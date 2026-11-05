import { parseDocument, stringify } from "yaml";

export interface ParsedNote {
  /** Frontmatter mapping. Empty when the note has no frontmatter block. */
  data: Record<string, unknown>;
  hasFrontmatter: boolean;
  /** Everything after the closing fence, with LF line endings. */
  body: string;
}

export class FrontmatterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FrontmatterError";
  }
}

const FENCE = "---";

/**
 * Split a markdown note into YAML frontmatter and body. Accepts CRLF and a
 * leading BOM. YAML 1.2 core schema, so dates stay strings and `no` stays a string.
 */
export function parseNote(text: string): ParsedNote {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!src.startsWith(`${FENCE}\n`) && src !== FENCE) {
    return { data: {}, hasFrontmatter: false, body: src };
  }
  const afterOpen = FENCE.length + 1;
  const close = findClosingFence(src, afterOpen);
  if (close === -1) throw new FrontmatterError("frontmatter has no closing --- line");

  const yamlText = src.slice(afterOpen, close);
  let bodyStart = close + FENCE.length;
  if (src[bodyStart] === "\n") bodyStart += 1;

  const doc = parseDocument(yamlText, { schema: "core", uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new FrontmatterError(`invalid frontmatter YAML: ${doc.errors[0]?.message}`, {
      cause: doc.errors,
    });
  }
  const data: unknown = doc.toJS() ?? {};
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new FrontmatterError("frontmatter must be a mapping");
  }
  return {
    data: data as Record<string, unknown>,
    hasFrontmatter: true,
    body: src.slice(bodyStart),
  };
}

/** Inverse of parseNote. Always writes LF. Key order follows the object. */
export function serializeNote(data: Record<string, unknown>, body: string): string {
  const yamlText = Object.keys(data).length === 0 ? "" : stringify(data, { lineWidth: 0 });
  return `${FENCE}\n${yamlText}${FENCE}\n${body.replace(/\r\n?/g, "\n")}`;
}

function findClosingFence(src: string, from: number): number {
  let pos = from;
  while (pos <= src.length) {
    const end = src.indexOf("\n", pos);
    const line = end === -1 ? src.slice(pos) : src.slice(pos, end);
    if (line.trimEnd() === FENCE) return pos;
    if (end === -1) return -1;
    pos = end + 1;
  }
  return -1;
}
