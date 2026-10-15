---
title: mmk namespace adopt
description: Move a repo's existing migration records into its new namespace with mmk namespace adopt, when several repos share one MongoDB database.
---

# mmk namespace adopt

Moves this repo's older records, from before it had a [namespace](/guide/shared-database), into its
namespace. You run it once.

```bash
npx mmk namespace adopt [options]
```

::: tip You probably don't need this
New repos never need it. And an existing repo can also stay without a namespace. This is only for
an existing repo that you've decided to give a namespace.
:::

## Why it exists

Say `orders-api` ran migrations for a year, then you added `namespace: 'orders-api'` to its config.
Its old records have no namespace. In the new namespace, those migrations would look pending, and
`mmk up` would run them all again.

So mmk refuses until you move them. Every command whose answer depends on what's applied stops with
`NAMESPACE_UNADOPTED`: `up`, `down`, `redo`, `import`, `dry-run`, `list --pending`, `list --applied`
and `pendingMigrations()`. `status` and `list` still work, and mark those rows `unadopted`.

## Usage

Always look at the dry run first:

```bash
npx mmk namespace adopt --dry-run
```

```text
Namespace: orders-api
◎ Dry-run  Would adopt 2 record(s) into namespace "orders-api"
┌─────────────────────────────────────────┬─────────┬───────┬─────────────────────┬─────────────┬────────────┐
│ Migration                               │ Status  │ Batch │ Applied At          │ Executed By │ Service    │
├─────────────────────────────────────────┼─────────┼───────┼─────────────────────┼─────────────┼────────────┤
│ 20261001090000-create-orders-indexes.js │ applied │ 1     │ 2026-10-01 09:00:02 │ deploy      │ orders-api │
│ 20261001093000-backfill-order-totals.js │ applied │ 1     │ 2026-10-01 09:00:05 │ deploy      │ orders-api │
└─────────────────────────────────────────┴─────────┴───────┴─────────────────────┴─────────────┴────────────┘
```

`Executed By` and `Service` help you check that these records really are this repo's. Then:

```bash
npx mmk namespace adopt
```

## What moves

- Records with **no namespace** whose file is in this repo's migrations folder, whatever their status.
- Nothing else. Records without a file here stay where they are. The result tells you how many
  (`leftInDefault`).
- Only within the current `migrationsCollection`.

::: warning One repo at a time
If two repos ever had a file with the same name, there's only one record for it, and whichever repo
adopts first takes it. The other one then gets `MIGRATION_NAME_CONFLICT`. Read the dry run before
you adopt, especially the `Executed By` and `Service` columns.
:::

## Options

| Option | What it does |
| --- | --- |
| `--dry-run` | Show what would move, write nothing. |
| `--no-lock` | Don't take the lock. Only for local development. |
| `--json` | Print `{ namespace, rows, adopted, leftInDefault, dryRun }`. |

It needs a `namespace` in the config (or `MMK_NAMESPACE`). Without one, it stops with
`INVALID_ARGUMENT`.

## From code

```ts
const result = await migrator.adopt({ dryRun: true }); // AdoptResult
```
