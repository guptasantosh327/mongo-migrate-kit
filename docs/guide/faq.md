# Frequently Asked Questions

Quick answers to the most common questions about running MongoDB migrations with
`mongo-migrate-kit`.

## What is mongo-migrate-kit?

`mongo-migrate-kit` is a production-grade MongoDB migration toolkit for Node.js and TypeScript. It
runs versioned `up`/`down` migration files against MongoDB, with single-file runs, real rollbacks,
dry-run previews, transactions, checksums, lifecycle hooks, and a native concurrency lock — exposed
through the `mmk` CLI and a fully-typed programmatic API.

## Is mongo-migrate-kit a good migrate-mongo alternative?

Yes. It's a drop-in alternative to [`migrate-mongo`](https://github.com/seppevs/migrate-mongo) that
keeps the same `up`/`down`/`create`/`status` mental model and adds what the older tool lacks:
single-file runs, rollback of any batch/file/last-N, dry-run previews, checksums, lifecycle hooks,
and first-class TypeScript. You can adopt an existing migrate-mongo changelog with
[`mmk import`](/commands/import) — no re-running migrations. See
[Migrating from migrate-mongo](/guide/migrate-mongo).

## How do I run a single MongoDB migration?

Pass the filename to `up`:

```bash
mmk up 20260605120000-add-users-index.js
```

Most tools only run *all* pending migrations; `mmk` lets you run exactly one. See
[`mmk up`](/commands/up).

## How do I roll back a MongoDB migration in Node.js?

`mmk down` reverts the last batch. You can also revert a specific batch, the last N migrations, or a
single file:

```bash
mmk down                 # roll back the last batch
mmk down --batch 3       # roll back a specific batch
mmk down --steps 2       # roll back the last 2 migrations
mmk down <file>          # roll back one migration
```

Rollbacks never delete history — the record is marked `reverted`. See [`mmk down`](/commands/down).

## Does mongo-migrate-kit support TypeScript?

Yes — TypeScript is first-class. `.ts` migrations run natively through `tsx` (no `ts-node` setup),
and the migration context and config are fully typed. ESM and CommonJS `.js` files work too. See
[Writing Migrations](/guide/writing-migrations).

## How do I write a MongoDB migration?

Export an `up` and a `down` function:

```ts
import type { MigrationContext } from 'mongo-migrate-kit';

export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('users').dropIndex('email_1');
}
```

Generate the scaffold with `mmk create <name>`. See [Writing Migrations](/guide/writing-migrations).

## Can I run MongoDB migrations in a transaction?

Yes. Export `useTransaction = true` from a migration (or set it globally in config) and `mmk` wraps
it in a MongoDB session + transaction — commit on success, abort on error. Requires a replica set.
See [Transactions](/guide/transactions).

## How do I preview migrations before running them?

Use a dry run — it computes exactly what would run and touches nothing:

```bash
mmk dry-run up
```

See [`mmk dry-run`](/commands/dry-run).

## How do I run MongoDB migrations in CI/CD?

Run `mmk up` as a deploy step, and gate deploys with `mmk status --check` (exits non-zero when
migrations are pending). Every data command supports `--json` for machine-readable output. There are
GitHub Actions and Docker recipes in [CI/CD & Deployment](/guide/ci-cd).

## Does it work with Mongoose?

Yes. Pass your Mongoose instance in config and it's available as `ctx.mongoose` inside migrations.
Mongoose is an optional peer dependency — you only need it if your migrations use Mongoose models.

## Can I run migrations without a config file?

Yes. Every option has an `MMK_*` environment variable, so exporting `MMK_URI` and `MMK_DB` is enough
to run — no config file required. See [Configuration](/guide/configuration).

## How does it prevent two deploys running migrations at once?

`mmk` acquires an atomic lock in MongoDB before writing, so concurrent runs can't collide. The lock
auto-expires and renews on a heartbeat during long migrations. A stuck lock from a crashed run can be
cleared with [`mmk unlock`](/commands/unlock).

## What Node.js and MongoDB versions are required?

Node.js **≥ 18** and MongoDB **≥ 5.0**. `mongoose` (≥ 7) is optional.

## Is it free and open source?

Yes — `mongo-migrate-kit` is MIT-licensed and free to use. The source is on
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit), and it's published on
[npm](https://www.npmjs.com/package/mongo-migrate-kit).
