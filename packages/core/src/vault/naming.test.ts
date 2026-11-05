import { describe, expect, it } from "vitest";
import { isNoteType, MAX_SLUG_LENGTH, noteFileName, randomShortId, slugify } from "./naming.ts";

describe("slugify", () => {
  it.each([
    ["Fix login timeout", "fix-login-timeout"],
    ["  Café crème  ", "cafe-creme"],
    ['a/b\\c:d*e?f"g<h>i|j', "a-b-c-d-e-f-g-h-i-j"],
    ["日本語 メモ", "日本語-メモ"],
    ["!!!", "untitled"],
    ["", "untitled"],
    ["Q3 Plan v2.1", "q3-plan-v2-1"],
  ])("%j -> %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("caps length without a trailing dash", () => {
    const slug = slugify(`${"word ".repeat(30)}`);
    expect(Array.from(slug).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("noteFileName", () => {
  it("builds <type>-<slug>-<short-id>.md", () => {
    expect(noteFileName("task", "Fix login timeout", "a1b2")).toBe(
      "task-fix-login-timeout-a1b2.md",
    );
  });

  it.each(["Task", "has space", "-x", "x_y", ""])("rejects type %j", (type) => {
    expect(() => noteFileName(type, "t", "a1b2")).toThrow(/invalid note type/);
  });

  it("rejects an unsafe short id", () => {
    expect(() => noteFileName("task", "t", "../x")).toThrow(/invalid short id/);
  });
});

describe("randomShortId", () => {
  it("is lowercase hex of the requested length", () => {
    for (let i = 0; i < 50; i++) expect(randomShortId()).toMatch(/^[0-9a-f]{4}$/);
    expect(randomShortId(7)).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe("isNoteType", () => {
  it("accepts dashed lowercase words", () => {
    expect(isNoteType("meeting-notes")).toBe(true);
    expect(isNoteType("meeting--notes")).toBe(false);
  });
});
