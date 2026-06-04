# Tutorial

Let's build and run a real migration end to end — create a `users` collection with a unique email
index, watch it apply, then roll it back. About five minutes.

::: tip Prerequisites
A running MongoDB you can connect to (local `mongodb://localhost:27017` is fine) and Node ≥ 18.
If you don't have Mongo handy, Docker works: `docker run -d -p 27017:27017 mongo`.
:::

## 1. Set up a project

```bash
mkdir mmk-tutorial && cd mmk-tutorial
npm init -y
npm install mongo-migrate-kit mongodb
```

## 2. Generate a config

```bash
npx mmk init
```

Open the generated `mmk.config.js` and point it at your database:

```js
// mmk.config.js
export default {
  uri: 'mongodb://localhost:27017',
  dbName: 'mmk_tutorial',
  migrationsDir: './migrations',
};
```

## 3. Create your first migration

```bash
npx mmk create add-users-email-index
```

This creates a timestamped file in `migrations/`. Open it and fill in the two halves:

```js
// migrations/2026...-add-users-email-index.js
export const description = 'Create users collection with a unique email index';

export async function up({ db }) {
  await db.createCollection('users');
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').drop();
}
```

## 4. Preview before running

Always look before you leap — this touches nothing:

```bash
npx mmk dry-run up
```

```
◎ Dry-run  Would apply 1 migration:
   • 2026...-add-users-email-index.js
```

## 5. Apply it

```bash
npx mmk up
```

```
✔ Applied  2026...-add-users-email-index.js   [38ms]
```

Your `users` collection now exists with a unique index. `mmk` also created the `_mmk_migrations`
changelog collection to record what it did.

## 6. Check the status

```bash
npx mmk status
```

```
┌───────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬──────────┐
│ Migration                                 │ Status  │ Batch │ Applied At          │ Duration │ Checksum │
├───────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┤
│ 2026...-add-users-email-index.js          │ applied │ 1     │ 2026-06-05 12:00:00 │ 38ms     │ ok       │
└───────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴──────────┘
```

## 7. Roll it back

Changed your mind? Undo the last batch:

```bash
npx mmk down
```

```
↩ Reverted 2026...-add-users-email-index.js   [21ms]
```

The `users` collection is gone — but the changelog **keeps the record** (now marked `reverted`), so
you always have an audit trail. Run `npx mmk status` again and you'll see it's back to `pending`.

## What you learned

- `mmk init` → `mmk create` → fill in `up`/`down` → `mmk up` is the core loop.
- `mmk dry-run` previews safely; `mmk status` shows the full picture.
- `mmk down` reverts, and history is never lost.

## Next steps

- [Writing Migrations](/guide/writing-migrations) — TypeScript, ESM, CommonJS, and the full file contract.
- [Core Concepts](/guide/concepts) — batches, ordering, locks, and checksums in depth.
- [Commands](/commands/up) — every command and flag.
