# Runbook

## Prerequisites
- Node 22.12 or newer (`node --version`).
- pnpm 9: `npm install -g pnpm@9` (or `corepack enable pnpm` if you have write access to the Node install dir).
- git.

## Setup
```
pnpm install
```
This also sets `core.hooksPath` to `.githooks`, which turns on the pre-commit secret scan.

## Keys and env vars
- Developer and build-time keys go in `.env` at the repo root: copy `.env.example` to `.env` and fill it in. Every `.env` and `.env.*` file, in any folder, is git-ignored. `scripts/env-files.test.ts` fails if that ever changes or a real env file is committed.
- New variable: add the name (no value) to `.env.example` with a comment saying what uses it.
- Load in Node with `process.loadEnvFile()` or `node --env-file-if-exists=.env`. No dotenv dependency.
- Keys DeskOS stores for a user at runtime (connector tokens) are not env vars. They go in the OS keychain (SPEC 9.6, M1-T06).

## Daily commands
- `pnpm check`: everything CI runs, except gitleaks and the audit.
- `pnpm format`: apply Biome formatting and safe fixes.

## Pre-commit hook
- Blocks commits whose staged content looks like it contains a secret. Prints the file, line, and rule, never the value.
- False positive: add a comment containing `secret-scan-allow` with a reason on that line.
- If the hook is not running: `git config core.hooksPath` should print `.githooks`. Re-run `pnpm install`.

## Reset local state
Nothing to reset yet. From M1 on, each workspace keeps operational state in `<workspace>/.deskos/`. The index snapshot there is safe to delete.

## Running the app
Not runnable yet. The daemon arrives in M1-T07, the web UI in M1-T08.

## Troubleshooting
- `EPERM` during `pnpm install` on Windows inside OneDrive: OneDrive may be locking files in `node_modules`. Pause sync or move the repo outside OneDrive (recommended, see PROGRESS.md).
- Line endings: `.gitattributes` forces LF on checkout on every OS. If a file shows as fully changed on Windows, run `git add --renormalize .`.
