# Handoff
Last updated: 2026-11-05, Claude Code session 2, after: M1-T02 green in CI and marked done.

Short "resume here" file. Rewrite it after every finished step (code pushed, CI result in, task flipped, blocker hit), not just at session end. Keep it under about 100 lines: history goes in PROGRESS.md, rationale in DECISIONS.md.

## Resume here
- Done so far: M0, M1-T01, M1-T02 (last green CI: run 42087947882 on `d6f9e34`).
- Active task: M1-T03 event bus and persistent, restart-safe job scheduler. Not started.
- Next step: design in `packages/core/src/events/` (bus) and `packages/core/src/scheduler/`. Time via `Clock`, persistence via `JsonStore` under `.deskos/`. Restart-safe means: scheduled work survives a daemon restart, and work that was running when the process died is detected on start, not lost or run twice silently. Log the design in DECISIONS.md before coding.
- Uncommitted work: none.

## Where things are (packages/core/src)
- `clock.ts`: `Clock` interface. All time goes through it. Tests use `FakeClock` from testkit.
- `storage/`: `writeFileAtomic` (temp + rename, Windows retry), `JsonStore` (one JSON file per id), `JsonlLog` (append-only, size and daily rotation).
- `vault/`: frontmatter parse/serialize, file naming, `NoteSchemaRegistry`, `Vault` (notes on disk, path guard).
- `search/`: `NoteIndex` (MiniSearch), `reconcileIndex`/`loadIndex`/`saveIndexSnapshot`, `VaultWatcher`.
- `entities/`: note schemas for the six core note types, `NoteRepository`, `Job` + `JobRepository`.
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
- `pnpm format` (Biome) rewrites `\uXXXX` escapes in strings to literal characters. Harmless.
- PowerShell shows pnpm stderr as `NativeCommandError` noise. Check the real output and exit code.
- pnpm warns about a core/testkit workspace cycle. Expected, see DECISIONS.md.
- The pre-commit hook runs the secret scan on staged files; it prints `scan-secrets: ok` on commit.

## Open questions for the owner
- Repo is public; plan default was private. Keep public?
- Move the repo out of OneDrive? (OneDrive can lock files.)
