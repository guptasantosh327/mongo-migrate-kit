<!--
SEO target keyword: "switch from migrate-mongo" / "migrate-mongo migration guide"
Meta description: Move an existing project from migrate-mongo to mongo-migrate-kit without
re-running old migrations, losing history, or touching your old changelog.
Published copy: docs/blog/switching-from-migrate-mongo.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Switching from migrate-mongo to mongo-migrate-kit, step by step

When you look at a migrate-mongo alternative, the real question isn't "is it better?". It's "how do
I switch without breaking what already works?"

This post walks through moving an existing project over. Nothing old gets re-run, no history is
lost, and your migrate-mongo `changelog` is never written to. If anything looks wrong at any step,
you can stop and nothing has changed.

## What you need

- A project using migrate-mongo, with some migrations already applied.
- Access to the same database migrate-mongo writes to.
- Node 18 or newer.

Leave migrate-mongo installed for now. You can remove it once you're happy.

## 1. Install mmk

```bash
npm install mongo-migrate-kit
```

You already have the `mongodb` driver from migrate-mongo, and mmk uses the same one.

## 2. Point it at the same database

Either generate a config file:

```bash
npx mmk init
```

and set the connection in `mmk.config.js`:

```js
export default {
  uri: 'mongodb://localhost:27017', // the same database migrate-mongo uses
  dbName: 'shop',
  migrationsDir: './migrations',    // where your migration files already are
};
```

Or skip the file and use environment variables:

```bash
export MMK_URI="mongodb://localhost:27017"
export MMK_DB="shop"
```

The one thing that matters: it has to be the **same database** migrate-mongo has been using. That's
where your history is.

## 3. Preview the import

This is the step that makes the switch safe. Ask mmk what it would do, without doing it:

```bash
npx mmk import --dry-run
```

```text
◎ Dry-run  Would import 3 record(s) from "changelog" → "_mmk_migrations"
┌─────────────────────────────────┬───────┬─────────────────────┬────────────┐
│ Migration                       │ Batch │ Applied At          │ Checksum   │
├─────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250301100000-create-users.js  │ 1     │ 2025-03-01 15:35:00 │ recomputed │
├─────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250412083000-add-sku-index.js │ 2     │ 2025-04-12 14:10:00 │ recomputed │
├─────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250720140000-split-address.js │ 3     │ 2025-07-20 19:40:00 │ recomputed │
└─────────────────────────────────┴───────┴─────────────────────┴────────────┘
```

Compare that list with `npx migrate-mongo status`. They should match.

If your project renamed migrate-mongo's collection, point mmk at it with
`--from your_collection_name`.

## 4. Import for real

```bash
npx mmk import
```

What happens:

- mmk **reads** migrate-mongo's changelog and writes the same history into its own collection,
  `_mmk_migrations`. The old collection isn't changed.
- Each record gets the file name, the date it was applied, and a checksum. If migrate-mongo stored
  a file hash that still matches the file, it's reused. Otherwise mmk computes one from the file.
- Files that are on disk but not in the old changelog stay **pending**. Those are migrations you
  wrote but never ran, and they'll run on the next `mmk up`.

## 5. Check, then carry on

```bash
npx mmk status
```

Everything migrate-mongo ran should show as `applied`, with its date. Anything new shows as
`pending`. Run those:

```bash
npx mmk up
```

Only the new ones run. Old indexes aren't rebuilt and seed data isn't inserted twice, because mmk
knows they're done.

Here's the whole switch in one recording:

![Terminal: mmk import --dry-run previews three migrate-mongo records, mmk import copies them, and mmk up applies only the one new migration](https://mongo-migrate-kit.vercel.app/gifs/import.gif)

## 6. Switch your scripts and CI

Change `migrate-mongo up` to `mmk up` in your `package.json` and pipelines. Do it for every
environment at the same time, so the two tools never both run against one database.

## What's different afterwards

The day-to-day is the same (`create`, `up`, `down`, `status`) with a few additions:

```bash
npx mmk dry-run up                 # see the plan first
npx mmk up <file>                  # run one file
npx mmk down <file>                # undo one file
npx mmk down --batch 3             # undo an older release
npx mmk redo                       # undo and run again, while developing
```

There's also a lock that's on by default, so two deploys can't run migrations at once, and checksums
that tell you when someone edits a migration after it ran.

## Writing new migrations

The only change from migrate-mongo is the function arguments. migrate-mongo passes two arguments,
mmk passes one object:


**migrate-mongo:**

```js
module.exports = {
  async up(db, client) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  async down(db, client) {
    await db.collection('users').dropIndex('email_1');
  },
};
```

**mongo-migrate-kit:**

```js
module.exports = {
  async up({ db, client }) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  async down({ db, client }) {
    await db.collection('users').dropIndex('email_1');
  },
};
```


`npx mmk create add-users-email-index` makes a new file with this already set up.

## Old migrations are forward-only

Because of that difference in arguments, mmk won't roll back the migrations you imported. Running an
old `down(db, client)` as `down({ db, client })` could do the wrong thing, so it refuses before
touching anything:

```text
✖ MIGRATION_IRREVERSIBLE: Cannot roll back migrate-mongo-imported migration(s): 20250101000000-legacy.js
```

Everything you write after the switch rolls back normally. If you need an old one to be reversible,
add the braces to that file.

## Backing out

If you decide mmk isn't for you, drop the `_mmk_migrations` collection. migrate-mongo's `changelog`
was never touched, so you're exactly where you started.

The full reference is in the docs: [Moving from migrate-mongo](https://mongo-migrate-kit.vercel.app/guide/migrate-mongo).

---

### Related reading

- [Why I built a new MongoDB migration tool](./01-why-i-built-mongo-migrate-kit.md)
- [7 things I kept missing in migrate-mongo](./03-7-things-migrate-mongo-cant-do.md)
