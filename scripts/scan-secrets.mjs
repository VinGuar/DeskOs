// Secret scanner for the pre-commit hook and CI.
//   node scripts/scan-secrets.mjs --staged   scan staged content (pre-commit)
//   node scripts/scan-secrets.mjs --all      scan every tracked or untracked, non-ignored file
//   node scripts/scan-secrets.mjs <files..>  scan specific files
// Exit 1 when anything is found. Matched values are never printed in full.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git, listRepoFiles, REPO_ROOT, readTextFile } from "./lib/repo-files.mjs";
import { findSecrets } from "./lib/secret-patterns.mjs";

const SKIP = new Set(["pnpm-lock.yaml"]);

/**
 * @param {{ file: string, text: string | null }[]} inputs
 */
export function scan(inputs) {
  /** @type {{ file: string, line: number, rule: string, preview: string }[]} */
  const out = [];
  for (const { file, text } of inputs) {
    if (text === null || SKIP.has(file)) continue;
    for (const hit of findSecrets(text)) out.push({ file, ...hit });
  }
  return out;
}

/**
 * Staged content of the repo at cwd. Git runs hooks from the repo root.
 * @param {string} cwd
 * @returns {{ file: string, text: string | null }[]}
 */
export function stagedInputs(cwd = process.cwd()) {
  const files = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], cwd)
    .split("\0")
    .filter(Boolean);
  return files.map((file) => {
    const blob = git(["show", `:${file}`], cwd);
    return { file, text: blob.includes("\0") ? null : blob };
  });
}

/**
 * @param {string[]} files repo-relative paths
 * @param {string} root
 */
export function fileInputs(files, root = REPO_ROOT) {
  return files.map((file) => ({ file, text: readTextFile(path.resolve(root, file)) }));
}

/** @param {string} root */
export function scanRepo(root = REPO_ROOT) {
  return scan(fileInputs(listRepoFiles(root), root));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const inputs =
    args[0] === "--staged"
      ? stagedInputs()
      : args[0] === "--all" || args.length === 0
        ? fileInputs(listRepoFiles())
        : fileInputs(args, process.cwd());
  const hits = scan(inputs);
  if (hits.length === 0) {
    console.log(`scan-secrets: ok (${inputs.length} file(s))`);
  } else {
    for (const h of hits) console.error(`${h.file}:${h.line}  ${h.rule}  ${h.preview}`);
    console.error(
      `scan-secrets: ${hits.length} possible secret(s). Remove them, or if a line is a known false positive, add the comment marker "secret-scan-allow" with a reason.`,
    );
    process.exitCode = 1;
  }
}
