---
title: "Rolling out mongo-migrate-kit to 50 repos"
description: "A practical plan for rolling out one MongoDB migration tool across fifty repos and three shared databases: the inventory, naming rules, configs, CI, and the order that saves you cleanup work."
date: 2026-10-16
author: Santosh Gupta
order: 14
---

# Rolling out mongo-migrate-kit to 50 repos

Installing a migration tool in one repo is an afternoon. Installing it in fifty repos that share
three databases is a project, and the choices you make in the first week decide whether it stays
tidy or turns into cleanup work.

This is the plan I'm using at work: about fifty repos, three MongoDB databases, the busiest of them
shared by twenty repos across several products.

## Step 1: draw the map before anyone installs anything

List every database, the products on it, and the repos that change it:

```text
commerce                      (database)
├── checkout                  (product)
│   ├── checkout-api          (repo)
│   └── payments-worker
├── catalog
│   ├── catalog-api
│   └── catalog-indexer
└── ...

identity
└── accounts
    ├── users-api
    └── auth-service
...
```

This map is the whole design. Each **database** gets one lock. Each **product** gets a changelog
collection, if it needs one. Each **repo** gets a namespace.

## Step 2: write the naming rules down once

| Item | Convention | Example |
|---|---|---|
| Changelog collection | `_mmk_migrations_<product>` | `_mmk_migrations_checkout` |
| Namespace | the repo name | `checkout-api` |
| Lock collection | the default, everywhere | `_mmk_locks` |
| Filenames | timestamped (the default) | `20261002090000-create-carts.js` |

Two of these are easy to get wrong later, so spell them out:

- **Never `sequential` filenames.** `0001-init.js` in two repos sharing a collection is a clash.
- **Never a custom `lockCollection`.** Every repo on a database must use the same one, or they stop
  taking turns.

Only split a product into its own collection where ownership or permissions really differ. If one
team owns a whole database, one collection with a namespace per repo is simpler. See
[several products in one MongoDB database](./several-products-one-mongodb-database).

## Step 3: one config template

Generate each repo's config with its namespace already in it:

```bash
npx mmk init --namespace checkout-api
```

Then set the product's collection. The result, trimmed:

```js
// mmk.config.js (committed)
export default {
  dbName: 'commerce',
  migrationsCollection: '_mmk_migrations_checkout',
  namespace: 'checkout-api',
};
```

The connection string stays out of the file: CI and each environment provide `MMK_URI`.

**Put the namespace in the file, not in the CI environment.** An `MMK_NAMESPACE` set on a shared
runner or at the organisation level gives every repo built there the *same* namespace. It's the one
mistake that quietly undoes the whole design.

## Step 4: release first, roll out second

Order matters more than anything else in this plan:

1. Upgrade to **1.5 or newer** everywhere that will share a database.
2. Then install mmk in new repos **with their namespace from day one**.

Do it in that order and every record is written with its namespace from the very first `mmk up`.
There's nothing to clean up, and `mmk namespace adopt` is never needed.

Do it the other way round (install first, add namespaces later) and every repo has records without
a namespace that have to be moved. [It's doable](./add-namespace-existing-repo-migrations),
but it's work you didn't need to create.

## Step 5: wire up CI

Every repo gets the same two pieces:

```yaml
# deploy job: runs before the new version rolls out
- run: npx mmk up --json
  env:
    MMK_URI: ${{ secrets.MONGO_URI }}
```

```yaml
# gate: fails if this environment still has pending migrations
- run: npx mmk status --check
```

`status --check` exits 1 and says why:

```text
✖ 1 pending migration(s)
```

**A busy lock means "re-run".** All repos on a database take turns, so two pipelines that overlap
will see `LOCK_ALREADY_HELD`, naming the repo that holds it. Nothing is broken. Re-run the job. If
a repo migrates on app start instead, use `runMigrations({ onLockHeld: 'wait' })`, which waits for
its turn ([details](./run-migrations-on-startup-serverless)).

## Step 6: leave the early adopters alone

Repos that used mmk *before* the rollout, each on its own database, need nothing. If their database
becomes shared later, they have two options:

- **Stay without a namespace.** Their records stay in the default namespace, which works alongside
  the named ones. Nothing to do.
- **Follow the naming rule.** Set a namespace, then run `mmk namespace adopt` once.

## The checklist

- [ ] Map: databases, then products, then repos
- [ ] Naming rules written down (collection, namespace, default lock, timestamped files)
- [ ] mongo-migrate-kit 1.5+ in every repo that shares a database
- [ ] `namespace` in each repo's committed config, never on the CI runner
- [ ] `MMK_URI` from CI secrets
- [ ] `mmk up` in the deploy job, before the app rolls out
- [ ] `mmk status --check` as a gate
- [ ] Teams know that `LOCK_ALREADY_HELD` means "re-run"

## In short

A fifty-repo rollout is mostly a naming exercise. Decide databases, products and repos up front,
put the namespace in each repo's config from day one, and the tool takes care of the rest.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk init --namespace <repo-name>
```

More in the docs: [Sharing a database](/guide/shared-database). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Many repos, one MongoDB database](./mongodb-migrations-shared-database-many-repos): the
  problem this rollout is designed around.
- [MongoDB migrations in GitHub Actions](./mongodb-migrations-ci-cd-github-actions):
  the full pipeline, step by step.
