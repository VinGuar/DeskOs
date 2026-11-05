import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FakeClock, makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "../clock.ts";
import { Vault } from "../vault/vault.ts";
import { type IndexChanges, reconcileIndex } from "./index-sync.ts";
import { NoteIndex } from "./note-index.ts";
import { VaultWatcher, type WatchFn } from "./vault-watcher.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tempDir(): string {
  const t = makeTempDir();
  cleanups.push(t.cleanup);
  return t.dir;
}

function write(root: string, rel: string, body: string) {
  const file = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# ${path.basename(rel, ".md")}\n${body}\n`);
}

/** A WatchFn the test drives by hand. */
function manualWatch() {
  const state = {
    emit: (_p: string | null) => {},
    fail: (_e: unknown) => {},
    closed: false,
  };
  const watch: WatchFn = (_root, onEvent, onError) => {
    state.emit = onEvent;
    state.fail = onError;
    return {
      close: () => {
        state.closed = true;
      },
    };
  };
  return { watch, state };
}

describe("VaultWatcher (driven by hand)", () => {
  function setup(
    opts: {
      fullScanIntervalMs?: number | null;
      rescanOnStart?: boolean;
      before?: (root: string) => void;
    } = {},
  ) {
    const root = tempDir();
    opts.before?.(root);
    const vault = new Vault({ root });
    const index = new NoteIndex();
    const clock = new FakeClock();
    const { watch, state } = manualWatch();
    const changes: IndexChanges[] = [];
    const errors: unknown[] = [];
    const watcher = new VaultWatcher(vault, index, {
      clock,
      watch,
      debounceMs: 50,
      fullScanIntervalMs: opts.fullScanIntervalMs ?? null,
      rescanOnStart: opts.rescanOnStart ?? false,
      onChange: (c) => changes.push(c),
      onError: (e) => errors.push(e),
    });
    watcher.start();
    cleanups.push(() => watcher.stop());
    return { root, vault, index, clock, state, watcher, changes, errors };
  }

  it("debounces a burst of events into one batch", async () => {
    const { root, index, clock, state, watcher, changes } = setup();
    write(root, "a.md", "one");
    write(root, "b.md", "two");
    state.emit("a.md");
    await clock.tick(30);
    state.emit("b.md");
    state.emit("a.md");
    await clock.tick(30);
    expect(changes).toEqual([]); // still inside the window
    await clock.tick(30);
    await watcher.idle();
    expect(changes).toEqual([{ upserted: ["a.md", "b.md"], removed: [] }]);
    expect(index.size).toBe(2);
  });

  it("normalizes backslash paths from Windows events", async () => {
    const { root, index, state, watcher } = setup();
    write(root, "Sub/x.md", "x");
    state.emit("Sub\\x.md");
    await watcher.idle();
    expect(index.get("Sub/x.md")).toBeDefined();
  });

  it("ignores dot paths, including its own snapshot writes", async () => {
    const { root, vault, state, watcher } = setup();
    write(root, "a.md", "x");
    const read = vi.spyOn(vault, "read");
    state.emit(".deskos/index.snapshot");
    state.emit(".obsidian/workspace.json");
    state.emit(".a.md.1234.tmp");
    await watcher.idle();
    expect(read).not.toHaveBeenCalled();
  });

  it("removes a deleted note", async () => {
    const { root, index, state, watcher, changes } = setup();
    write(root, "a.md", "x");
    state.emit("a.md");
    await watcher.idle();
    rmSync(path.join(root, "a.md"));
    state.emit("a.md");
    await watcher.idle();
    expect(index.size).toBe(0);
    expect(changes.at(-1)).toEqual({ upserted: [], removed: ["a.md"] });
  });

  it("reconciles a whole subtree when a folder event arrives", async () => {
    const { root, vault, index, state, watcher } = setup();
    write(root, "Old/a.md", "x");
    write(root, "Old/Deep/b.md", "y");
    await reconcileIndex(vault, index);
    renameSync(path.join(root, "Old"), path.join(root, "New"));
    state.emit("Old");
    state.emit("New");
    await watcher.idle();
    expect(index.list().map((n) => n.path)).toEqual(["New/Deep/b.md", "New/a.md"]);
  });

  it("does a full rescan when the event has no file name", async () => {
    const { root, index, state, watcher } = setup();
    write(root, "a.md", "x");
    write(root, "Z/b.md", "y");
    state.emit(null);
    await watcher.idle();
    expect(index.size).toBe(2);
  });

  it("rescans after a watcher error, since events may be lost", async () => {
    const { root, index, state, watcher, errors } = setup();
    write(root, "a.md", "x");
    state.fail(new Error("EPERM"));
    await watcher.idle();
    expect(errors).toHaveLength(1);
    expect(index.size).toBe(1);
  });

  it("runs a periodic full scan as a backstop for dropped events", async () => {
    const { root, index, clock, watcher } = setup({ fullScanIntervalMs: 60_000 });
    write(root, "missed.md", "x");
    await clock.tick(60_000 + 50);
    await watcher.idle();
    expect(index.get("missed.md")).toBeDefined();
  });

  it("rescans on start to catch changes made before the OS watcher went live", async () => {
    const { index, state, watcher } = setup({
      rescanOnStart: true,
      before: (root) => write(root, "early.md", "x"),
    });
    await watcher.idle();
    expect(index.get("early.md")).toBeDefined();
    expect(state.closed).toBe(false);
  });

  it("stop closes the OS watcher and cancels timers", async () => {
    const { state, clock, watcher } = setup({ fullScanIntervalMs: 1000 });
    state.emit("a.md");
    await watcher.stop();
    expect(state.closed).toBe(true);
    expect(clock.pending()).toBe(0);
  });
});

