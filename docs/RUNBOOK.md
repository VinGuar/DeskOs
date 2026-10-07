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
