---
title: Transactions
description: Make a MongoDB migration all-or-nothing with mongo-migrate-kit's useTransaction option. What it needs, how to use the session, and what happens when a migration fails.
---

# Transactions

<p class="page-meta">Step 3 of the learning path · about 5 minutes</p>

A migration often makes more than one write. If the third write fails, what happens to the first
two? Without a transaction, they stay in the database. With one, they're undone.

<Diagram name="transaction" />

## Turn it on for one migration

Export `useTransaction = true`, and pass `session` to every database call:

::: code-group

```js [JavaScript]
export const useTransaction = true;

export async function up({ db, session }) {
  await db.collection('plans').updateMany({}, { $set: { legacy: true } }, { session });
  await db.collection('plans').insertMany(
    [{ _id: 'pro', price: 29 }, { _id: 'team', price: 99 }],
    { session },
  );
}

export async function down({ db, session }) {
  await db.collection('plans').deleteMany({ _id: { $in: ['pro', 'team'] } }, { session });
  await db.collection('plans').updateMany({}, { $unset: { legacy: '' } }, { session });
}
```

```ts [TypeScript]
import type { MigrationContext } from 'mongo-migrate-kit';

export const useTransaction = true;

export async function up({ db, session }: MigrationContext): Promise<void> {
  await db.collection('plans').updateMany({}, { $set: { legacy: true } }, { session });
  await db.collection('plans').insertMany(
    [{ _id: 'pro', price: 29 }, { _id: 'team', price: 99 }],
    { session },
  );
}

export async function down({ db, session }: MigrationContext): Promise<void> {
  await db.collection('plans').deleteMany({ _id: { $in: ['pro', 'team'] } }, { session });
  await db.collection('plans').updateMany({}, { $unset: { legacy: '' } }, { session });
}
```

:::

::: warning Don't forget `{ session }`
A call without `{ session }` runs outside the transaction. It won't be rolled back if a later call
fails, and nothing will warn you. This is the most common mistake with transactions.
:::

## Turn it on for every migration

Set `useTransaction: true` in your config (or `MMK_USE_TRANSACTION=true`). A file can still opt out
with `export const useTransaction = false`.

## What it needs

MongoDB only supports transactions on a **replica set** or a **sharded cluster**. MongoDB Atlas is
always one of those. A single `mongod` started on its own (the default `docker run mongo`) is not.

mmk checks this when it connects. If a migration asks for a transaction and the server can't do
them, mmk stops with `TRANSACTIONS_UNSUPPORTED` before running anything, so you don't find out
halfway through.

To get a replica set locally, start MongoDB with `--replSet rs0` and run `rs.initiate()` once, or
use `MongoMemoryReplSet` from `mongodb-memory-server` in tests.

## What happens when it fails

Here's the migration above failing on a database that already had a `free` plan with a clashing
`_id`. The output tells you the writes were rolled back, and the file is still pending:

<Cast name="failure" alt="Terminal: mmk up fails with MIGRATION_EXECUTION_FAILED; the message includes the E11000 duplicate key reason, the file and line, and This migration ran in a transaction, so its database writes were rolled back; mmk list --pending still shows the migration" />

Step by step, mmk:

1. starts a session and a transaction (with `w: 'majority'`),
2. calls your `up` with that `session`,
3. writes the history record **inside the same transaction**,
4. commits. If anything threw, it aborts instead, calls your `onError` hook, and stops the run.

Step 3 is the important one. The record and your changes commit together, or not at all. Without a
transaction there's a tiny window where your changes are saved but the record isn't (say the process
is killed at exactly that moment). The next deploy would then run the migration again. For a
migration that isn't safe to run twice, a transaction closes that gap.

## Things transactions can't do

- **Very long migrations.** MongoDB aborts a transaction after 60 seconds by default
  (`transactionLifetimeLimitSeconds`). Large backfills should work in batches without a
  transaction, and be safe to re-run instead.
- **Some index and collection operations.** Building an index on a collection that already has data,
  and dropping a collection, aren't allowed inside a transaction. Put those in a migration without
  one.
- **Huge writes.** A big transaction holds a lot in memory and is more likely to be aborted. Think
  thousands of documents, not millions.

## Next

[Hooks](/guide/hooks) let you run your own code before and after migrations, for example to post to
Slack when one fails.
