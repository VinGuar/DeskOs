import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FAKE_CLOCK_EPOCH, FakeClock, makeTempDir } from "@deskos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { WorkspaceMismatchError } from "../entities/jobs.ts";
import { type BusEvent, EventBus } from "../events/bus.ts";
import { CorruptRecordError } from "../storage/json-store.ts";
import {
  MAX_TIMER_MS,
  type ScheduledTask,
  Scheduler,
  type TaskHandler,
  type TaskRunContext,
} from "./scheduler.ts";

const T0 = FAKE_CLOCK_EPOCH;
const at = (ms: number) => new Date(T0 + ms).toISOString();

const cleanups: (() => void)[] = [];
const schedulers: Scheduler[] = [];
afterEach(async () => {
  for (const s of schedulers.splice(0)) await s.stop(0);
  for (const c of cleanups.splice(0)) c();
});

function setup(opts: { maxConcurrent?: number } = {}) {
  const t = makeTempDir();
  cleanups.push(t.cleanup);
  const internalDir = path.join(t.dir, ".deskos");
  const clock = new FakeClock();
  const bus = new EventBus({ clock });
  const events: BusEvent[] = [];
  bus.subscribe("scheduler.*", (e) => {
    events.push(e);
  });
  const errors: unknown[] = [];
  let n = 0;
  const make = (workspaceId = "ws-1") => {
    const s = new Scheduler({
      internalDir,
      workspaceId,
      clock,
      bus,
      newId: () => `id-${++n}`,
      ...(opts.maxConcurrent === undefined ? {} : { maxConcurrent: opts.maxConcurrent }),
      onError: (err) => errors.push(err),
    });
    schedulers.push(s);
    return s;
  };
  const onDisk = (id: string): ScheduledTask =>
    JSON.parse(readFileSync(path.join(internalDir, "schedules", `${id}.json`), "utf8"));
  const topics = () => events.map((e) => e.topic);
  return { internalDir, clock, bus, events, errors, make, onDisk, topics };
}

type Behavior = (ctx: TaskRunContext<unknown>) => Promise<void>;

