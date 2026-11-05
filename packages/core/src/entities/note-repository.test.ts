import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FakeClock, makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { loadIndex } from "../search/index-sync.ts";
import { NoteIndex } from "../search/note-index.ts";
import { NoteSchemaRegistry } from "../vault/schema.ts";
import { Vault } from "../vault/vault.ts";
import { NoteRepository } from "./note-repository.ts";
import { personSchema, registerCoreNoteTypes, workItemSchema } from "./notes.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function setup() {
  const t = makeTempDir();
  cleanups.push(t.cleanup);
  const schemas = new NoteSchemaRegistry();
  registerCoreNoteTypes(schemas);
  const clock = new FakeClock();
  let n = 0;
  const vault = new Vault({ root: t.dir, clock, schemas, newId: () => `id-${++n}` });
  const index = new NoteIndex();
  const work = new NoteRepository(vault, index, "work-item", workItemSchema);
  const people = new NoteRepository(vault, index, "person", personSchema);
  return { root: t.dir, clock, vault, index, work, people };
}

describe("NoteRepository", () => {
  it("creates in the default folder and finds by id right away", async () => {
    const { work } = setup();
    const created = await work.create({ title: "Ship v1", priority: "high" }, { body: "Notes\n" });
    expect(created.path).toMatch(/^Work\/work-item-ship-v1-[0-9a-f]{4}\.md$/);
    expect(created.note).toMatchObject({ id: "id-1", status: "open", priority: "high" });
    const got = await work.get("id-1");
    expect(got).toMatchObject({ path: created.path, body: "Notes\n", note: { title: "Ship v1" } });
  });

  it("names person files from `name`", async () => {
    const { people } = setup();
    const p = await people.create({ name: "Sam Rivera" });
    expect(p.path).toMatch(/^People\/person-sam-rivera-/);
  });

  it("updates fields and keeps the index current", async () => {
    const { clock, work, index } = setup();
    const { note } = await work.create({ title: "Draft plan" });
    clock.advance(1000);
    const next = await work.update(note.id, { status: "done" });
    expect(next.note).toMatchObject({ status: "done", updated_at: "2026-01-01T00:00:01.000Z" });
    expect(index.getById(note.id)?.frontmatter).toMatchObject({ status: "done" });
    expect(work.list().map((w) => w.note.status)).toEqual(["done"]);
  });

  it("rejects an invalid patch and leaves the file unchanged", async () => {
    const { root, work } = setup();
    const { path: p, note } = await work.create({ title: "t" });
    const before = readFileSync(path.join(root, p), "utf8");
    await expect(work.update(note.id, { status: "someday" as never })).rejects.toThrow(/status/);
    expect(readFileSync(path.join(root, p), "utf8")).toBe(before);
  });

  it("does not return a note of another type for the same id", async () => {
    const { work, people } = setup();
    const { note } = await people.create({ name: "Sam" });
    expect(await work.get(note.id)).toBeUndefined();
    expect(work.list()).toEqual([]);
  });

  it("removes", async () => {
    const { root, work } = setup();
    const { path: p, note } = await work.create({ title: "t" });
    expect(await work.remove(note.id)).toBe(true);
    expect(await work.remove(note.id)).toBe(false);
    expect(() => readFileSync(path.join(root, p))).toThrow();
    expect(await work.get(note.id)).toBeUndefined();
  });

  it("heals a stale index instead of returning the wrong note", async () => {
    const { root, work, index } = setup();
    const { path: p, note } = await work.create({ title: "t" });
    // Someone deletes the file behind our back, the watcher has not caught up yet.
    rmSync(path.join(root, p));
    expect(await work.get(note.id)).toBeUndefined();
    expect(index.get(p)).toBeUndefined();
  });

  it("sees hand-written notes after a reconcile", async () => {
    const { root, vault } = setup();
    writeFileSync(
      path.join(root, "mine.md"),
      "---\nid: hand-1\ntype: work-item\ntitle: Mine\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n",
    );
    const { index } = await loadIndex(vault);
    const work = new NoteRepository(vault, index, "work-item", workItemSchema);
    expect((await work.get("hand-1"))?.note.title).toBe("Mine");
  });

  it("refuses a schema that conflicts with the registered one", () => {
    const { vault } = setup();
    expect(() => new NoteRepository(vault, new NoteIndex(), "work-item", personSchema)).toThrow(
      /different schema/,
    );
  });
});
