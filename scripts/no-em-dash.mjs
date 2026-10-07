// SPEC Section 0 rule 8: no em dashes anywhere in the repo.
// Run directly to check: `node scripts/no-em-dash.mjs`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRepoFiles, REPO_ROOT, readTextFile } from "./lib/repo-files.mjs";

// Built from the code point so this file never contains the character itself.
const EM_DASH = String.fromCharCode(0x2014);

/**
 * @param {string} text
 * @returns {{ line: number, column: number }[]}
 */
export function findEmDashes(text) {
  /** @type {{ line: number, column: number }[]} */
  const hits = [];
  text.split(/\r\n?|\n/).forEach((line, i) => {
    let col = line.indexOf(EM_DASH);
    while (col !== -1) {
      hits.push({ line: i + 1, column: col + 1 });
      col = line.indexOf(EM_DASH, col + 1);
    }
  });
  return hits;
}

/**
 * @param {string} root
 * @returns {{ file: string, line: number, column: number }[]}
 */
export function checkNoEmDash(root = REPO_ROOT) {
  /** @type {{ file: string, line: number, column: number }[]} */
  const out = [];
  for (const file of listRepoFiles(root)) {
    if (file === "pnpm-lock.yaml") continue;
    const text = readTextFile(path.join(root, file));
    if (text === null) continue;
    for (const hit of findEmDashes(text)) out.push({ file, ...hit });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = checkNoEmDash();
  if (hits.length === 0) {
    console.log("no-em-dash: ok");
  } else {
    for (const h of hits) console.error(`${h.file}:${h.line}:${h.column}  em dash`);
    console.error(`no-em-dash: ${hits.length} em dash(es). Use a comma, colon, or period.`);
    process.exitCode = 1;
  }
}
