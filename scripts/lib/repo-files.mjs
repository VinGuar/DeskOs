// Shared file listing for repo checks. Uses git so ignored files (node_modules,
// build output) are skipped the same way everywhere.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
export function git(args, cwd = REPO_ROOT) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  }
  return res.stdout;
}

/**
 * Tracked plus untracked-but-not-ignored files, as repo-relative POSIX paths.
 * @param {string} root
 * @returns {string[]}
 */
export function listRepoFiles(root = REPO_ROOT) {
  return git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root)
    .split("\0")
    .filter((f) => f !== "" && existsSync(path.join(root, f)))
    .sort();
}

/**
 * Text content, or null for binary files (NUL byte in the first 8 KB).
 * @param {string} absPath
 * @returns {string | null}
 */
export function readTextFile(absPath) {
  const buf = readFileSync(absPath);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}
