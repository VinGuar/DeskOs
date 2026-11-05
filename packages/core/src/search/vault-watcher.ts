import { watch as fsWatch } from "node:fs";
import { type Clock, systemClock, type TimerHandle } from "../clock.ts";
import type { Vault } from "../vault/vault.ts";
import { emptyChanges, type IndexChanges, reconcileIndex, syncNote } from "./index-sync.ts";
import type { NoteIndex } from "./note-index.ts";

/** Starts watching `root` recursively. Calls `onEvent` with a root-relative path, or null if unknown. */
export type WatchFn = (
  root: string,
  onEvent: (relPath: string | null) => void,
  onError: (err: unknown) => void,
) => { close(): void };

export const nodeWatch: WatchFn = (root, onEvent, onError) => {
  const w = fsWatch(root, { recursive: true }, (_event, filename) => {
    onEvent(filename === null ? null : String(filename));
  });
  w.on("error", onError);
  return w;
};

export interface VaultWatcherOptions {
  clock?: Clock;
  /** Wait this long after the last event before touching the index. */
  debounceMs?: number;
  /** Full reconcile on this interval, as a backstop for events the OS drops. Null turns it off. */
  fullScanIntervalMs?: number | null;
  onChange?: (changes: IndexChanges) => void;
  onError?: (err: unknown) => void;
  watch?: WatchFn;
}

/**
 * Keeps a NoteIndex in step with a vault folder. File events are batched with a
 * debounce. A changed `.md` path is re-read alone; any other path (a folder
 * renamed or deleted, or something unknown) reconciles that subtree.
 */
export class VaultWatcher {
  readonly #vault: Vault;
  readonly #index: NoteIndex;
  readonly #clock: Clock;
  readonly #debounceMs: number;
  readonly #fullScanMs: number | null;
  readonly #onChange: (c: IndexChanges) => void;
  readonly #onError: (err: unknown) => void;
  readonly #watchFn: WatchFn;

  #handle: { close(): void } | null = null;
  #debounce: TimerHandle | null = null;
  #interval: TimerHandle | null = null;
  #dirty = new Set<string>();
  #full = false;
  #running: Promise<void> = Promise.resolve();
  #busy = false;

  constructor(vault: Vault, index: NoteIndex, opts: VaultWatcherOptions = {}) {
    this.#vault = vault;
    this.#index = index;
    this.#clock = opts.clock ?? systemClock;
    this.#debounceMs = opts.debounceMs ?? 100;
    this.#fullScanMs = opts.fullScanIntervalMs === undefined ? 5 * 60_000 : opts.fullScanIntervalMs;
    this.#onChange = opts.onChange ?? (() => {});
    this.#onError = opts.onError ?? (() => {});
    this.#watchFn = opts.watch ?? nodeWatch;
  }

  start(): void {
    if (this.#handle) return;
    this.#handle = this.#watchFn(
      this.#vault.root,
      (p) => this.notify(p),
      (err) => {
        this.#onError(err);
        // Events may have been lost.
        this.notify(null);
      },
    );
    if (this.#fullScanMs !== null) {
      this.#interval = this.#clock.setInterval(() => this.notify(null), this.#fullScanMs);
    }
  }

  /** Record a changed path (root-relative, either separator). Null means "something changed, rescan". */
  notify(relPath: string | null): void {
    if (relPath === null) {
      this.#full = true;
    } else {
      const p = relPath.replace(/\\/g, "/").replace(/\/+$/, "");
      // Dot paths: .deskos (our own writes, including the snapshot), .obsidian, temp files.
      if (p === "" || p.split("/").some((s) => s.startsWith(".") || s === "")) return;
      this.#dirty.add(p);
    }
    this.#debounce?.cancel();
    this.#debounce = this.#clock.setTimeout(() => {
      this.#debounce = null;
      void this.flush();
    }, this.#debounceMs);
  }

  /** Apply pending events now. Flushes run one at a time. */
  flush(): Promise<void> {
    const run = this.#running.then(() => this.#apply());
    this.#running = run.catch(() => {});
    return run;
  }

  /** Resolves once nothing is pending or running. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.#busy || this.#debounce || this.#dirty.size > 0 || this.#full) {
      this.#debounce?.cancel();
      this.#debounce = null;
      await this.flush();
    }
  }

  async stop(): Promise<void> {
    this.#handle?.close();
    this.#handle = null;
    this.#interval?.cancel();
    this.#interval = null;
    this.#debounce?.cancel();
    this.#debounce = null;
    this.#dirty.clear();
    this.#full = false;
    await this.#running;
  }

  async #apply(): Promise<void> {
    const full = this.#full;
    const dirty = [...this.#dirty].sort();
    this.#full = false;
    this.#dirty.clear();
    if (!full && dirty.length === 0) return;

    this.#busy = true;
    const changes = emptyChanges();
    try {
      if (full) {
        add(changes, await reconcileIndex(this.#vault, this.#index));
      } else {
        for (const p of dirty) {
          if (p.toLowerCase().endsWith(".md")) {
            add(changes, await syncNote(this.#vault, this.#index, p));
          } else {
            add(changes, await reconcileIndex(this.#vault, this.#index, { folder: p }));
          }
        }
      }
    } catch (err) {
      this.#onError(err);
    } finally {
      this.#busy = false;
    }
    if (changes.upserted.length > 0 || changes.removed.length > 0) this.#onChange(changes);
  }
}

function add(into: IndexChanges, from: IndexChanges): void {
  into.upserted.push(...from.upserted);
  into.removed.push(...from.removed);
}
