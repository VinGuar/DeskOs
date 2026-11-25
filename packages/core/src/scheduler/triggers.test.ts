import { describe, expect, it } from "vitest";
import {
  firstRunAt,
  isValidTimeZone,
  nextRunAfter,
  type Trigger,
  triggerSchema,
  wallClock,
  wallToInstant,
} from "./triggers.ts";

const t = (s: string) => Date.parse(s);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const trigger = (input: unknown): Trigger => triggerSchema.parse(input);

describe("triggerSchema", () => {
  it.each<[unknown, string]>([
    [{ type: "once", at: "2026-01-01T00:00:00" }, "missing offset"],
    [{ type: "interval", every_ms: 999 }, "under a second"],
    [{ type: "interval", every_ms: 1500.5 }, "not an integer"],
    [{ type: "daily", time: "24:00", timezone: "UTC" }, "hour out of range"],
    [{ type: "daily", time: "9:00", timezone: "UTC" }, "not HH:MM"],
    [{ type: "daily", time: "09:00", timezone: "Mars/Olympus" }, "unknown zone"],
    [{ type: "daily", time: "09:00", timezone: "UTC", weekdays: [] }, "empty weekdays"],
    [{ type: "daily", time: "09:00", timezone: "UTC", weekdays: [7] }, "weekday out of range"],
    [{ type: "cron", expr: "* * * * *" }, "unknown type"],
  ])("rejects %j (%s)", (input) => {
    expect(triggerSchema.safeParse(input).success).toBe(false);
  });

  it("accepts each trigger type", () => {
    expect(trigger({ type: "once", at: "2026-01-01T09:00:00+02:00" }).type).toBe("once");
    expect(trigger({ type: "interval", every_ms: 60_000 }).type).toBe("interval");
    expect(
      trigger({ type: "daily", time: "09:00", timezone: "Europe/Berlin", weekdays: [1, 5] }).type,
    ).toBe("daily");
  });

  it("knows valid time zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Nowhere/Special")).toBe(false);
  });
});

describe("once", () => {
  const once = trigger({ type: "once", at: "2026-03-01T10:00:00Z" });

  it("first runs at its instant, even when that is past", () => {
    expect(iso(firstRunAt(once, t("2026-01-01T00:00:00Z"), 0))).toBe("2026-03-01T10:00:00.000Z");
    expect(iso(firstRunAt(once, t("2026-06-01T00:00:00Z"), 0))).toBe("2026-03-01T10:00:00.000Z");
  });

  it("never fires again after its instant", () => {
    expect(nextRunAfter(once, t("2026-03-01T10:00:00Z"), 0)).toBeNull();
    expect(iso(nextRunAfter(once, t("2026-02-01T00:00:00Z"), 0))).toBe("2026-03-01T10:00:00.000Z");
  });
});

describe("interval", () => {
  const anchor = t("2026-01-01T00:00:00Z");
  const every5 = trigger({ type: "interval", every_ms: 300_000 });

  it("first runs at the anchor when that is now or later", () => {
    expect(firstRunAt(every5, anchor, anchor)).toBe(anchor);
    const later = trigger({ type: "interval", every_ms: 300_000, anchor: "2026-01-02T00:00:00Z" });
    expect(iso(firstRunAt(later, anchor, anchor))).toBe("2026-01-02T00:00:00.000Z");
  });

  it("first runs at the next aligned slot when the anchor is past", () => {
    expect(iso(firstRunAt(every5, anchor + 301_000, anchor))).toBe("2026-01-01T00:10:00.000Z");
  });

  it("stays aligned to the anchor, strictly after the given time", () => {
    expect(nextRunAfter(every5, anchor, anchor)).toBe(anchor + 300_000);
    expect(nextRunAfter(every5, anchor + 299_999, anchor)).toBe(anchor + 300_000);
    expect(nextRunAfter(every5, anchor + 300_000, anchor)).toBe(anchor + 600_000);
    expect(nextRunAfter(every5, anchor - 5, anchor)).toBe(anchor);
  });

  it("skips over a long gap in one step", () => {
    const after = anchor + 7 * 86_400_000 + 1;
    expect(nextRunAfter(every5, after, anchor)).toBe(anchor + 7 * 86_400_000 + 300_000);
  });
});