describe("VaultWatcher (real file system events)", () => {
  async function waitFor(check: () => boolean, what: string, timeoutMs = 10_000) {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /**
   * Windows refuses to rename a folder while any file inside is open, and late
   * events can still have the watcher reading one. A person would just retry.
   */
  async function renameWithRetry(from: string, to: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(from, to);
        return;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (attempt >= 20 || (code !== "EPERM" && code !== "EBUSY")) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  it("follows add, edit, delete, folder rename, and folder delete", async () => {
    const root = tempDir();
    const vault = new Vault({ root });
    const index = new NoteIndex();
    const watcher = new VaultWatcher(vault, index, {
      clock: systemClock,
      debounceMs: 30,
      fullScanIntervalMs: null,
    });
    watcher.start();
    cleanups.push(() => watcher.stop());
    await watcher.idle();

    // macOS FSEvents goes live a moment after fs.watch returns and drops events
    // before that. Write fresh probe files until one arrives through an event.
    let live = false;
    for (let n = 0; n < 40 && !live; n++) {
      write(root, `probe-${n}.md`, "probe");
      const deadline = Date.now() + 500;
      while (!live && Date.now() < deadline) {
        live = index.get(`probe-${n}.md`) !== undefined;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    expect(live).toBe(true);
    for (const n of index.list().map((note) => note.path)) rmSync(path.join(root, n));
    await waitFor(() => index.size === 0, "probe cleanup");

    write(root, "a.md", "first");
    await waitFor(() => index.search("first").length === 1, "add");

    write(root, "a.md", "second version");
    await waitFor(() => index.search("second").length === 1, "edit");
    expect(index.search("first")).toEqual([]);

    write(root, "Folder/Deep/b.md", "nested");
    await waitFor(() => index.get("Folder/Deep/b.md") !== undefined, "nested add");

    await watcher.idle();
    await renameWithRetry(path.join(root, "Folder"), path.join(root, "Moved"));
    await waitFor(
      () =>
        index.get("Moved/Deep/b.md") !== undefined && index.get("Folder/Deep/b.md") === undefined,
      "folder rename",
    );

    rmSync(path.join(root, "Moved"), { recursive: true, force: true });
    await waitFor(() => index.get("Moved/Deep/b.md") === undefined, "folder delete");

    rmSync(path.join(root, "a.md"));
    await waitFor(() => index.size === 0, "delete");

    write(root, "café 日本.md", "unicode");
    await waitFor(() => index.search("unicode").length === 1, "unicode name");
  });
});
