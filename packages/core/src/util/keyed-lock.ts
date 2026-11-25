/**
 * Runs async work one call at a time per key. Calls with different keys run
 * concurrently. A failed call does not block the next one.
 */
export class KeyedLock {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn);
    const tail = result.catch(() => {});
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }

  /** Keys with work queued or running. */
  get size(): number {
    return this.#tails.size;
  }
}
