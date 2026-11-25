import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { type Clock, systemClock, type TimerHandle } from "../clock.ts";
import { operationalShape, WorkspaceMismatchError } from "../entities/jobs.ts";
import { defineTopic, type EventBus, type Topic, type WorkspaceBus } from "../events/bus.ts";
import { CorruptRecordError, JsonStore } from "../storage/json-store.ts";
import { KeyedLock } from "../util/keyed-lock.ts";
import { firstRunAt, nextRunAfter, type TriggerInput, triggerSchema } from "./triggers.ts";

/** Longest a timer sleeps, so a wall clock jump (sleep, manual change) is noticed within a minute. */
export const MAX_TIMER_MS = 60_000;
const MAX_BACKOFF_MS = 3_600_000;
const KIND_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

export const TASK_STATES = ["active", "completed", "failed", "interrupted", "missed"] as const;
export type TaskState = (typeof TASK_STATES)[number];

const isoInstant = z.iso.datetime({ offset: true });

export const runMarkerSchema = z.object({
  run_id: z.string().min(1),
  started_at: isoInstant,
  scheduled_for: isoInstant,
  attempt: z.number().int().min(1),
});

export const lastRunSchema = z.object({
  run_id: z.string().min(1).optional(),
  scheduled_for: isoInstant,
  ended_at: isoInstant,
  outcome: z.enum(["ok", "failed", "timeout", "interrupted", "skipped"]),
  attempt: z.number().int().min(0),
  error: z.string().optional(),
});

export const scheduledTaskSchema = z.looseObject({
  ...operationalShape,
  /** Which registered TaskHandler runs it. */
  kind: z.string().regex(KIND_PATTERN),
  trigger: triggerSchema,
  payload: z.unknown().optional(),
  state: z.enum(TASK_STATES).default("active"),
  /** What to do with a run that was cut off (daemon died, scheduler stopped). */
  on_interrupt: z.enum(["rerun", "hold"]).default("hold"),
  /** What to do with a run found late (daemon was off, machine asleep). */
  misfire: z.enum(["run_once", "skip"]).default("run_once"),
  /** With misfire "skip": a run later than this is skipped. */
  misfire_grace_ms: z.number().int().min(0).default(60_000),
  next_run_at: isoInstant.nullable(),
  /** Attempts already used for the occurrence at next_run_at (retries). */
  attempt: z.number().int().min(0).default(0),
  /** Present while a handler runs. Still present on start means the run was interrupted. */
  running: runMarkerSchema.optional(),
  last_run: lastRunSchema.optional(),
});
export type ScheduledTask = z.output<typeof scheduledTaskSchema>;

export interface TaskRunContext<P> {
  readonly task: ScheduledTask;
  readonly payload: P;
  readonly runId: string;
  /** 1 for the first try of an occurrence, 2 for the first retry, and so on. */
  readonly attempt: number;
  readonly scheduledFor: string;
  /** Aborted on timeout, pause, stop, or removal. Handlers should stop promptly. */
  readonly signal: AbortSignal;
}

export interface TaskHandler<S extends z.ZodType = z.ZodType> {
  kind: string;
  payload: S;
  run(ctx: TaskRunContext<z.output<S>>): Promise<void>;
  /** Tries per occurrence, retries included. Default 1 (no retry). */
  maxAttempts?: number;
  /** Default 10 minutes. On expiry the signal aborts and the run counts as failed. */
  timeoutMs?: number;
  /** First retry delay; doubles each retry, capped at an hour. Default 30 s. */
  backoffMs?: number;
  /** Default for tasks of this kind. "rerun" only for idempotent handlers. Default "hold". */
  onInterrupt?: "rerun" | "hold";
}

export interface UpsertTaskInput {
  /** Caller-chosen id makes upsert idempotent across boots. Random when absent. */
  id?: string;
  kind: string;
  trigger: TriggerInput;
  payload?: unknown;
  source: string;
  on_interrupt?: "rerun" | "hold";
  misfire?: "run_once" | "skip";
  misfire_grace_ms?: number;
}

const taskRef = { task_id: z.string(), kind: z.string() };

