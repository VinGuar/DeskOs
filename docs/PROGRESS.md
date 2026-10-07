# Progress (last updated: 2026-10-07 by Claude Code session 1)

## Status
- Current milestone: M0 Scaffold and handoff system
- Overall: M0 code is complete and green locally on Windows. M0 exit is not met: CI has never run because the repo has no GitHub remote yet.
- CI: not run. Workflow at `.github/workflows/ci.yml` (matrix ubuntu/macos/windows + gitleaks + audit).
- Test summary: vitest 106/106 passing locally (Windows 11, Node 24.15). Lint, typecheck, boundary, em dash, secret scan, audit all clean. Coverage not measured yet (floors start in M1).

## What works (verified)
- pnpm monorepo with `packages/core`, `packages/ui-core`, `packages/testkit`: `pnpm install`, `pnpm typecheck` (TS 7 strict, `noUncheckedIndexedAccess`), `pnpm lint` (Biome).
- Fake claude binary with 8 presets, each spawned as a real process: `packages/testkit/src/fake-claude/fake-claude.test.ts`.
- FakeClock, fixture loader (CRLF normalization, path escape refusal): their `*.test.ts` files.
- Boundary check catches terms, camelCase/snake identifiers, inflections, and file names in a throwaway repo, and the real repo is clean: `scripts/boundary.test.ts`.
- Pre-commit hook blocks a real `git commit` of a fake token in a throwaway repo and allows a clean one: `scripts/scan-secrets.test.ts`.
- No em dashes in the repo; fixtures name no real hosts: `scripts/no-em-dash.test.ts`, `scripts/fixture-hygiene.test.ts`.

## In progress
- M0-T03: workflow written, unverified. Needs a GitHub remote, then a push, then a green run on all three OSes.
- M0-T06: gitleaks job written, unverified (needs the same first CI run).

## Blockers
- No GitHub remote: tried nothing, this needs the owner. Creating a repo and pushing is outward-facing, so the builder did not do it unasked. Needed: owner creates a private GitHub repo (or approves `gh repo create deskos --private --source . --push`), then watch the first CI run.

## Known issues and tech debt
- Repo lives inside OneDrive (`C:\Users\bosto\OneDrive\Desktop\DeskOs`): medium. OneDrive will sync `node_modules` and can lock files mid-install. Recommend moving to a non-synced path such as `C:\dev\deskos`. Git remote is the backup, not OneDrive.
- Fake claude event shapes are unverified against the real CLI: low until M2-T02, which must verify them.
- macOS and Linux have never run the suite: unknown until the first CI run. Most likely trouble spots: the pre-commit hook test (runs `sh` via git) and the hanging-process kill test.

## Next actions (do these in order)
1. Get a remote: owner creates a private GitHub repo, `git remote add origin <url>`, `git push -u origin main`. Watch Actions. Fix any mac/Linux failures. When all three OS jobs plus gitleaks and audit are green, flip M0-T01..T06 to `[x]` in `docs/TASKS.md` and mark M0 complete here.
2. Start M1-T01 (vault engine) in `packages/core/src/vault/`: zod frontmatter schemas per entity type with passthrough for unknown fields, atomic write (temp file + rename) with Windows retry on EPERM/EBUSY, YAML frontmatter parse/serialize (pick a YAML lib, justify in DECISIONS.md), file naming `<type>-<slug>-<short-id>.md`. Tests first: round trip preserves unknown fields, CRLF input, unicode and spaces in paths, crash mid-write leaves old file intact.
3. Then the M1-T01 index: pick MiniSearch or FlexSearch (log why), build from vault scan, persist snapshot to `.deskos/index.snapshot`, rebuild-from-scratch test, file watcher (decide `node:fs.watch` recursive vs chokidar; recursive watch on Linux needs Node 20+, verify on CI).

## Open questions for the owner
- Create the GitHub repo and push? (default: wait. CI cannot run until this happens)
- Move the repo out of OneDrive? (default: stay put, but expect install slowness)
- Section 12 decisions: all defaults adopted, see DECISIONS.md. Change any?

## Session log (newest first)
### 2026-10-07 session 1
- Did: M0-T01 through M0-T06. Monorepo scaffold, docs, CI workflow, testkit (fake claude, fake clock, fixtures, spawnCapture, temp dirs), boundary check, em dash check, secret scanner + pre-commit hook + gitleaks job, fixture hygiene test.
- Verified by: `pnpm check` (lint, typecheck, boundary, em dash, secrets, 106 tests) and `pnpm audit --audit-level high`, all on Windows locally.
- Left off at: M0 waiting on a GitHub remote for CI. No M1 work started.
- Decisions: Node 22 floor, Biome, TS 7 source-only packages, stricter boundary check, two-layer secret scan, audit policy. See DECISIONS.md 2026-10-07 entries.
