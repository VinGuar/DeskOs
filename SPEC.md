# DeskOS: Product and Engineering Spec

Working name: **DeskOS** (placeholder, rename freely, log it in `docs/DECISIONS.md`).
Spec version: 1.0
Audience: Claude Opus / Claude Code acting as the primary builder, plus the human owner.

---

## 0. READ THIS FIRST (instructions for the AI builder)

You are building DeskOS from scratch. This spec is the source of truth. Follow these rules for the entire project:

1. **Read order at the start of EVERY session:** `CLAUDE.md` -> `docs/PROGRESS.md` -> `docs/TASKS.md` -> `docs/DECISIONS.md` -> the relevant section of this spec. Do not start coding before you have done this. If these files do not exist yet, you are in Milestone 0: create them from the templates in Section 11.
2. **Work in small verified increments.** One task ID at a time. A task is done only when its acceptance criteria are met AND its tests pass. Never mark a task done on the strength of "it should work".
3. **Tests are not optional.** Every feature ships with the tests listed in Section 10. If you cannot test something, write down why in `docs/DECISIONS.md` and add the closest substitute test.
4. **Keep the handoff doc current.** Update `docs/PROGRESS.md` at the end of every session, after every completed task, and BEFORE any risky or long operation. Another AI (or you, after a context reset) must be able to pick up cold from that file alone. Section 11 defines the exact protocol.
5. **Do not silently change scope.** If the spec is wrong, ambiguous, or impossible, log it in `docs/DECISIONS.md` under "Spec deviations", pick the simplest safe option, and continue. Ask the owner only for things listed in Section 12 or true blockers.
6. **Boring tech, small surface area.** Prefer well-known libraries. Fewer dependencies is better. Every dependency needs a one-line justification in `docs/DECISIONS.md`.
7. **Safety rules in Section 9 are hard constraints**, not suggestions. Never weaken them to make a test or feature pass.
8. **Style of communication:** terse, direct, no fluff, in code comments, docs, commit messages, and UI copy. No em dashes anywhere in the repo.

---

## 1. Context: what this is and why

### 1.1 The owner
A solo developer (CS and Statistics background, about to graduate) who uses **both macOS and Windows**, sometimes on a single laptop screen and sometimes on a 2 to 4 monitor desktop setup. He builds side projects, will likely work as a software engineer, and wants tooling that removes friction from everyday engineering work. He values simple, clean, fast tools and hates busywork.

### 1.2 The product in one paragraph
DeskOS is an app that runs on your desktop and sits across all your tools: code, terminal, Slack, Outlook, calendar, docs, Google, GitHub, and Claude Code. It watches what is going on, keeps the context of every task, runs AI agents in the background on your behalf, and puts everything that needs a human decision in one clean place. The goal: automate the annoying glue work between apps so the user's job becomes reviewing and deciding, not copying, switching, and remembering. Think a practical, less complex "Jarvis": it does not try to be a general chatbot, it removes specific, real friction.

### 1.3 The core insight
Every individual app already does its own job well. Nothing handles the work **between** apps: "where did I leave off", "what is blocking someone else on me", "turn that meeting into tasks", "what happened around this incident". DeskOS owns that gap.

### 1.4 First user and long-term direction
- **First user and first pack:** a software engineer. All v1 acceptance is judged against SWE workflows.
- **Designed to grow beyond SWE:** other roles (PM, designer, founder, student, researcher, writer, sales, ops) and **non-employer work** such as side projects, freelancing, and personal projects. See Section 3. This is a first-class design requirement, not a future nice-to-have. The architecture must make adding a new role a matter of writing a new pack, not rewriting the core.

### 1.5 Non-goals (v1)
- Not a general chat assistant or a replacement for the Claude app.
- Not a cloud service. No accounts, no multi-user, no hosted backend.
- Not a full window manager. It uses OS adapters and existing tools.
- No auto-sending messages or emails, no auto-merging code without explicit approval (Section 9).
- No mobile app.
- No syncing state between machines in v1 (config only follows via a git repo).

---

## 2. Design principles

1. **Human decides, AI prepares.** Default is read-only and draft-only. Anything with external side effects needs explicit approval.
2. **Local-first.** Data stays on the machine. Secrets in the OS keychain. Only calls out to the APIs the user connected and to the model provider.
3. **One screen of truth, zero screens required.** A clean dashboard the user can leave fullscreen on a spare monitor if they have one, or summon as an overlay on a single laptop screen if they don't. Same panels either way: what is running, what is waiting on me, what is on fire. Monitor count is a display preference, never a requirement.
4. **Keyboard-first.** Global hotkey, command palette, everything reachable without a mouse.
5. **Quiet by default.** Notifications only for things that need a human. No badge spam. Fewer, better signals.
6. **Cross-platform from day one.** macOS, Windows, and Linux for the core. Platform-specific code lives only in adapters.
7. **Role-agnostic core, role-specific packs.** The core never knows what a "PR" or "branch" is.
8. **Everything is inspectable.** Audit log for every action an agent takes. Every AI output links back to its sources.
9. **Resumable.** Agents, jobs, and the build process itself (this project) must survive restarts and context loss.

---

## 3. Generalization architecture (critical)

The product must be able to evolve from "SWE tool" to "helps anyone who works on a computer", including people with no employer. This is achieved with four concepts. Build them in Milestone 1 even though only one pack ships first.

### 3.1 Core vs Pack
- **Core** (`packages/core`): generic engine. Knows about workspaces, connectors, work items, threads, artifacts, people, events, context snapshots, jobs, agents, modes, panels, the approval system, the audit log, search, and the UI shell. It contains **zero** SWE vocabulary.
- **Pack** (`packages/pack-*`): a bundle of role-specific behavior that plugs into the core. It contributes: feature modules, context providers, triage signals, mode templates, dashboard panels, sandbox providers, vocabulary, and default prompts.

**Enforced boundary (testable):** a CI test greps `packages/core/**` and `packages/ui-core/**` for banned terms (`git`, `branch`, `commit`, `pull request`, `worktree`, `merge`, `CI`, `deploy`, `repo`) outside of comments explaining the rule, and fails the build if found. Pack-specific words live only in packs. This includes connector kinds: `ConnectorKind` is an open registry, core registers only generic kinds (chat, email, calendar, docs, storage) and packs register domain kinds like the version-control and build-system ones. The check is word-boundary based and case-insensitive except for the short term `CI`.

### 3.2 Generic entity model (core)
All features operate on these role-neutral entities. Packs map their domain onto them.

| Core entity | Meaning | SWE pack maps to | Other roles could map to |
|---|---|---|---|
| `WorkItem` | a unit of work with status, owner, due, links | ticket, PR, bug, task | deliverable, campaign task, assignment, article |
| `Thread` | a conversation from any source | Slack thread, email, PR review thread | client email, comment thread |
| `Artifact` | a thing that gets produced or edited | branch, diff, file, build | document, design file, deck, dataset |
| `Person` | someone involved | teammate, reviewer | client, stakeholder, collaborator |
| `Event` | something on a timeline | meeting, deploy, CI run, incident | meeting, deadline, launch |
| `ContextSnapshot` | saved "where I left off" for a WorkItem | branch state, terminal, agent output | open docs, last draft, last thread |
| `Job` | background unit of automated work | agent coding run | agent research or drafting run |
| `Sandbox` | isolated place a Job works | git worktree | scratch folder, doc copy |

### 3.3 Workspaces (employer vs side project vs personal)
A **Workspace** is a top-level vault folder (Section 4.6) and a fully isolated context. The user can have many.

