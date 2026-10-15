---
title: mmk redo
description: Roll back and re-apply a MongoDB migration in one step with mmk redo. The quickest loop while you write a migration.
---

# mmk redo

Rolls a migration back and runs it again, in one command. Without a file name it uses the migration
that ran most recently.

```bash
npx mmk redo [file] [options]
```

## Examples

```bash
npx mmk redo           # the most recently applied migration
npx mmk redo <file>    # a specific one
```

## When to use it

Mostly while you're writing a migration. You run it, look at the data, change your mind, edit the
file, and want to try again from a clean state:

```text
$ npx mmk redo
Loaded config from mmk.config.js
↩ Reverted 20261015224137-index-orders-by-customer.js   [5ms]
✔ Applied  20261015224137-index-orders-by-customer.js   [128ms]
```

<Cast name="devloop" alt="Terminal: mmk up, the file is edited, mmk redo reverts and re-applies it, then mmk down checks the rollback" />

## Options

| Option | What it does |
| --- | --- |
| `[file]` | Redo this file instead of the most recent one. |
| `--no-lock` | Don't take the lock. Only for local development. |
| `--json` | Print the results as JSON on stdout. |

The [global flags](/guide/configuration#command-line-flags) work here too.

## Good to know

- **One lock for both halves.** The rollback and the re-run happen under a single lock, so nothing
  else can run in between, and the migration can't be left rolled back if the second half fails to
  start.
- **Edited files are fine.** Unlike [`mmk down`](/commands/down#edited-files-are-refused), redo
  doesn't refuse a file that changed since it ran. Editing it is usually why you're running redo.
  It runs the **current** `down()`, so make sure that still matches what the old `up()` did.
- **Both events are recorded.** The history shows the rollback and the new run.
- **Imported migrate-mongo records can't be redone**, for the same reason they can't be rolled back.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Rolled back and applied again. |
| `1` | Either half failed, the file isn't applied, or it was imported from migrate-mongo. |
