# Decisions (append-only)

## 2026-10-07: Adopt SPEC Section 12 defaults
- Context: owner has not answered the Section 12 questions.
- Decision: use every default. Name DeskOS. Slack first. Best Claude model for agent jobs, a cheaper fast model for summaries, both configurable. Browser/PWA shell. Conservative per-job budget. Private repo. Voice deferred. AI off for employer workspaces until enabled. Config repo local only.
- Alternatives: block on the owner. Rejected, Section 12 says not to.
- Consequences: revisit any of these when the owner answers. Tracked in PROGRESS.md open questions.

## 2026-10-07: Node 22 is the floor, not Node 20
- Context: SPEC 4.2 says Node 20+ LTS. Node 20 reached end of life in April 2026.
- Decision: `engines.node >=22.12`, CI runs Node 22, `@types/node` pinned to 22. Owner machine runs Node 24.
- Alternatives: keep 20. Rejected, no security fixes.
- Consequences: Node 22.18+ can run erasable TypeScript directly (type stripping), which the daemon may use (decide in M1-T07).

## 2026-10-07: Biome instead of ESLint + Prettier
- Context: SPEC 4.2 allows "ESLint + Prettier (or Biome)".
- Decision: Biome 2 for lint, format, and import sorting. Config in `biome.json`, `recommended` preset.
- Alternatives: ESLint + typescript-eslint + Prettier. Rejected, 3+ deps and two configs for the same job.
- Consequences: no type-aware lint rules. `tsc` strict covers most of that ground.

## 2026-10-07: TypeScript 7, source-only internal packages, erasable syntax
- Context: TypeScript 7 (native compiler) is current. Monorepo packages need to consume each other with no build step.
- Decision: TS 7. Every internal package sets `exports` to `./src/index.ts` and imports with `.ts` extensions (`allowImportingTsExtensions`, `noEmit`). `erasableSyntaxOnly` is on so code also runs under Node type stripping. Strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Alternatives: TS 5.x with project references and a build step. Kept as fallback if TS 7 tooling breaks something.
- Consequences: no enums, namespaces, or parameter properties. A bundler or type stripping is needed when packaging (M7-T05).

## 2026-10-07: Clock interface lives in core from M0
- Context: M0-T04 needs a fake clock, which needs an interface to implement. The interface belongs in core.
- Decision: small unblocker. `packages/core/src/clock.ts` defines `Clock` and `systemClock`. `FakeClock` in testkit implements it.
- Consequences: all time-dependent core code takes a `Clock`.

## 2026-10-07: Boundary check is stricter than the spec wording
- Context: SPEC 3.1 asks for a word-boundary grep. Plain `\bgit\b` misses identifiers like `gitStatus` or `repo_path`, which are the likeliest leaks.
- Decision: `scripts/boundary.mjs` tokenizes each line, splitting identifiers on camelCase, `_`, `-`, and punctuation, then matches tokens. Also rejects common inflections (`branches`, `merged`, `deployment`, `commits`) and checks file names. `CI` is case-sensitive, all other terms are not. A line is exempt only with `boundary-allow: <reason>` (used for comments that explain the rule). Runs as `pnpm check:boundary` and as a vitest test.
- Alternatives: literal `\b` regex. Rejected, too easy to bypass by accident.
- Consequences: core cannot name things like `mergeSnapshots`. Use `combine`, `fold`, `join`.

## 2026-10-07: Repo-wide em dash check
- Context: SPEC Section 0 rule 8 bans em dashes in the repo.
- Decision: `scripts/no-em-dash.mjs`, run in CI and as a test. The character is built from its code point in the checker so no source file contains it.

## 2026-10-07: Secret scanning in two layers
- Context: M0-T06 asks for CI secret scanning and a pre-commit hook. Requiring a gitleaks binary on every dev machine (mac and Windows) is friction.
- Decision: (1) `scripts/scan-secrets.mjs`, a small dependency-free scanner, runs in the pre-commit hook on staged content and in CI on all files. (2) `gitleaks/gitleaks-action@v2` scans full history in CI. Hooks live in `.githooks/`, enabled by `core.hooksPath`, which `pnpm install` sets (`scripts/install-hooks.mjs`). No husky. Allow marker for false positives: `secret-scan-allow`. Fixtures are also checked for real hosts and emails against an allow-list in `scripts/lib/hosts.mjs` (SPEC 10.4).
- Alternatives: husky + gitleaks binary locally. Rejected, extra dependency and install burden.
- Consequences: the JS scanner is pattern-only, no entropy checks. gitleaks is the backstop. gitleaks-action needs `GITLEAKS_LICENSE` if the repo ever moves under an organization. The redaction layer (SPEC 9.6, M5) is separate and will have its own corpus; it may reuse `scripts/lib/secret-patterns.mjs` ideas but must live in core.

