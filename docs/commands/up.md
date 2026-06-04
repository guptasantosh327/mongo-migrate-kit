# mmk up

Run pending migrations — all of them, or a single named file.

```bash
mmk up [file] [options]
```

## Usage

```bash
mmk up                      # run all pending migrations (one shared batch)
mmk up <file>               # run a single migration by filename
mmk up --step               # apply each pending file as its own batch
mmk up <file> --force --yes  # re-run an already-applied file (non-interactive)
```

## How it works

With no argument, `mmk up` resolves every file in the migrations directory that isn't already
applied, sorted ascending, and runs them as **one batch**. A later `mmk down` reverts that whole
batch together.

```
✔ Applied  20260605120000-add-users-index.js     [42ms]
✔ Applied  20260605120500-backfill-status.js     [128ms]
```

If there's nothing to do:

```
Nothing to migrate
```

## Options

| Option | Description |
|---|---|
| `[file]` | Run only this migration file. |
| `--step` | Apply each pending file as its **own** sequential batch, so they can later be rolled back one at a time. |
| `--force` | Re-run an **already-applied** file (requires a `[file]`). Prompts for confirmation. |
| `--yes` | Skip the confirmation prompt for `--force` (required in `--json` mode). |
| `--strict` | Override config: abort on a checksum mismatch instead of warning. |
| `--no-lock` | Skip the concurrency lock. **Dev only** — warns loudly. |
| `--json` | Emit the run results as a JSON array on stdout. |

Plus the [global flags](/guide/configuration#global-cli-flags): `--uri`, `--db`, `--dir`, `--config`.

## `--step` vs. the default batch model

```bash
mmk up          # files A, B, C → batch 5 (all together)
mmk up --step   # A → batch 5, B → batch 6, C → batch 7 (each its own batch)
```

Use `--step` when you want to peel migrations off individually later with
[`mmk down --steps`](/commands/down).

## Re-running an applied migration

By default an already-applied file is skipped. `--force` re-runs its `up()` and re-records it as a new
batch. It requires a specific file (a bare `mmk up --force` exits 1) and asks for `y/N` confirmation
first — pass `--yes` to confirm non-interactively:

```bash
mmk up 20260605120000-add-users-index.js --force --yes
```

::: warning
`--force` bypasses the checksum-mismatch guard — re-running is the explicit intent. In `--json` mode,
`--force` without `--yes` is refused so automation never silently re-applies a migration.
:::

## Checksum behavior

Each file's SHA-256 is verified against what was recorded when it was applied. If a file changed:

- `strict: false` (default) → logs a warning and skips it.
- `strict: true` (or `--strict`) → throws `ChecksumMismatchError` and stops.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All targeted migrations applied (or nothing to do). |
| `1` | A migration threw, or validation failed. The batch stops at the first error. |
