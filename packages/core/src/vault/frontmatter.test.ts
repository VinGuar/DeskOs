import { describe, expect, it } from "vitest";
import { FrontmatterError, parseNote, serializeNote } from "./frontmatter.ts";

describe("parseNote", () => {
  it("splits frontmatter and body", () => {
    const note = parseNote("---\ntype: task\ntitle: Hi\n---\n# Body\n");
    expect(note).toEqual({
      data: { type: "task", title: "Hi" },
      hasFrontmatter: true,
      body: "# Body\n",
    });
  });

  it("treats a note with no frontmatter as all body", () => {
    expect(parseNote("# Just text\n")).toEqual({
      data: {},
      hasFrontmatter: false,
      body: "# Just text\n",
    });
  });

  it("normalizes CRLF and strips a BOM", () => {
    const note = parseNote("﻿---\r\ntype: task\r\n---\r\nline 1\r\nline 2\r\n");
    expect(note.data).toEqual({ type: "task" });
    expect(note.body).toBe("line 1\nline 2\n");
  });

  it("keeps dates and yes/no as strings (YAML 1.2 core schema)", () => {
    const note = parseNote("---\ncreated_at: 2026-01-01\nanswer: no\ncount: 3\n---\n");
    expect(note.data).toEqual({ created_at: "2026-01-01", answer: "no", count: 3 });
  });

  it("accepts an empty frontmatter block and a body-less note", () => {
    expect(parseNote("---\n---\n")).toEqual({ data: {}, hasFrontmatter: true, body: "" });
    expect(parseNote("---\na: 1\n---").body).toBe("");
  });

  it("keeps a later --- line in the body", () => {
    expect(parseNote("---\na: 1\n---\nabove\n---\nbelow\n").body).toBe("above\n---\nbelow\n");
  });

  it.each([
    ["unclosed block", "---\na: 1\n"],
    ["bad YAML", "---\na: [1\n---\n"],
    ["duplicate keys", "---\na: 1\na: 2\n---\n"],
    ["a list instead of a mapping", "---\n- a\n- b\n---\n"],
    ["a scalar instead of a mapping", "---\nhello\n---\n"],
  ])("rejects %s", (_name, text) => {
    expect(() => parseNote(text)).toThrow(FrontmatterError);
  });
});

describe("serializeNote", () => {
  it("round trips data, unknown fields, unicode, and body", () => {
    const data = {
      id: "abc",
      type: "task",
      title: "Café: 日本",
      my_custom_field: { nested: [1, "two", null] },
      tags: ["a", "b"],
      long: "x".repeat(200),
    };
    const body = "# Heading\n\nSome [[link]] text.\n";
    const text = serializeNote(data, body);
    expect(text.startsWith("---\n")).toBe(true);
    expect(parseNote(text)).toEqual({ data, hasFrontmatter: true, body });
  });

  it("quotes strings that would otherwise read back as another type", () => {
    const data = { id: "1234", flag: "true", when: "2026-01-01", empty: "" };
    expect(parseNote(serializeNote(data, "")).data).toEqual(data);
  });

  it("writes LF even when the body has CRLF", () => {
    expect(serializeNote({ a: 1 }, "x\r\ny\r\n")).toBe("---\na: 1\n---\nx\ny\n");
  });

  it("writes an empty block for empty data", () => {
    expect(serializeNote({}, "b")).toBe("---\n---\nb");
  });
});
