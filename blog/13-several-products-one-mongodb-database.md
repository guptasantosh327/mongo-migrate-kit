<!--
SEO target keyword: "mongodb migration collection per service"
Meta description: When several products or teams share one MongoDB database, give each product its
own history collection and each repo its own namespace. The rule of thumb, the setup, and how to
lock down permissions.
Requires mongo-migrate-kit 1.5. Publish after 1.5.0 is on npm.
-->

# Several products in one MongoDB database

[Several repos owned by one team](./12-multiple-repos-same-mongodb-database-migrations.md) can share
one migration history. Each repo sets a `namespace`, and you're done.

But databases often outgrow one team. A `commerce` database might hold checkout, payments and the
product catalog, built by different teams, deployed on different schedules, with different people
on call. Sharing one history across all of them works, but it isn't always what you want.

## Two settings, two questions

mongo-migrate-kit has two settings that look similar but answer different questions:

| Setting | Question it answers | Typical value |
|---|---|---|
| `namespace` | *Whose migration is this?* | one per **repo** |
| `migrationsCollection` | *Who shares a history?* | one per **product or team**, only if needed |

A namespace separates repos *inside* a collection. A collection separates groups of repos
completely, even at the permission level, because MongoDB grants access per collection.

**Rule of thumb: a namespace per repo, always. A separate collection only where ownership or access
differs.**

## The setup

Checkout has two repos, catalog has one:

```js
// checkout-api/mmk.config.js
export default {
  dbName: 'commerce',
  migrationsCollection: '_mmk_migrations_checkout', // product
  namespace: 'checkout-api',                        // repo
};

// payments-worker/mmk.config.js
export default {
  dbName: 'commerce',
  migrationsCollection: '_mmk_migrations_checkout',
  namespace: 'payments-worker',
};

// catalog-api/mmk.config.js
export default {
  dbName: 'commerce',
  migrationsCollection: '_mmk_migrations_catalog',
  namespace: 'catalog-api',
};
```

After each repo runs `mmk up`, the database has these mmk collections:

```text
_mmk_locks, _mmk_meta, _mmk_migrations_catalog, _mmk_migrations_checkout
```

One history per product, one lock for everyone, and `_mmk_meta`: a single document that lets an
older mongo-migrate-kit refuse to run against data it would misread.

## Each product sees its own world

`mmk status --all-namespaces` shows every namespace **in this repo's collection**. From
`checkout-api` you see the checkout product and nothing else:

```text
$ npx mmk status --all-namespaces
┌─────────────────┬──────────────────────────────────────────┬─────────┬───────┬─────────────────────┬────────────────────────┐
│ Namespace       │ Migration                                │ Status  │ Batch │ Applied At          │ Author                 │
├─────────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ checkout-api    │ 20261002090000-create-carts.js           │ applied │ 1     │ 2026-10-02 09:00:01 │ Priya <priya@shop.dev> │
├─────────────────┼──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼────────────────────────┤
│ payments-worker │ 20261002093000-create-payment-intents.js │ applied │ 1     │ 2026-10-02 09:30:01 │ Priya <priya@shop.dev> │
└─────────────────┴──────────────────────────────────────────┴─────────┴───────┴─────────────────────┴────────────────────────┘
```

From `catalog-api`, the same command shows only `catalog-api`.

## The lock is still database-wide

Products have separate histories but **one lock**. Checkout and catalog never migrate the
`commerce` database at the same time. If both deploy at once, one gets `LOCK_ALREADY_HELD` naming
the other, and re-runs.

That's deliberate. Two products' migrations can touch the same data (a shared `users` collection,
an index build that loads the server), and "one run at a time per database" is the one rule that
can't be configured wrong. Most runs take seconds, so taking turns costs little. More in
[how locking works when 20 repos share one database](./16-mongodb-migration-lock-multiple-services.md).

Keep `lockCollection` at its default in every repo. A repo with a different one quietly stops
taking turns.

## Locking down permissions

The real reason to split collections is access. If checkout's deploy user shouldn't be able to
write catalog's history, give it a role that covers only what it needs. This one can run `up`,
`status` and `down` for checkout, and gets `Unauthorized` if it even reads catalog's history:

```js
use commerce
db.createRole({
  role: 'checkoutMigrator',
  privileges: [
    // checkout's own history
    { resource: { db: 'commerce', collection: '_mmk_migrations_checkout' },
      actions: ['find', 'insert', 'update', 'createIndex', 'createCollection'] },
    // the shared lock and storage-format marker
    { resource: { db: 'commerce', collection: '_mmk_locks' },
      actions: ['find', 'insert', 'update', 'remove', 'createCollection'] },
    { resource: { db: 'commerce', collection: '_mmk_meta' },
      actions: ['find', 'insert', 'update', 'createCollection'] },
    // ...plus whatever checkout's migrations change, e.g.:
    { resource: { db: 'commerce', collection: 'carts' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex', 'dropIndex', 'createCollection'] },
  ],
  roles: [],
});
```

Two things to know:

- mmk creates its index on the changelog when it connects, so even `mmk status` needs write access to
  the history collection. A read-only user can't run mmk.
- Every product needs access to the **same** `_mmk_locks`. That's how they take turns.

## File names are unique per collection

Records are unique by file name within a collection. With timestamped names (the default) that never
comes up. If a repo insists on `sequential` names (`0001-init.js`), give it its own collection. Two
repos' `0001-init.js` in one collection is a clash, and mmk refuses to run.

## In short

| Your setup | Configure |
|---|---|
| Several repos, one team | `namespace` per repo |
| Several products or teams | `migrationsCollection` per product, and `namespace` per repo |
| Permissions per service, or `sequential` names | `migrationsCollection` per repo |

Start with namespaces. Add a collection boundary only where a team or permission boundary already
exists.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk init --namespace checkout-api
# then set migrationsCollection: '_mmk_migrations_checkout' in mmk.config.js
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/shared-database** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Many repos, one MongoDB database](./10-mongodb-migrations-shared-database-many-repos.md): the
  overview of the whole series.
- [Rolling out mongo-migrate-kit to 50 repos](./14-rolling-out-mongodb-migrations-50-microservices.md):
  how to plan collections and namespaces for a whole company.
