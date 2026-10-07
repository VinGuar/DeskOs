import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Absolute path of the fake binary. Run it as `node <FAKE_CLAUDE_BIN>`. */
export const FAKE_CLAUDE_BIN = fileURLToPath(new URL("./bin.mjs", import.meta.url));

const json = z.record(z.string(), z.unknown());

export const fakeClaudeStepSchema = z.union([
  /** One JSON line on stdout. */
  z.strictObject({ emit: json }),
  /** One raw line on stdout, for malformed output. */
  z.strictObject({ stdout: z.string() }),
  z.strictObject({ stderr: z.string() }),
  /** The same JSON line many times, for huge output. */
  z.strictObject({ repeat: z.strictObject({ times: z.number().int().min(0), emit: json }) }),
  z.strictObject({ sleep: z.number().int().min(0) }),
  /** Real file write relative to cwd. Reports the outcome as a fake_write line. */
  z.strictObject({ writeFile: z.strictObject({ path: z.string(), content: z.string() }) }),
  /** Never exit until killed. */
  z.strictObject({ hang: z.literal(true) }),
  /** Throw with this message. Exit code 70, message on stderr. */
  z.strictObject({ crash: z.string() }),
]);

export const fakeClaudeScenarioSchema = z.strictObject({
  steps: z.array(fakeClaudeStepSchema),
  exitCode: z.number().int().min(0).max(255).default(0),
  readStdin: z.boolean().default(false),
});

export type FakeClaudeStep = z.input<typeof fakeClaudeStepSchema>;
export type FakeClaudeScenario = z.input<typeof fakeClaudeScenarioSchema>;

/** What the fake saw when it was invoked. */
export const fakeClaudeRecordSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
  stdin: z.string().nullable(),
  envKeys: z.array(z.string()),
});
export type FakeClaudeRecord = z.infer<typeof fakeClaudeRecordSchema>;

export interface FakeClaudeHandle {
  /** Spawn this with `args` plus whatever CLI flags the runner adds. */
  command: string;
  args: string[];
  /** Merge into the child env. */
  env: Record<string, string>;
  scenarioPath: string;
  recordPath: string;
  /** Null until the fake has run. */
  readRecord(): FakeClaudeRecord | null;
}

/** Validate a scenario, write it into dir, and return how to launch the fake. */
export function prepareFakeClaude(
  scenario: FakeClaudeScenario,
  dir: string,
  name = "scenario",
): FakeClaudeHandle {
  const parsed = fakeClaudeScenarioSchema.parse(scenario);
  const scenarioPath = path.join(dir, `${name}.fake-claude.json`);
  const recordPath = path.join(dir, `${name}.fake-claude.record.json`);
  writeFileSync(scenarioPath, JSON.stringify(parsed, null, 2));
  return {
    command: process.execPath,
    args: [FAKE_CLAUDE_BIN],
    env: { FAKE_CLAUDE_SCENARIO: scenarioPath, FAKE_CLAUDE_RECORD: recordPath },
    scenarioPath,
    recordPath,
    readRecord() {
      if (!existsSync(recordPath)) return null;
      return fakeClaudeRecordSchema.parse(JSON.parse(readFileSync(recordPath, "utf8")));
    },
  };
}

// Event shapes below approximate `claude -p --output-format stream-json`.
// UNVERIFIED: M2-T02 must check them against the current CLI docs and update
// these presets, then log the result in docs/DECISIONS.md.
const SESSION = "fake-session-0001";

const init = (sessionId: string) => ({
  emit: {
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: "fake-model",
    tools: [],
  },
});

const assistantText = (text: string, sessionId: string) => ({
  type: "assistant",
  session_id: sessionId,
  message: { role: "assistant", content: [{ type: "text", text }] },
});

const result = (
  opts: { text: string; costUsd: number; sessionId: string; isError?: boolean },
  extra: Record<string, unknown> = {},
) => ({
  emit: {
    type: "result",
    subtype: opts.isError ? "error_during_execution" : "success",
    is_error: opts.isError ?? false,
    result: opts.text,
    session_id: opts.sessionId,
    num_turns: 1,
    duration_ms: 1,
    total_cost_usd: opts.costUsd,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...extra,
  },
});

/** Ready-made scenarios covering the cases in SPEC Section 10.4. */
export const fakeClaudeScenarios = {
  success(opts: { text?: string; costUsd?: number; sessionId?: string } = {}): FakeClaudeScenario {
    const sessionId = opts.sessionId ?? SESSION;
    const text = opts.text ?? "Done.";
    return {
      steps: [
        init(sessionId),
        { emit: assistantText(text, sessionId) },
        result({ text, costUsd: opts.costUsd ?? 0.01, sessionId }),
      ],
    };
  },

  /** Stream stops before a result event and the process exits non-zero. */
  partial(): FakeClaudeScenario {
    return {
      steps: [init(SESSION), { emit: assistantText("Working on it", SESSION) }],
      exitCode: 1,
    };
  },

  /** Non-JSON and wrongly shaped lines mixed into the stream. */
  malformed(): FakeClaudeScenario {
    return {
      steps: [
        init(SESSION),
        { stdout: "{this is not json" },
        { emit: { type: 42, nonsense: true } },
        { stdout: "plain text line" },
      ],
    };
  },

  slow(delayMs: number): FakeClaudeScenario {
    return {
      steps: [
        init(SESSION),
        { sleep: delayMs },
        { emit: assistantText("Slow but done", SESSION) },
        { sleep: delayMs },
        result({ text: "Slow but done", costUsd: 0.01, sessionId: SESSION }),
      ],
    };
  },

  /** Emits init then never exits. The runner must time out and kill it. */
  hanging(): FakeClaudeScenario {
    return { steps: [init(SESSION), { hang: true }] };
  },

  crash(message = "simulated crash"): FakeClaudeScenario {
    return { steps: [init(SESSION), { crash: message }] };
  },

  hugeOutput(lines: number): FakeClaudeScenario {
    return {
      steps: [
        init(SESSION),
        { repeat: { times: lines, emit: assistantText("x".repeat(200), SESSION) } },
        result({ text: "Done after a lot of output", costUsd: 0.5, sessionId: SESSION }),
      ],
    };
  },

  /** The agent tries a write and the CLI denies it. */
  permissionDeniedWrite(filePath: string): FakeClaudeScenario {
    const toolUseId = "toolu_fake_0001";
    return {
      steps: [
        init(SESSION),
        {
          emit: {
            type: "assistant",
            session_id: SESSION,
            message: {
              role: "assistant",
              content: [
                { type: "tool_use", id: toolUseId, name: "Write", input: { file_path: filePath } },
              ],
            },
          },
        },
        {
          emit: {
            type: "user",
            session_id: SESSION,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUseId,
                  is_error: true,
                  content: `Permission denied: ${filePath}`,
                },
              ],
            },
          },
        },
        result(
          { text: "Could not write the file.", costUsd: 0.01, sessionId: SESSION },
          { permission_denials: [{ tool_name: "Write", tool_input: { file_path: filePath } }] },
        ),
      ],
    };
  },
} as const;
