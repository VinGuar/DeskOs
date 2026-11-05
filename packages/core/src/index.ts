export { type Clock, systemClock, type TimerHandle } from "./clock.ts";
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