- Types: `employer`, `side-project`, `freelance`, `personal`, `school`. Type only sets defaults, it does not gate features.
- Each workspace has its own: vault folder, connectors and credentials, enabled packs, modes, audit log, brag/wins log, and agent permissions.
- **Path-scoped by default.** A job's or feature's default read/write scope is its own workspace folder, full stop. Reaching outside that folder, into another workspace or anywhere else on disk, requires the path be explicitly declared up front and approved once through the same ApprovalGate as any other `act` (Section 9.2). Nothing gets broader access implicitly, and nothing needs a separate isolation mechanism beyond "what path was this approved for."
- **No implicit cross-workspace data flow follows from that same rule:** content from an employer workspace is never handed to an agent, prompt, or search running in another workspace unless that access was explicitly requested and approved. A cross-workspace dashboard view is allowed but shows only titles, counts, and statuses, and only if the user opted in per workspace.
- **Nested folders inside one workspace are organization, not a security boundary.** A `Work/ClientA/` folder next to `Work/ClientB/` inside the same workspace is browsable by anything scoped to `Work/`. If two things need to never see each other (e.g. genuinely confidential client data), they belong in separate top-level workspaces, not subfolders of one. This is a design fact to know going in, not something the tool tries to paper over.
- A workspace with **no company connectors at all** must be fully functional. A solo side-project workspace needs only local folders, GitHub, and optionally Google. This is a hard requirement and has a dedicated test.
- Switching workspace is one hotkey and instantly re-lays out the monitors (modes) for that workspace.

### 3.4 Packs (what ships and what is planned)
| Pack | Milestone | Purpose |
|---|---|---|
| `pack-swe` | M2 to M7 | Full engineering workflow (the v1 product) |
| `pack-builder` | M8 | Solo builder / side-project support (see 3.5) |
| `pack-general` | M8 | Minimal role-neutral pack: calendar, email, docs only. Proves the core is not SWE-bound |
| future | post-v1 | PM, designer, founder, student/researcher, writer, sales, ops |

Pack interface (sketch, refine during M1 and log the final version in `docs/DECISIONS.md`):

```ts
export interface Pack {
  id: string;                       // "swe"
  version: string;
  requires: ConnectorKind[];        // kinds the pack needs; pack registers any domain-specific kinds itself
  optional: ConnectorKind[];
  vocabulary: Vocabulary;           // labels: workItem -> "Ticket", artifact -> "Branch"
  features: FeatureModule[];
  contextProviders: ContextProvider[];
  triageSignals: TriageSignal[];
  sandboxProviders: SandboxProvider[];
  modeTemplates: ModeTemplate[];
  panels: PanelDefinition[];
  defaultPrompts: PromptSet;
}

export interface FeatureModule {
  id: string;
  needs: { connector: ConnectorKind; capability: Capability }[]; // "read" | "draft" | "act"
  register(host: HostContext): void; // registers jobs, panels, commands, hotkeys
}
```

A pack can be enabled per workspace. Disabling a pack removes its panels and jobs cleanly with no orphaned data errors (tested).

### 3.5 Builder pack (side projects and non-company work) requirements
Needed by M8, but core decisions in M1 to M7 must not block it.

- **Project registry:** list of side projects with repo path, live URL, hosting, status (idea, building, launched, paused).
- **Project health panel:** last commit age, open issues, failing CI, deploy status, uptime ping. Flags stale projects.
- **Idea inbox:** hotkey capture of ideas, AI groups and dedupes them, weekly "promote or drop" review.
- **Ship log / wins log:** same engine as the brag doc, framed for solo builders (what shipped, what launched).
- **Time and focus allocation:** where hours actually went across projects this week, based on commits, sessions, and calendar blocks (no invasive tracking, local only).
- **Launch checklist:** reusable checklist per project (domain, analytics, legal pages, store listing, announcement). Editable templates.
- **Build-in-public drafts (draft-only):** turns commits and shipped work into draft posts. Never auto-posts.
- **Cost tracker:** manual or read-only tracking of API, hosting, and tool spend per project.
- **Next best action:** given projects, energy, and deadlines, suggest what to work on now, with the reasoning shown.

### 3.6 pack-general (proof of generality)
Minimal pack for a non-engineer: triage across email and chat, meeting prep, meeting to tasks, wins log, context restore for documents. It exists mainly as a **test of the abstraction**: if this pack needs any change to `packages/core`, the core has leaked SWE assumptions and must be fixed.

### 3.7 Which features are core vs pack
| Feature | Lives in | Notes |
|---|---|---|
| Agent queue and runner | core | Sandbox provided by pack (SWE: git worktree, general: scratch dir) |
| Modes (window/app layouts) | core + OS adapters | Templates per pack |
| Context restore | core | Providers contributed by packs |
| Cross-app triage | core | Signals contributed by packs (SWE adds review requests, CI failures) |
| Meeting to agents | core | SWE pack maps items to repos |
| Meeting prep | core | |
| Wins/brag log | core | SWE and builder packs supply sources |
| Auto standup / status summary | core | Sources from packs |
| Capture and recall (search) | core | |
| PR pre-review | pack-swe | |
| Incident mode | pack-swe | |
| Ops feed (CI, deploys, logs) | pack-swe | Uses core panel framework |
| Project registry, idea inbox, cost tracker, etc. | pack-builder | |

---
## 4. Architecture

### 4.1 High-level
```
+-------------------------------------------------------------+
|  UI (React + Vite, served on localhost, fullscreen-able)     |
|  Dashboard | Queue | Triage | Context | Palette | Settings    |
+------------------------------+------------------------------+
                               | HTTP + WebSocket (localhost only, token auth)
+------------------------------v------------------------------+
|  Daemon (Node + TypeScript)                                  |
|  Event bus | Job scheduler | Agent runner | Approval gate     |
|  Audit log | Search index | Workspace manager | Pack host     |
+---------+----------------+----------------+-----------------+
          |                |                |
   Connectors         OS Adapters       Storage
   (Slack, MS Graph,  (mac, windows,    (vault: plain files on disk,
   Google, GitHub,    linux: windows,   OS keychain for
   MCP servers)       hotkeys, notify)  secrets)
```

### 4.2 Tech choices (defaults, deviate only with a logged reason)
- Language: **TypeScript** everywhere, strict mode. Node 20+ LTS.
- Monorepo: **pnpm workspaces**.
- Daemon HTTP: Fastify or Hono. WebSocket for live updates.
- Validation: **zod** at every boundary (HTTP, connector responses, config, agent output).
- Storage: **no database.** Human-facing data lives as plain files in a per-workspace vault (Section 4.6); operational plumbing (job state, audit log) is also plain files (Section 4.7). This is a deliberate choice, not a placeholder: it avoids a compiled native dependency (`better-sqlite3` needs a prebuilt binary per OS/arch, which is exactly the kind of cross-platform pain a mac+Windows tool should avoid), it means the data is inspectable and editable with any text editor or real Obsidian, and it means there is nothing to migrate, since the files are the schema. A single **in-memory index**, rebuilt by scanning the vault and persisted to one snapshot file for fast cold starts, provides search and queries (`FlexSearch` or `MiniSearch`, both pure JS, no native build). Revisit only if profiling on real data shows the scan-and-index approach is too slow (Section 10.8 has the budget it needs to hit).
- UI: React + Vite + a small CSS approach (CSS modules or Tailwind). No heavy component framework needed. Clean, dense, no gradients or gimmicks.
- Desktop shell: **v1 is daemon + browser tab or PWA.** Optional later: Tauri wrapper for tray icon and global hotkey. Global hotkeys in v1 are handled by the OS adapter layer or a tiny native helper, isolated behind an interface.
- Secrets: OS keychain via a cross-platform library (macOS Keychain, Windows Credential Manager, libsecret on Linux). Fallback: encrypted file with a key from the keychain. Never plaintext tokens on disk.
- Agent execution: spawn **Claude Code in headless/non-interactive mode** as a child process, with structured output parsing. Wrap it behind an `AgentRunner` interface so other agents or models can be swapped in. Verify current CLI flags from the official docs at build time, do not assume them, and record what you verified in `docs/DECISIONS.md`.
- External tools: prefer **MCP** servers where they exist and are reliable (Slack, Google, GitHub, etc.), otherwise call official REST APIs directly. Both sit behind the `Connector` interface.
- Testing: **Vitest** (unit and integration), **Playwright** (UI e2e), **fast-check** (property tests), fixtures recorded and stored in repo (scrubbed of secrets and personal data).
- Lint and format: ESLint + Prettier (or Biome), strict TS, `noUncheckedIndexedAccess` on.
- CI: GitHub Actions with a matrix of `ubuntu-latest`, `macos-latest`, `windows-latest`.

