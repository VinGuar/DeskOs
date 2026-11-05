import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { type Clock, systemClock } from "../clock.ts";

/** The file operations atomic writes use. Swappable so tests can inject faults. */
export interface AtomicFs {
  writeFile(file: string, data: string | Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
}

export const nodeAtomicFs: AtomicFs = {
  writeFile: (file, data) => fsp.writeFile(file, data, { flush: true }),
  rename: (from, to) => fsp.rename(from, to),
  unlink: (file) => fsp.unlink(file),
  mkdir: async (dir) => {
    await fsp.mkdir(dir, { recursive: true });
  },
};

export interface AtomicWriteOptions {
  fs?: AtomicFs;
  clock?: Clock;
  /** Delays between rename attempts. Windows returns EPERM/EBUSY/EACCES while another process holds the target. */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320] as const;
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Write a file so readers see either the old content or the new content, never
 * a mix. Writes a temp file in the same directory, then renames it over the
 * target. On failure the temp file is removed and the old file is untouched.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const fs = opts.fs ?? nodeAtomicFs;
  const clock = opts.clock ?? systemClock;
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const dir = path.dirname(target);
  // Leading dot keeps leftovers from a crash out of vault scans.
  const temp = path.join(dir, `.${path.basename(target)}.${randomBytes(4).toString("hex")}.tmp`);

  await fs.mkdir(dir);
  try {
    await fs.writeFile(temp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (err) {
        const delay = delays[attempt];
        if (delay === undefined || !RETRYABLE.has(errorCode(err))) throw err;
        await sleep(clock, delay);
      }
    }
  } catch (err) {
    await fs.unlink(temp).catch(() => {});
    throw err;
  }
}

export function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
}

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms);
  });
}
