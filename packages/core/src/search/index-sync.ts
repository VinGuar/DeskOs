import { promises as fsp } from "node:fs";
import path from "node:path";
import { errorCode, writeFileAtomic } from "../storage/atomic.ts";
import { type Vault, VaultPathError } from "../vault/vault.ts";
import { NoteIndex } from "./note-index.ts";

export const INDEX_SNAPSHOT_FILE = "index.snapshot";

export interface IndexChanges {
  upserted: string[];
  removed: string[];
}

export function emptyChanges(): IndexChanges {
  return { upserted: [], removed: [] };
}

/**
 * Bring the index in line with the files on disk (all of them, or those under
 * `folder`, a normalized `/` vault path). Only files whose size or mtime changed are re-read.
 */
export async function reconcileIndex(
  vault: Vault,
  index: NoteIndex,
  opts: { folder?: string } = {},
): Promise<IndexChanges> {
  const changes = emptyChanges();
  const seen = new Set<string>();
  for await (const notePath of opts.folder === undefined ? vault.walk() : vault.walk(opts.folder)) {
    seen.add(notePath);
    const stamp = await statNote(vault, notePath);
    const known = index.get(notePath);
    if (stamp && known && known.mtimeMs === stamp.mtimeMs && known.size === stamp.size) continue;
    await syncOne(vault, index, notePath, changes);
  }
  const prefix = opts.folder === undefined ? "" : `${opts.folder}/`;
  for (const note of index.list()) {
    if (note.path.startsWith(prefix) && !seen.has(note.path)) {
      index.remove(note.path);
      changes.removed.push(note.path);
    }
  }
  return changes;
}

/** Re-read one note into the index, or drop it if it is gone or no longer readable as a note. */
export async function syncNote(
  vault: Vault,
  index: NoteIndex,
  notePath: string,
): Promise<IndexChanges> {
  const changes = emptyChanges();
  await syncOne(vault, index, notePath, changes);
  return changes;
}

async function syncOne(vault: Vault, index: NoteIndex, notePath: string, changes: IndexChanges) {
  // Stat before read: if the file changes in between, the stale stamp forces a re-read next time.
  const stamp = await statNote(vault, notePath);
  if (stamp) {
    try {
      index.upsert(await vault.read(notePath), stamp);
      changes.upserted.push(notePath);
      return;
    } catch (err) {
      if (!(err instanceof VaultPathError) && errorCode(err) !== "ENOENT") throw err;
    }
  }
  if (index.remove(notePath)) changes.removed.push(notePath);
}

async function statNote(vault: Vault, notePath: string) {
  try {
    const s = await fsp.lstat(vault.resolve(notePath));
    return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null;
  } catch (err) {
    if (
      err instanceof VaultPathError ||
      errorCode(err) === "ENOENT" ||
      errorCode(err) === "ENOTDIR"
    ) {
      return null;
    }
    throw err;
  }
}

export function snapshotPath(vault: Vault): string {
  return path.join(vault.internalDir, INDEX_SNAPSHOT_FILE);
}

/**
 * Load the snapshot if there is a usable one, then reconcile with the files.
 * A missing, corrupt, or outdated snapshot means a full rebuild. Never fails
 * because of the snapshot.
 */
export async function loadIndex(
  vault: Vault,
): Promise<{ index: NoteIndex; fromSnapshot: boolean; changes: IndexChanges }> {
  let index: NoteIndex | null = null;
  try {
    index = NoteIndex.fromSnapshot(await fsp.readFile(snapshotPath(vault), "utf8"));
  } catch {
    // Missing or unreadable: rebuild.
  }
  const fromSnapshot = index !== null;
  const usable = index ?? new NoteIndex();
  const changes = await reconcileIndex(vault, usable);
  return { index: usable, fromSnapshot, changes };
}

export async function saveIndexSnapshot(vault: Vault, index: NoteIndex): Promise<void> {
  await writeFileAtomic(snapshotPath(vault), index.toSnapshot());
}