### 4.3 Repository layout
```
deskos/
  CLAUDE.md                     # short standing rules for AI builders
  SPEC.md                       # this file
  docs/
    PROGRESS.md                 # living handoff doc (Section 11)
    TASKS.md                    # task checklist with IDs
    DECISIONS.md                # decisions, deviations, dependency justifications
    TESTING.md                  # how to run each test tier, known flaky tests
    RUNBOOK.md                  # how to run, debug, reset local state
  packages/
    core/                       # generic engine, NO domain vocabulary
    ui-core/                    # generic UI shell and panel framework
    connectors/                 # slack, msgraph, google, github, mcp-bridge, fake
    adapters/                   # os-mac, os-windows, os-linux, os-fake
    pack-swe/
    pack-builder/
    pack-general/
    testkit/                    # fakes, fixtures, fake claude binary, helpers
  apps/
    daemon/
    web/
  scripts/
  .github/workflows/
```

### 4.4 Cross-platform rules (hard)
- Never shell out with bash-specific syntax. Use `child_process.spawn` with argument arrays, never string commands.
- Use `path` and `os` APIs. Never hardcode separators or home paths.
- Handle CRLF vs LF. Normalize line endings on ingest.
- All OS-specific behavior sits behind `OsAdapter`. The core calls `adapter.openMode(...)`, `adapter.registerHotkey(...)`, `adapter.notify(...)`, `adapter.focusWindow(...)`, and never touches platform APIs.
- Provide `os-fake` adapter for tests and for unsupported platforms (graceful degradation: feature reports "not supported here", never crashes).
- Adapter implementations: mac (AppleScript / `open` / optional Hammerspoon integration), windows (PowerShell / Win32 via a Node binding / optional AutoHotkey integration), linux (best effort, xdg-open, wmctrl if present). Do not write a custom tiling window manager. Integrate with Rectangle (mac) and PowerToys FancyZones (windows) where available; otherwise position windows by coordinates per monitor.
- Monitor layout is described abstractly (`monitor: 1..N`, `zone: left|right|full|top|bottom`) and mapped by the adapter. Handle monitors being added or removed at runtime.

### 4.5 Core interfaces (sketch)
```ts
type Capability = "read" | "draft" | "act";

interface Connector {
  id: string;
  kind: ConnectorKind;                  // open string registry: core registers only generic kinds ("chat" | "email" | "calendar" | "docs" | "storage"), packs register domain kinds
  capabilities: Capability[];
  health(): Promise<Health>;
  // read
  fetchSince(cursor: Cursor | null): Promise<{ items: RawItem[]; next: Cursor }>;
  // draft and act are separate, act always goes through the ApprovalGate
  draft?(req: DraftRequest): Promise<Draft>;
  act?(req: ActRequest, approval: Approval): Promise<ActResult>;
}

interface AgentRunner {
  run(job: Job, sandbox: Sandbox, signal: AbortSignal): AsyncIterable<AgentEvent>;
  resume(jobId: string): AsyncIterable<AgentEvent>;
}

interface SandboxProvider {
  create(job: Job): Promise<Sandbox>;   // SWE: git worktree, general: scratch dir
  diff(s: Sandbox): Promise<ArtifactDiff>;
  destroy(s: Sandbox): Promise<void>;
}

interface OsAdapter {
  platform: "mac" | "windows" | "linux" | "fake";
  registerHotkey(combo: string, cb: () => void): Disposable;
  openMode(mode: ResolvedMode): Promise<void>;
  listMonitors(): Promise<Monitor[]>;
  notify(n: Notification): Promise<void>;
}

interface ApprovalGate {
  request(action: PendingAction): Promise<Approval | Rejection>;   // UI surfaces this
}
```

### 4.6 The vault (per-workspace storage, human-facing data)

**A workspace is a folder on disk.** That folder is the workspace: an Obsidian-style vault of plain markdown files with YAML frontmatter, organized into whatever folder structure the user wants (`Projects/`, `People/`, `Meetings/`, `Wins/`, `Inbox/` are sensible defaults, all renameable). The user can open the same folder in real Obsidian and everything just works: files, folders, `[[wikilinks]]`, nothing DeskOS-proprietary about the format.

- Every entity from Section 3.2 that is naturally a "note" (WorkItem, Thread summary, ContextSnapshot, a win, a capture, meeting notes) is one markdown file. Frontmatter carries the structured fields (type, status, source, source_ref, created_at, updated_at, links); the body is normal readable text.
- Cross-references use `[[wikilinks]]` (a WorkItem note links to the people and threads involved) instead of foreign keys. This is also just more useful to the user than a database row: they can read it.
- File naming: `<type>-<slug>-<short-id>.md` (e.g. `task-fix-auth-timeout-a1b2.md`), short id keeps files unique without forcing ugly names.
- A minimal frontmatter schema per type is fixed and validated with zod on read and write (unknown extra fields are preserved, not dropped, since the user may hand-edit notes). Schema changes are additive; a version field in frontmatter lets old notes stay valid, there is no migration step because there is no separate schema to migrate.
- Raw ingested content (an email body, a Slack message) is stored as **untrusted data** (Section 9.4) in its own note, clearly marked as raw/ingested in frontmatter. AI-derived fields (summaries, priorities, drafted replies) live in a separate note or a separate frontmatter block flagged as `derived: true` with the model, prompt version, and the source note ids it was built from, so a citation checker (used across F3, F4, F5, F9, F12) can verify every claim traces to a real file.
- The **index** is a rebuildable, disposable cache: a file watcher keeps it current as notes change, and the whole thing can be deleted and rebuilt from the vault at any time with no data loss. Nothing is ever stored only in the index.
- **What is NOT a vault note:** job state, sandbox paths, pending actions, approvals, and the audit log. Those are operational plumbing the user doesn't need to hand-edit, and they live separately (Section 4.7) so a user editing their notes can never corrupt an in-flight agent job.

### 4.7 Operational storage (plumbing, not notes)
- **Job state:** one JSON file per job under a per-workspace `.deskos/jobs/<id>.json`, atomically written (write to temp file, rename) so a crash mid-write never corrupts it.
- **Audit log:** append-only JSONL (`.deskos/audit.jsonl`, rotated by size/date). Append-only is the natural fit for a log; no database needed to get that property, the filesystem's append mode already gives it.
- **Pending actions / approvals:** JSON files under `.deskos/approvals/`, same atomic-write rule, deleted once resolved (moved into the audit log entry that recorded the resolution).
- **Sandboxes:** git worktrees live wherever git puts them (Section 5, F1); DeskOS tracks only the path and job id in the job's JSON file.
- **Search/index snapshot:** `.deskos/index.snapshot`, purely a cache, safe to delete.
- The `.deskos/` folder sits inside the workspace folder but is treated as internal (hidden, git-ignored by default if the vault is put under version control). It is never scanned as vault content.
- Every operational record still has `id`, `workspace_id`, `created_at`, `updated_at`, and a `source` field, same as before, just as JSON fields instead of DB columns.

### 4.7 Config
Workspace config is JSON (validated by zod), stored in a user config directory and optionally in a git repo the user controls. No secrets in config. Example:

```json
{
  "workspace": { "id": "side-1", "name": "My SaaS", "type": "side-project" },
  "packs": ["builder", "swe"],
  "connectors": [
    { "id": "gh", "kind": "vcs", "provider": "github", "capabilities": ["read", "draft"] },
    { "id": "gcal", "kind": "calendar", "provider": "google", "capabilities": ["read"] }
  ],
  "modes": [
    {
      "id": "deep-work",
      "layout": [
        { "monitor": 1, "zone": "full", "open": [{ "app": "editor", "path": "~/code/mysaas" }] },
        { "monitor": 2, "zone": "left", "open": [{ "url": "http://localhost:3000" }] },
        { "monitor": 2, "zone": "right", "open": [{ "app": "terminal", "cwd": "~/code/mysaas" }] },
        { "monitor": 3, "zone": "full", "open": [{ "deskos": "dashboard" }] }
      ],
      "hotkey": "Ctrl+Alt+1"
    }
  ]
}
```

---
## 5. Feature specs

Format per feature: **Lives in**, **Purpose**, **Behavior**, **Acceptance criteria (AC)**, **Required tests**. Every AC must map to at least one automated test. Generic tests from Section 10 apply to all features (approval gate, audit log, workspace isolation, graceful degradation).

