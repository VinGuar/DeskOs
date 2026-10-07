# Tasks
Legend: [ ] todo, [~] in progress, [x] done (tests green), [!] blocked

A task is `[x]` only when its tests are green in CI on all three OSes (SPEC 10.9).
`[~] local` means code complete and green locally, waiting for the first CI run.

## M0: Scaffold and handoff system
- [~] M0-T01 Init pnpm monorepo, TS strict, lint, format, editorconfig, `.gitignore`. (local: Windows green)
- [~] M0-T02 Create `CLAUDE.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, `docs/RUNBOOK.md`. (local)
- [!] M0-T03 GitHub Actions matrix (ubuntu, macos, windows): install, lint, typecheck, unit tests. (workflow written; blocked on a GitHub remote to run it)
- [~] M0-T04 `testkit` skeleton: fake `claude` binary (scriptable), fixture loader, fake clock. (local: Windows green)
- [~] M0-T05 Boundary test: banned-terms check for `packages/core` and `packages/ui-core`. (local: Windows green)
- [~] M0-T06 Secret scanning in CI (gitleaks) and a pre-commit hook. (local scanner + hook green; gitleaks job unrun)
Exit: CI green on 3 OSes. A fresh AI session can resume using only the repo docs.

## M1: Core engine and generalization foundations
- [ ] M1-T01 Vault engine: frontmatter schemas per entity type (zod), atomic file read/write, file watcher, in-memory index builder plus snapshot persistence, rebuild-from-scratch tests, operational JSON/JSONL storage with atomic writes.
- [ ] M1-T02 Core entity schemas (zod) and repositories for all entities in 3.2.
- [ ] M1-T03 Event bus and job scheduler (persistent, restart-safe).
- [ ] M1-T04 ApprovalGate, PendingAction, Approval, and append-only audit log.
- [ ] M1-T05 Pack host: load, enable/disable per workspace, register features/panels/jobs/providers; unload cleanly.
- [ ] M1-T06 Connector interface, fake connector, secrets store on OS keychain (with test double).
- [ ] M1-T07 Daemon HTTP + WebSocket, bound to 127.0.0.1, random per-install token, origin checks.
- [ ] M1-T08 Web UI shell, panel framework, workspace switcher, command palette skeleton, theme.
- [ ] M1-T09 OsAdapter interface and `os-fake`.
- [ ] M1-T10 Isolation tests: two workspaces never leak data through repos, search, jobs, prompts, or panels. Test a workspace with zero company connectors.
- [ ] M1-T11 A tiny throwaway `pack-hello` (non-SWE vocabulary) used only in tests to prove the pack API.
Exit: UI shows an empty dashboard with working workspace switching, approvals inbox, and audit log. All isolation and boundary tests pass.

## M2: Agent queue (F1) and `pack-swe` foundation
- [ ] M2-T01 `pack-swe` skeleton, vocabulary, git sandbox provider (worktrees), Windows path tests.
- [ ] M2-T02 `AgentRunner` for Claude Code headless, with verified CLI flags recorded in DECISIONS.md. Fake claude binary integration tests.
- [ ] M2-T03 Job state machine, budgets and limits, orphan detection and resume.
- [ ] M2-T04 Queue UI and review screen (diff view, event log, test results, approve/reject/request changes).
- [ ] M2-T05 Post-run test execution in sandbox with configurable command, captured results.
- [ ] M2-T06 Approve path: open PR or merge behind the approval gate.
Exit: all F1 AC met. Demo: 3 parallel agent jobs on a sample repo, reviewed and approved from the UI.

## M3: Modes (F2), OS adapters, hotkeys
- [ ] M3-T01 Layout resolver (pure), monitor degradation, property tests.
- [ ] M3-T02 `os-mac` adapter.
- [ ] M3-T03 `os-windows` adapter.
- [ ] M3-T04 `os-linux` best-effort adapter.
- [ ] M3-T05 Adapter contract test suite run against every adapter.
- [ ] M3-T06 Modes UI: create, edit, save current layout, hotkey binding.
- [ ] M3-T07 Manual test checklist for real machines in `docs/TESTING.md`.
Exit: F2 AC met. Mode switching works on a real mac and a real Windows machine (owner verifies).

## M4: Connectors (read-only first, then drafts)
- [ ] M4-T01 GitHub connector.
- [ ] M4-T02 Google connector (Calendar, Gmail, Drive/Docs read).
- [ ] M4-T03 Slack connector.
- [ ] M4-T04 Microsoft Graph connector (Outlook mail and calendar read).
- [ ] M4-T05 MCP bridge connector.
- [ ] M4-T06 Draft support per connector. Send/act implemented but disabled by default and gated.
- [ ] M4-T07 Sync engine: cursors, pagination, backoff, rate limits, token refresh, revocation, health panel.
- [ ] M4-T08 Contract tests with recorded, scrubbed fixtures for every connector, plus failure modes.
Exit: connectors sync into a workspace, health visible, no writes possible without approval.

## M5: Context restore (F3), triage (F4), meeting to agents (F5)
- [ ] M5-T01 Context providers in `pack-swe` and generic providers in core.
- [ ] M5-T02 Snapshot engine and brief UI, AI-off fallback, citation checker.
- [ ] M5-T03 Triage ingestion, normalization, dedupe.
- [ ] M5-T04 Deterministic ranking and reasons, feedback weights, AI ask-extraction and draft replies.
- [ ] M5-T05 Triage UI with keyboard-first flow.
- [ ] M5-T06 Meeting to agents: extraction, review list, WorkItem and Job creation.
- [ ] M5-T07 Eval harness with fixtures for F3, F4, F5.
Exit: F3, F4, F5 AC met. v1 usable product. Owner dogfoods for a week.

## M6: Pre-review (F6), prep (F8), dashboard (F11), incident (F7)
- [ ] M6-T01 PR pre-review.
- [ ] M6-T02 Meeting prep with scheduler.
- [ ] M6-T03 Dashboard panels and glance mode.
- [ ] M6-T04 Incident mode and read-only investigation agent.
Exit: F6, F7, F8, F11 AC met.

## M7: Wins log (F9), capture and recall (F10), standup (F12), polish
- [ ] M7-T01 Wins log and export.
- [ ] M7-T02 Capture hotkey and search, index maintenance and rebuild.
- [ ] M7-T03 Auto standup.
- [ ] M7-T04 First-run onboarding, empty/error states, accessibility pass, performance pass.
- [ ] M7-T05 Packaging for mac and Windows, auto-start option, `docs/RUNBOOK.md` complete.
Exit: F9, F10, F12 AC met. Startup and idle budgets met.

## M8: Generalization proof
- [ ] M8-T01 `pack-general`. Zero changes to `packages/core` allowed.
- [ ] M8-T02 `pack-builder` per SPEC 3.5.
- [ ] M8-T03 Side-project workspace e2e test, no company connectors.
- [ ] M8-T04 `docs/PACK_AUTHORING.md`.
- [ ] M8-T05 Role-adaptation review doc.
Exit: pack-general works end to end with zero core edits. Two workspaces of different types run side by side with verified isolation.