## 2026-10-07: Dependency audit policy
- Decision: CI runs `pnpm audit --audit-level high`. High and critical findings fail the build. Fix by upgrading, or if no fix exists, log the advisory, its reachability, and an expiry date here, then add a pnpm override or ignore.

## 2026-10-07: pnpm 9 via npm on the owner machine
- Context: `corepack enable` failed with EPERM writing to `C:\Program Files\nodejs` (no admin).
- Decision: `npm install -g pnpm@9` into the user prefix. `packageManager: pnpm@9.15.9` pins the version; CI uses `pnpm/action-setup`, which reads it.

## 2026-10-07: Fake claude event shapes are provisional
- Context: the fake binary (M0-T04) emits events shaped like `claude -p --output-format stream-json`. These shapes were written from memory, not verified.
- Decision: keep them as presets in `packages/testkit/src/fake-claude/scenario.ts`, marked UNVERIFIED. M2-T02 must check the current CLI docs, fix the presets, and record the verified flags and shapes under "Verified external facts".

## 2026-11-05: Vault file format and path rules (M1-T01)
- Context: SPEC 4.6 fixes markdown + YAML frontmatter and `<type>-<slug>-<short-id>.md`, but not parsing, ids, or path rules.
- Decision:
  - YAML via `yaml` (YAML 1.2 core schema, `uniqueKeys`). Dates and `yes`/`no` stay strings, so hand-written notes do not silently change type. Frontmatter must be a mapping. Writes are always LF; CRLF and BOM are accepted on read.
  - Entity `id` is a UUID in frontmatter. The 4-hex short id exists only to keep file names unique and is regenerated on a name clash. Renaming a file never changes the entity id.
  - Slugs keep letters and digits from any script (NFKD, accents stripped, max 60 code points), everything else becomes one dash. Empty slug is `untitled`.
  - Base frontmatter: `id`, `type`, `schema_version` (default 1), `created_at`, `updated_at`, optional `source`, `source_ref`, `links`, `raw`. Schemas are `z.looseObject` so unknown fields survive. Timestamps accept ISO datetime with offset or a bare date. A `NoteSchemaRegistry` maps type to schema; unregistered types use the base schema. Per-type schemas come in M1-T02.
  - Read results are `entity`, `plain` (no frontmatter or no `type`: a user note DeskOS did not create), or `invalid` (reported, never thrown).
  - Note paths are vault-relative and `/` separated. Backslash is a separator on every OS. Rejected: absolute, drive-relative, UNC, `.`/`..`/empty segments, any dot segment (so `.deskos`, `.obsidian`, temp files are off limits), NUL, non-`.md`. Every read/write/remove also realpaths the target and refuses anything outside the real root, plus any note that is itself a symlink. Scans skip dot entries and never follow symlinks.
  - `update` is a shallow patch; `id`, `type`, `created_at` cannot change.
- Alternatives: `js-yaml` (YAML 1.1 by default, would coerce `no` to false and dates to Date). `gray-matter` (wraps js-yaml, unmaintained). Preserving YAML comments via the `yaml` Document API: deferred, see PROGRESS tech debt.
- Consequences: a DeskOS rewrite of a hand-edited note drops YAML comments and converts CRLF to LF.

## 2026-11-05: Operational storage (M1-T01)
- Decision: `writeFileAtomic` writes `.<name>.<random>.tmp` in the target folder (with `flush`), then renames. Rename retries EPERM/EBUSY/EACCES with backoff 10..320 ms (Windows returns these while antivirus, OneDrive, or an editor holds the file). Temp files are removed on failure. `JsonStore` is one atomic JSON file per id (`^[A-Za-z0-9_-]{1,128}$`). `JsonlLog` appends with `flush`, serializes appends per instance, rotates by size to `<name>.<utc stamp>-<nnnn>.jsonl` (no colons, sorts in time order), and on first append adds a newline if a crash left a torn last line. Readers skip and report unparseable lines.
- Consequences: date-based rotation (SPEC 4.7) not done yet. One writer process per log is assumed (the daemon); cross-process locking is not provided.

