import { z } from "zod";
import { defineNoteSchema, type NoteSchemaRegistry, noteTimestampSchema } from "../vault/schema.ts";

/**
 * Role-neutral entities that live as vault notes (SPEC 3.2, 4.6). Packs map
 * their own domain onto these and may add fields; unknown fields pass through.
 * References to other entities are their ids (or `[[wikilinks]]` in `links`).
 */

const ref = z.string().min(1);
const title = z.string().min(1);

export const WORK_ITEM_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** A unit of work with status, owner, due date, and links. */
export const workItemSchema = defineNoteSchema({
  title,
  status: z.enum(WORK_ITEM_STATUSES).default("open"),
  owner: ref.optional(),
  due: noteTimestampSchema.optional(),
  priority: z.enum(PRIORITIES).optional(),
  tags: z.array(z.string()).optional(),
});

/** A conversation from any source. Raw messages are separate notes with `raw: true`. */
export const threadSchema = defineNoteSchema({
  title,
  participants: z.array(ref).default([]),
  last_activity_at: noteTimestampSchema.optional(),
  work_item: ref.optional(),
});

/** Something produced or edited. `kind` is an open string packs define. */
export const artifactSchema = defineNoteSchema({
  title,
  kind: z.string().min(1),
  /** File path or URL. */
  location: z.string().min(1).optional(),
  work_item: ref.optional(),
});

/** Someone involved. Handles map a source name to that person's id there. */
export const personSchema = defineNoteSchema({
  name: z.string().min(1),
  emails: z.array(z.string().min(3)).optional(),
  handles: z.record(z.string(), z.string()).optional(),
  org: z.string().optional(),
});

/** Something on a timeline. `timezone` is an IANA name; `recurrence` an RFC 5545 RRULE. */
export const eventSchema = defineNoteSchema({
  title,
  starts_at: noteTimestampSchema,
  ends_at: noteTimestampSchema.optional(),
  all_day: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  recurrence: z.string().min(1).optional(),
  attendees: z.array(ref).default([]),
  location: z.string().optional(),
});

/** One fact a provider contributed to a snapshot. `source_ref` lets the UI open the exact thing. */
export const contextFactSchema = z.looseObject({
  provider: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  source_ref: z.string().min(1).optional(),
  observed_at: noteTimestampSchema.optional(),
});
export type ContextFact = z.output<typeof contextFactSchema>;

/** Saved "where I left off" for one work item. The summary, if any, is derived. */
export const contextSnapshotSchema = defineNoteSchema({
  work_item: ref,
  captured_at: noteTimestampSchema,
  facts: z.array(contextFactSchema).default([]),
});

export const CORE_NOTE_TYPES = {
  "work-item": workItemSchema,
  thread: threadSchema,
  artifact: artifactSchema,
  person: personSchema,
  event: eventSchema,
  "context-snapshot": contextSnapshotSchema,
} as const;

export type CoreNoteType = keyof typeof CORE_NOTE_TYPES;
export type WorkItem = z.output<typeof workItemSchema>;
export type Thread = z.output<typeof threadSchema>;
export type Artifact = z.output<typeof artifactSchema>;
export type Person = z.output<typeof personSchema>;
/** Not `Event`: that name is taken by the global DOM-style Event class in Node. */
export type TimelineEvent = z.output<typeof eventSchema>;
export type ContextSnapshot = z.output<typeof contextSnapshotSchema>;

export function registerCoreNoteTypes(registry: NoteSchemaRegistry): void {
  for (const [type, schema] of Object.entries(CORE_NOTE_TYPES)) registry.register(type, schema);
}