/** A handler that records each run and does whatever `behavior` says. */
function recorder(
  kind = "tick",
  behavior: Behavior = async () => {},
  extra: Partial<TaskHandler> = {},
) {
  const calls: TaskRunContext<unknown>[] = [];
  const handler: TaskHandler = {
    kind,
    payload: z.unknown(),
    ...extra,
    run: async (ctx) => {
      calls.push(ctx);
      await behavior(ctx);
    },
  };
  return { handler, calls };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Rejects when the run is aborted, like a well behaved handler. */
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

const never = () => new Promise<void>(() => {});

/** Polls with real time; the scheduler's own time is the fake clock. */
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("Scheduler basics", () => {
  it("runs a once task at its time, then marks it completed on disk", async () => {
    const { make, clock, onDisk, events } = setup();
    const s = make();
    const { handler, calls } = recorder();
    s.register(handler);
    await s.start();
    await s.upsert({
      id: "t1",
      kind: "tick",
      source: "test",
      trigger: { type: "once", at: at(5000) },
    });

    await clock.tick(4999);
    await s.idle();
    expect(calls).toHaveLength(0);
    await clock.tick(1);
    await s.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ runId: "id-1", attempt: 1, scheduledFor: at(5000) });

    const task = s.get("t1");
    expect(task).toMatchObject({
      state: "completed",
      next_run_at: null,
      attempt: 0,
      last_run: { run_id: "id-1", outcome: "ok", attempt: 1, scheduled_for: at(5000) },
    });
    expect(task?.running).toBeUndefined();
    expect(onDisk("t1")).toEqual(task);
    expect(events.map((e) => [e.topic, e.workspace_id])).toEqual([
      ["scheduler.run.started", "ws-1"],
      ["scheduler.run.succeeded", "ws-1"],
    ]);
  });

  it("requires start before use and a registered handler for upsert", async () => {
    const { make } = setup();
    const s = make();
    expect(() => s.list()).toThrow(/start/);
    await s.start();
    await expect(s.start()).rejects.toThrow(/already started/);
    expect(() =>
      s.upsert({ kind: "nope", source: "test", trigger: { type: "interval", every_ms: 1000 } }),
    ).toThrow(/no handler/);
  });

  it("rejects bad handler definitions", () => {
    const { make } = setup();
    const s = make();
    expect(() => s.register(recorder("Bad Kind").handler)).toThrow(/invalid task kind/);
    expect(() => s.register(recorder("ok", undefined, { maxAttempts: 0 }).handler)).toThrow(
      /maxAttempts/,
    );
    s.register(recorder("ok").handler);
    expect(() => s.register(recorder("ok").handler)).toThrow(/already registered/);
  });

  it("validates the payload with the handler's schema", async () => {
    const { make } = setup();
    const s = make();
    const calls: unknown[] = [];
    s.register({
      kind: "greet",
      payload: z.object({ name: z.string(), loud: z.boolean().default(false) }),
      run: async (ctx) => {
        calls.push(ctx.payload);
      },
    });
    await s.start();
    expect(() =>
      s.upsert({
        kind: "greet",
        source: "test",
        payload: { name: 3 },
        trigger: { type: "once", at: at(0) },
      }),
    ).toThrow();
    await s.upsert({
      kind: "greet",
      source: "test",
      payload: { name: "Ada" },
      trigger: { type: "once", at: at(0) },
    });
    await s.idle();
    expect(calls).toEqual([{ name: "Ada", loud: false }]);
  });

  it("upsert with the same id and definition is a no-op; a new definition reschedules", async () => {
    const { make, clock } = setup();
    const s = make();
    s.register(recorder().handler);
    await s.start();
    const input = {
      id: "daily",
      kind: "tick",
      source: "test",
      trigger: { type: "daily", time: "09:00", timezone: "UTC" },
    } as const;
    const first = await s.upsert(input);
    expect(first.next_run_at).toBe(at(9 * 3_600_000));
    clock.advance(1000);
    const again = await s.upsert({
      ...input,
      trigger: { timezone: "UTC", time: "09:00", type: "daily" },
    });
    expect(again).toEqual(first);

    const changed = await s.upsert({
      ...input,
      trigger: { type: "daily", time: "10:00", timezone: "UTC" },
    });
    expect(changed.next_run_at).toBe(at(10 * 3_600_000));
    expect(changed.created_at).toBe(first.created_at);
    expect(changed.updated_at).toBe(at(1000));
    expect(s.list()).toHaveLength(1);
  });

  it("runs an interval task on aligned slots", async () => {
    const { make, clock } = setup();
    const s = make();
    const { handler, calls } = recorder();
    s.register(handler);
    await s.start();
    await s.upsert({
      id: "i",
      kind: "tick",
      source: "test",
      trigger: { type: "interval", every_ms: 10_000 },
    });
    await s.idle();
    for (let i = 0; i < 3; i++) {
      await clock.tick(10_000);
      await s.idle();
    }
    expect(calls.map((c) => c.scheduledFor)).toEqual([at(0), at(10_000), at(20_000), at(30_000)]);
    expect(s.get("i")?.next_run_at).toBe(at(40_000));
  });

  it("runs a daily task at local time", async () => {
    const { make, clock } = setup();
    const s = make();
    const { handler, calls } = recorder();
    s.register(handler);
    await s.start();
    // 09:00 in Berlin in January is 08:00 UTC.
    await s.upsert({
      kind: "tick",
      source: "test",
      trigger: { type: "daily", time: "09:00", timezone: "Europe/Berlin" },
    });
    for (let i = 0; i < 9 * 60; i++) {
      await clock.tick(60_000);
      await s.idle();
    }
    expect(calls.map((c) => c.scheduledFor)).toEqual([at(8 * 3_600_000)]);
  });

  it("only publishes into its own workspace", async () => {
    const { make, bus } = setup();
    const other: BusEvent[] = [];
    bus.subscribe(
      "*",
      (e) => {
        other.push(e);
      },
      { workspaceId: "ws-2" },
    );
    const s = make();
    s.register(recorder().handler);
    await s.start();
    await s.upsert({ kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await s.idle();
    expect(other).toEqual([]);
  });
});

describe("Scheduler restart safety", () => {
  it("a held once task cut off by a crash comes back as interrupted, not rerun", async () => {
    const { make, onDisk, events } = setup();
    const s1 = make();
    const first = recorder("tick", never);
    s1.register(first.handler);
    await s1.start();
    await s1.upsert({
      id: "t",
      kind: "tick",
      source: "test",
      trigger: { type: "once", at: at(0) },
    });
    await until(() => first.calls.length === 1);
    await until(() => onDisk("t").running !== undefined);
    expect(onDisk("t").running).toMatchObject({ run_id: "id-1", attempt: 1, scheduled_for: at(0) });
    await s1.stop(0); // Handler never returns: same as the process dying.
    expect(onDisk("t").running).toBeDefined();

    const s2 = make();
    const second = recorder();
    s2.register(second.handler);
    await s2.start();
    await s2.idle();
    expect(second.calls).toHaveLength(0);
    expect(s2.get("t")).toMatchObject({
      state: "interrupted",
      next_run_at: null,
      last_run: { run_id: "id-1", outcome: "interrupted", attempt: 1 },
    });
    expect(s2.get("t")?.running).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      topic: "scheduler.run.interrupted",
      payload: {
        task_id: "t",
        run_id: "id-1",
        cause: "restart",
        policy: "hold",
        next_run_at: null,
      },
    });

    // The owner decides: run it again.
    await s2.runNow("t");
    await s2.idle();
    expect(second.calls).toHaveLength(1);
    expect(s2.get("t")?.state).toBe("completed");
  });

  it("a rerun task cut off by a crash runs again with the same attempt and occurrence", async () => {
    const { make } = setup();
    const s1 = make();
    const first = recorder("tick", never, { onInterrupt: "rerun" });
    s1.register(first.handler);
    await s1.start();
    await s1.upsert({
      id: "t",
      kind: "tick",
      source: "test",
      trigger: { type: "once", at: at(0) },
    });
    await until(() => first.calls.length === 1);
    await s1.stop(0);

    const s2 = make();
    const second = recorder();
    s2.register(second.handler);
    await s2.start();
    await s2.idle();
    expect(s2.get("t")?.on_interrupt).toBe("rerun");
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]).toMatchObject({ attempt: 1, scheduledFor: at(0) });
    expect(s2.get("t")?.state).toBe("completed");
  });

  it("a held recurring task moves on to its next occurrence", async () => {
    const { make, clock, internalDir, onDisk } = setup();
    const s1 = make();
    s1.register(recorder("tick", never).handler);
    await s1.start();
    await s1.upsert({
      id: "t",
      kind: "tick",
      source: "test",
      trigger: { type: "interval", every_ms: 60_000 },
    });
    await until(
      () =>
        existsSync(path.join(internalDir, "schedules", "t.json")) &&
        onDisk("t").running !== undefined,
    );
    await s1.stop(0);

    clock.setTime(T0 + 30_000);
    const s2 = make();
    const second = recorder();
    s2.register(second.handler);
    await s2.start();
    await s2.idle();
    expect(second.calls).toHaveLength(0);
    expect(s2.get("t")).toMatchObject({ state: "active", next_run_at: at(60_000) });
    await clock.tick(30_000);
    await s2.idle();
    expect(second.calls).toHaveLength(1);
  });

  it("stop lets a handler that honors the abort finish, and records the interruption", async () => {
    const { make, onDisk } = setup();
    const s = make();
    const { handler, calls } = recorder("tick", (ctx) => untilAborted(ctx.signal));
    s.register(handler);
    await s.start();
    await s.upsert({ id: "t", kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await until(() => calls.length === 1);
    await s.stop(1000);
    expect(onDisk("t")).toMatchObject({
      state: "interrupted",
      last_run: { outcome: "interrupted" },
    });
    expect(onDisk("t").running).toBeUndefined();
  });

  it("stop gives up after the grace period and leaves the marker for the next start", async () => {
    const { make, clock, onDisk } = setup();
    const s = make();
    s.register(recorder("tick", never).handler);
    await s.start();
    await s.upsert({ id: "t", kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await until(() => s.running.length === 1);
    await until(() => onDisk("t").running !== undefined);
    const stopping = s.stop(1000);
    await clock.tick(1000);
    await stopping;
    expect(onDisk("t").running).toBeDefined();
    expect(() =>
      s.upsert({ kind: "tick", source: "x", trigger: { type: "once", at: at(0) } }),
    ).toThrow(/stopped/);
  });

  it("skips corrupt records and records from another workspace, and runs the rest", async () => {
    const { make, internalDir, errors, events } = setup();
    const foreign = make("ws-2");
    foreign.register(recorder().handler);
    await foreign.start();
    await foreign.upsert({
      id: "theirs",
      kind: "tick",
      source: "test",
      trigger: { type: "once", at: at(60_000) },
    });
    await foreign.stop(0);
    mkdirSync(path.join(internalDir, "schedules"), { recursive: true });
    writeFileSync(path.join(internalDir, "schedules", "broken.json"), "{ not json");

    const s = make("ws-1");
    const { handler, calls } = recorder();
    s.register(handler);
    await s.start();
    await s.upsert({
      id: "mine",
      kind: "tick",
      source: "test",
      trigger: { type: "once", at: at(0) },
    });
    await s.idle();
    expect(s.list().map((t) => t.id)).toEqual(["mine"]);
    expect(calls.map((c) => c.task.id)).toEqual(["mine"]);
    expect(errors.map((e) => e?.constructor)).toEqual([CorruptRecordError, WorkspaceMismatchError]);
    expect(
      events.filter((e) => e.topic === "scheduler.task.invalid").map((e) => e.payload),
    ).toEqual([
      expect.objectContaining({ task_id: "broken" }),
      expect.objectContaining({ task_id: "theirs" }),
    ]);
  });
});

describe("Scheduler missed runs", () => {
  async function missedSetup(misfire: "run_once" | "skip") {
    const ctx = setup();
    const s1 = ctx.make();
    s1.register(recorder().handler);
    await s1.start();
    await s1.upsert({
      id: "i",
      kind: "tick",
      source: "test",
      misfire,
      misfire_grace_ms: 5000,
      trigger: { type: "interval", every_ms: 60_000 },
    });
    await s1.idle();
    await s1.stop(0);
    // Daemon off for an hour.
    ctx.clock.setTime(T0 + 3_600_000 + 1000);
    const s2 = ctx.make();
    const rec = recorder();
    s2.register(rec.handler);
    await s2.start();
    await s2.idle();
    return { ...ctx, s2, calls: rec.calls };
  }

  it("run_once runs one catch-up run, then continues from the next slot", async () => {
    const { s2, calls } = await missedSetup("run_once");
    expect(calls.map((c) => c.scheduledFor)).toEqual([at(60_000)]);
    expect(s2.get("i")?.next_run_at).toBe(at(3_660_000));
  });

  it("skip skips a run past the grace period", async () => {
    const { s2, calls, events } = await missedSetup("skip");
    expect(calls).toHaveLength(0);
    expect(s2.get("i")).toMatchObject({
      next_run_at: at(3_660_000),
      last_run: { outcome: "skipped" },
    });
    expect(events.at(-1)).toMatchObject({
      topic: "scheduler.run.skipped",
      payload: { scheduled_for: at(60_000), next_run_at: at(3_660_000) },
    });
  });

  it("a once task skipped for lateness is marked missed", async () => {
    const { make, clock } = setup();
    const s = make();
    const { handler, calls } = recorder();
    s.register(handler);
    clock.setTime(T0 + 10_000);
    await s.start();
    await s.upsert({
      id: "o",
      kind: "tick",
      source: "test",
      misfire: "skip",
      misfire_grace_ms: 1000,
      trigger: { type: "once", at: at(0) },
    });
    await s.idle();
    expect(calls).toHaveLength(0);
    expect(s.get("o")).toMatchObject({ state: "missed", next_run_at: null });
  });

  it("notices a wall clock jump within MAX_TIMER_MS", async () => {
    const { make, clock } = setup();
    const s = make();
    const { handler, calls } = recorder();
    s.register(handler);
    await s.start();
    await s.upsert({
      kind: "tick",
      source: "test",
      trigger: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    // Machine sleeps: wall clock jumps past 09:00 while no timer fires.
    clock.setTime(T0 + 9 * 3_600_000 + 1);
    await clock.tick(MAX_TIMER_MS);
    await s.idle();
    expect(calls).toHaveLength(1);
  });
});

describe("Scheduler failures", () => {
  it("retries with exponential backoff up to maxAttempts", async () => {
    const { make, clock, events } = setup();
    const s = make();
    let failures = 2;
    const { handler, calls } = recorder(
      "tick",
      async () => {
        if (failures-- > 0) throw new Error("flaky");
      },
      { maxAttempts: 3, backoffMs: 1000 },
    );
    s.register(handler);
    await s.start();
    await s.upsert({ id: "t", kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await s.idle();
    expect(s.get("t")).toMatchObject({ state: "active", attempt: 1, next_run_at: at(1000) });
    await clock.tick(1000);
    await s.idle();
    expect(s.get("t")).toMatchObject({ attempt: 2, next_run_at: at(3000) });
    await clock.tick(1999);
    await s.idle();
    expect(calls).toHaveLength(2);
    await clock.tick(1);
    await s.idle();
    expect(calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
    expect(s.get("t")).toMatchObject({
      state: "completed",
      attempt: 0,
      last_run: { outcome: "ok", attempt: 3 },
    });
    const failed = events.filter((e) => e.topic === "scheduler.run.failed").map((e) => e.payload);
    expect(failed).toEqual([
      expect.objectContaining({
        attempt: 1,
        error: "flaky",
        will_retry: true,
        next_run_at: at(1000),
      }),
      expect.objectContaining({
        attempt: 2,
        error: "flaky",
        will_retry: true,
        next_run_at: at(3000),
      }),
    ]);
  });

  it("a once task out of attempts is failed; a recurring one moves on", async () => {
    const { make } = setup();
    const s = make();
    s.register(
      recorder("boom", async () => {
        throw new Error("nope");
      }).handler,
    );
    await s.start();
    await s.upsert({ id: "o", kind: "boom", source: "test", trigger: { type: "once", at: at(0) } });
    await s.upsert({
      id: "d",
      kind: "boom",
      source: "test",
      trigger: { type: "daily", time: "00:00", timezone: "UTC" },
    });
    await s.runNow("d");
    await s.idle();
    expect(s.get("o")).toMatchObject({
      state: "failed",
      next_run_at: null,
      last_run: { outcome: "failed", error: "nope" },
    });
    expect(s.get("d")).toMatchObject({
      state: "active",
      next_run_at: at(86_400_000),
      last_run: { outcome: "failed" },
    });
  });

  it("a timed out handler is aborted and counts as failed", async () => {
    const { make, clock, events } = setup();
    const s = make();
    const { handler, calls } = recorder("slow", (ctx) => untilAborted(ctx.signal), {
      timeoutMs: 5000,
    });
    s.register(handler);
    await s.start();
    await s.upsert({ id: "t", kind: "slow", source: "test", trigger: { type: "once", at: at(0) } });
    await until(() => calls.length === 1);
    await clock.tick(4999);
    expect(calls[0]?.signal.aborted).toBe(false);
    await clock.tick(1);
    await s.idle();
    expect(calls[0]?.signal.reason).toBe("timeout");
    expect(s.get("t")).toMatchObject({
      state: "failed",
      last_run: { outcome: "timeout", error: "timed out" },
    });
    expect(events.at(-1)).toMatchObject({
      topic: "scheduler.run.failed",
      payload: { timed_out: true },
    });
  });

  it("a handler that throws synchronously is a failure, not a crash", async () => {
    const { make } = setup();
    const s = make();
    s.register({
      kind: "sync",
      payload: z.unknown(),
      run: () => {
        throw new Error("sync throw");
      },
    });
    await s.start();
    await s.upsert({ id: "t", kind: "sync", source: "test", trigger: { type: "once", at: at(0) } });
    await s.idle();
    expect(s.get("t")).toMatchObject({ state: "failed", last_run: { error: "sync throw" } });
  });
});

describe("Scheduler concurrency and control", () => {
  it("never overlaps runs of one task", async () => {
    const { make, clock } = setup();
    const s = make();
    const gate = deferred();
    let inFlight = 0;
    let maxInFlight = 0;
    const { handler, calls } = recorder("tick", async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (calls.length === 1) await gate.promise;
      inFlight--;
    });
    s.register(handler);
    await s.start();
    await s.upsert({
      id: "i",
      kind: "tick",
      source: "test",
      trigger: { type: "interval", every_ms: 1000 },
    });
    await until(() => calls.length === 1);
    await clock.tick(5500);
    expect(calls).toHaveLength(1);
    gate.resolve();
    await s.idle();
    expect(s.get("i")?.next_run_at).toBe(at(6000));
    await clock.tick(500);
    await s.idle();
    expect(calls).toHaveLength(2);
    expect(maxInFlight).toBe(1);
  });

  it("caps runs across tasks at maxConcurrent", async () => {
    const { make } = setup({ maxConcurrent: 2 });
    const s = make();
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const { handler, calls } = recorder("tick", async (ctx) => {
      const g = deferred();
      gates.set(ctx.task.id, g);
      await g.promise;
    });
    s.register(handler);
    await s.start();
    for (const id of ["a", "b", "c"]) {
      await s.upsert({ id, kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    }
    await until(() => calls.length === 2);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.running).toEqual(["a", "b"]);
    gates.get("a")?.resolve();
    await until(() => calls.length === 3);
    expect(s.running).toEqual(["b", "c"]);
    gates.get("b")?.resolve();
    gates.get("c")?.resolve();
    await s.idle();
    expect(s.list().map((t) => t.state)).toEqual(["completed", "completed", "completed"]);
  });

  it("keeps tasks dormant while their handler is not registered", async () => {
    const { make, clock } = setup();
    const s1 = make();
    s1.register(recorder().handler);
    await s1.start();
    await s1.upsert({
      id: "t",
      kind: "tick",
      source: "test",
      trigger: { type: "once", at: at(1000) },
    });
    await s1.stop(0);

    const s2 = make();
    await s2.start();
    await clock.tick(60_000);
    await s2.idle();
    expect(s2.get("t")?.state).toBe("active");
    const { handler, calls } = recorder();
    s2.register(handler);
    await s2.idle();
    expect(calls).toHaveLength(1);

    expect(s2.unregister("tick")).toBe(true);
    expect(s2.unregister("tick")).toBe(false);
  });

  it("pause aborts running handlers and holds new runs until resume", async () => {
    const { make, clock } = setup();
    const s = make();
    const { handler, calls } = recorder("tick", (ctx) => untilAborted(ctx.signal), {
      onInterrupt: "rerun",
    });
    s.register(handler);
    await s.start();
    await s.upsert({ id: "t", kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await until(() => calls.length === 1);
    await s.pause();
    expect(s.paused).toBe(true);
    expect(calls[0]?.signal.reason).toBe("stopped");
    expect(s.get("t")).toMatchObject({
      state: "active",
      next_run_at: at(0),
      attempt: 0,
      last_run: { outcome: "interrupted" },
    });
    await clock.tick(60_000);
    await s.idle();
    expect(calls).toHaveLength(1);
    s.resume();
    await until(() => calls.length === 2);
    expect(calls[1]).toMatchObject({ attempt: 1, scheduledFor: at(0) });
  });

  it("pause right after launch never calls the handler and leaves no marker", async () => {
    const { make, onDisk } = setup();
    for (let i = 0; i < 5; i++) {
      const s = make();
      const { handler, calls } = recorder(`tick${i}`, (ctx) => untilAborted(ctx.signal));
      s.register(handler);
      await s.start();
      const id = `t${i}`;
      await s.upsert({
        id,
        kind: `tick${i}`,
        source: "test",
        trigger: { type: "once", at: at(0) },
      });
      await s.pause();
      await s.idle();
      expect(calls).toHaveLength(0);
      expect(onDisk(id)).toMatchObject({ state: "active", next_run_at: at(0) });
      expect(onDisk(id).running).toBeUndefined();
      await s.stop(0);
    }
  });

  it("runNow reruns a finished task and refuses a running one", async () => {
    const { make } = setup();
    const s = make();
    const gate = deferred();
    const { handler, calls } = recorder("tick", async () => {
      if (calls.length === 2) await gate.promise;
    });
    s.register(handler);
    await s.start();
    await s.upsert({ id: "t", kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await s.idle();
    expect(s.get("t")?.state).toBe("completed");
    await s.runNow("t");
    await until(() => calls.length === 2);
    await expect(s.runNow("t")).rejects.toThrow(/running/);
    await expect(s.runNow("missing")).rejects.toThrow(/no such task/);
    gate.resolve();
    await s.idle();
    expect(s.get("t")?.state).toBe("completed");
  });

  it("remove aborts a running handler and the record stays gone", async () => {
    const { make, internalDir, events } = setup();
    const s = make();
    const { handler, calls } = recorder("tick", (ctx) => untilAborted(ctx.signal));
    s.register(handler);
    await s.start();
    await s.upsert({ id: "t", kind: "tick", source: "test", trigger: { type: "once", at: at(0) } });
    await until(() => calls.length === 1);
    expect(await s.remove("t")).toBe(true);
    await s.idle();
    expect(calls[0]?.signal.reason).toBe("removed");
    expect(s.get("t")).toBeUndefined();
    expect(existsSync(path.join(internalDir, "schedules", "t.json"))).toBe(false);
    expect(events.map((e) => e.topic)).toEqual(["scheduler.run.started"]);
    expect(await s.remove("t")).toBe(false);
  });
});
