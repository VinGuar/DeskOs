import { afterEach, describe, expect, it } from "vitest";
import { checkBoundary, findBannedTerms, tokenize } from "./boundary.mjs";
import { tempGitRepo } from "./test-helpers.ts";

const terms = (text: string) => findBannedTerms(text).map((h) => h.term);

describe("tokenize", () => {
  it("splits identifiers on camelCase, acronyms, and separators", () => {
    expect(tokenize("gitStatus repo_path HTTPServer v2Git a-b").map((t) => t.token)).toEqual([
      "git",
      "Status",
      "repo",
      "path",
      "HTTP",
      "Server",
      "v2",
      "Git",
      "a",
      "b",
    ]);
  });

  it("reports 1-based columns", () => {
    expect(tokenize("  fooBar")).toEqual([
      { token: "foo", column: 3 },
      { token: "Bar", column: 6 },
    ]);
  });
});

describe("findBannedTerms", () => {
  it.each([
    ["const git = 1", "git"],
    ["new Branch()", "branch"],
    ["branches.length", "branch"],
    ["// commit the change", "commit"],
    ["onCommitted()", "commit"],
    ["createWorktree()", "worktree"],
    ["merge(a, b)", "merge"],
    ["mergeSnapshots", "merge"],
    ["DEPLOY_TARGET", "deploy"],
    ["deploymentId", "deploy"],
    ["repo_path", "repo"],
    ["listRepos()", "repo"],
    ["pull request", "pull request"],
    ["PullRequest", "pull request"],
    ["pull_requests", "pull request"],
    ["isCI", "CI"],
    ["MAX_CI_RUNS", "CI"],
  ])("flags %j as %s", (text, term) => {
    expect(terms(text)).toEqual([term]);
  });

  it.each([
    "digit",
    "repository",
    "emerge",
    "commitment",
    "github",
    "pullback request",
    "ci",
    "Ci",
    "CIRCLE",
    "special",
    "deployable",
  ])("does not flag %j", (text) => {
    expect(terms(text)).toEqual([]);
  });

  it("skips lines with the allow marker", () => {
    expect(terms("// boundary-allow: the rule bans the word git here")).toEqual([]);
  });

  it("reports line and column", () => {
    expect(findBannedTerms("ok\n  x = repo")).toEqual([
      { line: 2, column: 7, term: "repo", found: "repo" },
    ]);
  });
});

describe("checkBoundary", () => {
  let repo: ReturnType<typeof tempGitRepo> | undefined;
  afterEach(() => repo?.cleanup());

  it("flags guarded dirs, including file names, and ignores packs", () => {
    repo = tempGitRepo();
    repo.write("packages/core/src/clean.ts", "export const ok = 1;\n");
    repo.write("packages/core/src/leak.ts", "export const repoPath = '';\n");
    repo.write("packages/core/src/git-status.ts", "export {};\n");
    repo.write("packages/ui-core/src/panel.tsx", "// shows CI state\n");
    repo.write("packages/pack-swe/src/git.ts", "export const git = 'git';\n");
    const found = checkBoundary(repo.dir).map((v) => `${v.file}:${v.line}:${v.term}`);
    expect(found.sort()).toEqual([
      "packages/core/src/git-status.ts:0:git",
      "packages/core/src/leak.ts:1:repo",
      "packages/ui-core/src/panel.tsx:1:CI",
    ]);
  });

  it("the real repo has no violations", () => {
    expect(checkBoundary()).toEqual([]);
  });
});
