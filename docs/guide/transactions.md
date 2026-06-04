# Transactions

`mongo-migrate-kit` can wrap a migration in a MongoDB session + transaction so that **either every
operation commits, or none do**. This is opt-in and works at two levels.

::: warning Requires a replica set
MongoDB transactions require a replica set (or a sharded cluster). A standalone `mongod` does not
support them. Local development with `mongodb-memory-server` spins up a replica set automatically.
:::

## Enable per file

Export `useTransaction = true` from a migration:

::: code-group

```ts [TypeScript]
import type { MigrationContext } from 'mongo-migrate-kit';

export const useTransaction = true;

export async function up({ db, session }: MigrationContext): Promise<void> {
  await db.collection('accounts').updateMany({}, { $inc: { balance: 0 } }, { session });
  await db.collection('ledger').insertOne({ migratedAt: new Date() }, { session });
}

export async function down({ db, session }: MigrationContext): Promise<void> {
  await db.collection('ledger').deleteMany({}, { session });
}
```

```js [JavaScript]
export const useTransaction = true;

export async function up({ db, session }) {
  await db.collection('accounts').updateMany({}, { $inc: { balance: 0 } }, { session });
  await db.collection('ledger').insertOne({ migratedAt: new Date() }, { session });
}
```

:::

::: tip Always pass `session`
For operations to participate in the transaction, you **must** pass `ctx.session` to each driver
call. An operation without `{ session }` runs outside the transaction and won't be rolled back.
:::

## Enable globally

Set `useTransaction: true` in your config to wrap **every** migration in a transaction by default. A
per-file `useTransaction` still overrides the global setting.

```js
// mmk.config.js
export default {
  uri: 'mongodb://localhost:27017',
  dbName: 'my_app',
  useTransaction: true, // every migration is transactional unless it opts out
};
```

## How it behaves

When a transactional migration runs:

1. A MongoDB session starts and `session.startTransaction()` is called.
2. The session is exposed as `ctx.session` to your `up`/`down`.
3. On success → `session.commitTransaction()`, then the changelog record is written.
4. On any thrown error → `session.abortTransaction()`, the `onError` hook fires, and the batch stops.

This means a failed transactional migration leaves the database in its original state — no partial
writes.
