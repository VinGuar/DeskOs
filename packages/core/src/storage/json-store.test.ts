import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CorruptRecordError, JsonStore } from "./json-store.ts";

const recordSchema = z.object({ id: z.string(), state: z.enum(["queued", "done"]) });

let cleanup: () => void = () => {};
afterEach(() => cleanup());

function store(): JsonStore<typeof recordSchema> {
  const t = makeTempDir();
  cleanup = t.cleanup;
  return new JsonStore(path.join(t.dir, ".deskos", "jobs"), recordSchema);
}

describe("JsonStore", () => {
  it("round trips a record as pretty JSON with a trailing newline", async () => {
    const s = store();
    await s.put("job-1", { id: "job-1", state: "queued" });
    expect(await s.get("job-1")).toEqual({ id: "job-1", state: "queued" });
    const text = readFileSync(path.join(s.dir, "job-1.json"), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("returns undefined for a missing record and an empty list for a missing dir", async () => {
    const s = store();
    expect(await s.get("nope")).toBeUndefined();
    expect(await s.ids()).toEqual([]);
  });

  it("rejects invalid values before touching disk", async () => {
    const s = store();
    await expect(s.put("a", { id: "a", state: "bogus" } as never)).rejects.toThrow();
    expect(await s.ids()).toEqual([]);
  });

  it("flags a corrupt file instead of returning garbage", async () => {
    const s = store();
    await s.put("a", { id: "a", state: "done" });
    writeFileSync(path.join(s.dir, "a.json"), "{ not json");
    await expect(s.get("a")).rejects.toBeInstanceOf(CorruptRecordError);
  });

  it("lists ids sorted and ignores temp and foreign files", async () => {
    const s = store();
    await s.put("b", { id: "b", state: "done" });
    await s.put("a", { id: "a", state: "done" });
    writeFileSync(path.join(s.dir, ".a.json.1234.tmp"), "");
    writeFileSync(path.join(s.dir, "notes.txt"), "");
    expect(await s.ids()).toEqual(["a", "b"]);
  });

  it("deletes", async () => {
    const s = store();
    await s.put("a", { id: "a", state: "done" });
    expect(await s.delete("a")).toBe(true);
    expect(await s.delete("a")).toBe(false);
    expect(readdirSync(s.dir)).toEqual([]);
  });

  it.each(["../escape", "a/b", "a\\b", "", "x.json", "has space"])("refuses id %j", async (id) => {
    const s = store();
    await expect(s.put(id, { id, state: "done" })).rejects.toThrow(/invalid record id/);
  });
});
