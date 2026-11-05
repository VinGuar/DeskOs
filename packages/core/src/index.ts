export { type Clock, systemClock, type TimerHandle } from "./clock.ts";
export {
  emptyChanges,
  INDEX_SNAPSHOT_FILE,
  type IndexChanges,
  loadIndex,
  reconcileIndex,
  saveIndexSnapshot,
  snapshotPath,
  syncNote,
} from "./search/index-sync.ts";
export {
  type FileStamp,
  INDEX_SNAPSHOT_FORMAT,
  type IndexedNote,
  indexedNoteSchema,
  NoteIndex,
  type NoteSearchHit,
  type NoteSearchOptions,
  noteTitle,
} from "./search/note-index.ts";
export {
  nodeWatch,
  VaultWatcher,
  type VaultWatcherOptions,
  type WatchFn,
} from "./search/vault-watcher.ts";
export {
  type AtomicFs,
  type AtomicWriteOptions,
  nodeAtomicFs,
  writeFileAtomic,
} from "./storage/atomic.ts";
export { CorruptRecordError, JsonStore } from "./storage/json-store.ts";
export { JsonlLog, type JsonlLogOptions, type JsonlReadResult } from "./storage/jsonl-log.ts";
export {
  FrontmatterError,
  type ParsedNote,
  parseNote,
  serializeNote,
} from "./vault/frontmatter.ts";
export { isNoteType, noteFileName, randomShortId, slugify } from "./vault/naming.ts";
export {
  type BaseNoteFrontmatter,
  baseNoteSchema,
  baseNoteShape,
  defineNoteSchema,
  NOTE_SCHEMA_VERSION,
  type NoteSchema,
  NoteSchemaRegistry,
  noteTimestampSchema,
} from "./vault/schema.ts";
export {
  type CreateNoteInput,
  INTERNAL_DIR,
  type NoteReadResult,
  NoteValidationError,
  normalizeNotePath,
  Vault,
  type VaultOptions,
  VaultPathError,
} from "./vault/vault.ts";
