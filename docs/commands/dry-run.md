---
title: mmk dry-run
description: Preview which MongoDB migrations mmk up or mmk down would run, without touching the database. Safe to run against production.
---

# mmk dry-run

Shows what `mmk up` or `mmk down` would do, without doing it.

```bash
npx mmk dry-run <up|down> [file] [options]
```

## Examples

```bash
npx mmk dry-run up                # what would mmk up run?
npx mmk dry-run up <file>         # would this file run?
npx mmk dry-run down              # what would mmk down undo?
npx mmk dry-run down --steps 2    # what would the last two be?
```

## What it does

It works out the same list of files the real command would, prints it, and stops. It reads the
history, but never writes and never takes the lock, so it's safe against production even while a
deploy is running.

```text
$ npx mmk dry-run up
Loaded config from mmk.config.js
◎ Dry-run  Would apply: 3
┌─────────────────────────────────────────────┬─────────┬───────┬────────────┬──────────┬────────┐
│ Migration                                   │ Status  │ Batch │ Applied At │ Checksum │ Author │
├─────────────────────────────────────────────┼─────────┼───────┼────────────┼──────────┼────────┤
│ 20261012090000-add-users-email-index.js     │ pending │       │            │ —        │        │
├─────────────────────────────────────────────┼─────────┼───────┼────────────┼──────────┼────────┤
│ 20261012091500-backfill-order-status.js     │ pending │       │            │ —        │        │
├─────────────────────────────────────────────┼─────────┼───────┼────────────┼──────────┼────────┤
│ 20261014103000-add-orders-customer-index.js │ pending │       │            │ —        │        │
└─────────────────────────────────────────────┴─────────┴───────┴────────────┴──────────┴────────┘
```

```text
$ npx mmk dry-run down --steps 2
◎ Dry-run  Would revert: 2
┌─────────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬──────────┐
│ Migration                                   │ Status  │ Batch │ Applied At          │ Checksum │ Author   │
├─────────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┤
│ 20261014103000-add-orders-customer-index.js │ applied │ 3     │ 2026-10-15 22:47:26 │ ok       │ Asha Rao │
├─────────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┤
│ 20261012091500-backfill-order-status.js     │ applied │ 2     │ 2026-10-15 22:47:26 │ ok       │ Asha Rao │
└─────────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴──────────┘
```

For `down`, the rows are in the order they'd be undone.

Because it predicts the real command, it also fails when the real command would. For example, with
a [namespace](/guide/shared-database) whose older records haven't been adopted yet, it refuses with
`NAMESPACE_UNADOPTED` instead of listing applied migrations as pending.

## Options

| Option | What it does |
| --- | --- |
| `up` or `down` | Required. Which command to preview. |
| `[file]` | Preview just this file. |
| `--steps <n>` | With `down`: preview undoing the last `n` files. |
| `--json` | Print the rows as JSON. |

The [global flags](/guide/configuration#command-line-flags) work here too.

::: tip Make it a habit
Put `npx mmk dry-run up` right before `npx mmk up` in your deploy job. It costs a second, and the job
log then shows exactly what was about to run.
:::
