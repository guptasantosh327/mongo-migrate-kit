# Switching from migrate-mongo to mongo-migrate-kit: A Zero-Downtime, Non-Destructive Guide

If you're looking for a `migrate-mongo` alternative, the scariest question isn't "is the new tool better?" It's "how do I switch without breaking everything that already works?"

This guide answers that. We'll move an existing project from `migrate-mongo` to `mongo-migrate-kit` step by step. No re-running old migrations. No data loss. No editing your old changelog. If anything looks off at any point, you can stop and you've lost nothing.

Let's go.

## Before you start

You'll need:

- A project already using `migrate-mongo` with some migrations applied.
- Access to the same MongoDB database that `migrate-mongo` has been writing to.
- Node 18 or newer.

That's it. You don't need to uninstall `migrate-mongo` yet. We'll leave it in place until you're confident.

## Step 1 — Install mongo-migrate-kit

```bash
npm install mongo-migrate-kit
npm install mongodb        # required peer dependency
```

The CLI is `mmk`. You can run it with `npx mmk` if you'd rather not install it globally.

## Step 2 — Point it at the same database

`mmk` needs to know your connection string and database name. You have two ways to do this. Pick whichever fits your setup.

**Option A — a config file.** Generate one:

```bash
npx mmk init
```

This creates an `mmk.config.js` in your project, fully commented. Open it and set your connection:

```js
export default {
  uri: 'mongodb://localhost:27017',  // the SAME database migrate-mongo uses
  dbName: 'my_app',
  migrationsDir: './migrations',     // where your migration files already live
};
```

Use `mmk init --ts` if you want a TypeScript config instead.

**Option B — no file at all.** `mmk` reads environment variables, so you can skip the config file completely:

```bash
export MMK_URI="mongodb://localhost:27017"
export MMK_DB="my_app"
export MMK_MIGRATIONS_DIR="./migrations"
```

The important thing in both cases: point `mmk` at the **same database** `migrate-mongo` has been using. That's how it can see your existing history.

## Step 3 — Preview the import (this writes nothing)

This is the step that makes the whole switch safe. Before changing anything, ask `mmk` to show you exactly what it plans to do:

```bash
npx mmk import --dry-run
```

`mmk` reads your `migrate-mongo` changelog and prints a table of every migration it found and how it'll record it. It does **not** write anything. It does **not** touch your `migrate-mongo` data.

Read the table. Does the list of migrations match what `migrate-mongo status` shows? Good. That's what we want.

By default `mmk` reads a collection named `changelog` (that's `migrate-mongo`'s default). If your project renamed it, tell `mmk` where to look:

```bash
npx mmk import --dry-run --from my_changelog_collection
```

## Step 4 — Run the import for real

Happy with the preview? Run it without `--dry-run`:

```bash
npx mmk import
```

Here's exactly what happens, so there are no surprises:

- `mmk` **reads** your `migrate-mongo` changelog and records that history in its own changelog (a collection called `_mmk_migrations` by default). Your old changelog is **never modified**.
- For each migration, it copies the filename, the applied date, and a checksum. It reuses `migrate-mongo`'s stored hash when it still matches the file on disk, and recomputes a fresh SHA-256 from disk otherwise.
- Migration files that exist on disk but aren't in the changelog yet are left **pending**. They'll run on your next `mmk up`. This is correct — those are the new ones you haven't applied.

It's a one-time, forward-only step. After this, `mmk` knows your past.

## Step 5 — Confirm

Check the status:

```bash
npx mmk status
```

You should see all your previously-applied migrations marked as applied, with their dates, and any not-yet-run files marked pending. This should line up with what `migrate-mongo status` was telling you.

Now run anything pending — these are migrations you wrote but hadn't applied yet:

```bash
npx mmk up
```

`mmk` runs only the new ones. It does not re-run the old ones, because the import told it they're already done. No re-created indexes. No duplicate seed data. Nothing touched that shouldn't be.

That's the migration. You're now on `mmk`.

## What you get on the other side

Now that you're moved over, here's what's new in your day-to-day.

**Preview before you run.** Every command has a dry run:

```bash
npx mmk dry-run up
npx mmk dry-run down
```

**Run or roll back a single file** instead of "all" or "the last one":

```bash
npx mmk up 20260101-add-index.js
npx mmk down 20260101-add-index.js
```

**Roll back a whole batch** by number:

```bash
npx mmk down --batch 3
```

**Redo** — undo and re-apply in one step, great while developing a migration:

```bash
npx mmk redo
```

**A lock** so two deploys can't migrate at the same time, and **checksums** that warn you if an already-applied migration file got edited. Both are on automatically.

## One thing to know about rollbacks

The migrations you *imported* from `migrate-mongo` are forward-only — `mmk` won't roll them back.

The reason is technical but it matters: `migrate-mongo` migrations use an `up(db, client)` signature, while `mmk` passes a single context object. Rather than run an old file's `down` in a way it can't fully guarantee, `mmk` refuses and tells you clearly:

```text
✖ Cannot roll back 1 migrate-mongo-imported migration(s): 20260101-add-index.js
```

Every migration you write *after* switching is fully reversible. And if you genuinely need an old one to roll back under `mmk`, you just rewrite that single file in the native format (named `up`/`down` exports taking one context argument).

## Writing migrations from here on

A `mmk` migration is an `up` and a `down`, like you're used to. The only change from `migrate-mongo` is the function signature — one context object instead of two arguments:

```js
export const description = 'Add unique index on users.email';

export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').dropIndex('email_1');
}
```

Create a new one with:

```bash
npx mmk create "add users email index"
```

## If you want to back out

You won't break anything by trying this. `mmk import` never writes to your `migrate-mongo` changelog. If you decide to go back, you drop the `_mmk_migrations` collection and you're exactly where you started, with `migrate-mongo` still working.

That's the whole point. A switch you can't undo isn't a switch, it's a gamble. This one isn't.

---

`mongo-migrate-kit` is on npm and GitHub under that name. If this guide saved you a stressful afternoon, a star helps others find it.
