# Progress (last updated: 2026-11-05 by Claude Code session 2)

## Status
- Current milestone: M0 Scaffold (code complete, CI never run) and M1 started locally.
- Overall: M0 exit is not met: CI has never run because the repo has no GitHub remote. M1-T01 part 1 (vault file layer + operational stores) is code complete and green locally on Windows.
- CI: not run. Workflow at `.github/workflows/ci.yml` (matrix ubuntu/macos/windows + gitleaks + audit).
- Test summary: vitest 196/196 passing locally (Windows 11, Node 24.15). Lint, typecheck, boundary, em dash, secret scan clean. Coverage not measured yet (floors start in M1).

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

## In progress
- M0-T03, M0-T06 (gitleaks job): written, unverified. Need a GitHub remote, a push, and a green run on all three OSes.
- M1-T01 part 2, not started: in-memory index, snapshot, watcher, rebuild-from-scratch tests, date-based log rotation.

## Blockers
- No GitHub remote, and `gh` is not installed on the owner machine. Creating a repo and pushing is outward-facing, so the builder did not do it unasked. Needed: owner creates a private GitHub repo, then `git remote add origin <url>` and `git push -u origin main`, then watch the first CI run.

## Known issues and tech debt
- Repo lives inside OneDrive: medium. OneDrive can lock files mid-install and mid-write. Recommend moving to a non-synced path such as `C:\dev\deskos`.
- Fake claude event shapes are unverified against the real CLI: low until M2-T02.
- macOS and Linux have never run the suite. Likely trouble spots: pre-commit hook test, hanging-process kill test, the junction symlink test in `vault.test.ts` (uses `symlinkSync(..., "junction")`, type is ignored off Windows, should be fine).
- DeskOS rewrites of hand-edited notes drop YAML comments and convert CRLF to LF: low. Fix later with the `yaml` Document API if users complain.
- `Vault.create` checks the name is free, then writes. Not race-safe across processes. Fine while the daemon is the only writer.
- `JsonlLog` assumes one writer process per log.

## Next actions (do these in order)
1. Get a remote (owner). Push, watch Actions, fix mac/Linux failures. When all three OS jobs plus gitleaks and audit are green, flip M0 tasks to `[x]`.
2. M1-T01 part 2, the index, in `packages/core/src/vault/` (or `src/index/`): pick MiniSearch or FlexSearch (log why), build from `Vault.walk()` + `Vault.read()`, keyed by entity id, plain notes indexed by path. Persist snapshot to `.deskos/index.snapshot` via `writeFileAtomic`, versioned so a format change forces rebuild. Rebuild-from-scratch test: delete snapshot, rebuild, same results. Invalid notes are tracked, not indexed.
3. Watcher: decide `node:fs.watch` recursive vs chokidar (recursive on Linux needs Node 20+, verify on CI). Debounce through `Clock`. Ignore dot paths and `.tmp`. Test with real files: add, change, rename, delete, folder delete.
4. Date-based rotation for `JsonlLog` (SPEC 4.7 says size/date). Then mark M1-T01 `[~] local` complete.

## Open questions for the owner
- Create the GitHub repo and push? (default: wait. CI cannot run until this happens)
- Move the repo out of OneDrive? (default: stay put)
- Section 12 decisions: all defaults adopted, see DECISIONS.md. Change any?

## Session log (newest first)
### 2026-11-05 session 2
- Did: M1-T01 part 1. `packages/core/src/storage/` (atomic write, JsonStore, JsonlLog) and `packages/core/src/vault/` (frontmatter, naming, schema registry, Vault). Added `zod` and `yaml` to core, testkit as core devDependency.
- Verified by: `pnpm check` on Windows (196 tests).
- Left off at: index/snapshot/watcher not started. M0 still waiting on a remote.
- Decisions: vault file format and path rules, operational storage, core-testkit cycle. See DECISIONS.md 2026-11-05 entries.

### 2026-10-07 session 1
- Did: M0-T01 through M0-T06. Monorepo scaffold, docs, CI workflow, testkit, boundary check, em dash check, secret scanner + pre-commit hook + gitleaks job, fixture hygiene test.
- Verified by: `pnpm check` and `pnpm audit --audit-level high` on Windows.
- Decisions: Node 22 floor, Biome, TS 7 source-only packages, stricter boundary check, two-layer secret scan, audit policy.
