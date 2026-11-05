import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Vault } from "../vault/vault.ts";
import {
  loadIndex,
  reconcileIndex,
  saveIndexSnapshot,
  snapshotPath,
  syncNote,
} from "./index-sync.ts";
import { NoteIndex } from "./note-index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function tempDir(): string {
  const t = makeTempDir();
  cleanups.push(t.cleanup);
  return t.dir;
}

function note(id: string, title: string, body: string): string {
  return `---\nid: ${id}\ntype: note\ntitle: ${title}\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n${body}\n`;
}

function sampleVault() {
  const root = tempDir();
  mkdirSync(path.join(root, "Projects", "Deep"), { recursive: true });
  mkdirSync(path.join(root, ".deskos"), { recursive: true });
  writeFileSync(path.join(root, "Projects", "alpha.md"), note("id-a", "Alpha", "apples"));
  writeFileSync(path.join(root, "Projects", "Deep", "beta.md"), note("id-b", "Beta", "bananas"));
  writeFileSync(path.join(root, "plain.md"), "# Plain\ncherries\n");
  writeFileSync(path.join(root, "broken.md"), "---\ntype: note\n---\n");
  writeFileSync(path.join(root, ".deskos", "ignored.md"), note("id-x", "X", "secret"));
  return { root, vault: new Vault({ root }) };
}

function setMtime(file: string, epochMs: number) {
  const t = new Date(epochMs);
  utimesSync(file, t, t);
}

describe("reconcileIndex", () => {
  it("builds the index from a vault scan", async () => {
    const { vault } = sampleVault();
    const index = new NoteIndex();
    const changes = await reconcileIndex(vault, index);
    expect(changes.upserted.sort()).toEqual([
      "Projects/Deep/beta.md",
      "Projects/alpha.md",
      "broken.md",
      "plain.md",
    ]);
    expect(index.list().map((n) => [n.path, n.status])).toEqual([
      ["Projects/Deep/beta.md", "entity"],
      ["Projects/alpha.md", "entity"],
      ["broken.md", "invalid"],
      ["plain.md", "plain"],
    ]);
    expect(index.search("secret")).toEqual([]);
    expect(index.search("cherries").map((h) => h.note.path)).toEqual(["plain.md"]);
  });

  it("re-reads only files whose size or mtime changed, and drops deleted ones", async () => {
    const { root, vault } = sampleVault();
    const index = new NoteIndex();
    await reconcileIndex(vault, index);

    const alpha = path.join(root, "Projects", "alpha.md");
    writeFileSync(alpha, note("id-a", "Alpha", "apricots"));
    setMtime(alpha, Date.UTC(2030, 0, 1));
    rmSync(path.join(root, "plain.md"));

    const read = vi.spyOn(vault, "read");
    const changes = await reconcileIndex(vault, index);
    expect(read.mock.calls.map((c) => c[0])).toEqual(["Projects/alpha.md"]);
    expect(changes).toEqual({ upserted: ["Projects/alpha.md"], removed: ["plain.md"] });
    expect(index.search("apricots").map((h) => h.note.path)).toEqual(["Projects/alpha.md"]);
    expect(index.search("cherries")).toEqual([]);
  });

  it("detects a same-size edit through mtime", async () => {
    const { root, vault } = sampleVault();
    const index = new NoteIndex();
    await reconcileIndex(vault, index);
    const alpha = path.join(root, "Projects", "alpha.md");
    writeFileSync(alpha, note("id-a", "Alpha", "melons")); // same length as "apples"
    setMtime(alpha, Date.UTC(2031, 0, 1));
    await reconcileIndex(vault, index);
    expect(index.search("melons")).toHaveLength(1);
  });

  it("can reconcile one folder without touching the rest", async () => {
    const { root, vault } = sampleVault();
    const index = new NoteIndex();
    await reconcileIndex(vault, index);
    rmSync(path.join(root, "Projects", "Deep"), { recursive: true });
    rmSync(path.join(root, "plain.md"));
    const changes = await reconcileIndex(vault, index, { folder: "Projects/Deep" });
    expect(changes).toEqual({ upserted: [], removed: ["Projects/Deep/beta.md"] });
    expect(index.get("plain.md")).toBeDefined(); // outside the folder: left for a later pass
  });

  it("does not index a note through a symlinked folder", async () => {
    const { root, vault } = sampleVault();
    const outside = tempDir();
    writeFileSync(path.join(outside, "leak.md"), note("id-l", "Leak", "outside"));
    symlinkSync(outside, path.join(root, "linked"), "junction");
    const index = new NoteIndex();
    await reconcileIndex(vault, index);
    expect(index.search("outside")).toEqual([]);
    expect(await syncNote(vault, index, "linked/leak.md")).toEqual({ upserted: [], removed: [] });
    expect(index.get("linked/leak.md")).toBeUndefined();
    expect(await reconcileIndex(vault, index, { folder: "linked" })).toEqual({
      upserted: [],
      removed: [],
    });
  });
});

describe("loadIndex and snapshots", () => {
  it("rebuilds from scratch when there is no snapshot", async () => {
    const { vault } = sampleVault();
    const { index, fromSnapshot } = await loadIndex(vault);
    expect(fromSnapshot).toBe(false);
    expect(index.size).toBe(4);
  });

  it("loads a saved snapshot without re-reading unchanged files", async () => {
    const { vault } = sampleVault();
    const first = await loadIndex(vault);
    await saveIndexSnapshot(vault, first.index);

    const read = vi.spyOn(vault, "read");
    const second = await loadIndex(vault);
    expect(second.fromSnapshot).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(second.changes).toEqual({ upserted: [], removed: [] });
    expect(second.index.list()).toEqual(first.index.list());
  });

  it("deleting the snapshot and rebuilding gives the same index (nothing lives only in the index)", async () => {
    const { vault } = sampleVault();
    const first = await loadIndex(vault);
    await saveIndexSnapshot(vault, first.index);
    rmSync(snapshotPath(vault));
    const rebuilt = await loadIndex(vault);
    expect(rebuilt.fromSnapshot).toBe(false);
    expect(rebuilt.index.list()).toEqual(first.index.list());
    for (const q of ["apples", "bananas", "cherries", "alpha"]) {
      expect(rebuilt.index.search(q)).toEqual(first.index.search(q));
    }
  });

  it("catches up with files changed after the snapshot was saved", async () => {
    const { root, vault } = sampleVault();
    await saveIndexSnapshot(vault, (await loadIndex(vault)).index);
    writeFileSync(path.join(root, "new.md"), "# New\ndates\n");
    rmSync(path.join(root, "Projects", "alpha.md"));
    const { index, fromSnapshot, changes } = await loadIndex(vault);
    expect(fromSnapshot).toBe(true);
    expect(changes).toEqual({ upserted: ["new.md"], removed: ["Projects/alpha.md"] });
    expect(index.search("dates")).toHaveLength(1);
    expect(index.getById("id-a")).toBeUndefined();
  });

  it("falls back to a rebuild on a corrupt snapshot", async () => {
    const { vault } = sampleVault();
    mkdirSync(vault.internalDir, { recursive: true });
    writeFileSync(snapshotPath(vault), "garbage");
    const { index, fromSnapshot } = await loadIndex(vault);
    expect(fromSnapshot).toBe(false);
    expect(index.size).toBe(4);
  });

  it("works on an empty vault", async () => {
    const vault = new Vault({ root: tempDir() });
    const { index } = await loadIndex(vault);
    expect(index.size).toBe(0);
    await saveIndexSnapshot(vault, index);
    expect((await loadIndex(vault)).fromSnapshot).toBe(true);
  });
});
