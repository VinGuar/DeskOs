// Points git at the repo's tracked hooks in .githooks. Runs on `pnpm install`.
// No-op outside a git checkout (for example a tarball install).
import { spawnSync } from "node:child_process";

const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
if (inRepo.status !== 0 || inRepo.stdout.trim() !== "true") {
  process.exit(0);
}
const set = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { encoding: "utf8" });
if (set.status !== 0) {
  console.warn(`install-hooks: could not set core.hooksPath: ${set.stderr.trim()}`);
}
