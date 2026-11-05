import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { type AtomicFs, nodeAtomicFs, writeFileAtomic } from "./atomic.ts";

let cleanup: () => void = () => {};
afterEach(() => cleanup());

function temp(): string {
  const t = makeTempDir();
  cleanup = t.cleanup;
  return t.dir;
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("writeFileAtomic", () => {
  it("creates the file and missing parent folders", async () => {
    const dir = temp();
    const file = path.join(dir, "a", "b", "note.md");
    await writeFileAtomic(file, "hello");
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("replaces existing content and leaves no temp files", async () => {
    const dir = temp();
    const file = path.join(dir, "x.json");
    writeFileSync(file, "old");
    await writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["x.json"]);
  });

  it("handles spaces and unicode in the path", async () => {
    const dir = temp();
    const file = path.join(dir, "My Notes", "café 日本.md");
    await writeFileAtomic(file, "ok");
    expect(readFileSync(file, "utf8")).toBe("ok");
  });

  it("crash mid-write leaves the old file intact and cleans up the temp file", async () => {
    const dir = temp();
    const file = path.join(dir, "x.md");
    writeFileSync(file, "old content");
    const crashing: AtomicFs = {
      ...nodeAtomicFs,
      async writeFile(f, data) {
        // Partial write, then the process "dies".
        writeFileSync(f, String(data).slice(0, 3));
        throw codeError("EIO");
      },
    };
    await expect(writeFileAtomic(file, "new content", { fs: crashing })).rejects.toThrow("EIO");
    expect(readFileSync(file, "utf8")).toBe("old content");
    expect(readdirSync(dir)).toEqual(["x.md"]);
  });

  it("failed rename leaves the old file intact", async () => {
    const dir = temp();
    const file = path.join(dir, "x.md");
    writeFileSync(file, "old");
    const failing: AtomicFs = {
      ...nodeAtomicFs,
      rename: async () => {
        throw codeError("ENOSPC");
      },
    };
    await expect(writeFileAtomic(file, "new", { fs: failing })).rejects.toThrow("ENOSPC");
    expect(readFileSync(file, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["x.md"]);
  });

  it("retries EPERM and EBUSY on rename, as Windows returns while the target is held open", async () => {
    const dir = temp();
    const file = path.join(dir, "x.md");
    const codes = ["EPERM", "EBUSY", "EACCES"];
    let calls = 0;
    const flaky: AtomicFs = {
      ...nodeAtomicFs,
      async rename(from, to) {
        const code = codes[calls++];
        if (code) throw codeError(code);
        await nodeAtomicFs.rename(from, to);
      },
    };
    await writeFileAtomic(file, "done", { fs: flaky, retryDelaysMs: [0, 0, 0] });
    expect(calls).toBe(4);
    expect(readFileSync(file, "utf8")).toBe("done");
  });

  it("gives up after the retry budget", async () => {
    const dir = temp();
    const stuck: AtomicFs = {
      ...nodeAtomicFs,
      rename: async () => {
        throw codeError("EBUSY");
      },
    };
    await expect(
      writeFileAtomic(path.join(dir, "x.md"), "y", { fs: stuck, retryDelaysMs: [0, 0] }),
    ).rejects.toThrow("EBUSY");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("does not retry other errors", async () => {
    const dir = temp();
    let calls = 0;
    const broken: AtomicFs = {
      ...nodeAtomicFs,
      rename: async () => {
        calls++;
        throw codeError("ENOENT");
      },
    };
    await expect(
      writeFileAtomic(path.join(dir, "x.md"), "y", { fs: broken, retryDelaysMs: [0, 0] }),
    ).rejects.toThrow("ENOENT");
    expect(calls).toBe(1);
  });
});
