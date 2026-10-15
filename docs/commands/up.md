---
title: mmk up
description: Run pending MongoDB migrations with mmk up, or a single named file. Options for per-file batches, re-running an applied file, strict checksums and JSON output.
---

# mmk up

Runs migrations that haven't run yet. With a file name, runs only that file.

```bash
npx mmk up [file] [options]
```

## Examples

```bash
npx mmk up                                      # everything that's pending
npx mmk up 20261014103000-add-orders-index.js   # just this one
npx mmk up --step                               # everything, each file in its own batch
npx mmk up <file> --force                       # run an already-applied file again
```

## What it does

mmk takes the lock, finds every file in the migrations folder that has no `applied` record, and runs
them oldest first. Each one gets a record as soon as it finishes. All files from one run share a
batch number, so a later `mmk down` can undo the whole run.

```text
$ npx mmk up
Loaded config from mmk.config.js
✔ Applied  20261012090000-add-users-email-index.js   [125ms]
✔ Applied  20261012091500-backfill-order-status.js   [265ms]
✔ Applied  20261014103000-add-orders-customer-index.js   [148ms]
```

If nothing is pending, it says `Nothing to migrate` and exits `0`.

If a migration throws, the run stops. That file stays pending, and the ones after it don't run. See
[A migration failed](/guide/troubleshooting#a-migration-failed).

## Options

| Option | What it does |
| --- | --- |
| `[file]` | Run only this file. |
| `--step` | Give each file its own batch, so `mmk down` can undo them one at a time. |
| `--force` | Run a file that already ran. Needs a `[file]`. Asks you to confirm. |
| `--yes` | Answer yes to the `--force` question. Needed with `--json`. |
| `--strict` | Stop, instead of warning, if a named applied file has changed since it ran. |
| `--no-lock` | Don't take the lock. Only for local development. |
| `--json` | Print the results as JSON on stdout. |

The [global flags](/guide/configuration#command-line-flags) `--uri`, `--db`, `--dir` and `--config`
work here too.

## One batch or one per file

```bash
npx mmk up          # files A, B, C → all batch 5
npx mmk up --step   # A → batch 5, B → batch 6, C → batch 7
```

The default is right for most deploys: one run, one batch, one `mmk down` to undo it. Use `--step`
when you expect to undo files separately.

## Running an applied file again

Naming a file that already ran normally skips it:

```text
$ npx mmk up 20261012090000-add-users-email-index.js
⏭ Skipped  20261012090000-add-users-email-index.js
```

`--force` runs its `up()` again and records it under a new batch. mmk asks first. Use `--yes` to
answer in scripts:

```text
$ npx mmk up 20261012090000-add-users-email-index.js --force --yes
✔ Applied  20261012090000-add-users-email-index.js   [3ms]
⚠ Forcing   re-run of already-applied 20261012090000-add-users-email-index.js
```

Only do this with migrations that are safe to run twice. `--force` without a file name is an error,
because a plain `mmk up` only runs pending files. In `--json` mode, `--force` without `--yes` is
refused, so a script can never re-run something by accident.

## Edited files

`mmk up` only runs pending files, so it doesn't look at files that already ran. If you name an
applied file and its checksum changed, mmk warns and skips it, or stops with `CHECKSUM_MISMATCH` if
`strict` is on. To spot edited files in general, use [`mmk status`](/commands/status).

## Requiring an author

With `requireAuthor: true`, `mmk up` checks every file it's about to run before it runs any of them.
If any file has no `author`, nothing runs and the error lists them all. See
[Writing migrations](/guide/writing-migrations#the-author-line).

## Without the lock

```text
⚠ Running without a lock (--no-lock) — concurrent runs are unsafe
```

`--no-lock` is for your own machine, where nothing else is running. Don't use it in CI or production.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Everything it was asked to run ran, or there was nothing to do. |
| `1` | A migration failed, or something was wrong with the command or config. |
