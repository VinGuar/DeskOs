# Progress (last updated: 2026-11-24 by Claude Code session 3)

## Status
- Current milestone: M1 Core engine. M0, M1-T01, M1-T02 complete (last green CI run 42087947882). M1-T03 code complete and green locally, waiting on CI.
- CI: `.github/workflows/ci.yml` on `https://github.com/VinGuar/DeskOs` (public). Runs on push to main and on PRs.
- Test summary: vitest 358/358 locally on Windows (270/270 on all three OSes at the last green CI). Lint, typecheck, boundary, em dash, secret scan, gitleaks, audit clean. Coverage not measured yet (floors start in M1).

## What works (verified)
- pnpm monorepo with `packages/core`, `packages/ui-core`, `packages/testkit`: `pnpm install`, `pnpm typecheck` (TS 7 strict, `noUncheckedIndexedAccess`), `pnpm lint` (Biome).
- Fake claude binary with 8 presets, each spawned as a real process: `packages/testkit/src/fake-claude/fake-claude.test.ts`.
- FakeClock, fixture loader (CRLF normalization, path escape refusal): their `*.test.ts` files.
- Boundary check, pre-commit secret hook, em dash check, fixture hygiene: `scripts/*.test.ts`.
- Atomic write with crash and Windows EPERM/EBUSY retry tests: `packages/core/src/storage/atomic.test.ts`.
- `JsonStore` (one JSON file per record) and `JsonlLog` (append-only, serialized appends, torn-line recovery, size rotation): `packages/core/src/storage/*.test.ts`.
- Frontmatter parse/serialize (CRLF, BOM, YAML 1.2 core, unknown fields round trip): `packages/core/src/vault/frontmatter.test.ts`.
- File naming and slugs (unicode, illegal chars): `packages/core/src/vault/naming.test.ts`.
- `Vault` create/read/write/update/remove/walk, path guard (traversal, absolute, UNC, dot folders, symlink/junction escape): `packages/core/src/vault/vault.test.ts`.
- `NoteIndex` (MiniSearch): metadata by path and id, search, duplicate ids, snapshot round trip: `packages/core/src/search/note-index.test.ts`.
- Reconcile, `loadIndex` from snapshot, rebuild-from-scratch equality, corrupt snapshot fallback: `packages/core/src/search/index-sync.test.ts`.
- `VaultWatcher` debounce, subtree reconcile, periodic full scan, plus real fs.watch add/edit/rename/delete on all OSes: `packages/core/src/search/vault-watcher.test.ts`.
- `JsonlLog` daily rotation: `packages/core/src/storage/jsonl-log.test.ts`.
- `.env` files git-ignored, `.env.example` names only: `scripts/env-files.test.ts`.

- Core note schemas (six types, `derived` block), `NoteRepository`, `Job` + `JobRepository` with workspace check: `packages/core/src/entities/*.test.ts`.
- Locally only (CI pending): `EventBus` (topics, patterns, workspace views, handler isolation): `packages/core/src/events/bus.test.ts`. Triggers incl. DST gap/overlap and half-hour zones: `packages/core/src/scheduler/triggers.test.ts`. `Scheduler` (restart recovery hold/rerun, missed runs, retries, timeout, no overlap, concurrency cap, pause/resume, stop grace, corrupt and foreign records, wall clock jump): `packages/core/src/scheduler/scheduler.test.ts`. `KeyedLock`: `packages/core/src/util/keyed-lock.test.ts`.

## In progress
- M1-T03: pushed, waiting on CI. See `docs/HANDOFF.md` for the exact next step.

## Blockers
- None.

## Watching CI without gh
- `gh` is not installed. Public repo, so the REST API works unauthenticated (60 req/hr): `/repos/VinGuar/DeskOs/actions/runs?head_sha=<sha>`, `/actions/runs/<id>/jobs`, and `/check-runs/<job id>/annotations` for failure messages. Full job logs need auth. For gitleaks failures, run the gitleaks release binary locally: `gitleaks git --redact .`.

