# Handoff
Last updated: 2026-11-24, Claude Code session 3, after: M1-T03 code complete, green locally, pushed for CI.

Short "resume here" file. Rewrite it after every finished step (code pushed, CI result in, task flipped, blocker hit), not just at session end. Keep it under about 100 lines: history goes in PROGRESS.md, rationale in DECISIONS.md.

## Resume here
- Done so far: M0, M1-T01, M1-T02 (last green CI: run 42087947882 on `d6f9e34`).
- Active task: M1-T03 event bus and persistent, restart-safe scheduler. Code complete, `pnpm check` and audit green on Windows (358 tests). Pushed; waiting on CI.
- Next step: check the CI run for the latest commit on main. Green on ubuntu, macOS, Windows, gitleaks, audit: flip M1-T03 to `[x]` with the run id in TASKS.md, PROGRESS.md, and here. Red: read annotations, fix, push once.
- After that: M1-T04 ApprovalGate, PendingAction, Approval, audit log on `JsonlLog` with `rotateDaily: true`.
- Uncommitted work: none.

## Where things are (packages/core/src)
- `clock.ts`: `Clock` interface. All time goes through it. Tests use `FakeClock` from testkit.
- `storage/`: `writeFileAtomic` (temp + rename, Windows retry), `JsonStore` (one JSON file per id), `JsonlLog` (append-only, size and daily rotation).
- `vault/`: frontmatter parse/serialize, file naming, `NoteSchemaRegistry`, `Vault` (notes on disk, path guard).
- `search/`: `NoteIndex` (MiniSearch), `reconcileIndex`/`loadIndex`/`saveIndexSnapshot`, `VaultWatcher`.
- `entities/`: note schemas for the six core note types, `NoteRepository`, `Job` + `JobRepository`.
- `events/bus.ts`: `EventBus`, `defineTopic`, `WorkspaceBus` (`bus.forWorkspace(id)`). In-process, not persisted.
- `scheduler/triggers.ts`: `once`/`interval`/`daily` triggers, DST handling via `Intl`.
- `scheduler/scheduler.ts`: `Scheduler` (one per workspace, records at `.deskos/schedules/<id>.json`), `TaskHandler`, run markers for restart safety, `scheduler.*` topics. Design and guarantees: DECISIONS.md "Event bus and scheduler (M1-T03)".
- `util/keyed-lock.ts`: per-key async serialization, used by `JobRepository` and `Scheduler`.
- `index.ts`: public exports. Add new modules here.
- `packages/testkit`: fake claude binary, `FakeClock`, fixtures, `makeTempDir` (returns a resolved path).
- `scripts/`: boundary, em dash, secret scan, env file checks, each with a test.

## How to verify
- `pnpm check` runs lint, typecheck, boundary, em dash, secret scan, and tests. `pnpm audit --audit-level high` must also be clean.
- A task is done only when CI is green on ubuntu, macOS, and Windows plus the gitleaks and audit jobs.

## Watching CI (no gh CLI on this machine)
- Public repo, so the REST API works unauthenticated (60 req/hr):
  - runs: `https://api.github.com/repos/VinGuar/DeskOs/actions/runs?head_sha=<sha>`
  - jobs: `.../actions/runs/<run id>/jobs`
  - failure messages: `.../check-runs/<job id>/annotations`
- Full logs need auth. For gitleaks failures, run the gitleaks release binary locally: `gitleaks git --redact .`.

## Gotchas that already bit us
- Boundary check bans domain words in `packages/core` and `packages/ui-core`, including in tests and variable names (`repo`, `commit`, `merge`, `branch`, `git`, `deploy`, `worktree`, `CI`). Use neutral words.
- No em dashes anywhere in the repo.
- Fake secrets in tests: build them from short string pieces. One long random-looking piece trips gitleaks `generic-api-key`.
- macOS temp dirs are under `/private/var`; compare resolved paths. `makeTempDir` already resolves.
- Windows: a folder cannot be renamed while a file inside is open (EPERM). Retry in tests.
- macOS: fs.watch (FSEvents) drops events for a moment after start. Real-fs watcher tests must wait for a live event first.
- Pushing while CI runs cancels the running run (workflow `cancel-in-progress`). Wait for a result before pushing again.
- `pnpm format` (Biome) rewrites `\uXXXX` escapes in strings to literal characters. Harmless. It sometimes needs two passes to settle; run it until "No fixes applied".
- `exactOptionalPropertyTypes` is on: pass optional options with a conditional spread, not `key: maybeUndefined`.
- Scheduler tests mix the fake clock (scheduler time) with real fs. Pattern: `await clock.tick(ms); await s.idle();`. For blocked handlers use `until(cond)` (real-time poll) and wait for the marker on disk, not `s.running`, before simulating a crash.
- PowerShell shows pnpm stderr as `NativeCommandError` noise. Check the real output and exit code.
- pnpm warns about a core/testkit workspace cycle. Expected, see DECISIONS.md.
- The pre-commit hook runs the secret scan on staged files; it prints `scan-secrets: ok` on commit.

## Open questions for the owner
- Repo is public; plan default was private. Keep public?
- Move the repo out of OneDrive? (OneDrive can lock files.)
