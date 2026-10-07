# Testing

## Run
| What | Command | Notes |
|---|---|---|
| Everything CI runs locally | `pnpm check` | lint, typecheck, boundary, em dash, secrets, tests |
| Unit + integration | `pnpm test` | vitest, all `*.test.ts` under `packages/*/src`, `apps/*/src`, `scripts` |
| Watch | `pnpm test:watch` | |
| Coverage | `pnpm test:coverage` | floors from SPEC 10.2 enforced starting M1 |
| One file | `pnpm vitest run packages/testkit/src/fake-clock.test.ts` | |
| Boundary | `pnpm check:boundary` | SPEC 3.1, see DECISIONS.md for matching rules |
| Em dash | `pnpm check:em-dash` | |
| Secrets | `pnpm check:secrets` | JS scanner; gitleaks runs only in CI |
| Dependency audit | `pnpm audit --audit-level high` | |
| E2E | `pnpm test:e2e` | arrives in M1-T08 (Playwright) |
| Evals | `pnpm eval` | arrives in M5-T07 |

## Tiers present today
- Unit: core `Clock`, testkit `FakeClock`, fixture loader, scanner and boundary matchers.
- Integration: fake claude binary spawned as a real child process for every preset; secret scan and pre-commit hook run against throwaway git repos; boundary check against a throwaway git repo.
- Repo checks as tests: the real repo has no boundary violations, no em dashes, no secrets, and fixtures name no real hosts.

## Test doubles (packages/testkit)
- `FakeClock`: deterministic time. `advance(ms)` fires due timers in order, `tick(ms)` also lets promises settle, `setTime` simulates skew.
- `prepareFakeClaude(scenario, dir)`: writes a scenario and returns `{ command, args, env }` to spawn the fake `claude`. `fakeClaudeScenarios` has presets: success, partial, malformed, slow, hanging, crash, hugeOutput, permissionDeniedWrite. `readRecord()` returns the argv, cwd, stdin, and env keys the fake saw, for prompt and isolation assertions.
- `createFixtureLoader(dir)` / `fixtures`: CRLF-normalized text, JSON with optional zod schema, JSONL. Refuses paths outside the fixture dir.
- `spawnCapture(command, args, opts)`: spawn with arg arrays, capture output, optional timeout kill.
- `makeTempDir()`.

## Writing tests
- Never use real time in logic tests. Take a `Clock`, pass `FakeClock`.
- Fake secrets: assemble at runtime (`["AK", "IA..."].join("")`), never as literals.
- Fixture hosts: only `example.com/.org/.net`, `*.test`, `*.invalid`, `*.example`, `localhost`.
- Cross-platform: build paths with `path.join`, compare with `path.resolve`. Never assume `/`.

## Mutation testing thresholds
Not set yet. Defined when the safety-critical modules land (M1-T04 onward).

## Flaky tests (quarantine list)
None.

## Manual checklist (real machines)
Filled in M3-T07. Record date, OS version, and result for each item.
