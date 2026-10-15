---
title: mmk down
description: Roll back MongoDB migrations with mmk down. Undo the last batch, a batch by number, the last N migrations, or one file by name. History is kept.
---

# mmk down

Rolls migrations back by running their `down()`. By default it undoes the last batch.

```bash
npx mmk down [file] [options]
```

## Examples

```bash
npx mmk down                     # the last batch
npx mmk down <file>              # one file
npx mmk down --batch 3           # everything in batch 3
npx mmk down --steps 2           # the last two files, whatever their batch
```

<Diagram name="batches" />

## What it does

mmk takes the lock, works out which files to undo, and runs their `down()` newest first.

```text
$ npx mmk down
Loaded config from mmk.config.js
↩ Reverted 20261015110000-rename-user-name.js   [25ms]
↩ Reverted 20261014103000-add-orders-customer-index.js   [4ms]
```

Records aren't deleted. Each one gets `status: 'reverted'` and a `revertedAt` date, and the file
shows as pending again.

Not sure what it'll undo? Put `dry-run` in front: `npx mmk dry-run down --steps 2`.

## Options

| Option | What it does |
| --- | --- |
| `[file]` | Undo only this file. |
| `--batch <n>` | Undo every file in batch `n`. |
| `--steps <n>` | Undo the last `n` files, newest first, ignoring batches. |
| `--force` | Undo even if a file changed since it ran. Asks you to confirm. |
| `--yes` | Answer yes to the `--force` question. Needed with `--json`. |
| `--no-lock` | Don't take the lock. Only for local development. |
| `--json` | Print the results as JSON on stdout. |

`--steps` can't be combined with a file name or with `--batch`. mmk tells you before it connects:

```text
✖ INVALID_ARGUMENT: Cannot combine --batch with --steps — they select different things
  Received: --batch 2 and --steps 1
  --batch 2 rolls back everything applied in batch 2
  --steps 1 rolls back the last 1 migration(s), ignoring batches
```

A batch that doesn't exist is an error too, and lists the ones that do:

```text
✖ INVALID_ARGUMENT: No applied migrations found in batch 99
  Batches that still have applied migrations: 2, 3
  Run `mmk status` to see the batch number of each migration
```

## Edited files are refused

Before it undoes anything, `mmk down` checks every file against the checksum saved when it ran. If
any of them changed, it stops before undoing anything at all:

```text
✖ CHECKSUM_MISMATCH: Refusing to roll back a file that changed since being applied: 20261012091500-backfill-order-status.js
  Rolling back would run the CURRENT down(), which may not undo what the applied up() did
  Restore the file to the version that was applied, then roll back
  Or roll back with the current code anyway: mmk down 20261012091500-backfill-order-status.js --force
```

This check is always on, whatever `strict` says. Running edited rollback code against production is
the riskiest thing a migration tool can do, so mmk wants you to say so explicitly with `--force`.
[`mmk redo`](/commands/redo) skips this check, because redoing a file you just edited is what it's
for.

## Imported migrations

Migrations brought over from migrate-mongo with [`mmk import`](/commands/import) can't be rolled
back by mmk. `mmk down` checks for them first and refuses with `MIGRATION_IRREVERSIBLE` before
touching anything, so you never end up with half a batch undone.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The files were rolled back, or there was nothing to roll back. |
| `1` | A `down()` failed, the file wasn't applied, a file changed (without `--force`), or the command was wrong. |
