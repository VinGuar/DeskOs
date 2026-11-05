import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { type Clock, systemClock } from "../clock.ts";
import { type AtomicWriteOptions, errorCode, writeFileAtomic } from "../storage/atomic.ts";
import { FrontmatterError, parseNote, serializeNote } from "./frontmatter.ts";
import { noteFileName, randomShortId } from "./naming.ts";
import { type BaseNoteFrontmatter, NoteSchemaRegistry } from "./schema.ts";

/** Operational state lives here inside each workspace folder. Never scanned as notes. */
export const INTERNAL_DIR = ".deskos";

export type NoteReadResult =
  | { status: "entity"; path: string; frontmatter: BaseNoteFrontmatter; body: string }
  /** No frontmatter, or frontmatter without a `type`: a user note DeskOS did not create. */
  | { status: "plain"; path: string; data: Record<string, unknown>; body: string }
  | { status: "invalid"; path: string; error: string };

export interface CreateNoteInput {
  type: string;
  title: string;
  /** Vault-relative folder, `/` separated. Default: the vault root. */
  folder?: string;
  fields?: Record<string, unknown>;
  body?: string;
}

export interface VaultOptions {
  root: string;
  clock?: Clock;
  schemas?: NoteSchemaRegistry;
  newId?: () => string;
  newShortId?: () => string;
  writeOptions?: AtomicWriteOptions;
}

export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

export class NoteValidationError extends Error {
  readonly path: string;
  constructor(notePath: string, message: string, options?: ErrorOptions) {
    super(`${notePath}: ${message}`, options);
    this.name = "NoteValidationError";
    this.path = notePath;
  }
}

const MAX_NAME_ATTEMPTS = 20;

/**
 * One workspace folder of markdown notes. Paths in and out are vault-relative
 * and `/` separated on every OS. Nothing outside the root, and nothing under
 * a dot folder, is ever read or written as a note.
 */
export class Vault {
  readonly root: string;
  readonly schemas: NoteSchemaRegistry;
  readonly #clock: Clock;
  readonly #newId: () => string;
  readonly #newShortId: () => string;
  readonly #writeOpts: AtomicWriteOptions;

  constructor(opts: VaultOptions) {
    this.root = path.resolve(opts.root);
    this.schemas = opts.schemas ?? new NoteSchemaRegistry();
    this.#clock = opts.clock ?? systemClock;
    this.#newId = opts.newId ?? randomUUID;
    this.#newShortId = opts.newShortId ?? randomShortId;
    this.#writeOpts = { clock: this.#clock, ...opts.writeOptions };
  }

  get internalDir(): string {
    return path.join(this.root, INTERNAL_DIR);
  }

  /** Absolute path for a vault-relative note path. Throws VaultPathError on anything unsafe. */
  resolve(notePath: string): string {
    return path.join(this.root, ...normalizeNotePath(notePath).split("/"));
  }