## 2026-11-05: core tests depend on testkit
- Context: testkit implements core's `Clock`; core tests need `FakeClock` and `makeTempDir` (CLAUDE.md requires FakeClock in tests).
- Decision: `@deskos/testkit` is a devDependency of `@deskos/core`. pnpm warns about a workspace cycle. Harmless: packages are source-only, so there is no build order.
- Alternatives: move FakeClock into core (test code in production package), or duplicate helpers. Rejected.

## 2026-11-05: First push and CI fixes (M0)
- Remote: `https://github.com/VinGuar/DeskOs.git`, created by the owner. Its GitHub-generated initial commit (LICENSE Apache 2.0, README, Python `.gitignore` template) was merged with `--allow-unrelated-histories`, not force-pushed over. The project `.gitignore` won.
- The repo is public. Section 12 default was private; the owner created it, so it stays as is. Listed as an open question in PROGRESS.
- gitleaks `generic-api-key` flagged a fake key in `scripts/scan-secrets.test.ts` (commit 0702298): a single high-entropy fragment next to the word `api`. Fix: build fake keys from short fragments. The historical finding is listed in `.gitleaksignore` by fingerprint. Any new entry there needs a comment saying why.
- macOS: `os.tmpdir()` is under `/var`, a symlink to `/private/var`, and child processes report the resolved cwd. `makeTempDir` now returns `realpathSync.native(...)`. Tests should compare resolved paths.

## 2026-11-05: Search index is MiniSearch (M1-T01)
- Context: SPEC 4.2 allows FlexSearch or MiniSearch.
- Decision: MiniSearch 7. Zero dependencies, first-class TS types, synchronous `toJSON`/`loadJS` for the snapshot, `discard` for cheap removal with auto vacuum. Fields `title` (boost 2) and `body`; prefix search and fuzzy 0.2 on by default; terms are NFKD-folded and lowercased so accents and case do not matter. Bodies are indexed, not stored. Metadata (path, status, id, type, title, entity frontmatter, mtime, size) lives in a map beside it.
- Snapshot: `.deskos/index.snapshot`, JSON `{ format, notes, search }`, written with `writeFileAtomic`. Any parse or validation failure, or a different `format`, means a full rebuild. Bump `INDEX_SNAPSHOT_FORMAT` whenever search options or the layout change.
- Cold start: load snapshot, then reconcile: walk the vault, stat each note, re-read only on mtime or size change, drop notes no longer on disk. Stat happens before read so a mid-read edit forces a re-read next time.
- Duplicate ids (a copied file) are allowed in the index, surfaced by `duplicateIds()`, and `getById` picks the first path in sort order.
- Alternatives: FlexSearch. Faster at scale, but async multi-file export and weaker types. Revisit only if the 100k p95 budget (SPEC 10.8) fails.
- Consequences: the default tokenizer splits on spaces and punctuation, so CJK text without spaces indexes as long tokens. Fine for now.

