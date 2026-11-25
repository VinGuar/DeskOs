import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { type Clock, systemClock } from "../clock.ts";

/** Dotted lowercase segments: `scheduler.run.ended`. */
const TOPIC_NAME = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)*$/;

/** A named event type with the schema its payload must match. Make one with defineTopic. */
export interface Topic<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: S;
}

export function defineTopic<S extends z.ZodType>(name: string, schema: S): Topic<S> {
  if (!TOPIC_NAME.test(name)) throw new Error(`invalid topic name: ${JSON.stringify(name)}`);
  return Object.freeze({ name, schema });
}

export interface BusEvent<T = unknown> {
  readonly id: string;
  readonly topic: string;
  readonly workspace_id: string;
  /** ISO timestamp from the bus clock. */
  readonly at: string;
  readonly payload: T;
}

export type BusHandler<T = unknown> = (event: BusEvent<T>) => void | Promise<void>;

export interface Subscription {
  unsubscribe(): void;
}

export interface SubscribeOptions {
  /** Only deliver events from this workspace. */
  workspaceId?: string;
}

export interface EventBusOptions {
  clock?: Clock;
  newId?: () => string;
  /** A handler threw or rejected. Never called for the publisher's own errors. */
  onError?: (err: unknown, event: BusEvent) => void;
}

interface Sub {
  pattern: string;
  workspaceId: string | null;
  handler: BusHandler;
  active: boolean;
}

/**
 * In-process publish/subscribe. Not persisted: anything that must survive a
 * restart goes through the scheduler or a store, not the bus.
 *
 * Patterns: an exact topic name, `prefix.*` (any topic under prefix), or `*`.
 * Handlers run in subscription order; publish resolves once all of them have
 * settled. A failing handler is reported to onError and affects nobody else.
 */
export class EventBus {
  readonly #clock: Clock;
  readonly #newId: () => string;
  readonly #onError: (err: unknown, event: BusEvent) => void;
  readonly #topics = new Map<string, Topic>();
  #subs: Sub[] = [];

  constructor(opts: EventBusOptions = {}) {
    this.#clock = opts.clock ?? systemClock;
    this.#newId = opts.newId ?? randomUUID;
    this.#onError = opts.onError ?? (() => {});
  }

  /** Validates the payload (throws on mismatch, before any handler runs), then delivers it. */
  async publish<S extends z.ZodType>(
    workspaceId: string,
    topic: Topic<S>,
    payload: z.input<S>,
  ): Promise<BusEvent<z.output<S>>> {
    if (workspaceId.length === 0) throw new Error("workspaceId is required");
    this.#claim(topic);
    const event: BusEvent<z.output<S>> = deepFreeze({
      id: this.#newId(),
      topic: topic.name,
      workspace_id: workspaceId,
      at: new Date(this.#clock.now()).toISOString(),
      payload: topic.schema.parse(payload),
    });

    const pending: Promise<void>[] = [];
    for (const sub of this.#subs) {
      if (!sub.active || !matches(sub.pattern, event.topic)) continue;
      if (sub.workspaceId !== null && sub.workspaceId !== workspaceId) continue;
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          pending.push(result.catch((err: unknown) => this.#report(err, event)));
        }
      } catch (err) {
        this.#report(err, event);
      }
    }
    await Promise.all(pending);
    return event;
  }

  subscribe<S extends z.ZodType>(
    topic: Topic<S>,
    handler: BusHandler<z.output<S>>,
    opts?: SubscribeOptions,
  ): Subscription;
  subscribe(pattern: string, handler: BusHandler, opts?: SubscribeOptions): Subscription;
  subscribe(
    topic: Topic | string,
    handler: BusHandler<never>,
    opts: SubscribeOptions = {},
  ): Subscription {
    const pattern = typeof topic === "string" ? topic : topic.name;
    if (typeof topic !== "string") this.#claim(topic);
    if (!isPattern(pattern)) throw new Error(`invalid topic pattern: ${JSON.stringify(pattern)}`);
    const sub: Sub = {
      pattern,
      workspaceId: opts.workspaceId ?? null,
      handler: handler as BusHandler,
      active: true,
    };
    // Copy on write, so a dispatch in progress keeps iterating its own list.
    this.#subs = [...this.#subs, sub];
    return {
      unsubscribe: () => {
        if (!sub.active) return;
        sub.active = false;
        this.#subs = this.#subs.filter((s) => s !== sub);
      },
    };
  }

  /** A view that publishes only into, and only receives events from, one workspace. */
  forWorkspace(workspaceId: string): WorkspaceBus {
    if (workspaceId.length === 0) throw new Error("workspaceId is required");
    return new WorkspaceBus(this, workspaceId);
  }

  /** Number of live subscriptions. */
  get size(): number {
    return this.#subs.length;
  }

  /** Two different topic objects with one name would make payload types meaningless. */
  #claim(topic: Topic): void {
    const known = this.#topics.get(topic.name);
    if (known === undefined) this.#topics.set(topic.name, topic);
    else if (known !== topic) throw new Error(`topic ${topic.name} is already defined elsewhere`);
  }

  #report(err: unknown, event: BusEvent): void {
    try {
      this.#onError(err, event);
    } catch {
      // An error reporter that throws must not break delivery.
    }
  }
}

export class WorkspaceBus {
  readonly workspaceId: string;
  readonly #bus: EventBus;

  constructor(bus: EventBus, workspaceId: string) {
    this.#bus = bus;
    this.workspaceId = workspaceId;
  }

  publish<S extends z.ZodType>(
    topic: Topic<S>,
    payload: z.input<S>,
  ): Promise<BusEvent<z.output<S>>> {
    return this.#bus.publish(this.workspaceId, topic, payload);
  }

  subscribe<S extends z.ZodType>(topic: Topic<S>, handler: BusHandler<z.output<S>>): Subscription;
  subscribe(pattern: string, handler: BusHandler): Subscription;
  subscribe(topic: Topic | string, handler: BusHandler<never>): Subscription {
    return this.#bus.subscribe(topic as string, handler as BusHandler, {
      workspaceId: this.workspaceId,
    });
  }
}

function isPattern(pattern: string): boolean {
  if (pattern === "*") return true;
  const base = pattern.endsWith(".*") ? pattern.slice(0, -2) : pattern;
  return TOPIC_NAME.test(base);
}

function matches(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return topic.startsWith(pattern.slice(0, -1));
  return pattern === topic;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
