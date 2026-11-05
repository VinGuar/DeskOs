import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Fresh temp dir plus a cleanup function. Safe to call cleanup twice.
 * The path is resolved (macOS /var -> /private/var, Windows 8.3 short names)
 * so it matches what child processes report as their cwd.
 */
export function makeTempDir(prefix = "deskos-test-"): { dir: string; cleanup: () => void } {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
}