### F1. Agent queue and runner
**Lives in:** core (runner, queue, UI), sandbox from pack (`pack-swe`: git worktree).
**Purpose:** Run several AI agents in parallel on separate tasks, each isolated, and review all results from one screen.
**Behavior:**
- User creates a Job from a WorkItem, a capture, a triage item, or manually: title, instructions, workspace, repo/target, model, budget limits.
- Runner creates a Sandbox (SWE: a new git worktree on a new branch off a chosen base), spawns the agent (Claude Code headless) with scoped instructions and working directory, streams events into the job log.
- Job states: `queued -> starting -> running -> needs_input -> review -> approved | rejected | failed | cancelled`.
- Concurrency limit configurable (default 3). Per-job limits: max wall time, max tokens or cost, max files changed. Exceeding a limit pauses the job and requests approval to continue.
- **Review screen:** diff, files changed, agent summary, tests run and results (the runner runs the project's configured test command in the sandbox after the agent finishes), cost, and the full event log. Actions: approve (merge or open PR, needs approval gate), request changes (re-prompts the same agent session with feedback), reject (destroy sandbox), open in editor.
- Jobs survive daemon restarts: state persisted, running agents detected as orphaned and marked `interrupted` with a resume option.
- Agents may never touch anything outside their sandbox (Section 9.5).
**AC:**
- AC1: Creating 3 jobs on the same repo produces 3 separate worktrees and branches with no interference.
- AC2: Killing the daemon mid-job and restarting marks the job `interrupted`, retains logs, and offers resume or discard.
- AC3: Exceeding a budget pauses the job and raises an approval request, it does not continue silently.
- AC4: Approve/merge cannot happen without an approval object created from the UI (no code path bypasses the gate).
- AC5: Destroying a sandbox removes the worktree and branch cleanly, verified on Windows path semantics too.
- AC6: Agent output is parsed against a zod schema, malformed output leads to `failed` with the raw output preserved, not a crash.
**Tests:** unit (state machine, transitions, illegal transitions rejected), integration with **fake claude binary** from `testkit` (scripted outputs including malformed, slow, hanging, crashing), real git integration tests in temp repos, restart/recovery test, concurrency test, budget-limit test, path tests on the Windows CI runner.

### F2. Modes (project layouts, single laptop screen up to multiple monitors)
**Lives in:** core + OS adapters, templates from packs.
**Purpose:** One hotkey sets up the whole desk for a project or task type, on one screen or several.
**Behavior:**
- A Mode = named layout: which apps, folders, URLs, terminals, and DeskOS panels open on which monitor and zone, plus optional environment (e.g., start dev server, activate profile).
- Hotkey or command palette activates a mode. Idempotent: running it again focuses or repositions existing windows instead of spawning duplicates where possible.
- **Single monitor is the baseline path, not a degraded one.** With one screen, "monitor N" in a layout maps to a virtual desktop / Space instead of a physical monitor where the adapter supports it (mac Spaces, Windows virtual desktops), so a mode still separates editor/terminal/browser cleanly by a quick switch instead of tiling. With more monitors, the same layout spreads across them instead.
- "Save current layout as mode" (best effort capture of open windows).
- Switching workspace switches to that workspace's default mode.
**AC:**
- AC1: Activating a mode with the fake adapter produces the exact ordered list of adapter calls expected.
- AC2: A layout runs correctly on 1 monitor (via virtual desktops/Spaces), 2, and 4 monitors from the same mode definition (snapshot-tested); 1-monitor is a required, not optional, test target.
- AC3: Unsupported action on a platform yields a visible "not supported on this OS" result, never an exception.
- AC4: Re-activation does not duplicate windows (verified on adapters that support window lookup).
**Tests:** pure-function layout resolver with property tests (any monitor count including 1, any layout), adapter contract tests run against every adapter with the same suite, manual test checklist in `docs/TESTING.md` for real mac and Windows (cannot be fully automated).

### F3. Context restore ("where I left off")
**Lives in:** core, providers from packs.
**Purpose:** Kill the cost of task switching.
**Behavior:**
- A ContextSnapshot is continuously updated per WorkItem from providers: (SWE) branch, dirty files, last commit, last terminal commands and output, last agent job state, linked PR and unresolved review comments, linked Slack/email threads, related calendar events; (general) open documents, last drafts, related threads.
- Hotkey or click on a task shows a one-screen brief: 1) last thing you were doing, 2) current state, 3) what is blocking, 4) suggested next step, with links that open the exact artifacts. The "restore" action also activates the matching mode.
- Summaries are AI-generated but always show the raw facts they were derived from and links.
- Terminal capture is opt-in, local only, with secret redaction (Section 9.6).
**AC:**
- AC1: Snapshot updates within N seconds of a change in any provider (configurable, default 30s) without blocking the UI.
- AC2: A brief is producible with zero AI available (falls back to a facts-only view).
- AC3: Every claim in the AI summary is traceable to a stored source item (test with a citation checker: summary sentences must reference source ids that exist).
- AC4: Terminal secrets (tokens, keys, passwords matching redaction rules) never appear in stored snapshots (tested with a corpus of fake secrets).
**Tests:** provider unit tests with fixtures, snapshot merge logic, citation-checker test, redaction corpus test, AI-off fallback test.

### F4. Cross-app triage
**Lives in:** core, signals from packs.
**Purpose:** One ranked inbox across Slack, Outlook, GitHub, calendar, and more, focused on "who is blocked on me".
**Behavior:**
- Ingests items from all connected sources in the workspace and normalizes them to `TriageItem` (source, thread, sender, ask, deadline, evidence).
- Classification: `blocking_someone`, `needs_reply`, `fyi`, `can_wait`, `noise`. Ranking uses deterministic signals first (direct mention, review requested, asked a question, deadline, sender priority, age) then an AI pass for the ask and suggested response.
- Each item shows a one-line ask, why it is ranked where it is, and a **drafted reply** (draft-only, never sent automatically). Send is a separate approved action and can be disabled per connector.
- Feedback loop: user can mark "wrong priority", stored locally and used to adjust weights (simple, explainable, no black-box training in v1).
- Dedupes the same topic across sources (e.g., Slack ping about a PR that is also a review request).
**AC:**
- AC1: Deterministic ranking is fully reproducible: the same input fixtures produce the same order (golden tests).
- AC2: Every item shows its ranking reasons.
- AC3: With AI disabled, triage still works using deterministic signals only.
- AC4: No message is sent without an approval object, verified by a test that attempts every send code path.
- AC5: Cross-source duplicate merged into one item with both sources linked.
- AC6: Injection-laden message content (Section 9.4) never alters ranking rules, tool calls, or drafts beyond being quoted as data.
**Tests:** golden-file tests, property tests (ranking is stable and monotonic in urgency signals), injection test corpus, dedupe tests, feedback weight adjustment tests.

### F5. Meeting to agents
**Lives in:** core, repo mapping from `pack-swe`.
**Purpose:** Turn meeting outcomes into queued, context-loaded tasks.
**Behavior:**
- Inputs: transcript or notes (pasted, file, or from connected source), calendar event metadata, attendee list.
- Extract action items with owner, due date, and confidence. Only items owned by the user (or unowned and relevant) become WorkItems.
- For each, propose a Job: title, instructions, target repo or folder, attached context (relevant threads, docs, earlier tasks). SWE pack maps to a repo using project registry and heuristics.
- User reviews in a single list: accept, edit, drop, or "queue as job". Nothing runs automatically.
**AC:**
- AC1: Extraction output validated against schema, low-confidence items flagged, hallucinated owners never assigned (owner must match an attendee).
- AC2: Accepting an item creates a WorkItem linked to the source event and optionally a queued Job.
- AC3: Works with transcript only, notes only, and event only (degraded).
**Tests:** fixture transcripts with known action items (precision/recall thresholds via eval harness, Section 10.6), schema tests, owner-matching tests.

### F6. PR pre-review
**Lives in:** `pack-swe`.
**Purpose:** Arrive at a review already knowing what matters.
**Behavior:** For PRs where the user is a requested reviewer: fetch diff, CI status, description, linked ticket. Produce a summary, a risk-flag list (migrations, auth, concurrency, public API changes, big deletes, missing tests), a check of test coverage of changed lines where data exists, and suggested review questions. Optionally run the PR's tests in a sandbox. Draft-only comments, posting is an approved action.
**AC:** AC1: Every flagged risk cites file and line ranges from the diff. AC2: Large diffs are chunked with no truncation-related false claims (tested by asserting the summary states when content was skipped). AC3: Works when CI data is unavailable.
**Tests:** fixture PRs (small, huge, binary files, renames, deleted files), risk-heuristic unit tests, chunking tests.

