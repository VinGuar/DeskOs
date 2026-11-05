import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FakeClock, makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineNoteSchema, NoteSchemaRegistry } from "./schema.ts";
import { normalizeNotePath, Vault, VaultPathError } from "./vault.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function tempDir(): string {
  const t = makeTempDir();
  cleanups.push(t.cleanup);
  return t.dir;
}

function setup(opts: { schemas?: NoteSchemaRegistry } = {}) {
  const root = tempDir();
  const clock = new FakeClock();
  let ids = 0;
  const shortIds = ["a1b2", "c3d4", "e5f6", "0a0b"];
  const vault = new Vault({
    root,
    clock,
    newId: () => `id-${++ids}`,
    newShortId: () => shortIds.shift() ?? "ffff",
    ...opts,
  });
  return { root, clock, vault };
}

const taskSchema = defineNoteSchema({ status: z.enum(["open", "done"]) });

function registryWithTask(): NoteSchemaRegistry {
  const r = new NoteSchemaRegistry();
  r.register("task", taskSchema);
  return r;
}

describe("Vault.create", () => {
  it("writes <type>-<slug>-<short-id>.md with id, timestamps, and fields", async () => {
    const { root, vault } = setup({ schemas: registryWithTask() });
    const { path: p, frontmatter } = await vault.create({
      type: "task",
      title: "Fix login timeout",
      folder: "Projects",
      fields: { status: "open" },
      body: "Details.\n",
    });
    expect(p).toBe("Projects/task-fix-login-timeout-a1b2.md");
    expect(frontmatter).toMatchObject({
      id: "id-1",
      type: "task",
      status: "open",
      schema_version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const text = readFileSync(
      path.join(root, "Projects", "task-fix-login-timeout-a1b2.md"),
      "utf8",
    );
    expect(text).toContain("type: task\n");
    expect(text.endsWith("---\nDetails.\n")).toBe(true);
  });

  it("picks a new short id when the name is taken", async () => {
    const { vault } = setup();
    const first = await vault.create({ type: "note", title: "Same" });
    // Force the next candidate to collide with the first file.
    const collide = new Vault({
      root: vault.root,
      newShortId: (() => {
        const q = ["a1b2", "beef"];
        return () => q.shift() ?? "ffff";
      })(),
    });
    const second = await collide.create({ type: "note", title: "Same" });
    expect(first.path).toBe("note-same-a1b2.md");
    expect(second.path).toBe("note-same-beef.md");
  });

  it("refuses fields that fail the type's schema and writes nothing", async () => {
    const { vault } = setup({ schemas: registryWithTask() });
    await expect(
      vault.create({ type: "task", title: "x", fields: { status: "bogus" } }),
    ).rejects.toThrow(/status/);
    const all: string[] = [];
    for await (const p of vault.walk()) all.push(p);
    expect(all).toEqual([]);
  });

  it("works with spaces and unicode in folder names", async () => {
    const { vault } = setup();
    const { path: p } = await vault.create({
      type: "note",
      title: "R\u00e9sum\u00e9",
      folder: "My Work/\u65e5\u672c",
    });
    expect(p).toBe("My Work/\u65e5\u672c/note-resume-a1b2.md");
    expect((await vault.read(p)).status).toBe("entity");
  });
});

describe("Vault.read", () => {
  it("round trip preserves unknown fields and the body", async () => {
    const { root, vault } = setup({ schemas: registryWithTask() });
    writeFileSync(
      path.join(root, "hand.md"),
      [
        "---",
        "id: x1",
        "type: task",
        "status: open",
        "created_at: 2026-01-01",
        "updated_at: 2026-01-02T09:30:00+02:00",
        "priority_by_me: high",
        "aliases: [one, two]",
        "---",
        "My notes [[Someone]].",
        "",
      ].join("\n"),
    );
    const read = await vault.read("hand.md");
    expect(read.status).toBe("entity");
    if (read.status !== "entity") return;
    expect(read.frontmatter).toMatchObject({ priority_by_me: "high", aliases: ["one", "two"] });

    await vault.write("hand.md", read.frontmatter, read.body);
    const again = await vault.read("hand.md");
    expect(again).toEqual(read);
  });

  it("reads CRLF notes", async () => {
    const { root, vault } = setup();
    writeFileSync(
      path.join(root, "crlf.md"),
      "---\r\nid: x\r\ntype: note\r\ncreated_at: 2026-01-01\r\nupdated_at: 2026-01-01\r\n---\r\nhi\r\n",
    );
    const read = await vault.read("crlf.md");
    expect(read).toMatchObject({ status: "entity", body: "hi\n" });
  });

  it("classifies notes DeskOS did not create as plain", async () => {
    const { root, vault } = setup();
    writeFileSync(path.join(root, "a.md"), "# no frontmatter\n");
    writeFileSync(path.join(root, "b.md"), "---\ntags: [x]\n---\ntext\n");
    expect(await vault.read("a.md")).toEqual({
      status: "plain",
      path: "a.md",
      data: {},
      body: "# no frontmatter\n",
    });
    expect(await vault.read("b.md")).toMatchObject({ status: "plain", data: { tags: ["x"] } });
  });

  it("reports invalid notes instead of throwing", async () => {
    const { root, vault } = setup({ schemas: registryWithTask() });
    writeFileSync(path.join(root, "bad-yaml.md"), "---\na: [\n---\n");
    writeFileSync(path.join(root, "bad-fields.md"), "---\ntype: task\nid: x\n---\n");
    expect(await vault.read("bad-yaml.md")).toMatchObject({ status: "invalid" });
    const bad = await vault.read("bad-fields.md");
    expect(bad.status).toBe("invalid");
    if (bad.status === "invalid") expect(bad.error).toMatch(/created_at/);
  });
});

describe("Vault.update", () => {
  it("patches fields, keeps unknown ones, bumps updated_at only", async () => {
    const { clock, vault } = setup({ schemas: registryWithTask() });
    const { path: p } = await vault.create({
      type: "task",
      title: "t",
      fields: { status: "open", mine: 1 },
      body: "b\n",
    });
    clock.advance(60_000);
    const next = await vault.update(p, { status: "done" });
    expect(next).toMatchObject({
      status: "done",
      mine: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:01:00.000Z",
    });
    expect(await vault.read(p)).toMatchObject({ body: "b\n" });
  });

  it.each(["id", "type", "created_at"])("refuses to change %s", async (field) => {
    const { vault } = setup();
    const { path: p } = await vault.create({ type: "note", title: "t" });
    await expect(vault.update(p, { [field]: "other" })).rejects.toThrow(/cannot change/);
  });

  it("refuses to update a plain note", async () => {
    const { root, vault } = setup();
    writeFileSync(path.join(root, "p.md"), "plain\n");
    await expect(vault.update("p.md", { a: 1 })).rejects.toThrow(/plain/);
  });
});

describe("Vault.walk", () => {
  it("lists .md files in stable order and skips dot folders, temp files, and other files", async () => {
    const { root, vault } = setup();
    mkdirSync(path.join(root, "B"), { recursive: true });
    mkdirSync(path.join(root, ".deskos", "jobs"), { recursive: true });
    mkdirSync(path.join(root, ".obsidian"), { recursive: true });
    writeFileSync(path.join(root, "B", "two.md"), "");
    writeFileSync(path.join(root, "a.md"), "");
    writeFileSync(path.join(root, "UPPER.MD"), "");
    writeFileSync(path.join(root, "image.png"), "");
    writeFileSync(path.join(root, ".a.md.1234.tmp"), "");
    writeFileSync(path.join(root, ".deskos", "jobs", "x.md"), "");
    writeFileSync(path.join(root, ".obsidian", "y.md"), "");
    const all: string[] = [];
    for await (const p of vault.walk()) all.push(p);
    expect(all).toEqual(["B/two.md", "UPPER.MD", "a.md"]);
  });

  it("does not follow a symlinked folder out of the vault", async () => {
    const { root, vault } = setup();
    const outside = tempDir();
    writeFileSync(path.join(outside, "secret.md"), "");
    // Junctions need no admin rights on Windows. The type is ignored elsewhere.
    symlinkSync(outside, path.join(root, "linked"), "junction");
    const all: string[] = [];
    for await (const p of vault.walk()) all.push(p);
    expect(all).toEqual([]);
    await expect(vault.read("linked/secret.md")).rejects.toThrow(VaultPathError);
    await expect(
      vault.write(
        "linked/new.md",
        { id: "x", type: "note", created_at: "2026-01-01", updated_at: "2026-01-01" },
        "",
      ),
    ).rejects.toThrow(VaultPathError);
    await expect(vault.remove("linked/secret.md")).rejects.toThrow(VaultPathError);
    expect(readFileSync(path.join(outside, "secret.md"), "utf8")).toBe("");
  });

  it("handles a folder removed during the scan", async () => {
    const { root, vault } = setup();
    mkdirSync(path.join(root, "gone"));
    writeFileSync(path.join(root, "gone", "x.md"), "");
    writeFileSync(path.join(root, "a.md"), "");
    const all: string[] = [];
    for await (const p of vault.walk()) {
      all.push(p);
      rmSync(path.join(root, "gone"), { recursive: true, force: true });
    }
    expect(all).toEqual(["a.md"]);
  });
});

describe("note paths", () => {
  it("normalizes backslashes to /", () => {
    expect(normalizeNotePath("A\\b.md")).toBe("A/b.md");
  });

  it.each([
    "../x.md",
    "a/../../x.md",
    "/etc/x.md",
    "C:\\x.md",
    "C:x.md",
    "\\\\server\\share\\x.md",
    ".deskos/jobs/x.md",
    ".DESKOS/x.md",
    "a//b.md",
    "a/./b.md",
    "x.txt",
    "x\0.md",
    "",
  ])("rejects %j", (p) => {
    expect(() => normalizeNotePath(p)).toThrow(VaultPathError);
  });

  it("keeps the internal dir off limits for every write path", async () => {
    const { vault } = setup();
    await expect(vault.create({ type: "note", title: "x", folder: ".deskos" })).rejects.toThrow(
      VaultPathError,
    );
    await expect(vault.remove(".deskos/x.md")).rejects.toThrow(VaultPathError);
  });
});
