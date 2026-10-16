---
title: CLI cheatsheet
description: Every mongo-migrate-kit (mmk) command and flag on one page.
---

# CLI cheatsheet

Every command and flag on one page. Click a command for the details and real output.

## Global flags

These work on every command and beat environment variables and the config file:

| Flag | Description |
|---|---|
| `--uri <uri>` | MongoDB connection URI |
| `--db <name>` | Database name |
| `--dir <path>` | Migrations directory |
| `--config <path>` | Path to a config file (overrides auto-discovery) |
| `--json` | One JSON document on stdout; everything else, including your own code's `console.log`, goes to stderr (on every command that reads or changes migrations; on `init` it means "make a JSON config") |

## Running migrations

| Command | Description |
|---|---|
| [`mmk up`](/commands/up) | Run all pending migrations |
| `mmk up <file>` | Run a single migration |
| `mmk up --step` | Apply each file as its own batch |
| `mmk up <file> --force --yes` | Run an already-applied file again |
| `mmk up --strict` | Abort on a checksum mismatch |
| `mmk up --no-lock` | Don't take the lock (local development only) |
| [`mmk down`](/commands/down) | Roll back the last batch |
| `mmk down <file>` | Roll back a single migration |
| `mmk down --batch <n>` | Roll back a specific batch |
| `mmk down --steps <n>` | Roll back the last N migrations |
| `mmk down --force` | Roll back even if a file changed since it ran (asks first) |
| [`mmk redo`](/commands/redo) | Roll back and re-apply the most recent migration |
| `mmk redo <file>` | Roll back and re-apply one file |

## Looking around

| Command | Description |
|---|---|
| [`mmk status`](/commands/status) | Full status table |
| `mmk status --check` | Exit 1 if anything is pending (for CI) |
| `mmk status --all-namespaces` | Every repo's records on a shared database (read-only) |
| `mmk list --pending` | Only pending migrations |
| `mmk list --applied` | Only applied migrations |
| [`mmk dry-run up`](/commands/dry-run) | Preview what would apply |
| `mmk dry-run down` | Preview what would revert |
| `mmk dry-run down --steps <n>` | Preview reverting the last N |

## Creating files

| Command | Description |
|---|---|
| [`mmk create <name>`](/commands/create) | Create a migration (default `.js`) |
| `mmk create <name> --ts` | Create a `.ts` migration |
| `mmk create <name> --js` | Create a `.js` migration |
| `mmk create <name> --template <path>` | Use a custom template |
| `mmk create <name> --author <name>` | Set the author line (default: your git name and email) |
| [`mmk init`](/commands/create#mmk-init) | Generate `mmk.config.js` |
| `mmk init --ts` / `--json` | Generate `.ts` / `.json` config |
| `mmk init --secret-provider` | Generate a secret-manager config |
| `mmk init --force` | Overwrite an existing config |
| `mmk init --namespace <ns>` | Write this repo's [namespace](/guide/shared-database) into the config |

## Maintenance

| Command | Description |
|---|---|
| [`mmk import`](/commands/import) | Copy a migrate-mongo history into mmk |
| `mmk import --from <c>` / `--to <c>` | Source / target collection |
| `mmk import --dry-run` | Show what would be imported |
| `mmk import --trust-hash` | Reuse migrate-mongo's `fileHash` |
| `mmk import --force` | Import even if mmk's history isn't empty |
| [`mmk unlock`](/commands/unlock) | Force-release a stuck lock |
| `mmk unlock --yes` | Release without confirmation |
| [`mmk namespace adopt`](/commands/namespace) | Move older records into this repo's new namespace |
| `mmk namespace adopt --dry-run` | Preview what would move |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | It worked, or there was nothing to do |
| `1` | Something failed, or `status --check` found pending migrations |
