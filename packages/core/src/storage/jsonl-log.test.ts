import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FakeClock, makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonlLog } from "./jsonl-log.ts";

const entrySchema = z.object({ n: z.number() });

let cleanup: () => void = () => {};
afterEach(() => cleanup());

function dir(): string {
  const t = makeTempDir();
  cleanup = t.cleanup;
  return t.dir;
}

describe("JsonlLog", () => {
  it("appends one JSON object per line and reads them back in order", async () => {
    const d = dir();
    const log = new JsonlLog(path.join(d, ".deskos", "audit.jsonl"), entrySchema);
    await log.append({ n: 1 });
    await log.append({ n: 2 });
    expect(readFileSync(log.file, "utf8")).toBe('{"n":1}\n{"n":2}\n');
    expect((await log.read()).records).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("serializes concurrent appends so lines never interleave", async () => {
    const d = dir();
    const log = new JsonlLog(path.join(d, "audit.jsonl"), entrySchema);
    await Promise.all(Array.from({ length: 200 }, (_, n) => log.append({ n })));
    const { records, skipped } = await log.read();
    expect(skipped).toEqual([]);
    expect(records.map((r) => r.n)).toEqual(Array.from({ length: 200 }, (_, n) => n));
  });

  it("rejects invalid records and keeps accepting valid ones", async () => {
    const d = dir();
    const log = new JsonlLog(path.join(d, "audit.jsonl"), entrySchema);
    await expect(log.append({ n: "x" } as never)).rejects.toThrow();
    await log.append({ n: 1 });
    expect((await log.read()).records).toEqual([{ n: 1 }]);
  });

  it("skips a line torn by a crash and does not glue the next record onto it", async () => {
    const d = dir();
    const file = path.join(d, "audit.jsonl");
    writeFileSync(file, '{"n":1}\n{"n":');
    const log = new JsonlLog(file, entrySchema);
    await log.append({ n: 2 });
    const { records, skipped } = await log.read();
    expect(records).toEqual([{ n: 1 }, { n: 2 }]);
    expect(skipped).toEqual([{ file, line: 2 }]);
  });

  it("reads CRLF lines written by another tool", async () => {
    const d = dir();
    const file = path.join(d, "audit.jsonl");
    appendFileSync(file, '{"n":1}\r\n{"n":2}\r\n');
    expect((await new JsonlLog(file, entrySchema).read()).records).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("rotates by size into time-ordered segments with no colons in the name", async () => {
    const d = dir();
    const clock = new FakeClock();
    const log = new JsonlLog(path.join(d, "audit.jsonl"), entrySchema, { clock, maxBytes: 20 });
    for (let n = 0; n < 6; n++) await log.append({ n }); // each line is 8 bytes, 2 per segment
    const names = readdirSync(d).sort();
    expect(names).toEqual([
      "audit.20260101T000000000Z-0000.jsonl",
      "audit.20260101T000000000Z-0001.jsonl",
      "audit.jsonl",
    ]);
    expect(names.join("")).not.toContain(":");
    expect((await log.read()).records.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reads nothing when the log does not exist yet", async () => {
    const d = dir();
    const log = new JsonlLog(path.join(d, "missing", "audit.jsonl"), entrySchema);
    expect(await log.read()).toEqual({ records: [], skipped: [] });
  });
});