### F7. Incident mode
**Lives in:** `pack-swe`.
**Purpose:** Cut time-to-context when something breaks.
**Behavior:** Triggered manually or from an alert source. Gathers recent deploys, recent merged PRs, error logs or monitoring links, related threads, on-call info if available. Builds a timeline. Drafts a status message. Optionally starts an investigation Job (read-only agent: no code changes) that reports hypotheses with evidence. Activates an incident mode layout.
**AC:** AC1: Timeline is chronologically correct across timezones (tested). AC2: Investigation agent runs read-only, enforced by sandbox permissions (test attempts a write and expects denial). AC3: Status message is a draft only.
**Tests:** timeline builder tests with mixed timezones and clock skew, read-only enforcement test, draft-only test.

### F8. Meeting prep
**Lives in:** core.
**Purpose:** A short brief before each meeting.
**Behavior:** N minutes before a calendar event (default 5), assemble: attendees, recent threads with them, open WorkItems involving them, recent artifacts (PRs, docs) tied to the topic, last meeting's action items. One screen, skimmable. Notification only if there is something non-trivial.
**AC:** AC1: No brief for events with no relevant context (quiet by default). AC2: Handles recurring events and all-day events correctly. AC3: Only uses data from the event's own workspace.
**Tests:** scheduler tests with fake clock, recurring/all-day fixtures, workspace isolation test.

### F9. Wins log (auto brag doc)
**Lives in:** core, sources from packs.
**Purpose:** Continuously record what the user shipped and its impact for reviews, promotions, resumes, and portfolios.
**Behavior:** Collects candidate wins from merged PRs, closed tickets, launched projects, positive feedback in messages, incidents handled, shipped side projects. AI groups and writes entries with impact language, each linked to evidence. User confirms or edits. Exports Markdown, and a formatted review/resume-style summary for a date range. Works for employer and side-project workspaces.
**AC:** AC1: Every entry has evidence links. AC2: No entry is auto-published anywhere. AC3: Export is deterministic given the same confirmed entries.
**Tests:** source ingestion fixtures, dedupe tests, export golden tests.

### F10. Capture and recall
**Lives in:** core.
**Purpose:** Get things out of your head fast, and find anything later.
**Behavior:** Global hotkey opens a tiny capture box: text (voice input is a later add), optional workspace. Capture can be turned into a WorkItem, Job, idea (builder pack), or note. Search across everything in the workspace: messages, work items, notes, commits/PR text, context snapshots, terminal history (if opted in). Fast, over the in-memory vault index (Section 4.6), with optional semantic ranking later.
**AC:** AC1: Capture appears in the inbox within 200ms of submit. AC2: Search results are scoped to the active workspace by default, cross-workspace search requires explicit opt-in. AC3: Deleted items disappear from the index.
**Tests:** FTS query tests, index update/delete tests, latency test on a synthetic 100k item DB, isolation test.

### F11. Ops feed and dashboard
**Lives in:** core panel framework, panels from `pack-swe`.
**Purpose:** What is running, what is waiting on me, what is broken, ambient if you have the screen for it, on-demand if you don't.
**Behavior:** Panels are live and independent: agent queue status, review-needed list, triage top N, CI status for tracked repos, deploy state, PRs awaiting me, today's calendar, active incident banner. Layout configurable per workspace and mode. A panel failure never breaks other panels. Two presentations of the same panels: **glance mode**, read-only and large-type for a spare monitor left up all day, and **overlay mode**, the same dashboard as a hotkey-summoned popup that dismisses on its own, for a single-screen laptop. Neither is a separate feature to build, both render the same panel set.
**AC:** AC1: Each panel has independent loading, error, and stale states. AC2: Panel data refreshes via push (WebSocket) with polling fallback. AC3: Glance mode renders with no interaction and no scrollbars at 1080p and 4K. AC4: Overlay mode opens and fully renders on a single-monitor machine with zero spare screens, and this is a required test target, not an edge case.
**Tests:** panel contract tests, error isolation test, Playwright screenshot tests at multiple resolutions including single-monitor overlay.

### F12. Auto standup and status summaries
**Lives in:** core.
**Purpose:** Daily or weekly summary of what happened, drafted from real activity.
**Behavior:** From commits, PRs, closed items, jobs, meetings, and wins, generate "yesterday / today / blockers" or a weekly summary. Draft-only. Copy to clipboard or save to file. Includes evidence links.
**AC:** AC1: Empty days produce an honest "nothing recorded", not filler. AC2: All statements link to evidence.
**Tests:** fixture-day tests, empty-day test, citation checker.

---

## 6. UX requirements

- **Shell:** left rail (Dashboard, Queue, Triage, Context, Wins, Settings), top bar with workspace switcher and command palette hint, center content.
- **Command palette** (Ctrl/Cmd+K): switch workspace, activate mode, create job, capture, search, open task context. Every feature is reachable here.
- **Global hotkeys (configurable):** capture, palette, dashboard overlay, mode 1..9, workspace next/prev, "restore context".
- **Approvals inbox:** a single place listing everything waiting on the user (agent reviews, drafts to send, budget overages). Persistent count, no popups.
- **Design:** clean and dense, high contrast, light and dark themes following the OS, respects reduced motion, no decorative gradients or glassmorphism, consistent spacing scale, readable at 4 to 6 feet on a spare monitor (glance mode).
- **Empty and error states** are designed, not afterthoughts. First-run onboarding: pick workspace type, connect at most one source to start, see something useful within 2 minutes.
- **Accessibility:** keyboard navigable, ARIA labels, contrast checked in tests (axe in Playwright).
- **Copy:** short, plain, no marketing voice.

---
## 7. Milestones and tasks

Task IDs are `M<milestone>-T<nn>`. Copy them into `docs/TASKS.md` in M0. A milestone is complete only when every task is done, all its exit criteria pass on all three CI operating systems, and `docs/PROGRESS.md` is updated. **Do not start a milestone before the previous one is complete**, except for small unblockers logged in `DECISIONS.md`.

