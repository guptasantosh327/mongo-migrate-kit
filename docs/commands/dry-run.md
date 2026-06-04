# mmk dry-run

Preview what `up` or `down` would do — **without ever touching the database**.

```bash
mmk dry-run <up|down> [file] [options]
```

## Usage

```bash
mmk dry-run up               # preview every pending migration that would apply
mmk dry-run up <file>        # preview a single file
mmk dry-run down             # preview reverting the last batch
mmk dry-run down --steps <n> # preview reverting the last N migrations
```

## How it works

`dry-run` resolves exactly the same set of files the real command would, and prints the plan — but it
**never connects for writes, acquires no lock, and changes nothing**. It's the safe way to confirm a
production run before committing to it.

```
◎ Dry-run  Would apply 2 migrations:
   • 20260605120000-add-users-index.js
   • 20260605120500-backfill-status.js
```

## Options

| Option | Description |
|---|---|
| `up \| down` | **Required.** Direction to preview. |
| `[file]` | Preview a single migration file. |
| `--steps <n>` | (down only) Preview reverting the last N migrations. Ignored for `up`. |
| `--json` | Emit the planned rows as JSON. |

Plus the [global flags](/guide/configuration#global-cli-flags).

::: tip Read-only
Because a dry-run never writes, it takes no concurrency lock and is always safe to run against
production.
:::
