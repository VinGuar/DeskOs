import { describe, expect, it } from "vitest";
import { checkNoEmDash, findEmDashes } from "./no-em-dash.mjs";

const EM = String.fromCharCode(0x2014);

describe("findEmDashes", () => {
  it("finds every em dash with position", () => {
    expect(findEmDashes(`a ${EM} b\nc${EM}${EM}`)).toEqual([
      { line: 1, column: 3 },
      { line: 2, column: 2 },
      { line: 2, column: 3 },
    ]);
  });

  it("allows hyphens and en dashes", () => {
    expect(findEmDashes("a - b – c")).toEqual([]);
  });

  it("the real repo has none", () => {
    expect(checkNoEmDash()).toEqual([]);
  });
});
