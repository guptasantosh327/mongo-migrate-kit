---
title: 'Tutorial: your first migration'
description: A slow, explained walkthrough of MongoDB migrations with mongo-migrate-kit. Create a collection, backfill data, preview, run, check and roll back.
---

# Tutorial: your first migration

<p class="page-meta">Step 1 of the learning path · about 15 minutes</p>

In this tutorial you'll write two migrations for a small app. The first creates a `users` collection.
The second fills in a missing field on existing users, which is the kind of change you'll make most
often in real life. Along the way you'll run one file on its own, preview a run, look at the status
table and roll a change back.

You'll type every command yourself. The output shown is what mmk really prints. Your timestamps and
timings will be different.

## Before you start

You need Node.js 18 or newer and a MongoDB you can reach. The easiest way to get one is Docker:

```bash
docker run -d --name mmk-mongo -p 27017:27017 mongo:7
```

That starts MongoDB on `localhost:27017`. When you're done with the tutorial,
`docker rm -f mmk-mongo` removes it.

## 1. Make a project

```bash
mkdir mmk-tutorial && cd mmk-tutorial
npm init -y
npm pkg set type=module
npm install mongo-migrate-kit mongodb
```

`type=module` lets the migration files use `export`, which is what `mmk create` writes. (CommonJS
also works. See [Writing migrations](/guide/writing-migrations).)

## 2. Point mmk at the database

```bash
npx mmk init
```

Open `mmk.config.js`. It's long because every option has a comment, but you only need to look at
the first two settings. Set `dbName` to `mmk_tutorial`:

```js
  uri: 'mongodb://localhost:27017',
  dbName: 'mmk_tutorial',
```

## 3. Create two migrations

```bash
npx mmk create create-users
npx mmk create add-user-status
```

```text
Loaded config from mmk.config.js
✔ Created  20261015223651-create-users.js
Loaded config from mmk.config.js
✔ Created  20261015223652-add-user-status.js
```

Each file name starts with the time you created it. That's what keeps migrations in order: mmk
always runs them sorted by name, oldest first. Never rename a file after it has run somewhere.

Open the first file and replace the body:

```js
// migrations/…-create-users.js
export const description = 'Create the users collection';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.createCollection('users');
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').drop();
}
```

Every migration gets a `db` object. It's the normal `Db` from the MongoDB driver, so anything you
know about the driver works here.

## 4. Run one file on its own

Copy the full file name from step 3 and run just that one:

```bash
npx mmk up 20261015223651-create-users.js
```

```text
Loaded config from mmk.config.js
✔ Applied  20261015223651-create-users.js   [32ms]
```

Running a single file is handy while you work on something. Most of the time you'll run plain
`mmk up`, which runs everything that hasn't run yet.

## 5. Add some users

Pretend the app has been live for a while. Add three users, one of whom already has a status:

```bash
docker exec mmk-mongo mongosh mmk_tutorial --quiet --eval '
  db.users.insertMany([
    { name: "Ada",   email: "ada@example.com" },
    { name: "Linus", email: "linus@example.com" },
    { name: "Grace", email: "grace@example.com", status: "banned" }
  ])'
```

## 6. Write the backfill

The app now needs every user to have a `status`. Open the second file:

```js
// migrations/…-add-user-status.js
export const description = 'Give every user a status';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('users').updateMany(
    { status: { $exists: false } },
    { $set: { status: 'active', statusSetByMigration: true } },
  );
}

export async function down({ db }) {
  await db.collection('users').updateMany(
    { statusSetByMigration: true },
    { $unset: { status: '', statusSetByMigration: '' } },
  );
}
```

Look at the `down` function for a second. A lazy version would remove `status` from everyone, and
Grace would lose the `banned` status she had before the migration. So `up` leaves a small marker on
the users it touched, and `down` only undoes those. Writing a `down` that only undoes its own
`up` is the most useful habit you can pick up.

## 7. Preview, then run

Before running anything for real, ask what would happen:

```bash
npx mmk dry-run up
```

```text
Loaded config from mmk.config.js
◎ Dry-run  Would apply: 1
┌───────────────────────────────────┬─────────┬───────┬────────────┬──────────┬────────┐
│ Migration                         │ Status  │ Batch │ Applied At │ Checksum │ Author │
├───────────────────────────────────┼─────────┼───────┼────────────┼──────────┼────────┤
│ 20261015223652-add-user-status.js │ pending │       │            │ —        │        │
└───────────────────────────────────┴─────────┴───────┴────────────┴──────────┴────────┘
```

A dry run never writes to the database, so it's safe against production. Only the second file is
listed because the first one already ran. Now run it:

```bash
npx mmk up
```

```text
Loaded config from mmk.config.js
✔ Applied  20261015223652-add-user-status.js   [5ms]
```

Check the data. Ada and Linus are `active`, Grace is still `banned`:

```bash
docker exec mmk-mongo mongosh mmk_tutorial --quiet --eval 'db.users.find({}, { _id: 0, name: 1, status: 1 })'
```

## 8. Read the status table

```bash
npx mmk status
```

```text
Loaded config from mmk.config.js
┌───────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬──────────┐
│ Migration                         │ Status  │ Batch │ Applied At          │ Checksum │ Author   │
├───────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┤
│ 20261015223651-create-users.js    │ applied │ 1     │ 2026-10-15 22:36:53 │ ok       │ Asha Rao │
├───────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┤
│ 20261015223652-add-user-status.js │ applied │ 2     │ 2026-10-15 22:36:53 │ ok       │ Asha Rao │
└───────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴──────────┘
```

A few things to notice:

- **Batch.** Each `mmk up` run gets a batch number. You ran `up` twice, so there are two batches.
  If one `up` applies five files, all five share a batch, and one `mmk down` undoes all five.
- **Checksum.** `ok` means the file hasn't changed since it ran. If someone edits it later, this
  turns into `MISMATCH`.
- **Author.** Who wrote the migration. It comes from the `author` line in the file.

## 9. Roll back

Say the backfill was a mistake. Undo the last batch:

```bash
npx mmk down
```

```text
Loaded config from mmk.config.js
↩ Reverted 20261015223652-add-user-status.js   [6ms]
```

Ada and Linus no longer have a status, and Grace is still `banned`. Run `npx mmk status` again and
the second migration is back to `pending`:

```text
│ 20261015223651-create-users.js    │ applied │ 1     │ 2026-10-15 22:36:53 │ ok       │ Asha Rao │
│ 20261015223652-add-user-status.js │ pending │       │                     │ —        │          │
```

mmk kept the record of the run in the `_mmk_migrations` collection with `status: 'reverted'`. You
can look at it:

```bash
docker exec mmk-mongo mongosh mmk_tutorial --quiet --eval 'db._mmk_migrations.find().toArray()'
```

## Here's everything you just did

<Cast name="tutorial" alt="Terminal recording of the whole tutorial: two creates, running one file, a dry run, mmk up, mmk status, mmk down and mmk status again" />

## What you learned

- `mmk create` makes a file with `up` and `down`. Files run in name order.
- `mmk up` runs everything pending. `mmk up <file>` runs one file.
- `mmk dry-run up` shows the plan and writes nothing.
- `mmk status` shows what ran, in which batch, and whether the file changed since.
- `mmk down` undoes the last batch, and the history stays in the database.
- A good `down` only undoes what its own `up` did.

## Next

[How it works](/guide/concepts) explains batches, the lock and checksums properly, with pictures. It
takes about ten minutes and makes the rest of the docs much easier to follow.
