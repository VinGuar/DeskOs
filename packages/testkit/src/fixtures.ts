import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

/** Fixtures shipped with testkit itself. Other packages pass their own dir. */
export const TESTKIT_FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export interface FixtureLoader {
  /** Absolute path of a fixture, refusing anything that escapes the fixture dir. */
  resolve(relPath: string): string;
  /** Text with CRLF and CR normalized to LF, so fixtures behave the same on every OS. */
  text(relPath: string): string;
  /** Parsed JSON, optionally validated with a zod schema. */
  json<T = unknown>(relPath: string, schema?: z.ZodType<T>): T;
  /** One parsed value per non-empty line. */
  jsonl(relPath: string): unknown[];
}

export function createFixtureLoader(baseDir: string): FixtureLoader {
  const root = path.resolve(baseDir);

  const resolve = (relPath: string): string => {
    if (path.isAbsolute(relPath)) {
      throw new Error(`fixture path must be relative: ${relPath}`);
    }
    const full = path.resolve(root, relPath);
    const rel = path.relative(root, full);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`fixture path escapes fixture dir: ${relPath}`);
    }
    if (!existsSync(full)) {
      throw new Error(`fixture not found: ${relPath} (looked in ${root})`);
    }
    return full;
  };

  const text = (relPath: string): string =>
    normalizeLineEndings(readFileSync(resolve(relPath), "utf8"));

  return {
    resolve,
    text,
    json<T = unknown>(relPath: string, schema?: z.ZodType<T>): T {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text(relPath));
      } catch (err) {
        throw new Error(`fixture is not valid JSON: ${relPath}: ${(err as Error).message}`);
      }
      if (!schema) return parsed as T;
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`fixture failed schema: ${relPath}: ${result.error.message}`);
      }
      return result.data;
    },
    jsonl(relPath: string): unknown[] {
      return text(relPath)
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line, i) => {
          try {
            return JSON.parse(line) as unknown;
          } catch (err) {
            throw new Error(
              `fixture line ${i + 1} is not valid JSON: ${relPath}: ${(err as Error).message}`,
            );
          }
        });
    },
  };
}

export const fixtures = createFixtureLoader(TESTKIT_FIXTURES_DIR);