export const runStartedTopic = defineTopic(
  "scheduler.run.started",
  z.object({ ...taskRef, run_id: z.string(), attempt: z.number(), scheduled_for: z.string() }),
);
export const runSucceededTopic = defineTopic(
  "scheduler.run.succeeded",
  z.object({ ...taskRef, run_id: z.string(), attempt: z.number(), duration_ms: z.number() }),
);
export const runFailedTopic = defineTopic(
  "scheduler.run.failed",
  z.object({
    ...taskRef,
    run_id: z.string(),
    attempt: z.number(),
    error: z.string(),
    timed_out: z.boolean(),
    will_retry: z.boolean(),
    next_run_at: z.string().nullable(),
  }),
);
export const runInterruptedTopic = defineTopic(
  "scheduler.run.interrupted",
  z.object({
    ...taskRef,
    run_id: z.string(),
    /** "restart": found on start. "stopped": cut off by pause or stop. */
    cause: z.enum(["restart", "stopped"]),
    policy: z.enum(["rerun", "hold"]),
    next_run_at: z.string().nullable(),
  }),
);
export const runSkippedTopic = defineTopic(
  "scheduler.run.skipped",
  z.object({ ...taskRef, scheduled_for: z.string(), next_run_at: z.string().nullable() }),
);
export const taskInvalidTopic = defineTopic(
  "scheduler.task.invalid",
  z.object({ task_id: z.string(), reason: z.string() }),
);

export interface SchedulerOptions {
  /** The workspace's `.deskos` folder. Records go in `schedules/` under it. */
  internalDir: string;
  workspaceId: string;
  clock?: Clock;
  bus?: EventBus;
  newId?: () => string;
  /** Runs at once across all tasks. Default 4. */
  maxConcurrent?: number;
  /** Persistence failures and other errors that have no caller to throw to. */
  onError?: (err: unknown) => void;
}

type AbortCause = "timeout" | "stopped" | "removed";

interface ActiveRun {
  controller: AbortController;
  done: Promise<void>;
}

/**
 * Persistent scheduler for one workspace. See DECISIONS.md "Event bus and
 * scheduler (M1-T03)" for the guarantees. Call register for each handler,
 * then start, then upsert.
 */
export class Scheduler {
  readonly workspaceId: string;
  readonly #store: JsonStore<typeof scheduledTaskSchema>;
  readonly #clock: Clock;
  readonly #bus: WorkspaceBus | null;
  readonly #newId: () => string;
  readonly #maxConcurrent: number;
  readonly #onError: (err: unknown) => void;
  readonly #lock = new KeyedLock();
  readonly #handlers = new Map<string, TaskHandler>();
  readonly #tasks = new Map<string, ScheduledTask>();
  readonly #active = new Map<string, ActiveRun>();
  readonly #pending = new Set<Promise<unknown>>();
  #timer: TimerHandle | null = null;
  #started = false;
  #paused = false;
  #closed = false;

