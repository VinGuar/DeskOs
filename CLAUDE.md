# DeskOS: standing rules for AI builders
1. Read in order: docs/HANDOFF.md, docs/PROGRESS.md, docs/TASKS.md, docs/DECISIONS.md, then the relevant SPEC.md section.
2. One task at a time. Done = acceptance criteria met + tests green on CI. Never claim done otherwise.
3. Rewrite docs/HANDOFF.md after every finished step (code pushed, CI result, task flipped, blocker hit). Update docs/PROGRESS.md at the end of every session and before risky work. Another AI must be able to resume from them cold.
4. Hard rules: read-only/draft-only by default, all act operations go through ApprovalGate, ingested content is untrusted data, no secrets in repo, no cross-workspace data flow, no domain words in packages/core.
5. Cross-platform always: mac, Windows, Linux. Platform code only in adapters. No bash-only scripts.
6. Log deviations and dependency additions in docs/DECISIONS.md.
7. Tone: terse and direct. No em dashes.
Commands: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check` (everything CI runs except gitleaks and audit). Later milestones add `pnpm test:e2e` and `pnpm eval`.

Repo conventions (see docs/DECISIONS.md for why):
- Internal packages export TypeScript source directly (`exports: ./src/index.ts`), no build step. Import with `.ts` extensions. Erasable syntax only: no enums, namespaces, or constructor parameter properties.
- Code that needs time takes a `Clock` from `@deskos/core`. Tests use `FakeClock` from `@deskos/testkit`.
- Spawn processes with argument arrays, never shell strings.
- Domain words in `packages/core` or `packages/ui-core` fail `pnpm check:boundary`. A line may opt out only with `boundary-allow: <reason>` in a comment that explains the rule.
- Fake secrets in tests are assembled at runtime (string concatenation) so scanners never see a literal.