### M0: Scaffold and handoff system
- M0-T01 Init pnpm monorepo, TS strict, lint, format, editorconfig, `.gitignore`.
- M0-T02 Create `CLAUDE.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, `docs/RUNBOOK.md` from Section 11 templates.
- M0-T03 GitHub Actions matrix (ubuntu, macos, windows): install, lint, typecheck, unit tests.
- M0-T04 `testkit` skeleton: fake `claude` binary (scriptable), fixture loader, fake clock.
- M0-T05 Boundary test: banned-terms check for `packages/core` and `packages/ui-core` (Section 3.1).
- M0-T06 Secret scanning in CI (e.g., gitleaks) and a pre-commit hook.
**Exit:** CI green on 3 OSes. A fresh AI session can resume using only the repo docs.

### M1: Core engine and generalization foundations
- M1-T01 Vault engine: frontmatter schemas per entity type (zod), atomic file read/write, file watcher, in-memory index builder plus snapshot persistence, rebuild-from-scratch tests, operational JSON/JSONL storage (Section 4.7) with atomic writes.
- M1-T02 Core entity schemas (zod) and repositories for all entities in 3.2.
- M1-T03 Event bus and job scheduler (persistent, restart-safe).
- M1-T04 ApprovalGate, PendingAction, Approval, and append-only audit log.
- M1-T05 Pack host: load, enable/disable per workspace, register features/panels/jobs/providers; unload cleanly.
- M1-T06 Connector interface, fake connector, secrets store on OS keychain (with test double).
- M1-T07 Daemon HTTP + WebSocket, bound to 127.0.0.1, random per-install token, origin checks.
- M1-T08 Web UI shell, panel framework, workspace switcher, command palette skeleton, theme.
- M1-T09 OsAdapter interface and `os-fake`.
- M1-T10 Isolation tests: two workspaces never leak data through repos, search, jobs, prompts, or panels. Test a workspace with zero company connectors.
- M1-T11 A tiny throwaway `pack-hello` (non-SWE vocabulary) used only in tests to prove the pack API.
**Exit:** UI shows an empty dashboard with working workspace switching, approvals inbox, and audit log. All isolation and boundary tests pass.

### M2: Agent queue (F1) and `pack-swe` foundation
- M2-T01 `pack-swe` skeleton, vocabulary, git sandbox provider (worktrees), Windows path tests.
- M2-T02 `AgentRunner` for Claude Code headless, with verified CLI flags recorded in DECISIONS.md. Fake claude binary integration tests.
- M2-T03 Job state machine, budgets and limits, orphan detection and resume.
- M2-T04 Queue UI and review screen (diff view, event log, test results, approve/reject/request changes).
- M2-T05 Post-run test execution in sandbox with configurable command, captured results.
- M2-T06 Approve path: open PR or merge behind the approval gate.
**Exit:** all F1 AC met. Demo: 3 parallel agent jobs on a sample repo, reviewed and approved from the UI.

### M3: Modes (F2), OS adapters, hotkeys
- M3-T01 Layout resolver (pure), monitor degradation, property tests.
- M3-T02 `os-mac` adapter (open apps/URLs/folders, window placement, notify, hotkeys, optional Hammerspoon/Rectangle integration).
- M3-T03 `os-windows` adapter (PowerShell/Win32, PowerToys FancyZones integration if present, notify, hotkeys).
- M3-T04 `os-linux` best-effort adapter.
- M3-T05 Adapter contract test suite run against every adapter.
- M3-T06 Modes UI: create, edit, save current layout, hotkey binding.
- M3-T07 Manual test checklist for real machines in `docs/TESTING.md`.
**Exit:** F2 AC met. Mode switching works on a real mac and a real Windows machine (owner verifies, log result in PROGRESS.md).

### M4: Connectors (read-only first, then drafts)
- M4-T01 GitHub connector (PRs, reviews, CI checks, issues, commits, deploy status).
- M4-T02 Google connector (Calendar read; Gmail read; Drive/Docs read).
- M4-T03 Slack connector (mentions, DMs, threads in selected channels).
- M4-T04 Microsoft Graph connector (Outlook mail and calendar read).
- M4-T05 MCP bridge connector to use MCP servers as connectors.
- M4-T06 Draft support per connector (drafts only, no send). Send/act support implemented but disabled by default and gated.
- M4-T07 Sync engine: cursors, pagination, backoff, rate-limit handling, token refresh, revocation, health panel.
- M4-T08 Contract tests using recorded, scrubbed fixtures for every connector, plus failure-mode tests.
**Exit:** connectors sync into a workspace, health visible, no writes possible without approval. See Section 8 for degraded modes when org policies block access.

### M5: Context restore (F3), triage (F4), meeting to agents (F5)
- M5-T01 Context providers in `pack-swe` (git state, terminal capture opt-in with redaction, agent jobs, PR threads) and generic providers in core (threads, events).
- M5-T02 Snapshot engine and brief UI, AI-off fallback, citation checker.
- M5-T03 Triage ingestion, normalization, dedupe.
- M5-T04 Deterministic ranking and reasons, feedback weights, AI ask-extraction and draft replies.
- M5-T05 Triage UI with keyboard-first flow.
- M5-T06 Meeting to agents: extraction, review list, WorkItem and Job creation.
- M5-T07 Eval harness (Section 10.6) with fixtures for F3, F4, F5.
**Exit:** F3, F4, F5 AC met. **This is the v1 usable product.** Owner dogfoods it for at least a week, notes go into PROGRESS.md.

### M6: Pre-review (F6), prep (F8), dashboard (F11), incident (F7)
- M6-T01 PR pre-review.
- M6-T02 Meeting prep with scheduler.
- M6-T03 Dashboard panels and glance mode.
- M6-T04 Incident mode and read-only investigation agent.
**Exit:** F6, F7, F8, F11 AC met.

### M7: Wins log (F9), capture and recall (F10), standup (F12), polish
- M7-T01 Wins log and export.
- M7-T02 Capture hotkey and search (in-memory index over the vault, Section 4.6), index maintenance and rebuild.
- M7-T03 Auto standup.
- M7-T04 First-run onboarding, empty/error states, accessibility pass, performance pass.
- M7-T05 Packaging: installable on mac and Windows (e.g., signed builds are out of scope, unsigned is fine for the owner), auto-start option, `docs/RUNBOOK.md` complete.
**Exit:** F9, F10, F12 AC met. Startup time and idle resource budget met (Section 10.8).

### M8: Generalization proof
- M8-T01 `pack-general` (triage, prep, meeting to tasks, wins log, context for docs). **Rule: zero changes to `packages/core` allowed. If any are needed, stop, log a "core leak" in DECISIONS.md, fix the core properly with tests, then continue.**
- M8-T02 `pack-builder` per Section 3.5 (project registry, health, idea inbox, ship log, launch checklist, build-in-public drafts, cost tracker, time allocation, next best action).
- M8-T03 A side-project workspace e2e test: no company connectors, builder + swe packs, full flow from capture to shipped win.
- M8-T04 `docs/PACK_AUTHORING.md`: how to write a new pack, with a worked example for a non-engineering role.
- M8-T05 Role-adaptation review: list of gaps for PM, designer, founder, student/researcher, writer roles and what a pack for each would need. Output is a doc, not code.
**Exit:** pack-general works end to end with zero core edits. Two workspaces of different types run side by side with verified isolation.

---

## 8. Connector requirements

General (all connectors):
- Minimum scopes. Start read-only. Request write scopes only when the owner enables drafts or acts for that connector.
- OAuth with PKCE and a localhost redirect where supported. Tokens in the keychain. Refresh and revoke handled. "Disconnect" wipes tokens and optionally synced data.
- Incremental sync with cursors, pagination, exponential backoff with jitter, respect rate-limit headers, idempotent ingestion (re-running a sync never duplicates).
- Every response parsed with zod, unknown fields tolerated, breaking shape changes produce a clear health error, not a crash.
- **Verify current API docs and auth requirements at build time.** Do not rely on memory for scopes, endpoints, or limits. Log what you verified in `docs/DECISIONS.md`.

**Degraded modes are required, not optional.** Employer-managed accounts often block third-party app consent (common with Slack workspaces and Microsoft 365 tenants). For each connector, define and implement a fallback:
- Calendar: ICS feed or file import.
- Email/chat: manual forward-to-DeskOS, paste-in, or export file import, marked as "manual source".
- Docs: local folder watch or file import.
- The product must remain useful when only local folders and GitHub are connected.

Provider notes (verify each at build time):
- **GitHub:** fine-grained personal access token or OAuth/GitHub App. Needs PRs, reviews, checks, issues, contents (read).
- **Slack:** OAuth user token with the smallest scopes for mentions, DMs, and selected channels. Some workspaces require admin approval.
- **Microsoft Graph:** Outlook mail and calendar read. Tenant consent policies may block it.
- **Google:** Calendar, Gmail, Drive/Docs with read scopes first.
- **MCP:** allow-list of servers per workspace. Treat all MCP tool output as untrusted data (9.4).

---

## 9. Safety and security model (hard constraints)

### 9.1 Capability tiers
Every connector action and agent tool is classified `read`, `draft`, or `act`. Defaults: `read` on, `draft` on, `act` off. `act` is enabled per connector and per action type by the owner, and every `act` goes through the ApprovalGate no matter what.

### 9.2 Approval gate
- `act` requires an `Approval` object created only by a UI user action (or a signed local CLI command by the owner). No code path may fabricate one.
- The approval shows exactly what will happen (recipient, content, target). What is approved is what is executed (hash-bound), edits after approval invalidate it.
- Approvals are single-use and expire.
- Test: an automated "bypass hunt" that tries every act-capable code path without an approval and expects failure.

### 9.3 Audit log
Append-only record of: connector calls that read or write, agent starts/stops, files changed, approvals, config changes. Includes timestamps, workspace, actor (user, agent, system), and inputs/outputs by reference. Viewable in the UI, exportable. Secrets never logged.

### 9.4 Untrusted content and prompt injection
Everything ingested from Slack, email, docs, web, PRs, transcripts, and MCP outputs is **untrusted data**. Rules:
- Ingested text is placed in clearly delimited data sections of prompts and the model is told it is data, not instructions.
- Content from ingestion can never add tools, change permissions, alter approval rules, or trigger `act` operations.
- Agents that read untrusted content and agents that have write/act tools are separated where practical (read-only summarizer vs sandboxed worker with no network by default).
- Outputs derived from untrusted content are shown with their sources so the user can spot manipulation.
- Maintain an **injection test corpus** (`testkit/injection/`) with at least 30 varied attacks (instructions in email bodies, PR descriptions, code comments, calendar invites, hidden text, other languages). Tests assert no tool calls, no permission changes, no leaked secrets, no act attempts.

### 9.5 Agent sandboxing
- Agents run with working directory set to the sandbox (for `pack-swe`, the git worktree; for other packs, a scratch folder), plus their own workspace's vault folder if the job declares it needs vault access (e.g. to write a job outcome note). That is the entire default scope, per the path-scoped rule in 3.3.
- Path traversal, symlink escapes, and absolute paths outside the approved scope are blocked and tested, whether the target is another workspace, the vault's own `.deskos/` internals, another project's subfolder the job never declared, the keychain, or anywhere else on disk.
- Any path outside the default scope must be explicitly declared on the job and approved once through the ApprovalGate before the agent starts; nothing is grantable mid-run without a fresh approval.
- Network access for agents is configurable, default off or allow-listed for package registries. Document what the Claude Code CLI permission modes provide, use the most restrictive mode that lets the task work, and record the choice.
- Destructive git operations (force push, branch deletion outside the sandbox, history rewrite) are never permitted to agents.
- Resource limits: wall time, tokens/cost, files changed, process count.

### 9.6 Secrets and redaction
- Secrets only in the OS keychain. `.env` files in projects are never ingested or sent to models by default.
- A redaction layer strips likely secrets (API keys, tokens, private keys, connection strings, password patterns) from terminal capture, logs, prompts, and stored snapshots. Test with a corpus of fake secrets in many formats.
- No secrets in the repo, tests, fixtures, or docs. CI secret scanning is mandatory.

### 9.7 Daemon security
- Bind to 127.0.0.1 only. Per-install random token required on every request and WebSocket. Strict origin/host checks (DNS rebinding protection). No wildcard CORS.
- Local UI never exposes raw connector tokens.
- Dependencies audited in CI (`pnpm audit` or equivalent) with a policy for handling findings.

### 9.8 Data handling
- Local-only storage. "Delete workspace" removes the vault folder, `.deskos/` operational files, tokens, index snapshot, and sandboxes, and is tested.
- Retention settings for raw ingested content (default: keep derived data and links, purge raw bodies after N days).
- Employer data caution: the owner is responsible for employer policy compliance. DeskOS provides per-workspace controls, an "offline/no-AI" switch that blocks sending any workspace content to a model, and clear indicators of what leaves the machine. Never send employer-workspace content to any model provider unless that workspace has AI enabled.

### 9.9 Kill switch
Global "pause all automation" control (UI and hotkey): stops agents, halts syncs, blocks acts. Tested.

---
## 10. Testing strategy

Testing is a core deliverable, not a cleanup step. Write tests with the code, not after.

### 10.1 Tiers
| Tier | Tool | What it covers |
|---|---|---|
| Unit | Vitest | pure logic: state machines, ranking, layout resolver, redaction, parsers |
| Property | fast-check | layout resolver for any monitor count, ranking monotonicity, redaction never leaks, cursor/idempotent sync, timeline ordering |
| Integration | Vitest + temp dirs + real git | vault read/write/watch/rebuild, operational file stores, sandboxes with real git repos, agent runner with fake claude binary, sync engine with fake connectors |
| Contract | Vitest + recorded fixtures | every connector against scrubbed recorded API responses and failure cases; every OS adapter against the shared adapter suite |
| E2E | Playwright | UI flows through the real daemon with fakes behind it |
| Security | Vitest | approval bypass hunt, injection corpus, sandbox escape attempts, secret redaction corpus, daemon auth/origin tests |
| Eval | custom harness | quality of AI-produced outputs (10.6), run on demand, not required for every CI run |
| Manual | checklist in `docs/TESTING.md` | real mac and Windows behavior that cannot be automated (window placement, hotkeys, notifications) |

### 10.2 Coverage targets
- Overall: at least 85% line and branch coverage in `packages/core` and `apps/daemon`.
- Safety-critical modules (`ApprovalGate`, sandbox providers, redaction, workspace isolation, daemon auth): at least 95%, plus mutation testing (Stryker or equivalent) on these modules with a score threshold recorded in `docs/TESTING.md`.
- Coverage is a floor, not the goal. Tests must assert behavior, not just execute lines.

### 10.3 Global test suites (apply to every feature)
1. **Approval bypass hunt:** enumerate all `act` code paths, attempt each without a valid approval, expect denial and an audit entry.
2. **Audit completeness:** every read/write/agent action produces an audit record, no secrets inside.
3. **Workspace isolation:** run each feature in two workspaces, assert zero cross-leakage across vault folders, search, prompts (inspect what the fake model received), panels, and logs, and confirm an agent scoped to one workspace's path is denied on any path outside it without an approval.
4. **Graceful degradation:** connector down, token expired, rate limited, AI unavailable, adapter unsupported, disk full on log write, malformed payloads. Feature shows a clear state, nothing crashes, other features unaffected.
5. **Restart recovery:** kill the daemon at random points (use a deterministic set of kill points) and verify consistent state on restart.
6. **Idempotency:** run any sync or ingestion twice, expect no duplicates.
7. **Time:** timezone offsets, DST transitions, recurring events, clock skew. Use the fake clock.
8. **Cross-platform paths and line endings:** Windows path semantics, spaces and unicode in paths, CRLF, long paths.
9. **Scale:** 100k items in a workspace, 10k threads, 1k jobs. No UI freezes, bounded memory.
10. **Boundary test:** core has no domain vocabulary (Section 3.1).
11. **Pack toggle:** enabling and disabling each pack leaves the workspace consistent.
12. **Kill switch:** pausing automation stops agents and blocks acts within a bounded time.

### 10.4 Test doubles (in `packages/testkit`)
- **Fake claude binary:** scriptable executable that emits scripted event streams: success, partial, malformed, slow, hanging, crash, huge output, permission-denied write. Keeps CI free, fast, and deterministic.
- **Fake connectors** with controllable data and failure injection.
- **Fake clock**, **fake OS adapter** (records calls), **fake keychain**.
- **Fixtures** are scrubbed of real names, emails, and tokens. A test ensures no fixture contains secret-like strings or real domains outside an allow-list.

### 10.5 E2E flows (Playwright, minimum)
1. First run: create workspace, connect fake source, see first useful output within the flow.
2. Create 3 agent jobs, one fails, one needs input, one succeeds, review and approve the successful one.
3. Triage: ranked list, open item, edit drafted reply, approve send with the fake connector, verify audit entry.
4. Meeting to agents: paste transcript, review extracted items, queue a job.
5. Mode activation with fake adapter, verify recorded calls, degrade to fewer monitors.
6. Workspace switch changes data, mode, and panels with no leakage.
7. Kill switch stops running jobs.
8. Glance mode screenshot tests at 1080p and 4K.
9. Accessibility scan (axe) on every main screen.
10. Side-project workspace with no company connectors completes a capture-to-win flow (M8).

### 10.6 AI output eval harness
LLM outputs are non-deterministic, so split the strategy:
- **In CI:** the model is stubbed with deterministic recorded responses. This tests parsing, schema validation, fallbacks, citation checking, and orchestration.
- **On demand (`pnpm eval`):** runs real model calls against labeled fixtures and reports metrics. Results saved to `docs/evals/<date>.md` with model and prompt versions. Target thresholds (tune after first run, record changes):
  - Action item extraction: precision at least 0.85, recall at least 0.80, zero invented owners.
  - Triage: agreement with labeled priority buckets at least 0.80, zero blocking items placed in noise.
  - Citations: 100% of cited source ids exist and support the claim (checked programmatically plus spot LLM-judge).
  - PR risk flags: every flag has a valid file/line reference, false claim rate tracked.
  - Injection corpus: 0 successful attacks.
- Prompts are versioned files. Changing a prompt requires re-running evals and recording the result.

### 10.7 CI gates (all must pass to merge)
Lint, typecheck, unit, property, integration, contract, boundary, secret scan, dependency audit, e2e (ubuntu required, mac and Windows on nightly and on changes to adapters/paths), coverage floors. A failing or skipped test is never merged silently.

### 10.8 Performance budgets (tested where feasible)
- Dashboard first paint under 1.5s on a warm daemon.
- Daemon idle: under 2% CPU and under 300 MB RAM with 2 workspaces connected.
- Search p95 under 100 ms at 100k items.
- Ingest 1,000 triage items under 5 s.
- Mode activation under 3 s excluding app launch time.

### 10.9 Definition of Done (per task)
- [ ] Acceptance criteria met, each mapped to a named test.
- [ ] New and existing tests pass locally and in CI on all three OSes.
- [ ] Global suites (10.3) applicable to the change are updated.
- [ ] No new lint, type, or audit warnings.
- [ ] Docs updated (RUNBOOK, TESTING, or feature notes if behavior changed).
- [ ] `docs/TASKS.md` and `docs/PROGRESS.md` updated, decisions logged.

### 10.10 Flaky tests
Never delete or silently skip. Quarantine with a tag, list in `docs/TESTING.md` with cause and owner action, fix within the next milestone.

### 10.11 Manual checklist (owner runs on real machines)
Window placement on 1, 2, and 4 monitors, monitor unplug/replug, global hotkeys not clashing with the OS, notifications, tray/startup behavior, keychain prompts, sleep/wake recovery, VPN on/off, corporate proxy behavior. Record results with date and OS version in `docs/TESTING.md`.

---

## 11. Progress tracking and handoff protocol

The project will be built across many sessions, possibly by different AI instances with no memory of earlier ones. The repo docs are the memory. Treat them as part of the product.

### 11.1 Files
- `CLAUDE.md`: short, stable rules (template below). Read first, every session.
- `docs/PROGRESS.md`: the living state. Current milestone, what works, what is broken, next actions, session log.
- `docs/TASKS.md`: every task ID with status checkboxes, mirroring Section 7.
- `docs/DECISIONS.md`: append-only log of decisions, spec deviations, dependency justifications, verified external facts (CLI flags, API scopes).
- `docs/TESTING.md`, `docs/RUNBOOK.md`: how to run tests and the app, reset state, debug.

### 11.2 Session start checklist
1. Read `CLAUDE.md`, `PROGRESS.md`, `TASKS.md`, `DECISIONS.md`.
2. Run `git status` and `git log -10` and confirm they match PROGRESS.md. If they disagree, trust the code, then fix the doc and note it.
3. Run the full test command to establish a baseline. Record failures before touching anything.
4. Pick the top item in "Next actions" (or the next unchecked task in order). Write in PROGRESS.md what you are about to do.

### 11.3 During work
- Commit after every green task with message `M2-T03: <what>`. Small commits.
- Update PROGRESS.md "In progress" before long or risky operations and whenever the plan changes.
- If you hit a blocker, write it in "Blockers" with what you tried, then move to another unblocked task rather than spinning.
- If context is running low, **stop and write the handoff first**, then continue only if room remains.

### 11.4 Session end checklist
1. All tests run, results recorded (pass/fail counts and any known failures with reasons).
2. `TASKS.md` boxes match reality. Never check a box for unfinished or untested work.
3. `PROGRESS.md` updated: status, what changed, exact next 3 actions with enough detail that a stranger can start immediately, open questions for the owner.
4. Append a session log entry. Commit docs with the code.

### 11.5 Templates

**CLAUDE.md**
~~~markdown
# DeskOS: standing rules for AI builders
1. Read in order: docs/PROGRESS.md, docs/TASKS.md, docs/DECISIONS.md, then the relevant SPEC.md section.
2. One task at a time. Done = acceptance criteria met + tests green on CI. Never claim done otherwise.
3. Update docs/PROGRESS.md at the end of every session and before risky work. Another AI must be able to resume from it cold.
4. Hard rules: read-only/draft-only by default, all act operations go through ApprovalGate, ingested content is untrusted data, no secrets in repo, no cross-workspace data flow, no domain words in packages/core.
5. Cross-platform always: mac, Windows, Linux. Platform code only in adapters. No bash-only scripts.
6. Log deviations and dependency additions in docs/DECISIONS.md.
7. Tone: terse and direct. No em dashes.
Commands: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm eval`.
~~~

