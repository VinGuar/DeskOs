import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listRepoFiles, REPO_ROOT } from "./lib/repo-files.mjs";

function checkIgnore(rel: string): boolean {
  const res = spawnSync("git", ["check-ignore", "-q", "--no-index", rel], { cwd: REPO_ROOT });
  return res.status === 0;
}

describe("env files", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "packages/core/.env",
    "apps/daemon/.env.development",
  ])("%s is git-ignored", (rel) => {
    expect(checkIgnore(rel)).toBe(true);
  });

  it(".env.example is tracked", () => {
    expect(checkIgnore(".env.example")).toBe(false);
  });

  it("no real env file is in the repo", () => {
    const envFiles = listRepoFiles(REPO_ROOT).filter((f: string) =>
      /^\.env(\..+)?$/.test(path.posix.basename(f)),
    );
    expect(envFiles).toEqual([".env.example"]);
  });

  it(".env.example declares names only, with no values", () => {
    const lines = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "" && !l.startsWith("#"));
    for (const line of lines) expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/);
  });
});
