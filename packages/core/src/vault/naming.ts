import { randomBytes } from "node:crypto";

export const MAX_SLUG_LENGTH = 60;
export const SHORT_ID_LENGTH = 4;

const NOTE_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isNoteType(value: string): boolean {
  return NOTE_TYPE_PATTERN.test(value);
}

/**
 * File-safe slug on every OS. Keeps letters and digits from any script,
 * lowercases, strips accents, joins runs of anything else with one dash.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const capped = Array.from(slug).slice(0, MAX_SLUG_LENGTH).join("").replace(/-+$/, "");
  return capped === "" ? "untitled" : capped;
}

/** Random lowercase hex, used only to keep file names unique. Not an entity id. */
export function randomShortId(length = SHORT_ID_LENGTH): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

/** `<type>-<slug>-<short-id>.md`, for example `task-fix-login-timeout-a1b2.md`. */
export function noteFileName(type: string, title: string, shortId: string): string {
  if (!isNoteType(type)) throw new Error(`invalid note type: ${JSON.stringify(type)}`);
  if (!/^[a-z0-9]+$/.test(shortId)) throw new Error(`invalid short id: ${JSON.stringify(shortId)}`);
  return `${type}-${slugify(title)}-${shortId}.md`;
}
