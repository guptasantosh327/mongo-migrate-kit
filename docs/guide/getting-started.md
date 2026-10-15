---
title: Quick start
description: Install mongo-migrate-kit, create a MongoDB migration, run it, check the status and roll it back in about five minutes.
---

# Quick start

<p class="page-meta">Step 1 of the learning path · about 5 minutes</p>

This page gets you from nothing to a migration you have run and rolled back. If you'd like each step
explained as you go, the [tutorial](/guide/tutorial) covers the same ground more slowly.

Here's the whole thing in one recording. The steps below match it.

<Cast name="quickstart" alt="Terminal: mmk init creates a config, mmk create makes a migration file, mmk up applies it and mmk status shows it as applied" />

## 1. Install

You need the package and the official MongoDB driver:

::: code-group

```bash [npm]
npm install mongo-migrate-kit mongodb
```

```bash [pnpm]
pnpm add mongo-migrate-kit mongodb
```

```bash [yarn]
yarn add mongo-migrate-kit mongodb
```

:::

This gives you the `mmk` command. Run it with `npx mmk`, or add scripts to `package.json` (see the
end of this page).

You need Node.js 18 or newer and a MongoDB server, version 4.2 or newer. If you don't have one
running, Docker is the quickest way: `docker run -d -p 27017:27017 mongo`.

::: warning Is your project CommonJS?
The files `mmk init` and `mmk create` write use `export`, which needs `"type": "module"` in your
`package.json`. Recent versions of `npm init -y` create CommonJS projects (`"type": "commonjs"`), and
there the next command fails with `Unexpected token 'export'`. For a new project, run
`npm pkg set type=module` first. For an existing CommonJS app, see
[CommonJS projects](/guide/writing-migrations#commonjs-projects).
:::

## 2. Create a config file

```bash
npx mmk init
```

This writes `mmk.config.js` in the current folder. Every option is in there with a comment. For now,
only two lines matter:

```js
// mmk.config.js (trimmed)
const config = {
  uri: 'mongodb://localhost:27017',
  dbName: 'myapp',
  // ...everything else has a sensible default
};
```

Change `dbName` to your database. Want TypeScript or JSON instead? Use `npx mmk init --ts` or
`npx mmk init --json`.

::: tip You can skip the file
The config file is optional. Setting `MMK_URI` and `MMK_DB` in your environment (or a `.env` file)
works just as well.
:::

## 3. Create a migration

```bash
npx mmk create add-users-email-index
```

```text
Loaded config from mmk.config.js
✔ Created  20261015223650-add-users-email-index.js
```

The file lands in `migrations/` with a timestamp at the front, so files always sort in the order you
made them. Open it and fill in both functions:

```js
// migrations/20261015223650-add-users-email-index.js
export const description = 'Unique index on users.email';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').dropIndex('email_1');
}
```

`up` makes the change. `down` undoes it. The `author` line is filled in for you from your git name.

## 4. Run it

```bash
npx mmk up
```

```text
Loaded config from mmk.config.js
✔ Applied  20261015223650-add-users-email-index.js   [117ms]
```

## 5. Check where you are

```bash
npx mmk status
```

```text
Loaded config from mmk.config.js
┌─────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬──────────┐
│ Migration                               │ Status  │ Batch │ Applied At          │ Checksum │ Author   │
├─────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┤
│ 20261015223650-add-users-email-index.js │ applied │ 1     │ 2026-10-15 22:36:51 │ ok       │ Asha Rao │
└─────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴──────────┘
```

## 6. Roll it back

```bash
npx mmk down
```

```text
Loaded config from mmk.config.js
↩ Reverted 20261015223650-add-users-email-index.js   [5ms]
```

The index is gone, and the migration shows as `pending` again. The record of it running is still
in the database, marked `reverted`. mmk never deletes history.

## Add some npm scripts

Typing `npx mmk` gets old. Most projects add something like this:

```json
{
  "scripts": {
    "migrate": "mmk up",
    "migrate:down": "mmk down",
    "migrate:status": "mmk status",
    "migrate:new": "mmk create"
  }
}
```

Then `npm run migrate:new -- add-orders-index` creates a file and `npm run migrate` runs it.

## Where to go next

- [Tutorial](/guide/tutorial) if you want the same steps with more explanation.
- [How it works](/guide/concepts) to understand batches, the history collection and the lock.
- [Writing migrations](/guide/writing-migrations) for TypeScript, CommonJS and good habits.
