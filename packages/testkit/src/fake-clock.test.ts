import { describe, expect, it } from "vitest";
import { FAKE_CLOCK_EPOCH, FakeClock } from "./fake-clock.ts";

describe("FakeClock", () => {
  it("starts at the fixed epoch and only moves when told", () => {
    const c = new FakeClock();
    expect(c.now()).toBe(FAKE_CLOCK_EPOCH);
    c.advance(1500);
    expect(c.now()).toBe(FAKE_CLOCK_EPOCH + 1500);
  });

  it("fires timeouts in due order, FIFO on ties", () => {
    const c = new FakeClock(0);
    const log: string[] = [];
    c.setTimeout(() => log.push("b@20"), 20);
    c.setTimeout(() => log.push("a@10"), 10);
    c.setTimeout(() => log.push("c@20"), 20);
    c.advance(19);
    expect(log).toEqual(["a@10"]);
    c.advance(1);
    expect(log).toEqual(["a@10", "b@20", "c@20"]);
    expect(c.pending()).toBe(0);
  });

  it("reports the due time as now() inside a callback", () => {
    const c = new FakeClock(0);
    let seen = -1;
    c.setTimeout(() => {
      seen = c.now();
    }, 7);
    c.advance(100);
    expect(seen).toBe(7);
    expect(c.now()).toBe(100);
  });

  it("fires timers scheduled by other timers within the same advance", () => {
    const c = new FakeClock(0);
    const log: number[] = [];
    c.setTimeout(() => {
      log.push(c.now());
      c.setTimeout(() => log.push(c.now()), 5);
    }, 5);
    c.advance(10);
    expect(log).toEqual([5, 10]);
  });

  it("repeats intervals and stops after cancel", () => {
    const c = new FakeClock(0);
    const log: number[] = [];
    const h = c.setInterval(() => log.push(c.now()), 10);
    c.advance(35);
    expect(log).toEqual([10, 20, 30]);
    h.cancel();
    c.advance(100);
    expect(log).toEqual([10, 20, 30]);
    expect(c.pending()).toBe(0);
  });

  it("cancel after an interval has fired still works", () => {
    const c = new FakeClock(0);
    let n = 0;
    const h = c.setInterval(() => {
      n += 1;
      if (n === 2) h.cancel();
    }, 1);
    c.advance(10);
    expect(n).toBe(2);
  });

  it("keeps FIFO between an interval and a timeout due at the same instant", () => {
    const c = new FakeClock(0);
    const log: string[] = [];
    c.setInterval(() => log.push("i"), 10);
    c.setTimeout(() => log.push("t"), 20);
    c.advance(20);
    // Interval fired at 10 and was rescheduled after the timeout was created.
    expect(log).toEqual(["i", "t", "i"]);
  });

  it("runAll drains timeouts and refuses intervals", () => {
    const c = new FakeClock(0);
    let fired = 0;
    c.setTimeout(() => fired++, 1000);
    c.setTimeout(() => fired++, 5000);
    c.runAll();
    expect(fired).toBe(2);
    expect(c.now()).toBe(5000);
    c.setInterval(() => {}, 1);
    expect(() => c.runAll()).toThrow(/interval/);
  });

  it("runAll stops an endless timeout chain", () => {
    const c = new FakeClock(0);
    const loop = () => c.setTimeout(loop, 1);
    loop();
    expect(() => c.runAll(50)).toThrow(/exceeded 50/);
  });

  it("setTime jumps without firing timers", () => {
    const c = new FakeClock(0);
    let fired = false;
    c.setTimeout(() => {
      fired = true;
    }, 100);
    c.setTime(1_000_000);
    expect(fired).toBe(false);
    c.advance(0);
    expect(fired).toBe(true);
  });

  it("rejects negative or non-finite advances", () => {
    const c = new FakeClock(0);
    expect(() => c.advance(-1)).toThrow();
    expect(() => c.advance(Number.NaN)).toThrow();
  });

  it("tick lets promise chains run between timers", async () => {
    const c = new FakeClock(0);
    const log: string[] = [];
    const sleep = (ms: number) => new Promise<void>((r) => c.setTimeout(r, ms));
    const task = (async () => {
      await sleep(10);
      log.push("after first sleep");
      await sleep(10);
      log.push("after second sleep");
    })();
    await c.tick(20);
    await task;
    expect(log).toEqual(["after first sleep", "after second sleep"]);
  });
});
