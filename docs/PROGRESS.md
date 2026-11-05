# Progress (last updated: 2026-11-05 by Claude Code session 2)

## Status
- Current milestone: M1 Core engine. M0 is complete.
- Overall: M0 exit met: CI green on ubuntu, macOS, Windows plus gitleaks and audit (run 42082959833 on 8df2f94). M1-T01 part 1 (vault file layer + operational stores) is green in CI too.
- CI: `.github/workflows/ci.yml` on `https://github.com/VinGuar/DeskOs` (public). Runs on push to main and on PRs.
- Test summary: vitest 196/196 on all three OSes. Lint, typecheck, boundary, em dash, secret scan, gitleaks, audit clean. Coverage not measured yet (floors start in M1).

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
- M1-T01 part 2, not started: in-memory index, snapshot, watcher, rebuild-from-scratch tests, date-based log rotation.

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

## Next actions (do these in order)
1. M1-T01 part 2, the index, in `packages/core/src/vault/` (or `src/index/`): pick MiniSearch or FlexSearch (log why), build from `Vault.walk()` + `Vault.read()`, keyed by entity id, plain notes indexed by path. Persist snapshot to `.deskos/index.snapshot` via `writeFileAtomic`, versioned so a format change forces rebuild. Rebuild-from-scratch test: delete snapshot, rebuild, same results. Invalid notes are tracked, not indexed.
2. Watcher: decide `node:fs.watch` recursive vs chokidar (recursive on Linux needs Node 20+, verify on CI). Debounce through `Clock`. Ignore dot paths and `.tmp`. Test with real files: add, change, rename, delete, folder delete.
3. Date-based rotation for `JsonlLog` (SPEC 4.7 says size/date). Then M1-T01 is done once CI is green.

## Open questions for the owner
- Repo is public; Section 12 default was private. Keep public? (default: keep, owner created it)
- Move the repo out of OneDrive? (default: stay put)
- Section 12 decisions: all defaults adopted, see DECISIONS.md. Change any?

## Session log (newest first)
### 2026-11-05 session 2
- Did: first push to GitHub (merged its initial LICENSE/README commit). First CI run failed on gitleaks (fake key false positive) and macOS (`/private/var` temp path); fixed, second run green on all jobs. M0 marked complete. M1-T01 part 1. `packages/core/src/storage/` (atomic write, JsonStore, JsonlLog) and `packages/core/src/vault/` (frontmatter, naming, schema registry, Vault). Added `zod` and `yaml` to core, testkit as core devDependency.
- Verified by: `pnpm check` on Windows; CI run 42082959833 green on ubuntu, macOS, Windows, gitleaks, audit.
- Left off at: index/snapshot/watcher not started.
- Decisions: vault file format and path rules, operational storage, core-testkit cycle. See DECISIONS.md 2026-11-05 entries.

### 2026-10-07 session 1
- Did: M0-T01 through M0-T06. Monorepo scaffold, docs, CI workflow, testkit, boundary check, em dash check, secret scanner + pre-commit hook + gitleaks job, fixture hygiene test.
- Verified by: `pnpm check` and `pnpm audit --audit-level high` on Windows.
- Decisions: Node 22 floor, Biome, TS 7 source-only packages, stricter boundary check, two-layer secret scan, audit policy.
