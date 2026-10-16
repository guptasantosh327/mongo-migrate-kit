---
title: "MongoDB migrations in a monorepo: one namespace per service"
description: "Running MongoDB migrations in a monorepo where several services each have their own migrations folder: one config and one namespace per service, where to run mmk from, and the path mistake that makes it quietly find nothing."
date: 2026-10-16
author: Santosh Gupta
order: 18
---

# MongoDB migrations in a monorepo: one namespace per service

In a monorepo, "one repo" stops being a useful unit. A single repo might hold an orders service and a
billing service, each with its own `migrations/` folder, deployed separately, and quite possibly
sharing one MongoDB database.

Migration tools don't really care about repos. They care about **migration sets**: one folder of
migration files that are run together. A monorepo with two services has two migration sets, and
each needs its own history.

## The layout

```text
shop-monorepo/
├── package.json                  (workspaces: services/*)
└── services/
    ├── orders/
    │   ├── package.json          "migrate": "mmk up"
    │   ├── mmk.config.js
    │   └── migrations/
    └── billing/
        ├── package.json          "migrate": "mmk up"
        ├── mmk.config.js
        └── migrations/
```

One config file per service, next to its migrations:

```js
// services/orders/mmk.config.js
export default { dbName: 'shop', namespace: 'shop-orders' };

// services/billing/mmk.config.js
export default { dbName: 'shop', namespace: 'shop-billing' };
```

If the services use **separate databases**, you don't need namespaces at all. Each database has one
history. If they **share a database**, give each service a namespace, exactly as you would two
separate repos.

## Run mmk from the service's folder

This is the part that catches people out. Run each service's migrations **from that service's
folder**:

```bash
cd services/orders && npx mmk up
# or, with npm workspaces, from the root:
npm run migrate -w services/orders
```

npm runs a workspace's script inside the workspace folder, so both do the same thing.

What you should *not* do is run it from the root and point at the config file:

```text
$ npx mmk --config services/orders/mmk.config.js up
Loaded config from mmk.config.js
Namespace: shop-orders
⚠ Migrations directory not found: /shop-monorepo/migrations — set it with --dir <path>, the MMK_MIGRATIONS_DIR environment variable, or "migrationsDir" in your config file
Nothing to migrate
```

`migrationsDir` (default `./migrations`) and the `.env` file are resolved from **the folder you run
mmk in**, not from where the config file lives. From the root, mmk looks for `/shop-monorepo/migrations`,
finds nothing, and reports "Nothing to migrate". It does warn you, but in a busy CI log that's easy
to miss, and a deploy step that migrated nothing still exits 0.

If you really want to run from the root, make the path explicit in the config:

```js
// services/orders/mmk.config.js, when run from the monorepo root
export default {
  dbName: 'shop',
  namespace: 'shop-orders',
  migrationsDir: 'services/orders/migrations',
};
```

But then the config only works from the root. Pick one place to run from and stick to it;
the service folder is the one that works with workspace scripts, Docker builds and local `cd`.

## Why the namespace isn't taken from `package.json`

Each service already has a name in its `package.json` (`@shop/orders`). Why not use that as the
namespace automatically?

Because the namespace decides which migrations count as applied. If it came from the package name,
then renaming the package, a harmless refactor, would make every migration look pending. And the value
would depend on *how* mmk was started: run through a script in the root `package.json`, npm reports
the root package's name, not the service's.

So mongo-migrate-kit never guesses a namespace. You write it once, in the config file, and it never
changes by accident.

## One namespace per migration set, not per package

A namespace belongs to a **migrations folder**, not to a deployable. If two services share one
migrations folder (say, an API and a worker built from the same package), they're one migration set
and share one namespace. Two folders, two namespaces.

## In short

- One `mmk.config.js` and one namespace per service that has its own migrations.
- Run mmk from the service's folder: `cd`, or `npm run migrate -w services/<name>`.
- `migrationsDir` and `.env` are relative to where you run mmk, not to the config file.
- Write each namespace by hand; never derive it from the package name.

## Try it

```bash
cd services/orders
npx mmk init --namespace shop-orders
npx mmk up
```

More in the docs: [Sharing a database](/guide/shared-database). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Several repos, one MongoDB database, one team](./multiple-repos-same-mongodb-database-migrations):
  the same pattern with separate repos.
- [Many repos, one MongoDB database](./mongodb-migrations-shared-database-many-repos): the
  overview of the series.
