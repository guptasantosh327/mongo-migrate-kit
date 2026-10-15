---
title: Sharing a database
description: Run mongo-migrate-kit from several repos against one MongoDB database. One namespace per repo keeps each repo's migration history separate, with one shared lock.
---

# Sharing a database

<p class="page-meta">Step 4 of the learning path · read when you need it</p>

::: tip One repo, one database?
Then you can skip this page. Without a `namespace`, nothing on this page applies to you, and nothing
about your setup changes when you upgrade.
:::

Sometimes several repos write to the same database. An `orders-api` and a `billing` service share a
`shop` database, say, and each has its own `migrations/` folder. Give each repo a `namespace` in its
config. That's the whole setup:

```js
// orders-api/mmk.config.js
export default {
  uri: process.env.MONGO_URL,
  dbName: 'shop',
  namespace: 'orders-api',
};
```

```js
// billing/mmk.config.js
export default {
  uri: process.env.MONGO_URL,
  dbName: 'shop',
  namespace: 'billing',
};
```

<Diagram name="shared-database" />

## Why you need it

Without namespaces, every repo on the database shares one history. That causes real problems:

- `mmk status` in one repo lists the other repos' migrations.
- `mmk down` in one repo can roll back **another repo's** last batch.
- If two repos have a file with the same name, the second one never runs.
- Batch numbers from different repos mix, and stop meaning anything.

With a namespace, each repo's records carry its name, and every command only looks at its own. The
collections are still shared. A namespace never creates new ones.

## What you see

In `orders-api`, `mmk status` starts with a `Namespace:` line and shows only that repo's migrations.
`--all-namespaces` shows everyone's, read-only:

<Cast name="namespaces" alt="Terminal in orders-api: mmk status shows Namespace: orders-api and one migration; mmk status --all-namespaces shows the billing and orders-api migrations side by side" />

The records themselves get one extra field:

```js
{ namespace: 'orders-api', name: '20261014103000-add-orders-customer-index.js', batch: 1, status: 'applied', … }
{ namespace: 'billing',    name: '20261013080000-add-invoices-index.js',        batch: 1, status: 'applied', … }
```

Batch numbers count per namespace, so each repo has its own batch 1.

## Repos take turns

Every repo on a database uses **the same lock**, whatever its namespace. Two migration runs never
touch the database at the same time, which is the safest option and needs no setup.

When a run finds the lock busy, it stops at once and names the holder, including its namespace:

```text
✖ LOCK_ALREADY_HELD: The migration lock is held by namespace "orders-worker"
  Holder: host worker-7c9f, pid 41, user deploy, since 2026-10-14 12:00:03 (8s ago)
  Why: all repos on this database take turns — one migration run at a time
  If the holder crashed, the lock frees itself at 2026-10-14 12:01:03; `mmk unlock` releases it now (check the holder first)
  Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))
```

In CI, re-run the job. If you migrate on app start, `runMigrations({ onLockHeld: 'wait' })` waits
for its turn.

Each repo's own `lockTTLSeconds` is respected, and staleness is judged by the database server's
clock. A repo with a short TTL can't steal the lock from one with a long TTL, and a machine with a
wrong clock can't mistake a fresh lock for an old one.

## The rules

- **Set the namespace once and never change it.** It decides which migrations count as applied.
  Change it and every migration looks pending. (mmk notices and refuses to run. See below.)
- **Put it in the repo's config file.** Not in a CI-wide `MMK_NAMESPACE`, which would give every repo
  built on that runner the same one.
- **Keep timestamped file names** (the default). `0001-` style names clash between repos.
- **Every repo on the database needs mongo-migrate-kit 1.5 or newer.** Older versions don't know
  about namespaces and see everyone's records.
- **Use the same `lockCollection` everywhere** (the default is fine). A repo with a different one
  stops taking turns with the others.
- **MongoDB 4.2 or newer.**
- **Monorepo?** One namespace per folder that has its own migrations, each with its own config:
  `npx mmk --config services/orders/mmk.config.js up`.

With a namespace set, mmk also keeps one small document in a `_mmk_meta` collection. It records the
storage format, so an older mmk version refuses to run against data it would misread. If your
deploy user has tight permissions, give it read and write access to `_mmk_migrations`, `_mmk_locks`
and `_mmk_meta`. Repos without a namespace never create `_mmk_meta`.

## Separate products in one database

If whole products or teams share a database, you can also give each group its own history
collection with `migrationsCollection`, and still use a namespace per repo:

```js
// checkout-api/mmk.config.js
export default {
  uri: process.env.MONGO_URL,
  dbName: 'commerce',
  migrationsCollection: '_mmk_migrations_checkout', // the product
  namespace: 'checkout-api',                        // the repo
};
```

Only do this when ownership or access really differs. MongoDB grants permissions per collection, so
it's the one way to stop one team's deploy user from writing to another team's history.

| Your setup | What to set |
| --- | --- |
| One repo, its own database | Nothing |
| Several repos, one database, one team | `namespace` in each repo |
| Several products in one database | `migrationsCollection` per product, and `namespace` per repo |
| Strict per-service permissions, or `sequential` file names | `migrationsCollection` per repo |

## Adding a namespace to a repo that already ran migrations

New repos never need this. If the namespace is set before the first `mmk up`, you're done.

It only matters for a repo that ran migrations **before** it had a namespace, for example the first
repo on a database that others joined later. Its records have no namespace. You have two options:

**Leave it as it is.** Records without a namespace belong to the "default" namespace, which works
fine alongside the named ones. Nothing to do.

**Give it a namespace too**, so every repo follows the same rule. After you set it, mmk refuses
`up`, `down` and `redo` until the old records are moved over (otherwise they'd look pending and run
again). Move them once:

```bash
npx mmk namespace adopt --dry-run   # which records would move, and who ran them
npx mmk namespace adopt             # move them
```

Only records whose file is in this repo's migrations folder move. If several repos already shared
one history without namespaces, do this **one repo at a time**, and read each dry run first. See
[`mmk namespace adopt`](/commands/namespace).

## Mistakes mmk catches

| Situation | What happens |
| --- | --- |
| A namespace was set, but the repo's older records have none | `NAMESPACE_UNADOPTED`: run `mmk namespace adopt`. Commands that depend on what's applied refuse until then. `status` and `list` still work and mark those rows `unadopted`. |
| The namespace was changed or mistyped | `MIGRATION_NAME_CONFLICT`: "These N files are recorded under namespace … Did the namespace change?" Nothing runs. |
| Two repos used the same file name | `MIGRATION_NAME_CONFLICT`, naming the other namespace. Nothing runs. |
| Applied records have no file in this repo | `mmk status` ends with one info line. Nothing is blocked. |
| A newer mmk wrote the database in a newer format | `SCHEMA_TOO_NEW` when connecting: upgrade this repo. |

## Next

[Moving from migrate-mongo](/guide/migrate-mongo) shows how to bring an existing project over
without running anything twice.