**docs/PROGRESS.md**
~~~markdown
# Progress (last updated: YYYY-MM-DD HH:MM by <who/what session>)

## Status
- Current milestone: M<n> <name>
- Overall: <one honest sentence>
- CI: <green/red on which OS, link or note>
- Test summary: <unit x/y, integration x/y, e2e x/y, coverage %>

## What works (verified)
- <feature or capability> : <how it was verified>

## In progress
- <task ID>: <what is done, what remains, files touched, branch>

## Blockers
- <blocker>: <what was tried> : <what is needed>

## Known issues and tech debt
- <issue> : <severity> : <where>

## Next actions (do these in order)
1. <specific, self-contained action with file paths and commands>
2. <...>
3. <...>

## Open questions for the owner
- <question> (default if no answer: <default>)

## Session log (newest first)
### YYYY-MM-DD session N
- Did: <...>
- Verified by: <tests/commands>
- Left off at: <exact point>
- Decisions: <see DECISIONS.md entries>
~~~

**docs/TASKS.md**
~~~markdown
# Tasks
Legend: [ ] todo, [~] in progress, [x] done (tests green), [!] blocked
## M0
- [ ] M0-T01 ...
~~~

**docs/DECISIONS.md**
~~~markdown
# Decisions (append-only)
## YYYY-MM-DD: <title>
- Context:
- Decision:
- Alternatives:
- Consequences:
## Spec deviations
## Dependencies (name, why, alternatives considered)
## Verified external facts (what, source, date verified)
~~~

