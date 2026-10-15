<!--
SEO target keyword: "multiple repos same mongodb database migrations"
Meta description: Three repos, one MongoDB database, and a migration history that stays separate per
repo. A walkthrough of mongo-migrate-kit namespaces: configs, records, batches, status and locking.
Requires mongo-migrate-kit 1.5. Publish after 1.5.0 is on npm.
-->

# Several repos, one MongoDB database, one team

Here's a common setup: one team, one MongoDB database, and a handful of repos that all change it. An
API, a background worker, a notifications service. Each has its own `migrations/` folder.

This post shows what that looks like with mongo-migrate-kit 1.5. All the output below is from real
runs.

## The setup: one line per repo

Three repos on the `shop` database. Each config is the same except for one line:

```js
// orders-api/mmk.config.js
export default { dbName: 'shop', namespace: 'orders-api' };

// orders-worker/mmk.config.js
export default { dbName: 'shop', namespace: 'orders-worker' };

// notifications/mmk.config.js
export default { dbName: 'shop', namespace: 'notifications' };
```

The connection string comes from `MMK_URI` in each environment, as usual. The namespace goes in the
**committed config file**, because it belongs to the repo, like its name does.

Use lowercase letters, digits, `.`, `_` or `-`. The repo name is the obvious choice.

## Running migrations

Each repo runs `mmk up` as it always did. The only visible change is one extra line at the top:

```text
$ npx mmk up
Loaded config from mmk.config.js
Namespace: orders-api
✔ Applied  20261001090000-create-orders-indexes.js   [1ms]
✔ Applied  20261001093000-backfill-order-totals.js   [1ms]
```

## What's stored

All three repos write to the same `_mmk_migrations` collection. Each record now has a `namespace`:

```js
{
  name: '20261008110000-add-order-status-index.js',
  namespace: 'orders-api',
  batch: 2,
  status: 'applied',
  appliedAt: ISODate('2026-10-08T11:00:02Z'),
  duration: 1,
  checksum: '1ab36b6f9a83…',
  environment: 'production',
  executedBy: 'deploy',
  author: 'Priya <priya@shop.dev>',
}
```

Every question mmk asks the database (what's applied, what's pending, which batch is last) includes
that namespace. Records without one belong to the *default* namespace, which is what you get when
you don't set one.

## Batch numbers are per repo

After `orders-api` deploys twice and the other two once each, the batches look like this:

| Namespace | Migration | Batch |
|---|---|---|
| notifications | 20261003120000-create-templates.js | 1 |
| orders-api | 20261001090000-create-orders-indexes.js | 1 |
| orders-api | 20261001093000-backfill-order-totals.js | 1 |
| orders-api | 20261008110000-add-order-status-index.js | 2 |
| orders-worker | 20261005080000-create-job-queue.js | 1 |

`orders-api` is on batch 2 and the others are on batch 1. So `mmk down` in `orders-api` undoes its
own batch 2, never another repo's work. Without namespaces, those batches would have been numbered 1
to 4 across all three repos, and "the last batch" would belong to whoever deployed last.

## Status: yours, or everyone's

`mmk status` shows only this repo's migrations:

```text
$ npx mmk status
Namespace: orders-api
┌──────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬────────────────────────┐
│ Migration                                │ Status  │ Batch │ Applied At          │ Checksum │ Author                 │
├──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────────────────┤
│ 20261001090000-create-orders-indexes.js  │ applied │ 1     │ 2026-10-01 09:00:02 │ ok       │ Priya <priya@shop.dev> │
├──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────────────────┤
│ 20261001093000-backfill-order-totals.js  │ applied │ 1     │ 2026-10-01 09:00:02 │ ok       │ Priya <priya@shop.dev> │
├──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────────────────┤
│ 20261008110000-add-order-status-index.js │ applied │ 2     │ 2026-10-08 11:00:02 │ ok       │ Priya <priya@shop.dev> │
└──────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴────────────────────────┘
```

When you want the whole picture, say during an incident, add `--all-namespaces`. It only reads:

```text
$ npx mmk status --all-namespaces
┌───────────────┬──────────────────────────────────────────┬─────────┬───────┬─────────────────────┬────────────────────────┐
│ Namespace     │ Migration                                │ Status  │ Batch │ Applied At          │ Author                 │
├───────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ notifications │ 20261003120000-create-templates.js       │ applied │ 1     │ 2026-10-03 12:00:01 │ Priya <priya@shop.dev> │
├───────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ orders-api    │ 20261001090000-create-orders-indexes.js  │ applied │ 1     │ 2026-10-01 09:00:02 │ Priya <priya@shop.dev> │
├───────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ orders-api    │ 20261001093000-backfill-order-totals.js  │ applied │ 1     │ 2026-10-01 09:00:02 │ Priya <priya@shop.dev> │
├───────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ orders-api    │ 20261008110000-add-order-status-index.js │ applied │ 2     │ 2026-10-08 11:00:02 │ Priya <priya@shop.dev> │
├───────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ orders-worker │ 20261005080000-create-job-queue.js       │ applied │ 1     │ 2026-10-05 08:00:01 │ Priya <priya@shop.dev> │
└───────────────┴──────────────────────────────────────────┴─────────┴───────┴─────────────────────┴────────────────────────┘
```

Here's the same thing recorded, with a second repo (`billing`) on the database:

![mmk status in orders-api shows only its own migration; mmk status --all-namespaces shows both repos](https://mongo-migrate-kit.vercel.app/gifs/namespaces.gif)

## Repos take turns

The three repos share one history collection and one lock. So if `orders-worker` is in the middle of
a deploy when `orders-api` starts, `orders-api` stops and tells you exactly who it's waiting for:

```text
✖ LOCK_ALREADY_HELD: The migration lock is held by namespace "orders-worker"
  Holder: host worker-7c9f, pid 41, user deploy, since 2026-10-15 19:09:17 (4s ago)
  Why: all repos on this database take turns — one migration run at a time
  If the holder crashed, the lock frees itself at 2026-10-15 19:10:17; `mmk unlock` releases it now (check the holder first)
  Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))
```

In CI, re-run the job. The full story is in
[how locking works when 20 repos share one database](./16-mongodb-migration-lock-multiple-services.md).

## Four rules

1. **Never change a repo's namespace.** It decides what counts as applied. If it changes, mmk
   refuses to run instead of running everything again.
2. **Every repo on the database runs mongo-migrate-kit 1.5 or newer.** Older versions see everyone's
   records.
3. **Keep the default `lockCollection` everywhere.** A repo with a different one stops taking turns.
4. **Keep timestamped file names** (the default). Names must be unique within the collection, and
   `sequential` names like `0001-init.js` clash between repos.

## In short

One shared collection, one shared lock, and one line of config per repo. Each repo sees its own
history, rolls back its own batches, and waits its turn.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk init --namespace orders-api
```

The full guide is at **https://mongo-migrate-kit.vercel.app/guide/shared-database**. The package is
**mongo-migrate-kit** on npm and GitHub.

---

### Related reading

- [Many repos, one MongoDB database](./10-mongodb-migrations-shared-database-many-repos.md): why
  shared histories break, and how other tools handle it.
- [Several products in one MongoDB database](./13-several-products-one-mongodb-database.md): when
  one team becomes several.
