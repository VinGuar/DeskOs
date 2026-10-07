import type { Clock, TimerHandle } from "@deskos/core";

interface Timer {
  /** Stable for the life of the timer, used by cancel. */
  id: number;
  /** Tie-breaker for timers due at the same instant. Bumped on each interval reschedule. */
  order: number;
  due: number;
  cb: () => void;
  interval: number | null;
}

/** Default start: 2026-01-01T00:00:00Z. Fixed so tests never depend on real time. */
export const FAKE_CLOCK_EPOCH = Date.UTC(2026, 0, 1);

/**
 * Deterministic Clock. Time only moves when a test calls advance/tick.
 * Timers due at the same instant fire in the order they were scheduled.
 */
export class FakeClock implements Clock {
  #now: number;
  #counter = 0;
  #timers = new Map<number, Timer>();

  constructor(start: number = FAKE_CLOCK_EPOCH) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  setTimeout(cb: () => void, ms: number): TimerHandle {
    return this.#schedule(cb, ms, null);
  }

  setInterval(cb: () => void, ms: number): TimerHandle {
    return this.#schedule(cb, ms, Math.max(1, ms));
  }

  /** Number of scheduled timers, intervals included. */
  pending(): number {
    return this.#timers.size;
  }

  /** Move time forward by ms, firing every timer that comes due, in order. */
  advance(ms: number): void {
    const target = this.#target(ms);
    for (let next = this.#nextDue(target); next; next = this.#nextDue(target)) {
      this.#fire(next);
    }
    this.#now = target;
  }

  /** Like advance, but lets pending promises settle before and after each timer fires. */
  async tick(ms: number): Promise<void> {
    const target = this.#target(ms);
    await flushMicrotasks();
    for (let next = this.#nextDue(target); next; next = this.#nextDue(target)) {
      this.#fire(next);
      await flushMicrotasks();
    }
    this.#now = target;
  }

  /** Fire timeouts until none remain. Throws on intervals or an endless loop. */
  runAll(maxSteps = 10_000): void {
    for (let i = 0; i < maxSteps; i++) {
      const next = this.#nextDue(Number.POSITIVE_INFINITY);
      if (!next) return;
      if (next.interval !== null) {
        throw new Error("FakeClock.runAll: an interval is scheduled, use advance instead");
      }
      this.#fire(next);
    }
    throw new Error(`FakeClock.runAll: exceeded ${maxSteps} steps`);
  }

  /**
   * Jump the wall clock without firing timers, to simulate clock skew or a
   * manual time change. Scheduled timers keep their absolute due times.
   */
  setTime(epochMs: number): void {
    this.#now = epochMs;
  }

  #target(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error("FakeClock: ms must be a finite number >= 0");
    return this.#now + ms;
  }

  #schedule(cb: () => void, ms: number, interval: number | null): TimerHandle {
    const id = this.#counter++;
    this.#timers.set(id, { id, order: id, due: this.#now + Math.max(0, ms), cb, interval });
    return { cancel: () => this.#timers.delete(id) };
  }

  #nextDue(limit: number): Timer | undefined {
    let best: Timer | undefined;
    for (const t of this.#timers.values()) {
      if (t.due > limit) continue;
      if (!best || t.due < best.due || (t.due === best.due && t.order < best.order)) best = t;
    }
    return best;
  }

  #fire(t: Timer): void {
    this.#now = Math.max(this.#now, t.due);
    if (t.interval === null) {
      this.#timers.delete(t.id);
    } else {
      t.due += t.interval;
      t.order = this.#counter++;
    }
    t.cb();
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