  constructor(opts: SchedulerOptions) {
    if (opts.workspaceId.length === 0) throw new Error("workspaceId is required");
    this.workspaceId = opts.workspaceId;
    this.#clock = opts.clock ?? systemClock;
    this.#store = new JsonStore(path.join(opts.internalDir, "schedules"), scheduledTaskSchema, {
      clock: this.#clock,
    });
    this.#bus = opts.bus ? opts.bus.forWorkspace(opts.workspaceId) : null;
    this.#newId = opts.newId ?? randomUUID;
    this.#maxConcurrent = opts.maxConcurrent ?? 4;
    if (!Number.isInteger(this.#maxConcurrent) || this.#maxConcurrent < 1) {
      throw new Error("maxConcurrent must be an integer >= 1");
    }
    this.#onError = opts.onError ?? (() => {});
  }

  register<S extends z.ZodType>(handler: TaskHandler<S>): void {
    if (!KIND_PATTERN.test(handler.kind)) {
      throw new Error(`invalid task kind: ${JSON.stringify(handler.kind)}`);
    }
    if (this.#handlers.has(handler.kind))
      throw new Error(`handler ${handler.kind} already registered`);
    if (
      handler.maxAttempts !== undefined &&
      !(Number.isInteger(handler.maxAttempts) && handler.maxAttempts >= 1)
    ) {
      throw new Error("maxAttempts must be an integer >= 1");
    }
    this.#handlers.set(handler.kind, handler as unknown as TaskHandler);
    if (this.#started) this.#kick();
  }

  /** Tasks of this kind stay on disk, dormant, until it is registered again. Runs in flight finish. */
  unregister(kind: string): boolean {
    return this.#handlers.delete(kind);
  }

  /** Loads records, resolves runs interrupted by the last shutdown, and starts the timer. */
  async start(): Promise<void> {
    if (this.#started) throw new Error("scheduler already started");
    if (this.#closed) throw new Error("scheduler is stopped");
    this.#started = true;
    for (const id of await this.#store.ids()) {
      let task: ScheduledTask | undefined;
      try {
        task = await this.#store.get(id);
        if (task && task.workspace_id !== this.workspaceId) {
          throw new WorkspaceMismatchError(id, this.workspaceId, task.workspace_id);
        }
      } catch (err) {
        if (!(err instanceof CorruptRecordError || err instanceof WorkspaceMismatchError))
          throw err;
        this.#report(err);
        this.#emit(taskInvalidTopic, { task_id: id, reason: err.message });
        continue;
      }
      if (task) this.#tasks.set(id, task);
    }
    for (const task of [...this.#tasks.values()]) {
      if (task.running) await this.#lock.run(task.id, () => this.#interrupt(task.id, "restart"));
    }
    this.#kick();
  }

  /**
   * Creates or redefines a task. Same id with the same definition is a no-op,
   * so features can declare their schedules on every boot.
   */
  upsert(input: UpsertTaskInput): Promise<ScheduledTask> {
    this.#requireOpen();
    const handler = this.#handlers.get(input.kind);
    if (!handler) throw new Error(`no handler registered for kind ${input.kind}`);
    const id = input.id ?? this.#newId();
    const trigger = triggerSchema.parse(input.trigger);
    const payload = handler.payload.parse(input.payload) as unknown;
    const definition = {
      kind: input.kind,
      trigger,
      payload,
      source: input.source,
      on_interrupt: input.on_interrupt ?? handler.onInterrupt ?? "hold",
      misfire: input.misfire ?? "run_once",
      misfire_grace_ms: input.misfire_grace_ms ?? 60_000,
    };
    return this.#lock.run(id, async () => {
      const current = this.#tasks.get(id);
      if (current && sameDefinition(current, definition)) return current;
      const now = this.#clock.now();
      const created = current?.created_at ?? iso(now);
      const next = firstRunAt(trigger, now, Date.parse(created));
      const task = await this.#write({
        ...current,
        ...definition,
        id,
        workspace_id: this.workspaceId,
        created_at: created,
        updated_at: iso(now),
        state: "active",
        next_run_at: iso(next),
        attempt: 0,
      });
      this.#kick();
      return task;
    });
  }

  get(id: string): ScheduledTask | undefined {
    this.#requireStarted();
    return this.#tasks.get(id);
  }

  /** Sorted by next run, tasks with none last, then by id. */
  list(): ScheduledTask[] {
    this.#requireStarted();
    return [...this.#tasks.values()].sort(byNextRun);
  }

  /** Deletes the record. A run in flight is aborted and its outcome discarded. */
  remove(id: string): Promise<boolean> {
    this.#requireOpen();
    this.#active.get(id)?.controller.abort("removed" satisfies AbortCause);
    return this.#lock.run(id, async () => {
      this.#tasks.delete(id);
      return this.#store.delete(id);
    });
  }

  /** Run as soon as a slot is free, whatever the state. Throws if it is running. */
  runNow(id: string): Promise<ScheduledTask> {
    this.#requireOpen();
    return this.#lock.run(id, async () => {
      const task = this.#tasks.get(id);
      if (!task) throw new Error(`no such task: ${id}`);
      if (this.#active.has(id) || task.running) throw new Error(`task ${id} is running`);
      const now = this.#clock.now();
      const updated = await this.#write({
        ...task,
        state: "active",
        next_run_at: iso(now),
        attempt: 0,
        updated_at: iso(now),
      });
      this.#kick();
      return updated;
    });
  }

  /** Kill switch: no new runs, running handlers are aborted. Resolves when they have returned. */
  async pause(): Promise<void> {
    this.#paused = true;
    this.#cancelTimer();
    for (const run of this.#active.values()) run.controller.abort("stopped" satisfies AbortCause);
    await Promise.allSettled([...this.#active.values()].map((r) => r.done));
  }

  resume(): void {
    this.#requireOpen();
    this.#paused = false;
    this.#kick();
  }

  get paused(): boolean {
    return this.#paused;
  }

  /** Ids of tasks with a handler in flight. */
  get running(): string[] {
    return [...this.#active.keys()].sort();
  }

  /**
   * Shutdown. Aborts running handlers and waits up to graceMs for them. A
   * handler still going after that keeps its marker, so the next start
   * reports it as interrupted. Nothing is written after stop resolves.
   */
  async stop(graceMs = 5000): Promise<void> {
    if (this.#closed) return;
    this.#paused = true;
    this.#cancelTimer();
    for (const run of this.#active.values()) run.controller.abort("stopped" satisfies AbortCause);
    const settled = Promise.allSettled([...this.#active.values()].map((r) => r.done));
    if (graceMs > 0 && this.#active.size > 0) {
      let timer: TimerHandle | undefined;
      const grace = new Promise<void>((resolve) => {
        timer = this.#clock.setTimeout(resolve, graceMs);
      });
      await Promise.race([settled, grace]);
      timer?.cancel();
    }
    this.#closed = true;
  }

  /** Resolves when no tick, run, or event delivery is in flight. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  #track<T>(p: Promise<T>): Promise<T> {
    this.#pending.add(p);
    void p.then(
      () => this.#pending.delete(p),
      () => this.#pending.delete(p),
    );
    return p;
  }

  /** Launch whatever is due, then sleep until the next due time (at most MAX_TIMER_MS). */
  #kick(): void {
    this.#cancelTimer();
    if (!this.#started || this.#paused || this.#closed) return;
    const now = this.#clock.now();
    let soonest = Number.POSITIVE_INFINITY;
    for (const task of [...this.#tasks.values()].sort(byNextRun)) {
      if (!this.#isRunnable(task)) continue;
      const due = Date.parse(task.next_run_at as string);
      if (due > now) {
        soonest = Math.min(soonest, due);
        continue;
      }
      if (this.#active.size >= this.#maxConcurrent) continue;
      this.#launch(task.id);
    }
    if (this.#hasRunnable()) {
      const delay = Number.isFinite(soonest) ? Math.min(soonest - now, MAX_TIMER_MS) : MAX_TIMER_MS;
      this.#timer = this.#clock.setTimeout(
        () => {
          this.#timer = null;
          this.#kick();
        },
        Math.max(0, delay),
      );
    }
  }

  #isRunnable(task: ScheduledTask): boolean {
    return (
      task.state === "active" &&
      task.next_run_at !== null &&
      !this.#active.has(task.id) &&
      this.#handlers.has(task.kind)
    );
  }

  #hasRunnable(): boolean {
    for (const task of this.#tasks.values()) if (this.#isRunnable(task)) return true;
    return false;
  }

  #cancelTimer(): void {
    this.#timer?.cancel();
    this.#timer = null;
  }

  /** Claims the slot synchronously, so one kick can never launch a task twice. */
  #launch(id: string): void {
    const controller = new AbortController();
    const run: ActiveRun = { controller, done: Promise.resolve() };
    this.#active.set(id, run);
    run.done = this.#track(
      this.#execute(id, controller)
        .catch((err: unknown) => this.#report(err))
        .finally(() => {
          this.#active.delete(id);
          this.#kick();
        }),
    );
  }

  async #execute(id: string, controller: AbortController): Promise<void> {
    const begin = await this.#lock.run(id, () => this.#begin(id));
    if (!begin) return;
    const { task, handler, marker } = begin;
    if (controller.signal.aborted) {
      // Paused, stopped, or removed while the marker was being written: the
      // handler never started, so take the marker back off.
      await this.#lock.run(id, async () => {
        const current = this.#tasks.get(id);
        if (!current?.running || this.#closed) return;
        await this.#write({ ...withoutMarker(current), updated_at: iso(this.#clock.now()) });
      });
      return;
    }
    this.#emit(runStartedTopic, {
      task_id: id,
      kind: task.kind,
      run_id: marker.run_id,
      attempt: marker.attempt,
      scheduled_for: marker.scheduled_for,
    });

    const timeout = this.#clock.setTimeout(
      () => controller.abort("timeout" satisfies AbortCause),
      handler.timeoutMs ?? 600_000,
    );
    let error: unknown = null;
    let failed = false;
    try {
      await Promise.resolve().then(() =>
        handler.run({
          task,
          payload: handler.payload.parse(task.payload),
          runId: marker.run_id,
          attempt: marker.attempt,
          scheduledFor: marker.scheduled_for,
          signal: controller.signal,
        }),
      );
    } catch (err) {
      failed = true;
      error = err;
    } finally {
      timeout.cancel();
    }
    if (this.#closed) return;
    const cause = controller.signal.aborted ? (controller.signal.reason as AbortCause) : null;
    if (cause === "removed") return;
    await this.#lock.run(id, async () => {
      if (!this.#tasks.has(id) || this.#closed) return;
      if (!failed) return this.#succeed(id, handler, marker);
      if (cause === "stopped") return this.#interrupt(id, "stopped");
      return this.#fail(id, handler, marker, error, cause === "timeout");
    });
  }

  /** Under the task lock: re-check, apply misfire policy, write the running marker. */
  async #begin(id: string): Promise<{
    task: ScheduledTask;
    handler: TaskHandler;
    marker: z.output<typeof runMarkerSchema>;
  } | null> {
    const task = this.#tasks.get(id);
    const handler = task && this.#handlers.get(task.kind);
    if (!task || !handler || task.state !== "active" || task.next_run_at === null) return null;
    if (this.#paused || this.#closed) return null;
    const now = this.#clock.now();
    const due = Date.parse(task.next_run_at);
    if (due > now) return null;

    if (task.misfire === "skip" && now - due > task.misfire_grace_ms) {
      const next = nextRunAfter(task.trigger, now, Date.parse(task.created_at));
      await this.#write({
        ...task,
        state: next === null ? "missed" : "active",
        next_run_at: next === null ? null : iso(next),
        attempt: 0,
        updated_at: iso(now),
        last_run: {
          scheduled_for: task.next_run_at,
          ended_at: iso(now),
          outcome: "skipped",
          attempt: 0,
        },
      });
      this.#emit(runSkippedTopic, {
        task_id: id,
        kind: task.kind,
        scheduled_for: task.next_run_at,
        next_run_at: next === null ? null : iso(next),
      });
      return null;
    }

    const marker = {
      run_id: this.#newId(),
      started_at: iso(now),
      scheduled_for: task.next_run_at,
      attempt: task.attempt + 1,
    };
    const updated = await this.#write({ ...task, running: marker, updated_at: iso(now) });
    return { task: updated, handler, marker };
  }

  async #succeed(
    id: string,
    handler: TaskHandler,
    marker: z.output<typeof runMarkerSchema>,
  ): Promise<void> {
    const task = this.#tasks.get(id) as ScheduledTask;
    const now = this.#clock.now();
    const next = nextRunAfter(
      task.trigger,
      Math.max(now, Date.parse(marker.scheduled_for)),
      Date.parse(task.created_at),
    );
    await this.#write({
      ...withoutMarker(task),
      state: next === null ? "completed" : "active",
      next_run_at: next === null ? null : iso(next),
      attempt: 0,
      updated_at: iso(now),
      last_run: {
        run_id: marker.run_id,
        scheduled_for: marker.scheduled_for,
        ended_at: iso(now),
        outcome: "ok",
        attempt: marker.attempt,
      },
    });
    this.#emit(runSucceededTopic, {
      task_id: id,
      kind: handler.kind,
      run_id: marker.run_id,
      attempt: marker.attempt,
      duration_ms: now - Date.parse(marker.started_at),
    });
  }

  async #fail(
    id: string,
    handler: TaskHandler,
    marker: z.output<typeof runMarkerSchema>,
    error: unknown,
    timedOut: boolean,
  ): Promise<void> {
    const task = this.#tasks.get(id) as ScheduledTask;
    const now = this.#clock.now();
    const message = timedOut ? "timed out" : errorMessage(error);
    const willRetry = marker.attempt < (handler.maxAttempts ?? 1);
    let next: number | null;
    let state: TaskState = "active";
    if (willRetry) {
      const base = handler.backoffMs ?? 30_000;
      next = now + Math.min(base * 2 ** (marker.attempt - 1), MAX_BACKOFF_MS);
    } else {
      next =
        task.trigger.type === "once"
          ? null
          : nextRunAfter(task.trigger, now, Date.parse(task.created_at));
      if (next === null) state = "failed";
    }
    await this.#write({
      ...withoutMarker(task),
      state,
      next_run_at: next === null ? null : iso(next),
      attempt: willRetry ? marker.attempt : 0,
      updated_at: iso(now),
      last_run: {
        run_id: marker.run_id,
        scheduled_for: marker.scheduled_for,
        ended_at: iso(now),
        outcome: timedOut ? "timeout" : "failed",
        attempt: marker.attempt,
        error: message,
      },
    });
    this.#emit(runFailedTopic, {
      task_id: id,
      kind: handler.kind,
      run_id: marker.run_id,
      attempt: marker.attempt,
      error: message,
      timed_out: timedOut,
      will_retry: willRetry,
      next_run_at: next === null ? null : iso(next),
    });
  }

  /** Under the task lock: apply on_interrupt to a run that was cut off. */
  async #interrupt(id: string, cause: "restart" | "stopped"): Promise<void> {
    const task = this.#tasks.get(id);
    const marker = task?.running;
    if (!task || !marker) return;
    const now = this.#clock.now();
    let next: number | null;
    let state: TaskState = task.state;
    let attempt: number;
    if (task.on_interrupt === "rerun") {
      // Same occurrence again, same attempt number.
      next = now;
      attempt = marker.attempt - 1;
      if (state !== "active") state = "active";
    } else if (task.trigger.type === "once") {
      next = null;
      state = "interrupted";
      attempt = 0;
    } else {
      next = nextRunAfter(task.trigger, now, Date.parse(task.created_at));
      attempt = 0;
    }
    await this.#write({
      ...withoutMarker(task),
      state,
      next_run_at: next === null ? null : iso(next),
      attempt,
      updated_at: iso(now),
      last_run: {
        run_id: marker.run_id,
        scheduled_for: marker.scheduled_for,
        ended_at: iso(now),
        outcome: "interrupted",
        attempt: marker.attempt,
      },
    });
    this.#emit(runInterruptedTopic, {
      task_id: id,
      kind: task.kind,
      run_id: marker.run_id,
      cause,
      policy: task.on_interrupt,
      next_run_at: next === null ? null : iso(next),
    });
  }

  async #write(task: z.input<typeof scheduledTaskSchema>): Promise<ScheduledTask> {
    const saved = await this.#store.put(task.id, task);
    this.#tasks.set(saved.id, saved);
    return saved;
  }

  #emit<S extends z.ZodType>(topic: Topic<S>, payload: z.input<S>): void {
    if (!this.#bus) return;
    void this.#track(this.#bus.publish(topic, payload).catch((err: unknown) => this.#report(err)));
  }

  #report(err: unknown): void {
    try {
      this.#onError(err);
    } catch {
      // A throwing reporter must not break the scheduler.
    }
  }

  #requireStarted(): void {
    if (!this.#started) throw new Error("call start() first");
  }

  #requireOpen(): void {
    this.#requireStarted();
    if (this.#closed) throw new Error("scheduler is stopped");
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function withoutMarker(task: ScheduledTask): ScheduledTask {
  const { running: _running, ...rest } = task;
  return rest as ScheduledTask;
}

function byNextRun(a: ScheduledTask, b: ScheduledTask): number {
  const an = a.next_run_at === null ? Number.POSITIVE_INFINITY : Date.parse(a.next_run_at);
  const bn = b.next_run_at === null ? Number.POSITIVE_INFINITY : Date.parse(b.next_run_at);
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameDefinition(task: ScheduledTask, def: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(def)) {
    if (stableJson(task[key as keyof ScheduledTask]) !== stableJson(value)) return false;
  }
  return true;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
