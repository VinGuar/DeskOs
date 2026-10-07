import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtures } from "../fixtures.ts";
import { spawnCapture } from "../process.ts";
import { makeTempDir } from "../temp.ts";
import {
  type FakeClaudeScenario,
  fakeClaudeScenarioSchema,
  fakeClaudeScenarios,
  prepareFakeClaude,
} from "./scenario.ts";

let tmp: { dir: string; cleanup: () => void };
beforeEach(() => {
  tmp = makeTempDir("deskos-fake-claude-");
});
afterEach(() => {
  tmp.cleanup();
});

async function run(
  scenario: FakeClaudeScenario,
  opts: { args?: string[]; input?: string; timeoutMs?: number; cwd?: string } = {},
) {
  const h = prepareFakeClaude(scenario, tmp.dir);
  const res = await spawnCapture(h.command, [...h.args, ...(opts.args ?? [])], {
    env: h.env,
    cwd: opts.cwd ?? tmp.dir,
    timeoutMs: opts.timeoutMs ?? 10_000,
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  const lines = res.stdout.split("\n").filter((l) => l !== "");
  return { ...res, lines, handle: h };
}

const parseAll = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe("fake claude binary", () => {
  it("success: emits init, assistant, result and exits 0", async () => {
    const r = await run(fakeClaudeScenarios.success({ text: "All good", costUsd: 0.25 }));
    expect(r.code).toBe(0);
    const events = parseAll(r.lines);
    expect(events.map((e) => e.type)).toEqual(["system", "assistant", "result"]);
    expect(events[2]).toMatchObject({
      subtype: "success",
      result: "All good",
      total_cost_usd: 0.25,
    });
  });

  it("records argv, cwd, stdin, and env keys", async () => {
    const r = await run(
      { ...fakeClaudeScenarios.success(), readStdin: true },
      { args: ["-p", "--output-format", "stream-json"], input: "do the thing" },
    );
    expect(r.code).toBe(0);
    const rec = r.handle.readRecord();
    expect(rec).not.toBeNull();
    expect(rec?.argv).toEqual(["-p", "--output-format", "stream-json"]);
    expect(path.resolve(rec?.cwd ?? "")).toBe(path.resolve(tmp.dir));
    expect(rec?.stdin).toBe("do the thing");
    expect(rec?.envKeys).toContain("FAKE_CLAUDE_SCENARIO");
  });

  it("readRecord is null before the fake runs", () => {
    const h = prepareFakeClaude(fakeClaudeScenarios.success(), tmp.dir);
    expect(h.readRecord()).toBeNull();
  });

  it("partial: no result event and non-zero exit", async () => {
    const r = await run(fakeClaudeScenarios.partial());
    expect(r.code).toBe(1);
    expect(parseAll(r.lines).some((e) => e.type === "result")).toBe(false);
  });

  it("malformed: emits lines that are not valid JSON or have the wrong shape", async () => {
    const r = await run(fakeClaudeScenarios.malformed());
    expect(r.code).toBe(0);
    const bad = r.lines.filter((l) => {
      try {
        JSON.parse(l);
        return false;
      } catch {
        return true;
      }
    });
    expect(bad).toEqual(["{this is not json", "plain text line"]);
    expect(r.lines).toContain('{"type":42,"nonsense":true}');
  });

  it("slow: takes at least the scripted delay", async () => {
    const started = Date.now();
    const r = await run(fakeClaudeScenarios.slow(100));
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it("hanging: never exits on its own and can be killed", async () => {
    const r = await run(fakeClaudeScenarios.hanging(), { timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
    expect(r.code === 0).toBe(false);
    expect(parseAll(r.lines)[0]).toMatchObject({ type: "system", subtype: "init" });
  });

  it("crash: exits 70 with the message on stderr", async () => {
    const r = await run(fakeClaudeScenarios.crash("boom"));
    expect(r.code).toBe(70);
    expect(r.stderr).toContain("boom");
  });

  it("hugeOutput: emits every line without truncation", async () => {
    const r = await run(fakeClaudeScenarios.hugeOutput(5000));
    expect(r.code).toBe(0);
    expect(r.lines).toHaveLength(5002);
    expect(parseAll(r.lines).at(-1)).toMatchObject({ type: "result" });
  });

  it("permissionDeniedWrite: reports a denied tool call and a denial list", async () => {
    const r = await run(fakeClaudeScenarios.permissionDeniedWrite("/outside/secret.txt"));
    const events = parseAll(r.lines);
    const toolResult = events.find((e) => e.type === "user");
    expect(JSON.stringify(toolResult)).toContain("Permission denied");
    expect(events.at(-1)).toMatchObject({
      type: "result",
      permission_denials: [
        { tool_name: "Write", tool_input: { file_path: "/outside/secret.txt" } },
      ],
    });
  });

  it("writeFile: writes relative to cwd and reports failures without crashing", async () => {
    const work = path.join(tmp.dir, "work");
    mkdirSync(work);
    const r = await run(
      {
        steps: [
          { writeFile: { path: "out.txt", content: "hello" } },
          { writeFile: { path: path.join("no", "such", "dir", "x.txt"), content: "x" } },
        ],
      },
      { cwd: work },
    );
    expect(r.code).toBe(0);
    expect(readFileSync(path.join(work, "out.txt"), "utf8")).toBe("hello");
    const [ok, failed] = parseAll(r.lines);
    expect(ok).toMatchObject({ type: "fake_write", ok: true });
    expect(failed).toMatchObject({ type: "fake_write", ok: false, code: "ENOENT" });
  });

  it("stderr and custom exit codes pass through", async () => {
    const r = await run({ steps: [{ stderr: "warning: something" }], exitCode: 3 });
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("warning: something");
  });

  it("exits 64 when no scenario is given", async () => {
    const h = prepareFakeClaude(fakeClaudeScenarios.success(), tmp.dir);
    const r = await spawnCapture(h.command, h.args, { env: { FAKE_CLAUDE_SCENARIO: "" } });
    expect(r.code).toBe(64);
  });

  it("rejects invalid scenarios before writing them", () => {
    expect(() =>
      prepareFakeClaude({ steps: [{ sleep: -1 }] } as FakeClaudeScenario, tmp.dir, "bad"),
    ).toThrow();
    expect(existsSync(path.join(tmp.dir, "bad.fake-claude.json"))).toBe(false);
  });

  it("the shipped fixture scenario is valid and runs", async () => {
    const scenario = fixtures.json("fake-claude/success.json", fakeClaudeScenarioSchema);
    const r = await run(scenario);
    expect(r.code).toBe(0);
    expect(parseAll(r.lines).at(-1)).toMatchObject({ result: "Loaded from a fixture." });
  });
});
