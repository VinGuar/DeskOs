import { z } from "zod";

const DAY_MS = 86_400_000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const isoInstant = z.iso.datetime({ offset: true });

export const onceTriggerSchema = z.object({
  type: z.literal("once"),
  at: isoInstant,
});

export const intervalTriggerSchema = z.object({
  type: z.literal("interval"),
  every_ms: z.number().int().min(1000),
  /** Runs fall on anchor + k * every_ms. Defaults to the task's creation time. */
  anchor: isoInstant.optional(),
});

export const dailyTriggerSchema = z.object({
  type: z.literal("daily"),
  /** Local wall-clock time, 24 hour `HH:MM`. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM"),
  /** IANA name, for example `Europe/Berlin`. */
  timezone: z.string().refine(isValidTimeZone, "unknown time zone"),
  /** Local days of the week, 0 = Sunday. All days when absent. */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
});

export const triggerSchema = z.discriminatedUnion("type", [
  onceTriggerSchema,
  intervalTriggerSchema,
  dailyTriggerSchema,
]);
export type Trigger = z.output<typeof triggerSchema>;
export type TriggerInput = z.input<typeof triggerSchema>;

/**
 * When a newly created (or re-triggered) task first runs. `once` runs at its
 * instant even if that is already past (the misfire policy then applies).
 * `interval` runs at its anchor if that is not past, else at the next slot.
 */
export function firstRunAt(trigger: Trigger, now: number, defaultAnchor: number): number {
  switch (trigger.type) {
    case "once":
      return Date.parse(trigger.at);
    case "interval": {
      const anchor = trigger.anchor === undefined ? defaultAnchor : Date.parse(trigger.anchor);
      return anchor >= now ? anchor : intervalAfter(anchor, trigger.every_ms, now);
    }
    case "daily":
      return dailyAfter(trigger, now);
  }
}

/** The first run strictly after `after`, or null if the trigger never fires again. */
export function nextRunAfter(
  trigger: Trigger,
  after: number,
  defaultAnchor: number,
): number | null {
  switch (trigger.type) {
    case "once": {
      const at = Date.parse(trigger.at);
      return at > after ? at : null;
    }
    case "interval": {
      const anchor = trigger.anchor === undefined ? defaultAnchor : Date.parse(trigger.anchor);
      return intervalAfter(anchor, trigger.every_ms, after);
    }
    case "daily":
      return dailyAfter(trigger, after);
  }
}

function intervalAfter(anchor: number, every: number, after: number): number {
  if (after < anchor) return anchor;
  return anchor + (Math.floor((after - anchor) / every) + 1) * every;
}

/**
 * Next local `HH:MM` on an allowed weekday, strictly after `after`.
 * A time inside a spring-forward gap runs at the offset in force before the
 * gap (02:30 becomes 03:30). A time that occurs twice runs at the first.
 */
function dailyAfter(trigger: z.output<typeof dailyTriggerSchema>, after: number): number {
  const [hh, mm] = trigger.time.split(":").map(Number) as [number, number];
  const today = new Date(wallClock(after, trigger.timezone));
  // Eight days covers a full week plus a skipped calendar day (a zone jumping the date line).
  for (let i = 0; i <= 8; i++) {
    const wall = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + i,
      hh,
      mm,
    );
    if (trigger.weekdays && !trigger.weekdays.includes(new Date(wall).getUTCDay())) continue;
    const instant = wallToInstant(wall, trigger.timezone);
    if (instant > after) return instant;
  }
  throw new Error(`no run found for daily trigger ${JSON.stringify(trigger)}`);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/**
 * Local wall-clock time in `tz` at `instant`, expressed as epoch ms of those
 * same fields read as UTC. Second precision.
 */
export function wallClock(instant: number, tz: string): number {
  const fields: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(instant))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = fields;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** UTC offset of `tz` at `instant`, in ms (local = utc + offset). */
function offsetAt(instant: number, tz: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallClock(whole, tz) - whole;
}

/** The instant a local wall-clock time happens in `tz`. See dailyAfter for gaps and overlaps. */
export function wallToInstant(wall: number, tz: string): number {
  // Offsets a day either side bracket any single transition near `wall`.
  const before = offsetAt(wall - DAY_MS, tz);
  const after = offsetAt(wall + DAY_MS, tz);
  const candidates = [wall - before, wall - after]
    .filter((c) => wallClock(c, tz) === Math.floor(wall / 1000) * 1000)
    .sort((a, b) => a - b);
  // Empty means `wall` falls in a gap: keep the pre-gap offset, which lands after the gap.
  return candidates[0] ?? wall - before;
}
