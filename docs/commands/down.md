# mmk down

Roll back migrations — the last batch, a specific batch, the last N, or a single file.

```bash
mmk down [file] [options]
```

## Usage

```bash
mmk down                 # roll back the last batch
mmk down <file>          # roll back a single migration by filename
mmk down --batch <n>     # roll back every migration in batch n
mmk down --steps <n>     # roll back the last N migrations, newest first
mmk down --force         # roll back even if a file drifted (asks for confirmation)
```

## How it works

With no argument, `mmk down` reverts the **most recent batch** — every migration that shares the
highest batch number — by calling each file's `down()` in reverse order.

```
↩ Reverted 20260605120500-backfill-status.js     [54ms]
↩ Reverted 20260605120000-add-users-index.js     [21ms]
```

History is **never deleted**: each reverted record has its `status` set to `reverted` and a
`revertedAt` timestamp, preserving the full audit trail.

## Options

| Option | Description |
|---|---|
| `[file]` | Revert only this migration file. |
| `--batch <n>` | Revert every migration in batch number `n`. |
| `--steps <n>` | Revert the **last N applied** migrations, newest first, ignoring batch grouping. |
| `--force` | Roll back even if a file's checksum drifted from what was applied (prompts for confirmation). |
| `--yes` | Confirm `--force` non-interactively (required with `--json`). |
| `--no-lock` | Skip the concurrency lock. **Dev only.** |
| `--json` | Emit the run results as a JSON array on stdout. |

Plus the [global flags](/guide/configuration#global-cli-flags).

::: warning Mutually exclusive
`--steps` cannot be combined with a `[file]` or with `--batch`. Doing so exits with a validation
error before connecting to the database.
:::

## Checksum verification

Before reverting, `mmk down` recomputes each target file's SHA-256 and compares it to the checksum
recorded when the migration was applied. If a file **drifted** (was edited after it ran), the rollback
is **refused up front** — the whole batch aborts before anything is reverted — with a
`ChecksumMismatchError`:

```text
✖ Checksum mismatch — refusing to roll back drifted file(s): 20260605120000-add-users-index.js
```

This is stricter than [`mmk up`](/commands/up), which only blocks under `strict` and otherwise skips:
running an *edited* `down()` against production is the riskiest place to execute unverified code, so
`down` blocks regardless of the `strict` setting.

To roll back the drifted file anyway — running its **current** `down()` — pass `--force`. It prompts
for confirmation (`--yes` to skip, required in `--json` mode). [`mmk redo`](/commands/redo) forces this
internally, since redoing an edited migration is the usual reason to run it.

## `--steps` — Laravel-style rollback

`--steps <n>` reverts the last `n` applied migrations as **individual files**, newest first
(ordered by `appliedAt`), regardless of which batch they belong to:

```bash
mmk down --steps 2   # undo the two most recently applied migrations
```

This differs from the default (revert the whole last *batch*) and from `--batch <n>` (revert one
specific batch).

## Forward-only / imported migrations

Migrations adopted via [`mmk import`](/commands/import) are tagged `origin: 'migrate-mongo'` and are
**not reversible**. `mmk down` preflights this and throws `IrreversibleMigrationError` **before**
touching anything, so the collection is never left half-reverted.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The targeted migrations were reverted. |
| `1` | A `down()` threw, a target wasn't applied (`NotAppliedError`), a file drifted without `--force` (`ChecksumMismatchError`), or validation failed. |