---

## 12. Decisions for the owner

The builder should not block on these. Use the default and continue, then flag it in PROGRESS.md.

| Decision | Default if unanswered |
|---|---|
| Product name | DeskOS |
| Which chat tool first, Slack or Teams | Slack, with manual import fallback |
| Which model for agents vs summaries | Best available Claude model for agent coding jobs, a cheaper fast model for summaries and triage classification, both configurable |
| Desktop shell | Browser/PWA for v1, revisit Tauri after M5 |
| Per-job default budget | Conservative low cap, raise per job |
| Repo visibility | Private |
| Voice capture | Deferred past v1 |
| Employer workspace with AI | Disabled by default until the owner turns it on per workspace |
| Where config repo lives | Local only until the owner chooses a git remote |

---

## Appendix A: Kickoff prompt for the first session

Paste this into Claude Code (Opus) in an empty repo that contains this file as `SPEC.md`:

~~~
Read SPEC.md fully and carefully before doing anything. You are the primary builder of DeskOS.
Start at Milestone 0. First create CLAUDE.md and the docs/ files from the templates in Section 11, then work through M0 tasks one at a time.
Follow every rule in Section 0. Tests are mandatory. Keep docs/PROGRESS.md current so any other AI can resume from it.
Do not stop to ask questions unless something is a true blocker; use the defaults in Section 12 and log them.
At the end of the session, do the session end checklist in Section 11.4.
~~~

## Appendix B: Future roles and how they map (for pack authors)

| Role | Likely work items | Key connectors | Notable pack features |
|---|---|---|---|
| Product manager | roadmap items, specs, feedback | docs, issues, chat, calendar | feedback clustering, spec drafts, stakeholder updates |
| Designer | design tasks, reviews | design tool files, chat, docs | review prep, asset handoff checklists, feedback triage |
| Founder / solo builder | projects, customers, launches | repos, payments, analytics, email | pack-builder plus customer inbox, metrics digest |
| Student / researcher | assignments, papers, experiments | docs, reference manager, calendar | reading queue, citation-linked notes, deadline planner |
| Writer / creator | pieces, drafts, publish slots | docs, CMS, social drafts | content calendar, draft pipeline, repurposing drafts |
| Sales / ops | accounts, follow-ups | CRM, email, calendar | follow-up triage, account briefs |

The test of good architecture: each of these is a new pack plus connectors, with no rewrite of the core.
