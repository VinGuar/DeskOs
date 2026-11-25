import { describe, expect, it } from "vitest";
import { KeyedLock } from "./keyed-lock.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("KeyedLock", () => {
  it("runs calls with the same key one at a time, in order", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const gate = deferred();
    const a = lock.run("k", async () => {
      order.push("a start");
      await gate.promise;
      order.push("a end");
    });
    const b = lock.run("k", async () => {
      order.push("b");
    });
    await Promise.resolve();
    expect(order).toEqual(["a start"]);
    gate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "a end", "b"]);
  });

  it("runs different keys concurrently", async () => {
    const lock = new KeyedLock();
    const gate = deferred();
    const a = lock.run("a", () => gate.promise);
    let bDone = false;
    await lock.run("b", async () => {
      bDone = true;
    });
    expect(bDone).toBe(true);
    gate.resolve();
    await a;
  });

  it("keeps going after a failure and forgets idle keys", async () => {
    const lock = new KeyedLock();
    await expect(lock.run("k", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(lock.run("k", async () => 7)).resolves.toBe(7);
    await new Promise((r) => setImmediate(r));
    expect(lock.size).toBe(0);
  });
});
