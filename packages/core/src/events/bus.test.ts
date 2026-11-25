import { FakeClock } from "@deskos/testkit";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type BusEvent, defineTopic, EventBus } from "./bus.ts";

const noteSaved = defineTopic("note.saved", z.object({ path: z.string(), size: z.number() }));
const noteRemoved = defineTopic("note.removed", z.object({ path: z.string() }));
const syncDone = defineTopic("sync.done", z.object({ count: z.number().int() }));

function setup() {
  const clock = new FakeClock();
  const errors: unknown[] = [];
  let n = 0;
  const bus = new EventBus({
    clock,
    newId: () => `ev-${++n}`,
    onError: (err) => errors.push(err),
  });
  return { bus, clock, errors };
}

describe("defineTopic", () => {
  it.each(["", "Note.saved", "note..saved", ".note", "note.", "note saved", "note.*", "*"])(
    "rejects the name %j",
    (name) => {
      expect(() => defineTopic(name, z.null())).toThrow(/invalid topic name/);
    },
  );
});

describe("EventBus", () => {
  it("delivers a validated, frozen event with id, workspace, and timestamp", async () => {
    const { bus } = setup();
    const seen: BusEvent<{ path: string; size: number }>[] = [];
    bus.subscribe(noteSaved, (e) => {
      seen.push(e);
    });
    const event = await bus.publish("ws-1", noteSaved, { path: "a.md", size: 3 });
    expect(event).toEqual({
      id: "ev-1",
      topic: "note.saved",
      workspace_id: "ws-1",
      at: "2026-01-01T00:00:00.000Z",
      payload: { path: "a.md", size: 3 },
    });
    expect(seen).toEqual([event]);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });

  it("rejects an invalid payload before any handler runs", async () => {
    const { bus } = setup();
    let calls = 0;
    bus.subscribe("*", () => {
      calls++;
    });
    await expect(bus.publish("ws-1", noteSaved, { path: 1 } as never)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("strips fields the schema does not know", async () => {
    const { bus } = setup();
    const event = await bus.publish("ws-1", noteRemoved, { path: "a.md", secret: "x" } as never);
    expect(event.payload).toEqual({ path: "a.md" });
  });

  it("matches exact names, prefix patterns, and the wildcard", async () => {
    const { bus } = setup();
    const got: Record<string, string[]> = { exact: [], prefix: [], all: [] };
    bus.subscribe("note.saved", (e) => {
      got.exact?.push(e.topic);
    });
    bus.subscribe("note.*", (e) => {
      got.prefix?.push(e.topic);
    });
    bus.subscribe("*", (e) => {
      got.all?.push(e.topic);
    });
    await bus.publish("ws-1", noteSaved, { path: "a", size: 1 });
    await bus.publish("ws-1", noteRemoved, { path: "a" });
    await bus.publish("ws-1", syncDone, { count: 2 });
    expect(got).toEqual({
      exact: ["note.saved"],
      prefix: ["note.saved", "note.removed"],
      all: ["note.saved", "note.removed", "sync.done"],
    });
  });

  it("does not let `note.*` match a topic that merely starts with the same letters", async () => {
    const { bus } = setup();
    const notebook = defineTopic("notebook.opened", z.object({}));
    const seen: string[] = [];
    bus.subscribe("note.*", (e) => {
      seen.push(e.topic);
    });
    await bus.publish("ws-1", notebook, {});
    expect(seen).toEqual([]);
  });

  it.each(["", "note.", "note.**", "*.saved", "note.*.x", "NOTE"])(
    "rejects the subscription pattern %j",
    (pattern) => {
      const { bus } = setup();
      expect(() => bus.subscribe(pattern, () => {})).toThrow(/invalid topic pattern/);
    },
  );

  it("calls handlers in subscription order and waits for async ones", async () => {
    const { bus, clock } = setup();
    const order: string[] = [];
    bus.subscribe("*", async () => {
      order.push("a start");
      await new Promise<void>((r) => clock.setTimeout(r, 10));
      order.push("a end");
    });
    bus.subscribe("*", () => {
      order.push("b");
    });
    const done = bus.publish("ws-1", syncDone, { count: 1 });
    expect(order).toEqual(["a start", "b"]);
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await clock.tick(5);
    expect(settled).toBe(false);
    await clock.tick(5);
    await done;
    expect(order).toEqual(["a start", "b", "a end"]);
  });

  it("isolates throwing and rejecting handlers", async () => {
    const { bus, errors } = setup();
    const seen: string[] = [];
    bus.subscribe("*", () => {
      throw new Error("sync boom");
    });
    bus.subscribe("*", () => Promise.reject(new Error("async boom")));
    bus.subscribe("*", (e) => {
      seen.push(e.topic);
    });
    await expect(bus.publish("ws-1", syncDone, { count: 1 })).resolves.toBeDefined();
    expect(seen).toEqual(["sync.done"]);
    expect(errors.map((e) => (e as Error).message)).toEqual(["sync boom", "async boom"]);
  });

  it("survives an onError that throws", async () => {
    const bus = new EventBus({
      onError: () => {
        throw new Error("reporter broke");
      },
    });
    let reached = false;
    bus.subscribe("*", () => {
      throw new Error("x");
    });
    bus.subscribe("*", () => {
      reached = true;
    });
    await bus.publish("ws-1", syncDone, { count: 1 });
    expect(reached).toBe(true);
  });

  it("unsubscribes, including from inside a dispatch", async () => {
    const { bus } = setup();
    const seen: string[] = [];
    const second = bus.subscribe("*", () => {
      seen.push("second");
    });
    // Subscribed after `second`, so it runs after it: the unsubscribe takes effect next publish.
    const first = bus.subscribe("*", () => {
      seen.push("first");
      second.unsubscribe();
      first.unsubscribe();
    });
    await bus.publish("ws-1", syncDone, { count: 1 });
    await bus.publish("ws-1", syncDone, { count: 2 });
    expect(seen).toEqual(["second", "first"]);
    expect(bus.size).toBe(0);
    first.unsubscribe();
  });

  it("skips a handler that an earlier handler in the same dispatch unsubscribed", async () => {
    const { bus } = setup();
    const seen: string[] = [];
    let later: { unsubscribe(): void } | undefined;
    bus.subscribe("*", () => {
      seen.push("early");
      later?.unsubscribe();
    });
    later = bus.subscribe("*", () => {
      seen.push("later");
    });
    await bus.publish("ws-1", syncDone, { count: 1 });
    expect(seen).toEqual(["early"]);
  });

  it("does not deliver to a subscriber added during a dispatch until the next publish", async () => {
    const { bus } = setup();
    const seen: number[] = [];
    let added = false;
    bus.subscribe(syncDone, () => {
      if (added) return;
      added = true;
      bus.subscribe(syncDone, (e) => {
        seen.push(e.payload.count);
      });
    });
    await bus.publish("ws-1", syncDone, { count: 1 });
    await bus.publish("ws-1", syncDone, { count: 2 });
    expect(seen).toEqual([2]);
  });

  it("refuses two different topic objects with the same name", async () => {
    const { bus } = setup();
    const impostor = defineTopic("note.saved", z.object({ other: z.boolean() }));
    await bus.publish("ws-1", noteSaved, { path: "a", size: 1 });
    await expect(bus.publish("ws-1", impostor, { other: true })).rejects.toThrow(/already defined/);
    expect(() => bus.subscribe(impostor, () => {})).toThrow(/already defined/);
  });

  it("requires a workspace id", async () => {
    const { bus } = setup();
    await expect(bus.publish("", syncDone, { count: 1 })).rejects.toThrow(/workspaceId/);
    expect(() => bus.forWorkspace("")).toThrow(/workspaceId/);
  });
});

describe("WorkspaceBus", () => {
  it("only sees its own workspace and only publishes into it", async () => {
    const { bus } = setup();
    const a = bus.forWorkspace("ws-a");
    const b = bus.forWorkspace("ws-b");
    const seen: Record<string, string[]> = { a: [], b: [], global: [] };
    a.subscribe("*", (e) => {
      seen.a?.push(`${e.workspace_id}:${e.topic}`);
    });
    b.subscribe(syncDone, (e) => {
      seen.b?.push(`${e.workspace_id}:${e.payload.count}`);
    });
    bus.subscribe("*", (e) => {
      seen.global?.push(e.workspace_id);
    });
    await a.publish(syncDone, { count: 1 });
    await b.publish(syncDone, { count: 2 });
    await bus.publish("ws-c", noteRemoved, { path: "x" });
    expect(seen).toEqual({
      a: ["ws-a:sync.done"],
      b: ["ws-b:2"],
      global: ["ws-a", "ws-b", "ws-c"],
    });
    expect(a.workspaceId).toBe("ws-a");
  });
});
