# Sharing a Database

When several repos run migrations against the **same database**, give each repo a `namespace`.
That's the whole setup — one line per repo.

```js
// every repo on a shared database — the only new line is `namespace`
export default {
  uri: process.env.MONGO_URI,
  dbName: 'shop',
  namespace: 'orders-api',
};
```

::: tip One repo, one database?
You don't need any of this. Without a `namespace`, mongo-migrate-kit behaves exactly as before — same
config, same records, same output.
:::

## Why you need it

Without namespaces, every repo on a database shares one migration history (`_mmk_migrations`), so:

- `mmk status` shows other repos' migrations.
- A plain `mmk down` can target **another repo's** last batch.
- A filename one repo already applied is treated as applied in another repo.
- Batch numbers interleave across repos and stop meaning anything.

With a `namespace`, each repo's records carry its namespace and every query is scoped to it. Repos
still share the same collections — a namespace never creates new ones.

## What it looks like

Three repos on the `shop` database, each with its own `namespace`:

```
database: shop
├── _mmk_migrations      namespaces: orders-api, orders-worker, notifications
└── _mmk_locks           one lock for the whole database
```

```js
// _mmk_migrations — one new field, `namespace`; everything else is unchanged
{ namespace: 'orders-api',    name: '20261001090000-create-orders-indexes.js', batch: 1, status: 'applied', … }
{ namespace: 'notifications', name: '20261003120000-create-templates.js',      batch: 1, status: 'applied', … }
{ namespace: 'orders-worker', name: '20261005080000-create-job-queue.js',      batch: 1, status: 'applied', … }
```

- **Batch numbers are per namespace** — each repo has its own batch 1, and `mmk down` reverts this
  repo's last batch only.
- **`mmk status` shows only this repo's migrations.** `mmk status --all-namespaces` shows every
  namespace in the collection (read-only).
- **Records without a namespace** belong to the default namespace — that's every record written
  before you set one, and every repo that doesn't set one.

## Locking: repos take turns

Every repo on a database takes the **same** lock, whatever its namespace. So no two migration runs
ever touch a database at the same time — the strictest guarantee, with nothing to configure.

If a run finds the lock busy, it fails immediately and names the holder:

```
✖ LOCK_ALREADY_HELD: The migration lock is held by namespace "orders-worker"
  Holder: host worker-7c9f, pid 41, user deploy, since 2026-10-14 12:00:03 (8s ago)
  Why: all repos on this database take turns — one migration run at a time
  If the holder crashed, the lock frees itself at 2026-10-14 12:01:03; `mmk unlock` releases it now (check the holder first)
  Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))
```

In CI, re-run the pipeline. If you migrate on app start, [`runMigrations({ onLockHeld: 'wait' })`](/guide/api)
waits for its turn instead.

Each holder's own `lockTTLSeconds` is respected: a repo with a short TTL can't take over the lock from
a repo with a long one, and staleness is judged on the database server's clock, so a machine whose
clock is off can't mistake a fresh lock for a stale one.

## Several products in one database (optional)

If different **products or teams** share a database, you can also give each group its own changelog
collection with the existing `migrationsCollection` setting — and still a `namespace` per repo:

```js
// checkout-api/mmk.config.js
export default {
  uri: process.env.MONGO_URI,
  dbName: 'commerce',
  migrationsCollection: '_mmk_migrations_checkout', // product
  namespace: 'checkout-api',                        // repo
};
```

Use a separate collection only where **ownership or access** differs: MongoDB grants permissions per
collection, so it's the only way to stop one team's deploy user from writing another team's history.

| Your setup | Configure |
|---|---|
| One repo, own database | Nothing |
| Several repos, one database, one team | `namespace` per repo |
| Several products sharing a database | `migrationsCollection` per product + `namespace` per repo |
| Database permissions per service, or `sequential` filenames | `migrationsCollection` per repo |

## Rules

- **Treat the namespace as permanent.** It decides which migrations count as applied — changing it
  makes every migration look pending. mmk refuses to run if it spots this (see below).
- **Put it in each repo's config file**, not in a CI-runner or organisation-level `MMK_NAMESPACE`,
  which would give every repo built there the same namespace.
- **Use timestamped filenames** (the default). Filenames must be unique within a changelog
  collection; `sequential` names (`0001-init.js`) clash between repos, so repos using them need their
  own `migrationsCollection`.
- **Every repo on the database must run mongo-migrate-kit 1.5 or newer.** Older versions don't know
  about namespaces and see every repo's records.
- **Keep the same `lockCollection` in every repo** (the default `_mmk_locks`). A repo with a different
  one stops taking turns with the others.
- **Monorepos:** one namespace per service folder that has its own migrations, each with its own
  config file (`mmk --config services/orders/mmk.config.js up`).
- Requires MongoDB server **4.2 or newer**.
- With a namespace, mmk also keeps one document in a small **`_mmk_meta`** collection recording the
  storage format, so an older mongo-migrate-kit refuses to run against data it would misread. If your
  deploy user has narrowly scoped permissions, grant it read/write on `_mmk_migrations` (or your
  `migrationsCollection`), `_mmk_locks` and `_mmk_meta`. Repos without a namespace never create it.

## Adding a namespace to a repo that already ran migrations

**New repos never need this.** A repo that has its `namespace` set before its first `mmk up` is done —
there is nothing to move.

It only matters for an **existing** repo whose migrations ran before it had a namespace — for
example, a repo that had the database to itself until other repos joined. Its records have no
namespace, so you have two choices:

- **Leave it without a namespace.** The repo that had the database first may stay as it is: its
  records belong to the default namespace, which coexists safely with the named namespaces of the
  repos that join later. Zero extra steps.
- **Give it a namespace too** — for example, so every repo follows the same naming rule. After you
  set it, mmk refuses `up`/`down`/`redo` until this repo's records are moved into it (otherwise they
  would look pending and run a second time). Move them once:

  ```bash
  mmk namespace adopt --dry-run   # preview: which records move, who ran them
  mmk namespace adopt             # move them
  ```

  Only records whose file is in this repo's migrations folder move; the rest stay where they are.
  If several repos already shared one changelog without namespaces, do this **one repo at a time**
  and read each dry run first. See [`mmk namespace adopt`](/commands/namespace).

## Mistakes mmk catches

| Situation | What happens |
|---|---|
| A namespace was set, but older records have none yet | `NAMESPACE_UNADOPTED` — run `mmk namespace adopt`. Every command that answers "what's applied or pending" refuses until then (`up`, `down`, `redo`, `import`, `dry-run`, `list --pending/--applied`, `pendingMigrations()`); `status` and `list` show those rows as `unadopted` |
| The namespace was changed or mistyped | `MIGRATION_NAME_CONFLICT`: "These N files are recorded under namespace … Did the namespace change?" — nothing runs |
| Two repos used the same filename | `MIGRATION_NAME_CONFLICT` naming the other namespace — nothing runs |
| Applied records have no file in this repo (deleted, or a copied config) | `mmk status` ends with one info line; nothing is blocked |
| A newer mongo-migrate-kit wrote the database in a newer format | `SCHEMA_TOO_NEW` on connect — upgrade this repo |
