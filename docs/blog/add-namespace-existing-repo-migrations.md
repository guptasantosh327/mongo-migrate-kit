---
title: "Adding a namespace to a repo that already ran migrations"
description: "Your repo ran migrations before it had a namespace, and now its database is shared. Here's how mongo-migrate-kit protects you from re-running them, and how to move the old records over with one command."
date: 2026-10-16
author: Santosh Gupta
order: 15
---

# Adding a namespace to a repo that already ran migrations

New repos on a shared database set a `namespace` before their first `mmk up`, and there's nothing
more to do. This post is for the other case: a repo that has been running migrations for months, and now
needs a namespace.

Typically it's the repo that had the database to itself until other repos joined. Or, as in the
example below, two repos that already shared a changelog before namespaces existed.

## First: you might not need to do anything

Records without a namespace belong to the **default namespace**, and the default works alongside
named ones. If your repo was on the database first, it can simply **stay without a namespace** while
every repo that joins later sets one. No steps at all, and that's a perfectly good place to stay.

Read on if you want this repo to have a namespace too, so every repo follows the same naming rule.

## Before you start

**Upgrade every repo on the database to 1.5 or newer first.** Older versions don't know about
namespaces, and after the move they'd see a history they can't make sense of.

## The example

Two repos, `billing` and `invoices`, have been sharing the `payments` database without namespaces.
Look at the batch numbers: `billing` ran first (batch 1), then `invoices` (batch 2). That mixing is
exactly what namespaces fix:

```js
{ name: '20260601090000-create-payments-indexes.js', batch: 1, status: 'applied' }  // billing
{ name: '20260715090000-add-refund-status.js',       batch: 1, status: 'applied' }  // billing
{ name: '20260620090000-create-invoices.js',         batch: 2, status: 'applied' }  // invoices
```

Now `billing` sets `namespace: 'billing'` and adds a new migration.

## mmk refuses to run, on purpose

In the `billing` namespace, those two old records don't exist yet. A simpler tool would see two
"pending" migrations and run them **a second time**. mmk stops instead:

```text
$ npx mmk up
Loaded config from mmk.config.js
Namespace: billing
✖ NAMESPACE_UNADOPTED: 2 migrations in this folder were applied before this repo had a namespace
  Their records have no namespace yet, so in namespace "billing" they would look pending (and `mmk up` would run them a second time)
  Files: 20260601090000-create-payments-indexes.js, 20260715090000-add-refund-status.js
  Preview the move:  mmk namespace adopt --dry-run
  Then move them:    mmk namespace adopt   (into "billing")
  Nothing was run
```

Every command that answers "what's applied or pending?" refuses the same way: `up`, `down`, `redo`,
`import`, `dry-run`, `list --pending`, and `pendingMigrations()` in code. So a deploy check can't be
fooled into thinking those migrations are pending either.

`mmk status` still works, since it's how you look around, and it marks the rows:

```text
$ npx mmk status
Loaded config from mmk.config.js
Namespace: billing
⚠ 2 file(s) here have records from before this repo had a namespace — they are applied, not pending. Run `mmk namespace adopt` to move them into "billing"
┌───────────────────────────────────────────┬───────────┬───────┬────────────┬──────────┬────────┐
│ Migration                                 │ Status    │ Batch │ Applied At │ Checksum │ Author │
├───────────────────────────────────────────┼───────────┼───────┼────────────┼──────────┼────────┤
│ 20260601090000-create-payments-indexes.js │ unadopted │       │            │ —        │        │
├───────────────────────────────────────────┼───────────┼───────┼────────────┼──────────┼────────┤
│ 20260715090000-add-refund-status.js       │ unadopted │       │            │ —        │        │
├───────────────────────────────────────────┼───────────┼───────┼────────────┼──────────┼────────┤
│ 20261012090000-add-payout-schedule.js     │ pending   │       │            │ —        │        │
└───────────────────────────────────────────┴───────────┴───────┴────────────┴──────────┴────────┘
```