## 2026-11-05: File watcher is node:fs.watch recursive, no chokidar (M1-T01)
- Decision: `fs.watch(root, { recursive: true })` (native on Windows and macOS, Node's inotify implementation on Linux, Node 22 floor). Events are debounced through `Clock` (100 ms). A changed `.md` path is re-read alone. Any other path (folder renamed or deleted, or unknown) reconciles that subtree. A null file name or a watcher error triggers a full reconcile. Dot paths are ignored, which also ignores our own `.deskos/` writes. A full reconcile every 5 minutes covers dropped events and Unicode normalization differences in macOS event paths.
- Alternatives: chokidar. Rejected: a dependency for what Node now does natively, and the periodic reconcile already covers the cases chokidar papers over.
- 2026-11-05 addendum: macOS FSEvents goes live shortly after `fs.watch` returns and drops events made before that (CI run 42086864296 failed this way). `start()` now reconciles once by default (`rescanOnStart`), which also covers changes between `loadIndex` and `start`. The real-fs test waits for a probe file to arrive through an event before asserting.
- Consequences: on Windows a folder cannot be renamed while any file inside is open, so a rename racing an index read can fail once with EPERM. Reads are milliseconds long. The integration test retries the rename for this reason.

## 2026-11-05: Env files for developer keys only
- Decision: developer and build-time keys go in `.env` (git-ignored, every folder). `.env.example` lists names with empty values. `scripts/env-files.test.ts` enforces both. Load with `process.loadEnvFile` or `node --env-file-if-exists`; no dotenv dependency. Keys DeskOS holds for users at runtime go in the OS keychain (SPEC 9.6), never `.env`.

## 2026-11-05: Core entities and repositories (M1-T02)
- Note types (kebab-case, in the vault): `work-item`, `thread`, `artifact`, `person`, `event`, `context-snapshot`. All loose, so packs and users can add fields. Cross-references are entity ids as strings, plus `[[wikilinks]]` in `links`. `artifact.kind` is an open string packs define. Event times keep their offset; `timezone` is an IANA name, `recurrence` an RRULE. The TS type for events is `TimelineEvent` because Node has a global `Event`.
- `derived` (model, prompt_version, source_ids with at least one id, generated_at) is an optional block in the base note shape, so any note can carry AI output and its provenance.
- Job is operational (`.deskos/jobs/<id>.json`), with Sandbox as an embedded `{ provider, path, created_at }` record, per SPEC 4.7. States: F1 list plus `interrupted`. No transition rules yet (M2-T03). Operational records share `operationalShape`: id, workspace_id, created_at, updated_at, source.
- `JobRepository` refuses a record whose `workspace_id` is not its own (isolation), and serializes updates per job id.
- `NoteRepository` registers its schema on the vault's registry (or refuses a conflicting one), updates the index on every write, and on `get` re-reads from disk; a stale index entry is healed and reported as not found.
- Default folders for new notes: Work, Threads, Artifacts, People, Events, Context. Users can move notes anywhere.

## 2026-11-05: docs/HANDOFF.md
- Context: owner asked for a handoff doc edited after every completed step, so an AI can resume easily.
- Decision: `docs/HANDOFF.md` holds only the current state: active task, what it waits on, exact next step, code map, verify commands, gotchas. Rewritten after every finished step. PROGRESS.md keeps status, history, and tech debt (updated per session). CLAUDE.md rules 1 and 3 list it first.

## Spec deviations
- 2026-11-05: added `docs/HANDOFF.md` beyond the SPEC 11.1 file list (see above).
- 2026-10-07: Node floor 22, not 20 (see above).
- 2026-10-07: Boundary check stricter than "word-boundary grep" (see above).
- 2026-10-07: SPEC has two sections numbered 4.7 (Operational storage, Config). Docs refer to Config as "4.7 Config" to avoid ambiguity. No behavior change.

## Dependencies (name, why, alternatives considered)
- `typescript` (dev): SPEC language. Alternative: none.
- `vitest` (dev): SPEC test runner. Alternative: node:test, weaker watch/coverage/TS story.
- `@vitest/coverage-v8` (dev): coverage floors in SPEC 10.2. Alternative: istanbul provider, slower.
- `@biomejs/biome` (dev): lint + format in one tool. Alternative: ESLint + Prettier.
- `@types/node` (dev, pinned ^22): Node API types matching the engine floor.
- `zod` (testkit, core): SPEC-mandated validation at every boundary. Used in testkit for scenario and fixture schemas, in core for frontmatter and operational records.
- `minisearch` (core, ^7.2.0): in-memory full-text index with snapshot support. Pure JS, zero dependencies. Alternative: flexsearch (see 2026-11-05 index entry).
- `yaml` (core, ^2.9.1): frontmatter parse/serialize. Pure JS, zero dependencies, YAML 1.2. Alternatives: js-yaml, gray-matter (see 2026-11-05 vault entry).

## Verified external facts (what, source, date verified)
- Resolved versions on 2026-10-07 (npm registry via pnpm install): typescript 7.0.2, vitest 5.0.3, @biomejs/biome 2.5.15, zod 4.6.5, pnpm 9.15.9. Source: install output.
- `pnpm audit` works against the registry with pnpm 9.15.9. Source: local run, 2026-10-07.
- Biome 2.5 deprecates `linter.rules.recommended` in favor of `preset`. Source: `biome check` output, migrated with `biome migrate`, 2026-10-07.
- `yaml` 2.9.1 is current on npm with no dependencies. Source: `pnpm view yaml`, 2026-11-05.
- zod <4.6.6 has GHSA-mrhx-c7xc-m3w5 (high, memory exhaustion on oversized constrained collections). Upgraded core and testkit to zod ^4.6.7. `pnpm audit --audit-level high` clean after. Source: local audit, 2026-11-05.
- Node 20 end of life April 2026. Source: Node.js release schedule (from memory, not re-fetched this session).
