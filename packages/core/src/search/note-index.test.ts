import { describe, expect, it } from "vitest";
import type { NoteReadResult } from "../vault/vault.ts";
import { NoteIndex, noteTitle } from "./note-index.ts";

const stamp = { mtimeMs: 1, size: 10 };

function entity(
  path: string,
  id: string,
  fields: Record<string, unknown>,
  body = "",
): NoteReadResult {
  return {
    status: "entity",
    path,
    frontmatter: {
      id,
      type: "note",
      schema_version: 1,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      ...fields,
    },
    body,
  };
}

function plain(path: string, body: string): NoteReadResult {
  return { status: "plain", path, data: {}, body };
}

describe("NoteIndex", () => {
  it("indexes entities, plain notes, and invalid notes, keyed by path and id", () => {
    const index = new NoteIndex();
    index.upsert(entity("a.md", "id-a", { title: "Alpha" }), stamp);
    index.upsert(plain("b.md", "# Beta heading\ntext"), stamp);
    index.upsert({ status: "invalid", path: "c.md", error: "bad" }, stamp);
    expect(index.size).toBe(3);
    expect(index.getById("id-a")?.path).toBe("a.md");
    expect(index.get("b.md")).toMatchObject({ status: "plain", title: "Beta heading" });
    expect(index.get("c.md")).toMatchObject({ status: "invalid", error: "bad", title: "c" });
    expect(index.list({ status: "entity" }).map((n) => n.path)).toEqual(["a.md"]);
    expect(index.list({ type: "note" }).map((n) => n.path)).toEqual(["a.md"]);
  });

  it("searches title and body, prefix and case and accent insensitive", () => {
    const index = new NoteIndex();
    index.upsert(entity("a.md", "1", { title: "Résumé draft" }, "nothing here"), stamp);
    index.upsert(plain("b.md", "the quarterly budget review"), stamp);
    expect(index.search("resume").map((h) => h.note.path)).toEqual(["a.md"]);
    expect(index.search("QUARTER").map((h) => h.note.path)).toEqual(["b.md"]);
    expect(index.search("budgat").map((h) => h.note.path)).toEqual(["b.md"]); // fuzzy, one edit
    expect(index.search("zebra")).toEqual([]);
  });

  it("ranks title matches above body matches", () => {
    const index = new NoteIndex();
    index.upsert(plain("body.md", "# Other\nlaunch launch"), stamp);
    index.upsert(entity("title.md", "1", { title: "Launch plan" }, "x"), stamp);
    expect(index.search("launch")[0]?.note.path).toBe("title.md");
  });

  it("filters search by type and honors limit", () => {
    const index = new NoteIndex();
    index.upsert(entity("a.md", "1", { type: "task", title: "ship it" }), stamp);
    index.upsert(entity("b.md", "2", { type: "note", title: "ship notes" }), stamp);
    index.upsert(plain("c.md", "ship"), stamp);
    expect(index.search("ship", { type: "task" }).map((h) => h.note.path)).toEqual(["a.md"]);
    expect(index.search("ship", { limit: 2 })).toHaveLength(2);
  });

  it("never makes invalid notes searchable", () => {
    const index = new NoteIndex();
    index.upsert({ status: "invalid", path: "secret-plan.md", error: "x" }, stamp);
    expect(index.search("secret")).toEqual([]);
  });

  it("upsert replaces old content and remove drops it from search and ids", () => {
    const index = new NoteIndex();
    index.upsert(entity("a.md", "1", {}, "apples"), stamp);
    index.upsert(entity("a.md", "1", {}, "oranges"), stamp);
    expect(index.search("apples")).toEqual([]);
    expect(index.search("oranges")).toHaveLength(1);
    expect(index.remove("a.md")).toBe(true);
    expect(index.remove("a.md")).toBe(false);
    expect(index.search("oranges")).toEqual([]);
    expect(index.getById("1")).toBeUndefined();
  });

  it("reports duplicate ids from copied files and resolves to the first path", () => {
    const index = new NoteIndex();
    index.upsert(entity("z.md", "same", {}), stamp);
    index.upsert(entity("a.md", "same", {}), stamp);
    expect(index.getById("same")?.path).toBe("a.md");
    expect(index.duplicateIds()).toEqual([{ id: "same", paths: ["a.md", "z.md"] }]);
    index.remove("a.md");
    expect(index.duplicateIds()).toEqual([]);
    expect(index.getById("same")?.path).toBe("z.md");
  });

  it("snapshot round trip keeps notes, ids, and search results", () => {
    const index = new NoteIndex();
    index.upsert(entity("a.md", "1", { title: "Alpha", extra: [1, 2] }, "kiwi"), stamp);
    index.upsert(plain("Sub/b.md", "banana"), { mtimeMs: 5, size: 6 });
    index.remove("a.md");
    index.upsert(entity("a.md", "1", { title: "Alpha" }, "kiwi fruit"), stamp);

    const loaded = NoteIndex.fromSnapshot(index.toSnapshot());
    expect(loaded).not.toBeNull();
    expect(loaded?.list()).toEqual(index.list());
    expect(loaded?.getById("1")?.path).toBe("a.md");
    expect(loaded?.search("kiwi").map((h) => h.note.path)).toEqual(["a.md"]);
    expect(loaded?.search("banana").map((h) => h.note.path)).toEqual(["Sub/b.md"]);
    // Still editable after load.
    loaded?.remove("Sub/b.md");
    expect(loaded?.search("banana")).toEqual([]);
  });

  it.each([
    ["not JSON", "{"],
    ["another format", JSON.stringify({ format: 999, notes: [], search: {} })],
    ["bad notes", JSON.stringify({ format: 1, notes: [{ path: 1 }], search: {} })],
    ["bad search data", JSON.stringify({ format: 1, notes: [], search: { nope: true } })],
  ])("fromSnapshot returns null for %s", (_name, text) => {
    expect(NoteIndex.fromSnapshot(text)).toBeNull();
  });
});

describe("noteTitle", () => {
  it("prefers frontmatter title, then first heading, then file name", () => {
    expect(noteTitle("A/x.md", " Given ", "# H")).toBe("Given");
    expect(noteTitle("A/x.md", undefined, "intro\n## Sub heading ##\n")).toBe("Sub heading");
    expect(noteTitle("A/My Note.MD", 42, "no heading")).toBe("My Note");
  });
});
