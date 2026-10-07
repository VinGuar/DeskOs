/**
 * Time source for everything in the engine. Code that schedules or timestamps
 * takes a Clock instead of calling Date.now or setTimeout directly, so tests
 * can drive time with the fake clock in @deskos/testkit.
 */
export interface TimerHandle {
  cancel(): void;
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  setTimeout(cb: () => void, ms: number): TimerHandle;
  setInterval(cb: () => void, ms: number): TimerHandle;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(cb, ms) {
    const t = setTimeout(cb, ms);
    return { cancel: () => clearTimeout(t) };
  },
  setInterval(cb, ms) {
    const t = setInterval(cb, ms);
    return { cancel: () => clearInterval(t) };
  },
};
