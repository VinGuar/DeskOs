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

## Spec deviations
- 2026-10-07: Node floor 22, not 20 (see above).
- 2026-10-07: Boundary check stricter than "word-boundary grep" (see above).
- 2026-10-07: SPEC has two sections numbered 4.7 (Operational storage, Config). Docs refer to Config as "4.7 Config" to avoid ambiguity. No behavior change.

## Dependencies (name, why, alternatives considered)
- `typescript` (dev): SPEC language. Alternative: none.
- `vitest` (dev): SPEC test runner. Alternative: node:test, weaker watch/coverage/TS story.
- `@vitest/coverage-v8` (dev): coverage floors in SPEC 10.2. Alternative: istanbul provider, slower.
- `@biomejs/biome` (dev): lint + format in one tool. Alternative: ESLint + Prettier.
- `@types/node` (dev, pinned ^22): Node API types matching the engine floor.
- `zod` (testkit, later core): SPEC-mandated validation at every boundary. Used in testkit for scenario and fixture schemas.

## Verified external facts (what, source, date verified)
- Resolved versions on 2026-10-07 (npm registry via pnpm install): typescript 7.0.2, vitest 5.0.3, @biomejs/biome 2.5.15, zod 4.6.5, pnpm 9.15.9. Source: install output.
- `pnpm audit` works against the registry with pnpm 9.15.9. Source: local run, 2026-10-07.
- Biome 2.5 deprecates `linter.rules.recommended` in favor of `preset`. Source: `biome check` output, migrated with `biome migrate`, 2026-10-07.
- Node 20 end of life April 2026. Source: Node.js release schedule (from memory, not re-fetched this session).
