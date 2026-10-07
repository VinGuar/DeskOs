import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFixtureLoader, fixtures, normalizeLineEndings } from "./fixtures.ts";

describe("normalizeLineEndings", () => {
  it("turns CRLF and lone CR into LF", () => {
    expect(normalizeLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("createFixtureLoader", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "deskos-fixtures-"));
    writeFileSync(path.join(dir, "crlf.txt"), "one\r\ntwo\r\n");
    writeFileSync(path.join(dir, "ok.json"), '{ "n": 3 }');
    writeFileSync(path.join(dir, "bad.json"), "{ nope");
    writeFileSync(path.join(dir, "lines.jsonl"), '{"a":1}\r\n\r\n{"a":2}\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("normalizes line endings on read", () => {
    expect(createFixtureLoader(dir).text("crlf.txt")).toBe("one\ntwo\n");
  });

  it("parses and validates JSON", () => {
    const f = createFixtureLoader(dir);
    expect(f.json("ok.json", z.object({ n: z.number() }))).toEqual({ n: 3 });
    expect(() => f.json("ok.json", z.object({ n: z.string() }))).toThrow(/failed schema/);
    expect(() => f.json("bad.json")).toThrow(/not valid JSON/);
  });

  it("parses JSONL and skips blank lines", () => {
    expect(createFixtureLoader(dir).jsonl("lines.jsonl")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("refuses paths outside the fixture dir", () => {
    const f = createFixtureLoader(dir);
    expect(() => f.resolve("../outside.txt")).toThrow(/escapes/);
    expect(() => f.resolve(path.join("..", "..", "x"))).toThrow(/escapes/);
    expect(() => f.resolve(path.resolve(dir, "ok.json"))).toThrow(/relative/);
    expect(() => f.resolve(".")).toThrow(/escapes/);
  });

  it("names the missing fixture", () => {
    expect(() => createFixtureLoader(dir).text("missing.txt")).toThrow(/missing\.txt/);
  });

  it("loads testkit's own fixtures", () => {
    const s = fixtures.json("fake-claude/success.json");
    expect(s).toHaveProperty("steps");
  });
});
