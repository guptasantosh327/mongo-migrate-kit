<!--
SEO target keyword: "mongodb migrations shared database multiple services"
Meta description: When several repos run migrations against one MongoDB database, they share one
history and start stepping on each other. What breaks, how other tools handle it, and the one
setting that fixes it in mongo-migrate-kit.
Published copy: docs/blog/mongodb-migrations-shared-database-many-repos.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Many repos, one MongoDB database: migrations that don't step on each other

Most migration tools assume one app per database. That holds until it doesn't.

At work we're rolling mongo-migrate-kit out to about fifty repos. They don't have fifty databases.
They have three, and one of them is shared by twenty repos across several products. Each repo has
its own `migrations/` folder, and they all point at the same database.

Put twenty repos on one database with a tool that assumes one app, and you don't get an error. You
get something worse: things that look fine and aren't.

## What goes wrong when repos share one history

Every repo writes its records to the same collection (`_mmk_migrations`). The tool can't tell whose
record is whose, so:

1. **`status` shows other repos' migrations.** Your table fills up with files that aren't in your
   repo.
2. **`down` can undo another repo's work.** "Roll back the last batch" means the last batch in the
   collection, which might belong to the repo that deployed five minutes before you.
3. **A file name one repo applied counts as applied for all of them.** Records are matched by name.
   If two repos ever use the same name (easy with `0001-init.js` style names), the second one never
   runs, and nothing tells you.
4. **Batch numbers mix.** Repo A gets batch 1, repo B batch 2, repo A batch 3. "Batch 2" means
   nothing to either of them.

None of these throw an error. Each one just waits for the wrong deploy.

## How other tools deal with it

None of this is specific to MongoDB, so I looked at how tools in other ecosystems handle it:

| Approach | Who | How it works |
| --- | --- | --- |
| One history table per app | Flyway, Knex, Mongock, golang-migrate, migrate-mongo, TypeORM | Each app gets its own history (and lock). Knex even refuses to run if the table has records for files it can't see. |
| An owner column in one shared table | Django (`app` + `name`), Liquibase (id + author + file) | One table, and every query includes "whose is this?" |
| One database per service | Prisma, Rails, Laravel | No sharing at all. It's an infrastructure decision. |

Separate tables are the most common answer. But with twenty repos on one database, that's twenty
history collections, twenty locks, and no single place to see what ran. Django's approach scales
better: one table, and every row says who owns it.

## The fix: one line per repo

mongo-migrate-kit 1.5 does it the Django way. Each repo on a shared database gets a **namespace**:

```js
// mmk.config.js in the orders-api repo
export default {
  dbName: 'shop',
  namespace: 'orders-api',
};
```

That's all the setup there is. Every record now says which repo it belongs to, and every query
looks only at its own:

![Two repos, each with its own namespace, sharing one database and one lock](https://mongo-migrate-kit.vercel.app/diagrams/png/shared-database.png)

All four problems go away:

- `mmk status` shows only this repo's migrations. `mmk status --all-namespaces` shows everyone's.
- `mmk down` undoes this repo's last batch, never another repo's.
- Batch numbers count per namespace.
- Two repos using the same file name is an error, not a silent skip.

It doesn't add collections, however many repos join. Twenty repos is still one history and one
lock.

![mmk status in orders-api shows only its own migration; mmk status --all-namespaces shows both repos](https://mongo-migrate-kit.vercel.app/gifs/namespaces.gif)

## Which setup do you have?

| Your setup | What to set |
| --- | --- |
| One repo, its own database | Nothing. [You can ignore namespaces.](./11-mongo-migrate-kit-single-repo-no-namespace.md) |
| Several repos, one database, one team | [`namespace` in each repo](./12-multiple-repos-same-mongodb-database-migrations.md) |
| Several products sharing a database | [`migrationsCollection` per product and `namespace` per repo](./13-several-products-one-mongodb-database.md) |
| A monorepo with several services | [One namespace per service](./18-mongodb-migrations-monorepo-nodejs.md) |

## The rules that matter

- **Treat the namespace as permanent.** It decides which migrations count as applied. Change it and
  every migration looks pending. mmk notices and refuses to run (see
  [the mistakes mmk catches](./17-mongodb-migration-namespace-mistakes.md)).
- **Put it in the repo's config file**, not in an `MMK_NAMESPACE` on a shared CI runner. That would
  give every repo built there the same one.
- **Every repo on the database needs 1.5 or newer.** Older versions don't know about namespaces and
  see everyone's records.
- **Keep timestamped file names** (the default). Names must be unique within one history collection.
- **MongoDB 4.2 or newer.**

## The rest of the series

This post is the starting point for a series on shared databases:

- [One repo, one database? You can ignore namespaces](./11-mongo-migrate-kit-single-repo-no-namespace.md)
- [Several repos, one MongoDB database, one team](./12-multiple-repos-same-mongodb-database-migrations.md)
- [Several products in one MongoDB database](./13-several-products-one-mongodb-database.md)
- [Rolling out mongo-migrate-kit to 50 repos](./14-rolling-out-mongodb-migrations-50-microservices.md)
- [Adding a namespace to a repo that already ran migrations](./15-add-namespace-existing-repo-migrations.md)
- [How locking works when 20 repos share one database](./16-mongodb-migration-lock-multiple-services.md)
- [The namespace mistakes mongo-migrate-kit catches for you](./17-mongodb-migration-namespace-mistakes.md)
- [MongoDB migrations in a monorepo](./18-mongodb-migrations-monorepo-nodejs.md)
- [Leaving migrate-mongo when several repos shared its changelog](./19-migrate-mongo-shared-changelog-multiple-services.md)
- [`service` is deprecated, use `namespace`](./20-mongo-migrate-kit-service-vs-namespace.md)

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk init --namespace orders-api
```

More in the docs: [Sharing a database](https://mongo-migrate-kit.vercel.app/guide/shared-database). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Why I built a new MongoDB migration tool](./01-why-i-built-mongo-migrate-kit.md), where
  mongo-migrate-kit came from.
- [Locking MongoDB migrations so two deploys can't collide](./06-mongodb-migration-locking-concurrent-deploys.md),
  the lock every repo on a database shares.
