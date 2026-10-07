import { describe, expect, it } from "vitest";
import { systemClock } from "./clock.ts";

describe("systemClock", () => {
  it("returns wall time", () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("fires a timeout", async () => {
    await new Promise<void>((resolve) => {
      systemClock.setTimeout(resolve, 1);
    });
  });

  it("cancelled timeout never fires", async () => {
    let fired = false;
    systemClock
      .setTimeout(() => {
        fired = true;
      }, 1)
      .cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(false);
  });

  it("interval fires repeatedly until cancelled", async () => {
    let count = 0;
    await new Promise<void>((resolve) => {
      const h = systemClock.setInterval(() => {
        count += 1;
        if (count === 3) {
          h.cancel();
          resolve();
        }
      }, 1);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(3);
  });
});
