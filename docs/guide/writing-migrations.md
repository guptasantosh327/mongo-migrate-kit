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

## Running TypeScript migrations

`mmk` runs under your installed Node — it does **not** bundle a TypeScript loader. How a `.ts`
migration loads depends on your Node version:

| Your Node | `.ts` migrations | Setup needed |
|---|---|---|
| **≥ 22.18** | Load natively via built-in type stripping | None |
| **< 22.18** | Need a TypeScript loader, or use `.js` | See below |

::: tip The simplest path
On **Node ≥ 22.18**, `.ts` migrations just work — nothing to install. If you're on older Node and
don't want to set up a loader, author migrations as **`.js`**: they run everywhere on Node 18+ with
zero setup.
:::

### Using `.ts` on Node < 22.18

Install [`tsx`](https://github.com/privatenumber/tsx) and run `mmk` under it so its loader is
registered before the migration is imported:

```bash
npm install -D tsx
```

```json
{
  "scripts": {
    "migrate": "node --import tsx node_modules/mongo-migrate-kit/dist/mmk.cjs up"
  }
}
```

`tsx` is *your* dev dependency here — `mmk` doesn't ship it. The same applies when you call the
library programmatically: run your script under Node ≥ 22.18 or with a TypeScript loader registered.

If a `.ts` file can't be loaded, `mmk` throws a clear error explaining these options — see
[Troubleshooting](/guide/troubleshooting#a-ts-migration-won-t-load).
