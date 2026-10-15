---
title: FAQ
description: Answers to common questions about MongoDB migrations with mongo-migrate-kit, including running one migration, rolling back, TypeScript, Mongoose, transactions, CI and versions.
---

# FAQ

## What is mongo-migrate-kit?

A tool for running database migrations on MongoDB from Node.js. You write small files with an `up`
and a `down` function, and the `mmk` command runs them in order, records what ran, and can roll any
of them back. It also has a JavaScript API for running migrations from your own code.

## How is it different from migrate-mongo?

They work the same way at heart, so the switch is easy. mmk adds: running a single file, rolling
back an older batch or one file by name, dry runs, `redo`, a lock that's on by default, checksums
that stop you rolling back edited code, hooks, and a history that keeps rolled-back records. You
can bring an existing migrate-mongo history over with `mmk import`. See
[Moving from migrate-mongo](/guide/migrate-mongo).

## How do I run just one migration?

Pass the file name:

```bash
npx mmk up 20261015110000-rename-user-name.js
```

## How do I roll back a migration?

```bash
npx mmk down                 # the last batch (the last `mmk up` run)
npx mmk down <file>          # one file
npx mmk down --batch 3       # batch 3
npx mmk down --steps 2       # the last two files, whatever their batch
```

Add `dry-run` in front (`npx mmk dry-run down`) to see what would happen first. The
[rollback picture](/guide/concepts#batches) shows the difference.

## Does rolling back delete the record?

No. The record's `status` becomes `reverted` and it gets a `revertedAt` date. You can always see the
full history in `_mmk_migrations`.

## Does it work with TypeScript?

Yes. Write `.ts` migrations and import the `MigrationContext` type for full typing. On Node 22.18 or
newer they run as they are. On older Node, run mmk with a loader such as `tsx`, or write `.js` files.
See [Writing migrations → TypeScript](/guide/writing-migrations#typescript).

## Does it work with Mongoose?

Yes. Pass your Mongoose instance in the config (`mongoose: mongoose`) and it shows up as
`ctx.mongoose` in your migrations. That said, it's usually better to use `ctx.db` directly: your
Mongoose models change over time, and a migration should keep working the way it did when you wrote
it.

## Do I need a config file?

No. `MMK_URI` and `MMK_DB` in the environment (or in `.env`) are enough. See
[Configuration](/guide/configuration).

## Can a migration run in a transaction?

Yes. Add `export const useTransaction = true` to the file and pass `session` to each database call.
If the migration throws, everything it wrote is rolled back, and the history record is only saved if
the migration commits. You need a replica set or a sharded cluster (Atlas is always one). See
[Transactions](/guide/transactions).

## What happens if two deploys run migrations at the same time?

One gets the lock and runs. The other stops straight away with `LOCK_ALREADY_HELD` and says who has
the lock. If you run migrations on app start, `runMigrations({ onLockHeld: 'wait' })` makes the
others wait their turn. See [How it works → The lock](/guide/concepts#the-lock).

## What if a deploy dies halfway and leaves the lock behind?

It frees itself after `lockTTLSeconds` (60 seconds by default). If you can't wait, `npx mmk unlock`
removes it after showing you who held it.

## Can I see what will run before it runs?

Yes: `npx mmk dry-run up`. It reads the database but never writes, and doesn't take the lock, so
it's safe against production.

## How do I use it in CI?

Run `npx mmk up` as a step before the app deploys. Use `npx mmk status --check` to fail a job when
migrations are pending, and `--json` when a script needs to read the result. See
[Deploying and CI](/guide/ci-cd).

## Can I run migrations when my app starts?

Yes, with `runMigrations()`. It opens a connection, runs what's pending, and always closes the
connection. See [Running from your code](/guide/api).

## Several services share one database. Will they clash?

Not if each repo sets its own `namespace`. Each one then sees only its own history, and they all take
turns on one lock. See [Sharing a database](/guide/shared-database).

## Can I migrate several databases (one per customer)?

Yes. Run mmk once per database, changing `--db` (or `MMK_DB`) each time, or loop over your tenants
in code and call `runMigrations({ dbName })` for each one. Each database keeps its own history.

## Which versions does it need?

Node.js 18 or newer, the `mongodb` driver 5 or newer, and MongoDB server 4.2 or newer. Mongoose 7 or
newer if you use it. Transactions need a replica set or sharded cluster.

## Is it free?

Yes. It's MIT-licensed. The code is on [GitHub](https://github.com/guptasantosh327/mongo-migrate-kit)
and the package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit).
