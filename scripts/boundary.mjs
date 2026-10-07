// Boundary check (SPEC 3.1): packages/core and packages/ui-core must not use
// domain vocabulary. Run directly to check the repo: `node scripts/boundary.mjs`.
//
// Matching is per token. Identifiers are split on camelCase, `_`, `-`, and
// punctuation, so `gitStatus` and `repo_path` are caught, while `digit` and
// `repository` are not. Every term is case-insensitive except `CI`.
// A line containing the marker `boundary-allow:` plus a reason is skipped. Use
// it only in comments that explain this rule.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRepoFiles, REPO_ROOT, readTextFile } from "./lib/repo-files.mjs";

export const GUARDED_DIRS = ["packages/core", "packages/ui-core"];
export const ALLOW_MARKER = "boundary-allow:";

/** Banned single-token terms and the inflections we also reject, all lowercase. */
const TERM_FORMS = {
  git: ["git", "gits"],
  branch: ["branch", "branches", "branched", "branching"],
  commit: ["commit", "commits", "committed", "committing"],
  worktree: ["worktree", "worktrees"],
  merge: ["merge", "merges", "merged", "merging"],
  deploy: ["deploy", "deploys", "deployed", "deploying", "deployment", "deployments"],
  repo: ["repo", "repos"],
};

/** @type {Map<string, string>} form -> term */
const FORM_TO_TERM = new Map(
  Object.entries(TERM_FORMS).flatMap(([term, forms]) => forms.map((f) => [f, term])),
);

/**
 * Split a line into word tokens, breaking identifiers at camelCase boundaries.
 * @param {string} line
 * @returns {{ token: string, column: number }[]}
 */
export function tokenize(line) {
  /** @type {{ token: string, column: number }[]} */
  const out = [];
  for (const m of line.matchAll(/[A-Za-z0-9]+/g)) {
    const word = m[0];
    const start = m.index ?? 0;
    // Mark split points: fooBar -> foo|Bar, HTTPServer -> HTTP|Server, v2Git -> v2|Git.
    const marked = word
      .replace(/([a-z0-9])([A-Z])/g, "$1\u0000$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\u0000$2");
    let offset = 0;
    for (const part of marked.split("\u0000")) {
      out.push({ token: part, column: start + offset + 1 });
      offset += part.length;
    }
  }
  return out;
}

/**
 * @typedef {{ line: number, column: number, term: string, found: string }} TermHit
 */

/**
 * @param {string} text
 * @returns {TermHit[]}
 */
export function findBannedTerms(text) {
  /** @type {TermHit[]} */
  const hits = [];
  const lines = text.split(/\r\n?|\n/);
  lines.forEach((lineText, i) => {
    if (lineText.includes(ALLOW_MARKER)) return;
    const tokens = tokenize(lineText);
    tokens.forEach((t, j) => {
      const lower = t.token.toLowerCase();
      const term = FORM_TO_TERM.get(lower);
      if (term) {
        hits.push({ line: i + 1, column: t.column, term, found: t.token });
      } else if (t.token === "CI") {
        hits.push({ line: i + 1, column: t.column, term: "CI", found: t.token });
      } else if (lower === "pull") {
        const next = tokens[j + 1];
        const nextLower = next?.token.toLowerCase();
        if (nextLower === "request" || nextLower === "requests") {
          hits.push({
            line: i + 1,
            column: t.column,
            term: "pull request",
            found: `${t.token} ${next?.token}`,
          });
        }
      }
    });
  });
  return hits;
}

/**
 * @param {string} root
 * @param {string[]} dirs
 * @returns {(TermHit & { file: string })[]}
 */
export function checkBoundary(root = REPO_ROOT, dirs = GUARDED_DIRS) {
  const prefixes = dirs.map((d) => `${d.replace(/\\/g, "/").replace(/\/$/, "")}/`);
  /** @type {(TermHit & { file: string })[]} */
  const violations = [];
  for (const file of listRepoFiles(root)) {
    if (!prefixes.some((p) => file.startsWith(p))) continue;
    // The file name counts too: a file called git-status.ts is a leak.
    const text = readTextFile(path.join(root, file));
    for (const hit of findBannedTerms(file)) violations.push({ ...hit, file, line: 0 });
    if (text === null) continue;
    for (const hit of findBannedTerms(text)) violations.push({ ...hit, file });
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkBoundary();
  if (violations.length === 0) {
    console.log(`boundary: ok (${GUARDED_DIRS.join(", ")})`);
  } else {
    for (const v of violations) {
      const where = v.line === 0 ? `${v.file} (file name)` : `${v.file}:${v.line}:${v.column}`;
      console.error(`${where}  banned term "${v.term}" (found "${v.found}")`);
    }
    console.error(
      `boundary: ${violations.length} violation(s). Domain words belong in packs. See SPEC 3.1.`,
    );
    process.exitCode = 1;
  }
}
