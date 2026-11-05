import { promises as fsp } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { type AtomicWriteOptions, errorCode, writeFileAtomic } from "./atomic.ts";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class CorruptRecordError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    super(`corrupt record: ${file}`, { cause });
    this.name = "CorruptRecordError";
    this.file = file;
  }
}

/**
 * One JSON file per record under a directory, each written atomically.
 * Used for operational state (jobs, pending actions) that is not a vault note.
 */
export class JsonStore<S extends z.ZodType> {
  readonly dir: string;
  readonly #schema: S;
  readonly #writeOpts: AtomicWriteOptions;

  constructor(dir: string, schema: S, writeOpts: AtomicWriteOptions = {}) {
    this.dir = dir;
    this.#schema = schema;
    this.#writeOpts = writeOpts;
  }

  async put(id: string, value: z.input<S>): Promise<z.output<S>> {
    const parsed = this.#schema.parse(value);
    await writeFileAtomic(this.#file(id), `${JSON.stringify(parsed, null, 2)}\n`, this.#writeOpts);
    return parsed;
  }

  /** Undefined when absent. Throws CorruptRecordError when present but unreadable or invalid. */
  async get(id: string): Promise<z.output<S> | undefined> {
    const file = this.#file(id);
    let text: string;
    try {
      text = await fsp.readFile(file, "utf8");
    } catch (err) {
      if (errorCode(err) === "ENOENT") return undefined;
      throw err;
    }
    try {
      return this.#schema.parse(JSON.parse(text));
    } catch (err) {
      throw new CorruptRecordError(file, err);
    }
  }

  /** True if a record was removed. */
  async delete(id: string): Promise<boolean> {
    try {
      await fsp.unlink(this.#file(id));
      return true;
    } catch (err) {
      if (errorCode(err) === "ENOENT") return false;
      throw err;
    }
  }

  /** Record ids, sorted. Ignores temp files and anything that is not `<id>.json`. */
  async ids(): Promise<string[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch (err) {
      if (errorCode(err) === "ENOENT") return [];
      throw err;
    }
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length))
      .filter((id) => ID_PATTERN.test(id))
      .sort();
  }

  #file(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`invalid record id: ${JSON.stringify(id)}`);
    return path.join(this.dir, `${id}.json`);
  }
}
