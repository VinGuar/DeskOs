import { promises as fsp } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { type Clock, systemClock } from "../clock.ts";
import { errorCode } from "./atomic.ts";

export interface JsonlLogOptions {
  clock?: Clock;
  /** Rotate the active file before an append would push it past this size. */
  maxBytes?: number;
}

export interface JsonlReadResult<T> {
  records: T[];
  /** Lines that failed to parse or validate, for example a line torn by a crash. */
  skipped: { file: string; line: number }[];
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Append-only JSON Lines file with size rotation. The active file is `<name>.jsonl`.
 * Rotated segments are `<name>.<utc stamp>-<n>.jsonl`, which sort in time order.
 * Appends within one instance are serialized, so lines never interleave.
 */
export class JsonlLog<S extends z.ZodType> {
  readonly file: string;
  readonly #schema: S;
  readonly #clock: Clock;
  readonly #maxBytes: number;
  #queue: Promise<unknown> = Promise.resolve();
  #checkedTail = false;

  constructor(file: string, schema: S, opts: JsonlLogOptions = {}) {
    if (!file.endsWith(".jsonl")) throw new Error(`log file must end in .jsonl: ${file}`);
    this.file = file;
    this.#schema = schema;
    this.#clock = opts.clock ?? systemClock;
    this.#maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async append(record: z.input<S>): Promise<z.output<S>> {
    const parsed = this.#schema.parse(record);
    const line = `${JSON.stringify(parsed)}\n`;
    const run = this.#queue.then(() => this.#write(line));
    this.#queue = run.catch(() => {});
    await run;
    return parsed;
  }

  /** All records, oldest segment first. */
  async read(): Promise<JsonlReadResult<z.output<S>>> {
    const result: JsonlReadResult<z.output<S>> = { records: [], skipped: [] };
    for (const file of await this.segments()) {
      const text = await fsp.readFile(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]?.replace(/\r$/, "") ?? "";
        if (raw === "") continue;
        const ok = this.#schema.safeParse(safeJson(raw));
        if (ok.success) result.records.push(ok.data);
        else result.skipped.push({ file, line: i + 1 });
      }
    }
    return result;
  }

  /** Segment paths, oldest first, active file last. */
  async segments(): Promise<string[]> {
    const dir = path.dirname(this.file);
    const stem = path.basename(this.file, ".jsonl");
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      if (errorCode(err) === "ENOENT") return [];
      throw err;
    }
    const rotated = names
      .filter((n) => n.startsWith(`${stem}.`) && n.endsWith(".jsonl") && n !== `${stem}.jsonl`)
      .sort();
    const out = rotated.map((n) => path.join(dir, n));
    if (names.includes(`${stem}.jsonl`)) out.push(this.file);
    return out;
  }

  async #write(line: string): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const size = await fileSize(this.file);
    let prefix = "";
    if (!this.#checkedTail) {
      // A crash mid-append can leave a line with no newline. Start fresh so the
      // next record is not glued onto it.
      this.#checkedTail = true;
      if (size > 0 && !(await endsWithNewline(this.file, size))) prefix = "\n";
    }
    if (size > 0 && size + prefix.length + Buffer.byteLength(line) > this.#maxBytes) {
      await this.#rotate();
      prefix = "";
    }
    await fsp.appendFile(this.file, prefix + line, { flush: true });
  }

  async #rotate(): Promise<void> {
    const dir = path.dirname(this.file);
    const stem = path.basename(this.file, ".jsonl");
    // No colons: they are illegal in Windows file names.
    const stamp = new Date(this.#clock.now()).toISOString().replace(/[-:]/g, "").replace(".", "");
    // Padded counter keeps same-millisecond rotations in order when sorted.
    for (let n = 0; ; n++) {
      const target = path.join(dir, `${stem}.${stamp}-${String(n).padStart(4, "0")}.jsonl`);
      if ((await fileSize(target)) < 0) {
        await fsp.rename(this.file, target);
        return;
      }
    }
  }
}

/** File size in bytes, or -1 if the file does not exist. */
async function fileSize(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).size;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return -1;
    throw err;
  }
}

async function endsWithNewline(file: string, size: number): Promise<boolean> {
  const handle = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(1);
    await handle.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