## Step 1: preview

```text
$ npx mmk namespace adopt --dry-run
Loaded config from mmk.config.js
Namespace: billing
◎ Dry-run  Would adopt 2 record(s) into namespace "billing"
┌───────────────────────────────────────────┬─────────┬───────┬─────────────────────┬─────────────┬─────────┐
│ Migration                                 │ Status  │ Batch │ Applied At          │ Executed By │ Service │
├───────────────────────────────────────────┼─────────┼───────┼─────────────────────┼─────────────┼─────────┤
│ 20260601090000-create-payments-indexes.js │ applied │ 1     │ 2026-06-01 09:00:03 │ deploy      │ billing │
├───────────────────────────────────────────┼─────────┼───────┼─────────────────────┼─────────────┼─────────┤
│ 20260715090000-add-refund-status.js       │ applied │ 1     │ 2026-07-15 09:00:02 │ deploy      │ billing │
└───────────────────────────────────────────┴─────────┴───────┴─────────────────────┴─────────────┴─────────┘
```

Only records whose **file name is in this repo's migrations folder** can move. The `invoices` record
isn't listed, because there's no such file in `billing`. `Executed By` and `Service` come from the
old records. Read them and make sure these really are this repo's migrations.

## Step 2: move them

```text
$ npx mmk namespace adopt
Loaded config from mmk.config.js
Namespace: billing
✔ Adopted 2 record(s) into namespace "billing"
1 record(s) without a namespace were left as they are — no file with that name is in this repo (deleted long ago, or another repo's)
┌───────────────────────────────────────────┬─────────┬───────┬─────────────────────┬─────────────┬─────────┐
│ Migration                                 │ Status  │ Batch │ Applied At          │ Executed By │ Service │
├───────────────────────────────────────────┼─────────┼───────┼─────────────────────┼─────────────┼─────────┤
│ 20260601090000-create-payments-indexes.js │ applied │ 1     │ 2026-06-01 09:00:03 │ deploy      │ billing │
├───────────────────────────────────────────┼─────────┼───────┼─────────────────────┼─────────────┼─────────┤
│ 20260715090000-add-refund-status.js       │ applied │ 1     │ 2026-07-15 09:00:02 │ deploy      │ billing │
└───────────────────────────────────────────┴─────────┴───────┴─────────────────────┴─────────────┴─────────┘
```

The records keep their batch numbers, dates and checksums. Only the `namespace` field is added. Now
the repo runs normally:

```text
$ npx mmk up
Loaded config from mmk.config.js
Namespace: billing
✔ Applied  20261012090000-add-payout-schedule.js   [1ms]
```

The leftover `invoices` record stays in the default namespace, where `invoices` keeps finding it.
If `invoices` later sets its own namespace, it runs `adopt` the same way.

## When several repos shared one changelog: one at a time

If two repos ever had a migration file with **the same name**, only one record exists, and whichever
repo adopts first takes it. The other then gets `MIGRATION_NAME_CONFLICT`. So:

- Adopt **one repo at a time**.
- **Read every dry run** before running the real thing.
- After the move, **never run a pre-1.5 version** against this database.

## In short

Adding a namespace to an existing repo can't make it re-run old migrations: mmk refuses until the
old records are moved, and moving them is one command you can preview. Or skip all of it: the repo
that had the database first can stay in the default namespace for good.

## Try it

```bash
npx mmk namespace adopt --dry-run
npx mmk namespace adopt
```

More in the docs: [mmk namespace adopt](/commands/namespace). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [The namespace mistakes mongo-migrate-kit catches for you](./mongodb-migration-namespace-mistakes):
  `NAMESPACE_UNADOPTED` and the other safety checks.
- [Many repos, one MongoDB database](./mongodb-migrations-shared-database-many-repos): the
  overview of the series.
