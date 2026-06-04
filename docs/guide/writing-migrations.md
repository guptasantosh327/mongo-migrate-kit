# Writing Migrations

A migration file exports an `up` function (apply the change) and a `down` function (revert it). Both
receive a typed [`MigrationContext`](#the-migration-context). All three module formats are
first-class.

## The three supported formats

::: code-group

```ts [TypeScript]
import type { MigrationContext } from 'mongo-migrate-kit';

export const description = 'Add unique index on users.email';
export const useTransaction = true;

export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('users').dropIndex('email_1');
}
```

```js [JavaScript (ESM)]
export const description = 'Add unique index on users.email';

export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').dropIndex('email_1');
}
```

```js [JavaScript (CommonJS)]
module.exports = {
  description: 'Add unique index on users.email',
  async up({ db }) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  async down({ db }) {
    await db.collection('users').dropIndex('email_1');
  },
};
```

:::

::: tip Generate the scaffold
Don't write the boilerplate by hand — run `mmk create add-users-email-index`. The generated file
type follows your `createExtension` config, or pass `--ts` / `--js` to choose.
:::

## The migration context

Every `up`/`down` receives a single context object:

```ts
interface MigrationContext {
  /** Native MongoDB Db instance */
  db: Db;
  /** Native MongoClient — use for sessions / transactions */
  client: MongoClient;
  /** Mongoose instance — only present if passed in config */
  mongoose?: Mongoose;
  /** Active session — present when the migration runs in a transaction */
  session?: ClientSession;
}
```

When a migration runs inside a [transaction](/guide/transactions), pass `ctx.session` to your driver
calls so they participate in it:

```ts
export const useTransaction = true;

export async function up({ db, session }: MigrationContext): Promise<void> {
  await db.collection('orders').updateMany({}, { $set: { migrated: true } }, { session });
}
```

## Optional exports

| Export | Type | Effect |
|---|---|---|
| `up` | `(ctx) => Promise<void>` | **Required.** Applies the migration. |
| `down` | `(ctx) => Promise<void>` | **Required.** Reverts the migration. |
| `useTransaction` | `boolean` | Wrap this file in a MongoDB transaction. |
| `description` | `string` | Shown in the `mmk status` table. |

If `up` or `down` is missing or not a function, the loader throws `MigrationInvalidExportError`.

## File naming

By default files are timestamped: `20260605143021-add-users-index.ts`. Migrations run in ascending
filename order, so the timestamp prefix guarantees deterministic ordering. Set `sequential: true` in
config for `0001-`, `0002-` numbering instead.

## TypeScript at runtime

The `mmk` CLI runs `.ts` migrations natively through `tsx` — no `ts-node` setup. If you invoke the
library programmatically under a plain Node runtime that can't import `.ts`, either use Node ≥ 22.18,
register a TypeScript loader (such as `tsx`), or author the file as `.js`.