  async read(notePath: string): Promise<NoteReadResult> {
    const rel = normalizeNotePath(notePath);
    const text = await fsp.readFile(await this.#guarded(rel), "utf8");
    let parsed: ReturnType<typeof parseNote>;
    try {
      parsed = parseNote(text);
    } catch (err) {
      if (err instanceof FrontmatterError)
        return { status: "invalid", path: rel, error: err.message };
      throw err;
    }
    if (!("type" in parsed.data)) {
      return { status: "plain", path: rel, data: parsed.data, body: parsed.body };
    }
    const result = this.schemas.schemaFor(parsed.data.type).safeParse(parsed.data);
    if (!result.success) {
      return { status: "invalid", path: rel, error: formatIssues(result.error.issues) };
    }
    return { status: "entity", path: rel, frontmatter: result.data, body: parsed.body };
  }

  /** Validate and atomically write an entity note. Returns the frontmatter as written. */
  async write(
    notePath: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<BaseNoteFrontmatter> {
    const rel = normalizeNotePath(notePath);
    const result = this.schemas.schemaFor(frontmatter.type).safeParse(frontmatter);
    if (!result.success) {
      throw new NoteValidationError(rel, formatIssues(result.error.issues), {
        cause: result.error,
      });
    }
    await writeFileAtomic(
      await this.#guarded(rel),
      serializeNote(result.data, body),
      this.#writeOpts,
    );
    return result.data;
  }

  /** New entity note with a fresh id, timestamps from the clock, and a unique file name. */
  async create(
    input: CreateNoteInput,
  ): Promise<{ path: string; frontmatter: BaseNoteFrontmatter }> {
    const now = new Date(this.#clock.now()).toISOString();
    const frontmatter = {
      ...input.fields,
      id: this.#newId(),
      type: input.type,
      created_at: now,
      updated_at: now,
    };
    const folder = input.folder ? normalizeFolder(input.folder) : "";
    for (let i = 0; i < MAX_NAME_ATTEMPTS; i++) {
      const name = noteFileName(input.type, input.title, this.#newShortId());
      const rel = folder ? `${folder}/${name}` : name;
      if (await exists(this.resolve(rel))) continue;
      const written = await this.write(rel, frontmatter, input.body ?? "");
      return { path: rel, frontmatter: written };
    }
    throw new Error(`could not find a free file name for ${input.type} "${input.title}"`);
  }

  /**
   * Shallow-patch an entity note's frontmatter, keeping fields the patch does not
   * name (including unknown ones). Bumps updated_at. `id` and `type` are fixed.
   */
  async update(
    notePath: string,
    patch: Record<string, unknown>,
    body?: string,
  ): Promise<BaseNoteFrontmatter> {
    const current = await this.read(notePath);
    if (current.status !== "entity") {
      throw new NoteValidationError(current.path, `cannot update a ${current.status} note`);
    }
    for (const fixed of ["id", "type", "created_at"] as const) {
      if (fixed in patch && patch[fixed] !== current.frontmatter[fixed]) {
        throw new NoteValidationError(current.path, `${fixed} cannot change`);
      }
    }
    const next = {
      ...current.frontmatter,
      ...patch,
      updated_at: new Date(this.#clock.now()).toISOString(),
    };
    return this.write(current.path, next, body ?? current.body);
  }

  /** True if a note was removed. */
  async remove(notePath: string): Promise<boolean> {
    try {
      await fsp.unlink(await this.#guarded(notePath));
      return true;
    } catch (err) {
      if (errorCode(err) === "ENOENT") return false;
      throw err;
    }
  }

  /**
   * Every `.md` file in the vault (or under `folder`), as vault-relative `/` paths,
   * in a stable order. Skips dot files and folders (`.deskos`, `.obsidian`, temp
   * files) and does not follow symlinks, so a scan never leaves the workspace folder.
   * A missing folder, or a path that is a file, yields nothing.
   */
  async *walk(folder?: string): AsyncGenerator<string> {
    if (folder === undefined) {
      yield* walkDir(this.root, "");
      return;
    }
    const rel = normalizeFolder(folder);
    const abs = path.join(this.root, ...rel.split("/"));
    let real: string;
    try {
      if ((await fsp.lstat(abs)).isSymbolicLink()) return;
      real = await fsp.realpath(abs);
    } catch (err) {
      if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return;
      throw err;
    }
    if (!isInside(await fsp.realpath(this.root), real)) return;
    yield* walkDir(abs, rel);
  }

  /**
   * resolve(), plus a check that the real location is inside the real root,
   * so a symlinked file or folder cannot point a note path outside the vault.
   * A note that is itself a symlink is refused even if it points inside.
   */
  async #guarded(notePath: string): Promise<string> {
    const abs = this.resolve(notePath);
    const realRoot = await fsp.realpath(this.root);
    let probe = abs;
    let real: string | undefined;
    while (real === undefined) {
      try {
        if (probe === abs && (await fsp.lstat(abs)).isSymbolicLink()) {
          throw new VaultPathError(`note is a symlink: ${notePath}`);
        }
        real = path.join(await fsp.realpath(probe), path.relative(probe, abs));
      } catch (err) {
        if (errorCode(err) !== "ENOENT") throw err;
        const parent = path.dirname(probe);
        if (parent === probe) throw err;
        probe = parent;
      }
    }
    if (!isInside(realRoot, real)) throw new VaultPathError(`path leaves the vault: ${notePath}`);
    return abs;
  }
}

/** True if `child` is strictly below `root`. Both must be real (resolved) paths. */
function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function* walkDir(abs: string, rel: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch (err) {
    // A folder deleted mid-scan, or a file where a folder was expected, is not an error.
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return;
    throw err;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkDir(path.join(abs, entry.name), childRel);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) yield childRel;
  }
}

/** Canonical `/` form of a note path. Throws VaultPathError if unsafe. */
export function normalizeNotePath(notePath: string): string {
  const segments = pathSegments(notePath);
  const last = segments[segments.length - 1] ?? "";
  if (!last.toLowerCase().endsWith(".md")) throw new VaultPathError(`not a .md note: ${notePath}`);
  return segments.join("/");
}

function normalizeFolder(folder: string): string {
  return pathSegments(folder.replace(/[\\/]+$/, "")).join("/");
}

function pathSegments(p: string): string[] {
  if (p === "") throw new VaultPathError("empty path");
  if (p.includes("\0")) throw new VaultPathError("path contains NUL");
  if (path.isAbsolute(p) || path.win32.isAbsolute(p) || /^[A-Za-z]:/.test(p)) {
    throw new VaultPathError(`path must be vault-relative: ${p}`);
  }
  // Backslash is a separator here on every OS, so a path means the same thing everywhere.
  const segments = p.split(/[\\/]/);
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") throw new VaultPathError(`bad path segment in: ${p}`);
    if (s.startsWith(".")) throw new VaultPathError(`dot files and folders are internal: ${p}`);
  }
  return segments;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return false;
    throw err;
  }
}

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}
