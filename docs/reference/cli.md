# CLI Cheatsheet

Every command and flag on one page. For details, follow the link on each command.

## Global flags

Available on every command, highest precedence:

| Flag | Description |
|---|---|
| `--uri <uri>` | MongoDB connection URI |
| `--db <name>` | Database name |
| `--dir <path>` | Migrations directory |
| `--config <path>` | Path to a config file (overrides auto-discovery) |
| `--json` | Machine-readable JSON output (on data commands) |

## Running migrations

| Command | Description |
|---|---|
| [`mmk up`](/commands/up) | Run all pending migrations |
| `mmk up <file>` | Run a single migration |
| `mmk up --step` | Apply each file as its own batch |
| `mmk up <file> --force --yes` | Re-run an already-applied file |
| `mmk up --strict` | Abort on a checksum mismatch |
| `mmk up --no-lock` | Skip the lock (dev only) |
| [`mmk down`](/commands/down) | Roll back the last batch |
| `mmk down <file>` | Roll back a single migration |
| `mmk down --batch <n>` | Roll back a specific batch |
| `mmk down --steps <n>` | Roll back the last N migrations |
| [`mmk redo`](/commands/redo) | Down + up the last applied migration |
| `mmk redo <file>` | Down + up a specific migration |

## Inspecting

| Command | Description |
|---|---|
| [`mmk status`](/commands/status) | Full status table |
| `mmk status --check` | Exit 1 if any migration is pending (CI gate) |
| `mmk list --pending` | Only pending migrations |
| `mmk list --applied` | Only applied migrations |
| [`mmk dry-run up`](/commands/dry-run) | Preview what would apply |
| `mmk dry-run down` | Preview what would revert |
| `mmk dry-run down --steps <n>` | Preview reverting the last N |

## Authoring

| Command | Description |
|---|---|
| [`mmk create <name>`](/commands/create) | Create a migration (default `.js`) |
| `mmk create <name> --ts` | Create a `.ts` migration |
| `mmk create <name> --js` | Create a `.js` migration |
| `mmk create <name> --template <path>` | Use a custom template |
| [`mmk init`](/commands/create#mmk-init) | Generate `mmk.config.js` |
| `mmk init --ts` / `--json` | Generate `.ts` / `.json` config |
| `mmk init --secret-provider` | Generate a secret-manager config |
| `mmk init --force` | Overwrite an existing config |

## Operations

| Command | Description |
|---|---|
| [`mmk import`](/commands/import) | Adopt a migrate-mongo changelog |
| `mmk import --from <c>` / `--to <c>` | Source / target collection |
| `mmk import --dry-run` | Preview the mapping |
| `mmk import --trust-hash` | Reuse migrate-mongo's `fileHash` |
| `mmk import --force` | Import into a non-empty changelog |
| [`mmk unlock`](/commands/unlock) | Force-release a stuck lock |
| `mmk unlock --yes` | Release without confirmation |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (or nothing to do) |
| `1` | An error occurred, or `--check` found pending migrations |
