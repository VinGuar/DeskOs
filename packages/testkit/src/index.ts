export {
  FAKE_CLAUDE_BIN,
  type FakeClaudeHandle,
  type FakeClaudeRecord,
  type FakeClaudeScenario,
  type FakeClaudeStep,
  fakeClaudeRecordSchema,
  fakeClaudeScenarioSchema,
  fakeClaudeScenarios,
  fakeClaudeStepSchema,
  prepareFakeClaude,
} from "./fake-claude/scenario.ts";
export { FAKE_CLOCK_EPOCH, FakeClock } from "./fake-clock.ts";
export {
  createFixtureLoader,
  type FixtureLoader,
  fixtures,
  normalizeLineEndings,
  TESTKIT_FIXTURES_DIR,
} from "./fixtures.ts";
export { type SpawnCaptureOptions, type SpawnCaptureResult, spawnCapture } from "./process.ts";
export { makeTempDir } from "./temp.ts";