describe("daily", () => {
  it("runs at the local time today if not yet passed, else tomorrow", () => {
    const d = trigger({ type: "daily", time: "09:00", timezone: "UTC" });
    expect(iso(nextRunAfter(d, t("2026-01-05T08:59:59Z"), 0))).toBe("2026-01-05T09:00:00.000Z");
    expect(iso(nextRunAfter(d, t("2026-01-05T09:00:00Z"), 0))).toBe("2026-01-06T09:00:00.000Z");
    expect(iso(firstRunAt(d, t("2026-01-05T10:00:00Z"), 0))).toBe("2026-01-06T09:00:00.000Z");
  });

  it("uses the zone's offset, winter and summer", () => {
    const d = trigger({ type: "daily", time: "09:00", timezone: "Europe/Berlin" });
    expect(iso(nextRunAfter(d, t("2026-01-05T00:00:00Z"), 0))).toBe("2026-01-05T08:00:00.000Z");
    expect(iso(nextRunAfter(d, t("2026-07-06T00:00:00Z"), 0))).toBe("2026-07-06T07:00:00.000Z");
  });

  it("uses the local date, not the UTC date", () => {
    // 23:00 in Tokyo is 14:00 UTC the same day; at 20:00 UTC it is already tomorrow in Tokyo.
    const d = trigger({ type: "daily", time: "23:00", timezone: "Asia/Tokyo" });
    expect(iso(nextRunAfter(d, t("2026-01-05T20:00:00Z"), 0))).toBe("2026-01-06T14:00:00.000Z");
  });

  it("honors weekdays in local time", () => {
    // 2026-01-05 is a Monday. Weekdays Mon and Fri.
    const d = trigger({ type: "daily", time: "09:00", timezone: "UTC", weekdays: [1, 5] });
    expect(iso(nextRunAfter(d, t("2026-01-05T09:00:00Z"), 0))).toBe("2026-01-09T09:00:00.000Z");
    expect(iso(nextRunAfter(d, t("2026-01-09T10:00:00Z"), 0))).toBe("2026-01-12T09:00:00.000Z");
    // Sunday 20:00 in New York is Monday 01:00 UTC; the local day is still Sunday.
    const ny = trigger({
      type: "daily",
      time: "21:00",
      timezone: "America/New_York",
      weekdays: [0],
    });
    expect(iso(nextRunAfter(ny, t("2026-01-12T01:00:00Z"), 0))).toBe("2026-01-12T02:00:00.000Z");
  });

  it("finds a run a week out when only one weekday is allowed", () => {
    const d = trigger({ type: "daily", time: "09:00", timezone: "UTC", weekdays: [1] });
    expect(iso(nextRunAfter(d, t("2026-01-05T09:00:01Z"), 0))).toBe("2026-01-12T09:00:00.000Z");
  });

  describe("daylight saving", () => {
    it("moves a time inside the spring-forward gap to just after it", () => {
      // New York 2026-03-08: 02:00 EST jumps to 03:00 EDT. 02:30 does not exist.
      const d = trigger({ type: "daily", time: "02:30", timezone: "America/New_York" });
      expect(iso(nextRunAfter(d, t("2026-03-08T00:00:00Z"), 0))).toBe("2026-03-08T07:30:00.000Z");
      // The day after is a normal EDT day.
      expect(iso(nextRunAfter(d, t("2026-03-08T07:30:00Z"), 0))).toBe("2026-03-09T06:30:00.000Z");
    });

    it("runs a repeated fall-back time once, at the first occurrence", () => {
      // New York 2026-11-01: 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
      const d = trigger({ type: "daily", time: "01:30", timezone: "America/New_York" });
      expect(iso(nextRunAfter(d, t("2026-11-01T00:00:00Z"), 0))).toBe("2026-11-01T05:30:00.000Z");
      expect(iso(nextRunAfter(d, t("2026-11-01T05:30:00Z"), 0))).toBe("2026-11-02T06:30:00.000Z");
    });

    it("keeps local time across the change", () => {
      const d = trigger({ type: "daily", time: "09:00", timezone: "Europe/London" });
      expect(iso(nextRunAfter(d, t("2026-03-28T12:00:00Z"), 0))).toBe("2026-03-29T08:00:00.000Z");
      expect(iso(nextRunAfter(d, t("2026-10-24T12:00:00Z"), 0))).toBe("2026-10-25T09:00:00.000Z");
    });

    it("handles a half hour shift (Lord Howe Island)", () => {
      // Australia/Lord_Howe: +10:30 standard, +11:00 in summer. 2026-04-05 02:00 back to 01:30.
      const d = trigger({ type: "daily", time: "01:45", timezone: "Australia/Lord_Howe" });
      // First 01:45 on 2026-04-05 is still at +11:00, i.e. 14:45Z on 04-04.
      expect(iso(nextRunAfter(d, t("2026-04-04T12:00:00Z"), 0))).toBe("2026-04-04T14:45:00.000Z");
      expect(iso(nextRunAfter(d, t("2026-04-04T14:45:00Z"), 0))).toBe("2026-04-05T15:15:00.000Z");
    });
  });
});

describe("wall clock helpers", () => {
  it("reads local fields as UTC epoch", () => {
    expect(iso(wallClock(t("2026-07-01T12:00:00Z"), "Europe/Berlin"))).toBe(
      "2026-07-01T14:00:00.000Z",
    );
  });

  it("round trips ordinary wall times", () => {
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"]) {
      const wall = t("2026-05-20T09:15:00Z");
      expect(wallClock(wallToInstant(wall, tz), tz)).toBe(wall);
    }
  });
});
