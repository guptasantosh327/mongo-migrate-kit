<!--
SEO target keyword: "test mongodb migrations"
Meta description: Most teams never test their MongoDB migrations, until a down() that never worked
is needed in production. A tiny round-trip test with Vitest (or Jest) and mongodb-memory-server that
catches it in CI.
Published copy: docs/blog/test-mongodb-migrations-vitest-memory-server.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Testing MongoDB migrations with Vitest and mongodb-memory-server

An awkward question: when did your migrations' `down()` functions last run?

For most teams the honest answer is "never". `up()` runs on every deploy, so it gets tested by
accident. `down()` runs only on the worst day of the quarter, when a deploy has gone wrong and you
need to roll back *now*. That's a bad moment to discover it drops the wrong index.

A ten-line test fixes that.

## The round-trip test

The idea: on a throwaway database, run every migration **up**, then every migration **down**, then
**up** again. If any `down()` doesn't really undo its `up()`, the second `up()` trips over what was
left behind.

```js
// test/migrations.test.js
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MigratorKit } from 'mongo-migrate-kit';
import { afterAll, beforeAll, expect, it } from 'vitest';

let mongo;
let client;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(mongo.getUri());
});

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

async function indexNames(dbName) {
  const indexes = await client.db(dbName).collection('users').indexes();
  return indexes.map((index) => index.name);
}

it('applies, reverts and re-applies every migration', async () => {
  const dbName = 'migrations_roundtrip';
  const migrator = new MigratorKit({ uri: mongo.getUri(), dbName, logger: null });
  try {
    const applied = await migrator.up();
    expect(applied.map((r) => r.status)).not.toContain('error');
    expect(await indexNames(dbName)).toContain('email_unique');

    // Revert everything, newest first: every down() must really undo its up()
    await migrator.down(undefined, { steps: applied.length });
    expect(await indexNames(dbName)).not.toContain('email_unique');

    // ...and up() must work again on the reverted database
    const reapplied = await migrator.up();
    expect(reapplied).toHaveLength(applied.length);
  } finally {
    await migrator.disconnect();
  }
});
```

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  2.52s
```

What each step catches:

- **A `down()` that throws** (wrong index name, a collection that doesn't exist) fails the test
  on the spot.
- **An `up()` that can't run twice** (say it inserts a seed document with a fixed `_id`, and the
  `down()` forgot to remove it) fails on the second `up()` with a duplicate key.
- **A `down()` that quietly does nothing** is caught only by the assertions *after* `down()`. Many
  operations are idempotent: `createIndex` with an identical spec succeeds even if the index exists,
  so the second `up()` won't notice. I checked: with an empty `down()` and without the
  `not.toContain('email_unique')` line, this test passes. That line is what makes it fail.

So the `email_unique` checks aren't decoration. Assert, for each migration that matters, that
`up()` created what it should and `down()` removed it.

## Why each piece is there

**`MongoMemoryReplSet`, not `MongoMemoryServer`.** The memory server downloads and starts a real
`mongod`. The first run takes a moment, then it's cached. A *replica set* matters if any migration
uses `useTransaction`: transactions need a replica set, and on a standalone mmk refuses them with
`TRANSACTIONS_UNSUPPORTED`. Use the replica set and the test matches production.

**`logger: null`** keeps mmk's output out of your test report.

**`down(undefined, { steps: applied.length })`** reverts exactly the migrations this test applied,
newest first, regardless of batches. (The CLI equivalent is `mmk down --steps <n>`.)

**`try … finally { disconnect() }`** so a failing assertion doesn't leave a connection open and hang
the test run.

## One gotcha: where the migrations folder is

`migrationsDir` defaults to `./migrations`, resolved from the **current working directory**. Test
runners normally start in the project root, so that just works. If yours doesn't (a monorepo, a
runner started from elsewhere), make the path explicit:

```js
import path from 'node:path';

const migrator = new MigratorKit({
  uri: mongo.getUri(),
  dbName,
  migrationsDir: path.resolve(import.meta.dirname, '../migrations'),
  logger: null,
});
```

I hit this myself while writing this post: run from the wrong folder, the test happily migrated a
*different* project's migrations folder.

## Jest

Nothing above is Vitest-specific. With Jest, drop the `vitest` import (Jest provides `beforeAll`,
`afterAll`, `it` and `expect` as globals) and keep the rest.

## Going further

- **Seed realistic data first.** An index migration passes on an empty database and fails in
  production on duplicate emails. Insert a few documents shaped like your real (messy) data before
  `up()`, including the duplicates and missing fields you know exist.
- **Test a migration's effect, not just that it ran.** For a backfill, insert documents without the
  field, run `up()`, and assert the field is there with the right value.
- **Run it in CI on every pull request.** The memory server needs no database service, so the test
  is self-contained.

## In short

Up, down, up again, on a throwaway replica set, on every pull request. It takes a minute to write,
and it means `down()` has run successfully at least once before the day you actually need it.

## Try it

```bash
npm install -D vitest mongodb-memory-server
npm install mongo-migrate-kit mongodb
npx vitest run
```

More in the docs: [Running from your code](https://mongo-migrate-kit.vercel.app/guide/api). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [How to roll back a single MongoDB migration](./05-rollback-specific-mongodb-migration.md): the
  rollback this test makes sure will work.
- [MongoDB migrations in GitHub Actions](./08-mongodb-migrations-ci-cd-github-actions.md):
  where the test runs.
