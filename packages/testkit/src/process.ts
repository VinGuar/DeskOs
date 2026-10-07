import { spawn } from "node:child_process";

export interface SpawnCaptureOptions {
  cwd?: string;
  /** Merged over process.env. */
  env?: Record<string, string>;
  /** Written to stdin, then stdin is closed. Stdin is closed immediately when omitted. */
  input?: string;
  /** Kill the child after this many ms. */
  timeoutMs?: number;
}

export interface SpawnCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawn with an argument array (never a shell string) and collect output. */
export function spawnCapture(
  command: string,
  args: readonly string[],
  opts: SpawnCaptureOptions = {},
): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, opts.timeoutMs);
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.stdin.end(opts.input ?? "");
  });
}