## Known issues and tech debt
- Repo lives inside OneDrive: medium. OneDrive can lock files mid-install and mid-write. Recommend moving to a non-synced path such as `C:\dev\deskos`.
- Fake claude event shapes are unverified against the real CLI: low until M2-T02.
- CI actions (`actions/checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`, `gitleaks-action@v2`) target Node 20 and GitHub warns they are being forced onto Node 24: low. Bump to current majors when convenient. `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19.
- DeskOS rewrites of hand-edited notes drop YAML comments and convert CRLF to LF: low. Fix later with the `yaml` Document API if users complain.
- `Vault.create` checks the name is free, then writes. Not race-safe across processes. Fine while the daemon is the only writer.
- `JsonlLog` assumes one writer process per log.
- Search performance at 100k notes (SPEC 10.8, p95 under 100 ms) is not measured yet: belongs to the scale suite (SPEC 10.3 item 9).
- Windows: renaming a folder while the watcher is reading a file inside fails once with EPERM. Inherent to Windows; reads are short.
- Scheduler: a handler that ignores its AbortSignal holds its slot and marker until it returns (JS cannot kill a promise): low. Handlers must honor the signal; pack authors need to know.
- Scheduler `rerun` policy has no cap: a handler that crashes the daemon every time reruns on every start: low. Add a cap if it shows up.

## Next actions (do these in order)
1. Confirm M1-T03 green in CI, flip to `[x]`.
2. M1-T04 ApprovalGate, PendingAction, Approval, audit log on `JsonlLog` with `rotateDaily: true`.

## Open questions for the owner
- Repo is public; Section 12 default was private. Keep public? (default: keep, owner created it)
- Move the repo out of OneDrive? (default: stay put)
- Section 12 decisions: all defaults adopted, see DECISIONS.md. Change any?

## Session log (newest first)
### 2026-11-24 session 3
- Did: M1-T03. Event bus (`events/`), triggers with DST handling (`scheduler/triggers.ts`), persistent `Scheduler` with run markers, interrupt policy, misfire policy, retries, timeout, concurrency cap, pause/stop. Pulled `KeyedLock` out of `JobRepository`. Found and fixed a race where pause during the marker write handed the handler an already aborted signal.
- Verified by: `pnpm check` (358 tests) and `pnpm audit --audit-level high` on Windows; scheduler suite run 10 times without a flake. CI pending.
- Left off at: waiting on CI for M1-T03.
- Decisions: DECISIONS.md "Event bus and scheduler (M1-T03)", including the 2026-11-24 refinements. No new dependencies.

### 2026-11-05 session 2
- Did: first push to GitHub (merged its initial LICENSE/README commit). First CI run failed on gitleaks (fake key false positive) and macOS (`/private/var` temp path); fixed, second run green on all jobs. M0 marked complete. M1-T01 part 1. `packages/core/src/storage/` (atomic write, JsonStore, JsonlLog) and `packages/core/src/vault/` (frontmatter, naming, schema registry, Vault). Added `zod` and `yaml` to core, testkit as core devDependency.
- Then M1-T01 part 2: NoteIndex (MiniSearch), snapshot, reconcile, VaultWatcher (fs.watch recursive), JsonlLog daily rotation. `.env.example` and env ignore test.
- Then M1-T02: core note schemas, NoteRepository, JobRepository. First CI run failed on macOS (FSEvents startup race in the watcher test); fixed with `rescanOnStart`. Added `docs/HANDOFF.md`.
- Verified by: CI runs 42082959833 (M0), 42084790274 (M1-T01), 42087947882 (M1-T02), green on ubuntu, macOS, Windows, gitleaks, audit.
- Left off at: starting M1-T03.
- Decisions: vault file format and path rules, operational storage, core-testkit cycle, first push and CI fixes, MiniSearch, fs.watch, env files. See DECISIONS.md 2026-11-05 entries.

### 2026-10-07 session 1
- Did: M0-T01 through M0-T06. Monorepo scaffold, docs, CI workflow, testkit, boundary check, em dash check, secret scanner + pre-commit hook + gitleaks job, fixture hygiene test.
- Verified by: `pnpm check` and `pnpm audit --audit-level high` on Windows.
- Decisions: Node 22 floor, Biome, TS 7 source-only packages, stricter boundary check, two-layer secret scan, audit policy.
