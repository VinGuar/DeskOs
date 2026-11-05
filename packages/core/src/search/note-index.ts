import MiniSearch, { type Options } from "minisearch";
import { z } from "zod";
import type { NoteReadResult } from "../vault/vault.ts";

/** What the index keeps per note. The body is searchable but not stored. */
export const indexedNoteSchema = z.object({
  path: z.string(),
  status: z.enum(["entity", "plain", "invalid"]),
  id: z.string().optional(),
  type: z.string().optional(),
  title: z.string(),
  /** Entity notes only, for structured queries. */
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  mtimeMs: z.number(),
  size: z.number(),
});
export type IndexedNote = z.output<typeof indexedNoteSchema>;

export interface FileStamp {
  mtimeMs: number;
  size: number;
}

export interface NoteSearchOptions {
  type?: string;
  limit?: number;
}

export interface NoteSearchHit {
  note: IndexedNote;
  score: number;
}

/** Bump when the snapshot layout or search options change. Old snapshots are then rebuilt. */
export const INDEX_SNAPSHOT_FORMAT = 1;

interface SearchDoc {
  path: string;
  title: string;
  body: string;
}

const SEARCH_OPTIONS: Options<SearchDoc> = {
  idField: "path",
  fields: ["title", "body"],
  storeFields: [],
  // Case and accent insensitive: "Resume" finds "Résumé".
  processTerm: (term) => foldTerm(term) || null,
  searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2 },
  autoVacuum: true,
};

const snapshotSchema = z.object({
  format: z.literal(INDEX_SNAPSHOT_FORMAT),
  notes: z.array(indexedNoteSchema),
  search: z.record(z.string(), z.unknown()),
});

/**
 * In-memory view of one vault: note metadata by path and by id, plus full-text
 * search. A disposable cache: everything in it can be rebuilt from the files.
 */
export class NoteIndex {
  readonly #notes = new Map<string, IndexedNote>();
  readonly #byId = new Map<string, Set<string>>();
  #search: MiniSearch<SearchDoc>;

  constructor(search?: MiniSearch<SearchDoc>) {
    this.#search = search ?? new MiniSearch(SEARCH_OPTIONS);
  }

  get size(): number {
    return this.#notes.size;
  }

  upsert(read: NoteReadResult, stamp: FileStamp): IndexedNote {
    this.remove(read.path);
    const note = toIndexedNote(read, stamp);
    this.#add(note);
    if (read.status !== "invalid") {
      this.#search.add({ path: read.path, title: note.title, body: read.body });
    }
    return note;
  }

  /** True if the path was indexed. */
  remove(notePath: string): boolean {
    const note = this.#notes.get(notePath);
    if (!note) return false;
    this.#notes.delete(notePath);
    if (note.id !== undefined) {
      const paths = this.#byId.get(note.id);
      paths?.delete(notePath);
      if (paths?.size === 0) this.#byId.delete(note.id);
    }
    if (this.#search.has(notePath)) this.#search.discard(notePath);
    return true;
  }

  get(notePath: string): IndexedNote | undefined {
    return this.#notes.get(notePath);
  }

  /** The entity with this id. If a file was copied and two notes share an id, the first path wins. */
  getById(id: string): IndexedNote | undefined {
    const paths = this.#byId.get(id);
    if (!paths || paths.size === 0) return undefined;
    const first = [...paths].sort()[0];
    return first === undefined ? undefined : this.#notes.get(first);
  }

  /** Ids claimed by more than one note, for surfacing to the user. */
  duplicateIds(): { id: string; paths: string[] }[] {
    return [...this.#byId]
      .filter(([, paths]) => paths.size > 1)
      .map(([id, paths]) => ({ id, paths: [...paths].sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Notes sorted by path, optionally filtered. */
  list(filter: { type?: string; status?: IndexedNote["status"] } = {}): IndexedNote[] {
    return [...this.#notes.values()]
      .filter((n) => filter.type === undefined || n.type === filter.type)
      .filter((n) => filter.status === undefined || n.status === filter.status)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  search(query: string, opts: NoteSearchOptions = {}): NoteSearchHit[] {
    const hits: NoteSearchHit[] = [];
    const filter =
      opts.type === undefined
        ? undefined
        : (r: { id: string }) => this.#notes.get(r.id)?.type === opts.type;
    for (const r of this.#search.search(query, filter ? { filter } : {})) {
      const note = this.#notes.get(r.id);
      if (note) hits.push({ note, score: r.score });
      if (opts.limit !== undefined && hits.length >= opts.limit) break;
    }
    return hits;
  }

  toSnapshot(): string {
    return JSON.stringify({
      format: INDEX_SNAPSHOT_FORMAT,
      notes: [...this.#notes.values()],
      search: this.#search.toJSON(),
    });
  }

  /** Null when the snapshot is unreadable or from another format version: rebuild instead. */
  static fromSnapshot(text: string): NoteIndex | null {
    try {
      const parsed = snapshotSchema.parse(JSON.parse(text));
      const search = MiniSearch.loadJS(
        parsed.search as unknown as Parameters<typeof MiniSearch.loadJS>[0],
        SEARCH_OPTIONS,
      );
      const index = new NoteIndex(search);
      for (const note of parsed.notes) index.#add(note);
      return index;
    } catch {
      return null;
    }
  }

  #add(note: IndexedNote): void {
    this.#notes.set(note.path, note);
    if (note.id !== undefined) {
      const paths = this.#byId.get(note.id) ?? new Set<string>();
      paths.add(note.path);
      this.#byId.set(note.id, paths);
    }
  }
}

function toIndexedNote(read: NoteReadResult, stamp: FileStamp): IndexedNote {
  const base = { path: read.path, mtimeMs: stamp.mtimeMs, size: stamp.size };
  switch (read.status) {
    case "entity":
      return {
        ...base,
        status: "entity",
        id: read.frontmatter.id,
        type: read.frontmatter.type,
        title: noteTitle(read.path, read.frontmatter.title, read.body),
        frontmatter: read.frontmatter,
      };
    case "plain":
      return { ...base, status: "plain", title: noteTitle(read.path, read.data.title, read.body) };
    case "invalid":
      return {
        ...base,
        status: "invalid",
        title: noteTitle(read.path, undefined, ""),
        error: read.error,
      };
  }
}

/** Frontmatter `title`, else the first markdown heading (any level), else the file name. */
export function noteTitle(notePath: string, title: unknown, body: string): string {
  if (typeof title === "string" && title.trim() !== "") return title.trim();
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1];
  if (heading) return heading;
  const name = notePath.slice(notePath.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

function foldTerm(term: string): string {
  return term
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}
