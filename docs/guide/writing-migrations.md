---
title: Writing migrations
description: The mongo-migrate-kit migration file format in JavaScript (ESM or CommonJS) and TypeScript, the migration context, optional exports, and habits that make migrations safe to roll back.
---

# Writing migrations

<p class="page-meta">Step 2 of the learning path · about 10 minutes</p>

A migration file exports two async functions: `up` makes a change and `down` undoes it. Both get one
argument, the migration context, which holds your database handle.

Run `mmk create <name>` to get a file with everything filled in. This page explains what's in it and
how to write the body well.

## The file

A migration is JavaScript or TypeScript, written as an ES module or as CommonJS. All four behave the
same way. You don't have to choose the module style: `mmk create` matches your project (see
[ES modules or CommonJS](#es-modules-or-commonjs)).

::: code-group

```js [JavaScript (ESM)]
export const description = 'Unique index on users.email';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').dropIndex('email_1');
}
```

```js [JavaScript (CommonJS)]
module.exports = {
  description: 'Unique index on users.email',
  author: 'Asha Rao',

  async up({ db }) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },

  async down({ db }) {
    await db.collection('users').dropIndex('email_1');
  },
};
```

```ts [TypeScript (ESM)]
import type { MigrationContext } from 'mongo-migrate-kit';

export const description = 'Unique index on users.email';
export const author = 'Asha Rao';

export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('users').dropIndex('email_1');
}
```

```ts [TypeScript (CommonJS)]
import type { MigrationContext } from 'mongo-migrate-kit';

module.exports = {
  description: 'Unique index on users.email',
  author: 'Asha Rao',

  async up({ db }: MigrationContext): Promise<void> {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },

  async down({ db }: MigrationContext): Promise<void> {
    await db.collection('users').dropIndex('email_1');
  },
};
```

:::

`mmk create` writes `.js` files by default. Use `mmk create <name> --ts` for TypeScript, or set
`createExtension: 'ts'` in your config to make it the default.

## ES modules or CommonJS

Node decides how to load a `.js` or `.ts` file from the **nearest `package.json`** above it.
`mmk create` and `mmk init` read the same file before they write anything, so what they generate
always loads:

| Nearest `package.json` | What mmk writes | Example |
|---|---|---|
| `"type": "module"` | ES module | `export async function up(…)`, `export default config` |
| `"type": "commonjs"` | CommonJS | `module.exports = { async up(…) {…} }` |
| No `"type"` field, or no `package.json` | CommonJS | same as above |

CommonJS is what Node uses when `"type"` is missing. (Newer Node versions can also run `export` in
such a file by guessing from the syntax. Older ones can't, Node 18 included, and the guess prints a
warning on every run. So mmk doesn't rely on it.)

**TypeScript follows the same rule.** In a CommonJS project, a TypeScript migration keeps
`import type` (Node removes it before running the file) and exports with `module.exports`. That
runs under Node 22.18+ on its own and under `tsx`, and type-checks with `@types/node` installed.

A folder can have its own `package.json`. A `migrations/package.json` containing
`{ "type": "module" }` makes just that folder ES modules, and `mmk create` follows it.

A custom template (`--template` or `templatePath`) is copied exactly as it is, so write it in your
project's style.

### If a file is in the wrong style

A migration can end up in the other style, for example when it's copied from another project or
was created before a `package.json` changed. mmk then stops with an explanation instead of Node's
bare `Unexpected token 'export'`:

```text
✖ MIGRATION_INVALID_EXPORT: Migration "20261002090000-create-carts.js" uses CommonJS (module.exports/require), but Node loads it as an ES module
  Why: /app/package.json has "type": "module"
  Fix: write it as export async function up(ctx) {…} and export async function down(ctx) {…}, the form `mmk create` uses here
  Or, to keep the file unchanged (rewriting an applied migration changes its checksum): add a package.json containing { "type": "commonjs" } to /app/migrations
```

Prefer the second option for migrations that have already run. Rewriting one changes its checksum,
so `mmk status` shows it as changed and `mmk down` refuses it without `--force`.

## What you get in the context

```ts
interface MigrationContext {
  db: Db;                 // the database from your config (MongoDB driver)
  client: MongoClient;    // the connected client, for anything db can't do
  session?: ClientSession; // set when the migration runs in a transaction
  mongoose?: Mongoose;    // only if you passed mongoose in your config
}
```

`db` and `client` are the normal objects from the official `mongodb` driver. Nothing is wrapped, so
the driver docs apply as they are.

If the migration runs in a [transaction](/guide/transactions), pass `session` to every call so the
call takes part in it:

```js
export const useTransaction = true;

export async function up({ db, session }) {
  await db.collection('orders').updateMany({}, { $set: { migrated: true } }, { session });
}
```

## Exports

| Export | Required | What it does |
| --- | --- | --- |
| `up` | yes | Makes the change. |
| `down` | yes | Undoes the change. |
| `description` | no | A one-line summary. Saved on the record and included in `mmk status --json`. |
| `author` | no | Who wrote it. Saved on the record and shown in `mmk status`. |
| `useTransaction` | no | `true` runs this file inside a MongoDB transaction. |

If `up` or `down` is missing, or isn't a function, mmk stops with `MIGRATION_INVALID_EXPORT` and
tells you which one and what it found instead.

## Habits that keep migrations safe

These matter more than any setting.

**One change per file.** "Add the index" and "backfill the field" are two migrations. Small files
are easier to review, and easier to roll back on their own.

**Make `down` undo only what `up` did.** The tutorial has an example: the backfill marks the
documents it changed, so `down` doesn't wipe values that were there before. If a change truly can't
be undone (you deleted data), say so in `down` with a clear error instead of pretending:

```js
export async function down() {
  throw new Error('Cannot restore deleted sessions. Restore from the nightly backup if needed.');
}
```

**Make `up` safe to run twice when you can.** Use filters like `{ status: { $exists: false } }`
rather than "update everything". If a run dies halfway, the second attempt then only finishes the
job.

**Don't import your app's models.** Models change over time, but a migration should behave the same
in a year as it does today. Use `db.collection(...)` directly, or copy the bits of schema you need
into the migration.

**Don't edit a migration after it has run somewhere.** Not even to fix a typo. Write a new one.
mmk will [notice the edit](/guide/concepts#checksums) anyway.

**Big data changes go in batches.** `updateMany` over ten million documents can run for a long time
and load your cluster. Loop over `_id` ranges and update a few thousand at a time.

## The author line

`author` answers "who wrote this?", which is different from `executedBy` (the OS user who ran it,
often a CI bot). `mmk create` fills it in, using the first of these it finds:

1. `--author "Name <email>"` on the command
2. the `author` setting in your config, or `MMK_AUTHOR`
3. your git `user.name <user.email>`
4. your OS username

The value is written into the file once, when you create it. `mmk up` reads it from the file and
never calls git, so it works the same in a container with no `.git` folder. Because the line is part
of the file, it's covered by the checksum like the rest of the code. An empty string means "no
author".

If you want every migration to have an author, set `requireAuthor: true` (or
`MMK_REQUIRE_AUTHOR=true`). Before it runs anything, `mmk up` checks every file it's about to apply
and refuses the whole run if any are missing one:

```text
✖ MIGRATION_INVALID_EXPORT: 2 migrations have no author, and requireAuthor is on
  Missing an author: 20260605143021-add-index.js, 20260606090000-backfill.js
  Add to each file: export const author = 'Jane Doe <jane@example.com>';
  Nothing was applied — the check runs before any migration starts
  To allow migrations without an author, set requireAuthor: false (or MMK_REQUIRE_AUTHOR=false)
```

Files that already ran before you turned this on aren't checked.

## File names

`mmk create` names files `<timestamp>-<name>.js`, for example
`20261015223652-add-user-status.js`. Files run sorted by name, so the timestamp keeps them in the
order they were written.

If you prefer `0001-`, `0002-` numbering, set `sequential: true`. Be careful with it on a database
that several repos share: two repos will both have a `0001-` file. See
[Sharing a database](/guide/shared-database).

## TypeScript

Migrations and the config file can be TypeScript. mmk runs `.ts` files with the Node you have:
Node 22.18 or newer runs them as they are, and older Node needs `tsx`. Node only removes types, so
a few TypeScript features (`enum`, for one) aren't available.

[TypeScript](/guide/typescript) covers it in full: setup, the types the package exports, a
tsconfig that checks your migrations, and running TypeScript in production.

## Next

Writing migrations in TypeScript? Read [TypeScript](/guide/typescript) next. Otherwise,
[A normal day with mmk](/guide/workflow) shows how these pieces fit into everyday work: writing a
migration, testing it, getting it reviewed and shipping it.
