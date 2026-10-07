import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A throwaway git repo for tests of repo-level scripts. */
export function tempGitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "deskos-repo-"));
  const run = (args: string[]) => {
    const res = spawnSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    return { code: res.status, stdout: res.stdout, stderr: res.stderr };
  };
  const init = run(["init", "-q", "-b", "main"]);
  if (init.code !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return {
    dir,
    git: run,
    write(rel: string, content: string) {
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
}
