import { describe, expect, it } from "vitest";
import { NoteSchemaRegistry } from "../vault/schema.ts";
import {
  CORE_NOTE_TYPES,
  contextSnapshotSchema,
  eventSchema,
  personSchema,
  registerCoreNoteTypes,
  workItemSchema,
} from "./notes.ts";

const base = { id: "x", created_at: "2026-01-01", updated_at: "2026-01-01" };

describe("core note schemas", () => {
  it("registers every core type", () => {
    const r = new NoteSchemaRegistry();
    registerCoreNoteTypes(r);
    for (const type of Object.keys(CORE_NOTE_TYPES)) expect(r.has(type)).toBe(true);
    expect(() => registerCoreNoteTypes(r)).toThrow(/already registered/);
  });

  it("work item defaults status to open and keeps unknown fields", () => {
    const w = workItemSchema.parse({ ...base, type: "work-item", title: "Do it", effort: "S" });
    expect(w).toMatchObject({ status: "open", effort: "S", schema_version: 1 });
  });

  it.each([
    ["missing title", { ...base, type: "work-item" }],
    ["bad status", { ...base, type: "work-item", title: "t", status: "someday" }],
    ["bad due", { ...base, type: "work-item", title: "t", due: "next week" }],
  ])("work item rejects %s", (_name, value) => {
    expect(workItemSchema.safeParse(value).success).toBe(false);
  });

  it("event requires a start and defaults attendees", () => {
    expect(eventSchema.safeParse({ ...base, type: "event", title: "Sync" }).success).toBe(false);
    const e = eventSchema.parse({
      ...base,
      type: "event",
      title: "Sync",
      starts_at: "2026-03-29T09:00:00+02:00",
      timezone: "Europe/Paris",
    });
    expect(e.attendees).toEqual([]);
  });

  it("person needs a name", () => {
    expect(personSchema.safeParse({ ...base, type: "person" }).success).toBe(false);
    expect(
      personSchema.parse({ ...base, type: "person", name: "Sam", handles: { chat: "U1" } }).handles,
    ).toEqual({
      chat: "U1",
    });
  });

  it("context snapshot facts keep extra provider fields", () => {
    const s = contextSnapshotSchema.parse({
      ...base,
      type: "context-snapshot",
      work_item: "w1",
      captured_at: "2026-01-01T10:00:00Z",
      facts: [{ provider: "files", label: "last open", value: "plan.md", extra: 1 }],
    });
    expect(s.facts[0]).toMatchObject({ extra: 1 });
  });

  it("derived block must name model, prompt version, and at least one source", () => {
    const ok = {
      ...base,
      type: "work-item",
      title: "t",
      derived: { model: "m", prompt_version: "v1", source_ids: ["n1"], generated_at: "2026-01-01" },
    };
    expect(workItemSchema.safeParse(ok).success).toBe(true);
    expect(
      workItemSchema.safeParse({ ...ok, derived: { ...ok.derived, source_ids: [] } }).success,
    ).toBe(false);
    expect(
      workItemSchema.safeParse({ ...ok, derived: { model: "m", source_ids: ["n1"] } }).success,
    ).toBe(false);
  });
});
