import { z } from "zod";
import { isNoteType } from "./naming.ts";

/** Current version of the base frontmatter shape. Changes are additive only. */
export const NOTE_SCHEMA_VERSION = 1;

/** ISO 8601 timestamp with offset, or a bare date (common in hand-written notes). */
export const noteTimestampSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);

/**
 * Marks AI-produced content and what it was built from, so a citation checker
 * can trace every claim back to real notes (SPEC 4.6).
 */
export const derivedSchema = z.looseObject({
  model: z.string().min(1),
  prompt_version: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  generated_at: noteTimestampSchema,
});
export type Derived = z.output<typeof derivedSchema>;

/**
 * Fields every entity note carries. Loose: unknown fields pass through so
 * hand edits survive a read and rewrite.
 */
export const baseNoteShape = {
  id: z.string().min(1),
  type: z.string().refine(isNoteType, "type must be lowercase words joined by dashes"),
  schema_version: z.number().int().positive().default(NOTE_SCHEMA_VERSION),
  created_at: noteTimestampSchema,
  updated_at: noteTimestampSchema,
  source: z.string().min(1).optional(),
  source_ref: z.string().min(1).optional(),
  links: z.array(z.string()).optional(),
  /** Ingested third-party content. Always treated as untrusted data. */
  raw: z.boolean().optional(),
  /** Present when this note's content was produced by a model. */
  derived: derivedSchema.optional(),
};

export const baseNoteSchema = z.looseObject(baseNoteShape);
export type BaseNoteFrontmatter = z.output<typeof baseNoteSchema>;

/** A schema for one note type. Must accept everything baseNoteSchema requires. */
export type NoteSchema = z.ZodType<BaseNoteFrontmatter, Record<string, unknown>>;

/** Per-type frontmatter schema: the base fields plus `extra`, still loose. */
export function defineNoteSchema<E extends z.ZodRawShape>(extra: E) {
  return z.looseObject({ ...baseNoteShape, ...extra });
}

/**
 * Maps note types to schemas. Core registers generic types, packs register
 * their own. Types with no registration validate against the base schema.
 */
export class NoteSchemaRegistry {
  readonly #schemas = new Map<string, NoteSchema>();

  register(type: string, schema: NoteSchema): void {
    if (!isNoteType(type)) throw new Error(`invalid note type: ${JSON.stringify(type)}`);
    if (this.#schemas.has(type)) throw new Error(`note type already registered: ${type}`);
    this.#schemas.set(type, schema);
  }

  unregister(type: string): boolean {
    return this.#schemas.delete(type);
  }

  has(type: string): boolean {
    return this.#schemas.has(type);
  }

  schemaFor(type: unknown): NoteSchema {
    return (typeof type === "string" && this.#schemas.get(type)) || baseNoteSchema;
  }
}
