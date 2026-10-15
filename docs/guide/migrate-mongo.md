---
title: Moving from migrate-mongo
description: Switch an existing project from migrate-mongo to mongo-migrate-kit without re-running old migrations. mmk import copies your changelog and never modifies it.
---

# Moving from migrate-mongo

<p class="page-meta">Step 4 of the learning path · about 10 minutes</p>

If your project already uses [migrate-mongo](https://github.com/seppevs/migrate-mongo), you don't
start over. `mmk import` reads migrate-mongo's `changelog` collection and writes the same history
into mmk's own collection. After that, `mmk up` knows what already ran and only runs new files.

Your old `changelog` collection is only read, never changed. If you decide mmk isn't for you,
delete the `_mmk_migrations` collection and you're back where you started.

<Cast name="import" alt="Terminal: mmk import --dry-run previews three migrate-mongo records, mmk import copies them, and mmk up applies only the one new migration" />

## The switch, step by step

**1. Install mmk** next to migrate-mongo. You can remove migrate-mongo later.

```bash
npm install mongo-migrate-kit
```

**2. Point it at the same database and folder.** If your migrations live in `migrations/`, that's
already the default. Otherwise set `migrationsDir`:

```js
// mmk.config.js
export default {
  uri: process.env.MONGO_URL,
  dbName: 'shop',
  migrationsDir: './migrations',
};
```

**3. Preview the import.** This writes nothing:

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

Check that the list matches what you expect has run.

**4. Import.**

```bash
npx mmk import
```

**5. Carry on as usual.** `npx mmk status` shows the old migrations as applied. `npx mmk up` runs
only files that migrate-mongo never ran.

**6. Update your scripts and CI** to call `mmk` instead of `migrate-mongo`. Do this in every
environment (staging, production) at the same time, so the two tools never both run against one
database.

## What import does exactly

- Reads every document in the source collection (`changelog`, or `--from <name>`).
- For each one, writes a record to `_mmk_migrations` (or `--to <name>`) with the file name and the
  date it was applied.
- Works out a checksum for each file. If migrate-mongo stored a `fileHash` and it matches the file on
  disk, that's reused. Otherwise it's computed from the file. If the file is gone, the checksum is
  left empty and you get a warning. `--trust-hash` reuses migrate-mongo's hash without checking.
- Gives each imported migration its own batch number, in the order they ran.
- Leaves files that aren't in the old changelog alone. They're pending and run on the next
  `mmk up`.

If `_mmk_migrations` already has records, import stops with `IMPORT_TARGET_NOT_EMPTY`. Add
`--force` to import anyway; the new batch numbers continue after the existing ones.

## Old migrations are forward-only

There's one difference to know about. migrate-mongo calls `up(db, client)` with two arguments. mmk
calls `up({ db, client })` with one object. Running an old migrate-mongo file through mmk could
silently do the wrong thing, so mmk doesn't try. `mmk down` and `mmk redo` refuse imported records
before touching anything:

```text
✖ MIGRATION_IRREVERSIBLE: Cannot roll back migrate-mongo-imported migration(s): 20250101000000-legacy.js
```

New migrations you write with `mmk create` roll back normally. If you need an old one to be
reversible, rewrite its file in mmk's format:

::: code-group

```js [migrate-mongo]
module.exports = {
  async up(db, client) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  async down(db, client) {
    await db.collection('users').dropIndex('email_1');
  },
};
```

```js [mongo-migrate-kit]
module.exports = {
  async up({ db, client }) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  async down({ db, client }) {
    await db.collection('users').dropIndex('email_1');
  },
};
```

:::

The only change is the braces around `{ db, client }`.

## Several services sharing one changelog

If several repos used to share one migrate-mongo `changelog`, set a [`namespace`](/guide/shared-database)
in each repo and run `mmk import` in each. A repo only imports records whose file is in its own
migrations folder, and stamps them with its namespace. Records that belong to other repos are listed
as skipped.

## What you get after switching

| Capability                                      | `migrate-mongo` | `mongo-migrate-kit` |
| ----------------------------------------------- | :-------------: | :-----------------: |
| Run a single migration file                     |        ❌        |          ✅          |
| Roll back a specific batch (not just the last)  |        ❌        |          ✅          |
| Roll back a single migration file               |        ❌        |          ✅          |
| Dry-run preview                                 |        ❌        |          ✅          |
| `redo` (down + up)                              |        ❌        |          ✅          |
| Concurrency lock on by default                  |        ❌        |          ✅          |
| Refuses to roll back an edited migration        |        ❌        |          ✅          |
| Lifecycle hooks                                 |        ❌        |          ✅          |
| History kept on rollback (never deleted)        |        ❌        |          ✅          |
| Adopt an existing `migrate-mongo` changelog     |        —        |          ✅          |

<p style="font-size:.85rem;color:var(--vp-c-text-2)">Reflects <code>migrate-mongo</code>'s documented CLI as of mid-2026. It also gives migrations transaction access through a <code>client</code> argument; <code>mmk</code> exposes the same plus a declarative per-file <code>useTransaction</code> flag.</p>

The full command reference is at [`mmk import`](/commands/import).

## Next

The [FAQ](/guide/faq) covers the questions people ask most, from Mongoose to multiple databases.
