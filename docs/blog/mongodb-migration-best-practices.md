---
title: "Habits that make MongoDB migrations safe"
description: "MongoDB migration best practices learned the hard way: reversible migrations, rolling back one file, dry runs, locking, checksums, transactions, batches, expand and contract, and keeping history."
date: 2026-07-29
author: Santosh Gupta
---

# Habits that make MongoDB migrations safe

I learned most of these on a Friday afternoon when I shipped a bad migration, couldn't roll it back
cleanly, and ended up fixing the database by hand. This is the list I wish I'd had before that day.

Most of it applies whatever tool you use. Where a habit maps to a command, I'll show it with
mongo-migrate-kit (`mmk`), the tool I [ended up building](./why-i-built-mongo-migrate-kit).

## 1. Write the `down` when you write the `up`

Not "later". Later doesn't come, and the one day you need to roll back is the day you find there's
no way back.

And make `down` undo only what `up` did. If `up` sets `status: 'active'` on users who had no status,
`down` shouldn't remove `status` from everyone. Mark what you changed, or filter carefully:

```js
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

If a change really can't be undone (you deleted data), make `down` throw with a clear message. Don't
pretend an empty `down` is a rollback.

## 2. Then actually run the `down`

A `down` that has never run probably doesn't work. Before you commit, run `up`, then `down`, then
`up` again on your machine. Better still, have CI do it on every pull request.

<Cast name="devloop" alt="Terminal: mmk up, the file is edited, mmk redo reverts and re-applies it, then mmk down checks the rollback works" />

## 3. Be able to roll back one migration

"Undo the most recent one" stops being enough once you ship several migrations together or have
more than one environment. You want to undo a specific file, or a specific release:

```bash
npx mmk down <file>          # one file
npx mmk down --batch <n>     # one release
npx mmk down --steps <n>     # the last N, whatever the release
```

(There's a [whole post on this](./rollback-specific-mongodb-migration).)

## 4. Look before you run

Never run a migration against production without seeing the plan first:

```bash
npx mmk dry-run up
```

It writes nothing and takes a second. Make it a step in your deploy job so it ends up in the log.

## 5. Lock against two runs at once

Two deploys, a retried CI job, or several app instances booting together can all try to apply the
same migration. With a lock, the second one stops. It should be on by default, not something you
remember to turn on. (How a good lock handles crashes and long migrations:
[the locking post](./mongodb-migration-locking-concurrent-deploys).)

## 6. Notice edits to migrations that already ran

A migration runs in production. Then someone edits the file (a "small fix") and it ships. Now the
file doesn't match what changed the database, and environments drift apart without anyone noticing.

Save a checksum of each file when it runs, and compare later. `mmk status` shows `MISMATCH` for an
edited file, and `mmk down` refuses to run an edited rollback unless you `--force` it. The rule for
people is simpler: once a migration has run anywhere, it's history. Changes go in a new file.

## 7. Use transactions for changes with several steps

If a migration makes three writes and dies after the second, the database is neither "before" nor
"after". On a replica set or sharded cluster, wrap it in a transaction, so it's all or nothing:

```js
export const useTransaction = true;

export async function up({ db, session }) {
  await db.collection('plans').updateMany({}, { $set: { legacy: true } }, { session });
  await db.collection('plans').insertOne({ _id: 'pro', price: 29 }, { session });
}
```

Pass `session` to every call, or that call won't be part of the transaction. mmk also writes its own
history record inside the same transaction, so a migration can never be "done but not recorded"
and run again next deploy.

## 8. Work in batches on big collections

`updateMany` over ten million documents can run for a long time, load your primary, and push your
secondaries behind. Loop over `_id` ranges and update a few thousand at a time. Write it so a second
run picks up where the first stopped (filter on documents that still need the change). Big data
changes also don't fit in a transaction, which is another reason to make them safe to repeat.

## 9. Change the schema in steps the running code can live with

During a deploy, old and new versions of your app run side by side for a while. A migration that
renames `name` to `fullName` breaks whichever version expects the other field.

The safe pattern is **expand, then contract**:

1. **Expand:** add `fullName` next to `name`. Deploy code that writes both and reads `fullName`,
   falling back to `name`.
2. **Backfill:** a migration copies `name` into `fullName` where it's missing.
3. **Contract:** once nothing reads `name` any more, a later migration removes it.

<Diagram name="expand-contract" />

Three small migrations over a few deploys, instead of one that has to be perfectly timed.

## 10. Keep the history, all of it

When you roll a migration back, don't delete its record. Mark it reverted and keep it. "What ran
against this database, when, and who ran it" is the first question in an incident. mmk keeps the
batch, dates, duration, checksum, environment, who ran it and who wrote it on every record.

## 11. Run migrations from the pipeline, with config from the environment

Once more than one person ships, "I ran it from my laptop" isn't a process. Run migrations in CI,
the same way every time ([here's a GitHub Actions setup](./mongodb-migrations-ci-cd-github-actions)).
Keep connection strings in environment variables or a secret manager, never in the repo.

## The short version

Write the `down` and run it. Roll back one file when one file is wrong. Look before you run. Lock.
Notice edits. Use transactions for multi-step changes and batches for big ones. Change schemas in
steps. Keep the history. Run it from CI.

I picked up most of these after the Friday that taught me why they matter. You don't have to wait for
your own.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk dry-run up    # the safest possible first command
```

The [docs](/guide/) start with a five-minute quick start. The package is on
[npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [How to roll back a single MongoDB migration](./rollback-specific-mongodb-migration)
- [Why I built a new MongoDB migration tool](./why-i-built-mongo-migrate-kit)
