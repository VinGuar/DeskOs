import type { z } from "zod";
import { syncNote } from "../search/index-sync.ts";
import type { NoteIndex } from "../search/note-index.ts";
import { errorCode } from "../storage/atomic.ts";
import type { NoteSchema } from "../vault/schema.ts";
import { type NoteReadResult, type Vault, VaultPathError } from "../vault/vault.ts";

/** Default vault folders for core note types. Users can move notes anywhere; these only seed new ones. */
export const DEFAULT_NOTE_FOLDERS: Readonly<Record<string, string>> = {
  "work-item": "Work",
  thread: "Threads",
  artifact: "Artifacts",
  person: "People",
  event: "Events",
  "context-snapshot": "Context",
};

export interface StoredNote<T> {
  path: string;
  note: T;
  body: string;
}

/**
 * Typed access to one note type in one vault. Looks notes up by id through the
 * index and keeps the index current on every write, so a read right after a
 * write never depends on the file watcher.
 */
export class NoteRepository<S extends NoteSchema> {
  readonly type: string;
  readonly #vault: Vault;
  readonly #index: NoteIndex;
  readonly #folder: string;

  constructor(
    vault: Vault,
    index: NoteIndex,
    type: string,
    schema: S,
    opts: { folder?: string } = {},
  ) {
    if (!vault.schemas.has(type)) vault.schemas.register(type, schema);
    else if (vault.schemas.schemaFor(type) !== schema) {
      throw new Error(`note type ${type} is registered with a different schema`);
    }
    this.type = type;
    this.#vault = vault;
    this.#index = index;
    this.#folder = opts.folder ?? DEFAULT_NOTE_FOLDERS[type] ?? "";
  }

  /**
   * New note. `fields` excludes id, type, and timestamps, which are generated.
   * The file name comes from `title`, else `name`, else "untitled".
   */
  async create(
    fields: Omit<z.input<S>, "id" | "type" | "created_at" | "updated_at">,
    opts: { body?: string; folder?: string } = {},
  ): Promise<StoredNote<z.output<S>>> {
    const f = fields as Record<string, unknown>;
    const fileTitle =
      [f.title, f.name].find((v): v is string => typeof v === "string") ?? "untitled";
    const folder = opts.folder ?? this.#folder;
    const created = await this.#vault.create({
      type: this.type,
      title: fileTitle,
      fields: f,
      body: opts.body ?? "",
      ...(folder ? { folder } : {}),
    });
    await syncNote(this.#vault, this.#index, created.path);
    return { path: created.path, note: created.frontmatter as z.output<S>, body: opts.body ?? "" };
  }

  /** Fresh from disk. Undefined if no valid note of this type has the id. */
  async get(id: string): Promise<StoredNote<z.output<S>> | undefined> {
    const known = this.#index.getById(id);
    if (!known || known.type !== this.type) return undefined;
    let read: NoteReadResult | undefined;
    try {
      read = await this.#vault.read(known.path);
    } catch (err) {
      if (errorCode(err) !== "ENOENT" && !(err instanceof VaultPathError)) throw err;
    }
    if (read?.status !== "entity" || read.frontmatter.id !== id) {
      // Index was stale. Fix it and report nothing rather than the wrong note.
      await syncNote(this.#vault, this.#index, known.path);
      return undefined;
    }
    return { path: read.path, note: read.frontmatter as z.output<S>, body: read.body };
  }

  async update(
    id: string,
    patch: Partial<z.input<S>>,
    body?: string,
  ): Promise<StoredNote<z.output<S>>> {
    const current = await this.get(id);
    if (!current) throw new Error(`no ${this.type} note with id ${id}`);
    const next = await this.#vault.update(current.path, patch as Record<string, unknown>, body);
    await syncNote(this.#vault, this.#index, current.path);
    return { path: current.path, note: next as z.output<S>, body: body ?? current.body };
  }

  /** True if a note was removed. */
  async remove(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) return false;
    const removed = await this.#vault.remove(current.path);
    this.#index.remove(current.path);
    return removed;
  }

  /** Every valid note of this type, from the index, sorted by path. Frontmatter only, no bodies. */
  list(): { path: string; note: z.output<S> }[] {
    return this.#index
      .list({ type: this.type, status: "entity" })
      .map((n) => ({ path: n.path, note: n.frontmatter as z.output<S> }));
  }
}
