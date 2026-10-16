---
title: How it works
description: How mongo-migrate-kit decides what to run, where it keeps history, what a batch is, and how the lock and checksums keep production safe.
---

# How it works

<p class="page-meta">Step 2 of the learning path · about 10 minutes</p>

You can use mmk without reading this page. But ten minutes here will make every error message and
every flag make sense, and you'll know what's going on when something goes wrong in production.

## Migrations and the history collection

A migration is a file with an `up` function and a `down` function. That's all mmk needs from you.

mmk keeps track of what has run in a collection in your database called `_mmk_migrations`. Each
migration that has run gets one record. Here's a real one, from the tutorial:

```js
{
  name: '20261015223652-add-user-status.js',
  batch: 1,
  status: 'reverted',               // 'applied' while it's in effect
  appliedAt: ISODate('2026-10-15T17:09:58.069Z'),
  revertedAt: ISODate('2026-10-15T17:09:58.213Z'),
  duration: 1,                      // milliseconds
  checksum: 'f14593fff4ae45172a4847290917f42ad36ca84bcdedf5327ba98b1cf0f171e7',
  environment: 'production',        // NODE_ENV when it ran
  executedBy: 'asha',               // the OS user who ran it
  author: 'Asha Rao',               // who wrote it, from the file
  description: 'Give every user a status',
}
```

Two things to take away:

1. **This collection is how mmk knows what's done.** If a file has an `applied` record, it won't
   run again. If it doesn't, it's pending.
2. **Records are never deleted.** Rolling back sets `status` to `reverted` and adds `revertedAt`.
   When something breaks at 2am, you can see exactly what ran, when, and who wrote it.

A second collection, `_mmk_locks`, holds the lock while a run is in progress. It's empty the rest
of the time. You don't need to create either one. mmk does that the first time it runs.

## How mmk decides what to run

<Diagram name="how-up-works" />

When you run `mmk up`, mmk:

1. takes the lock, so nobody else runs migrations at the same time,
2. lists the files in your migrations folder and compares them with the records,
3. runs every file that has no `applied` record, oldest first (by file name), and saves a record
   after each one,
4. releases the lock. It always does this, even if a migration failed.

If a migration throws, the run stops right there. Files after it don't run, and the failed file
stays pending so you can fix it and run `mmk up` again.

### Why file names matter

Order comes from the file name, and that's why `mmk create` puts a timestamp at the front
(`20261015223652-add-user-status.js`). Everyone on the team gets the same order, whatever order
they pulled the files in.

Two rules follow from this:

- **Don't rename a file that has run anywhere.** The record is keyed by file name, so a renamed file
  looks like a new, pending migration.
- **Don't edit a file that has run anywhere.** Write a new migration instead. (More on this under
  [checksums](#checksums).)

## Batches

Every `mmk up` run gets a batch number. If one run applies three files, all three share the same
batch. Think of a batch as "what one deploy changed".

Batches matter when you roll back, because `mmk down` works on batches by default:

<Diagram name="batches" />

- `mmk down` undoes the **last batch**. That's usually what you want after a bad deploy: one command
  undoes everything that deploy did.
- `mmk down --batch 2` undoes **one batch by number**, even if it isn't the latest.
- `mmk down --steps 3` ignores batches and undoes the **last three files**, newest first.
- `mmk down <file>` undoes **one file**.

Files are always undone newest first. Here's a real session: two batches, undo the last one, then
one more file with `--steps`:

<Cast name="rollback" alt="Terminal: mmk status shows four migrations in batches 1 and 2; mmk down reverts both files of batch 2; mmk down --steps 1 reverts one more; mmk status shows one applied and three pending" />

If you'd rather undo files one at a time, run `mmk up --step`. It gives each file its own batch, so
a plain `mmk down` undoes only the newest one.

## The lock

Picture two deploys starting a few seconds apart, or three app instances booting at once. Without
anything to stop them, they'd all see the same pending migration and all try to run it.

So before it writes anything, mmk takes a lock: one document in `_mmk_locks`. Taking it is a single
atomic operation in MongoDB, so only one process can win. Anyone else stops straight away and is
told who has it:

<Cast name="lock" alt="Two terminals. Deploy A runs mmk up and starts a slow migration. Deploy B runs mmk up two seconds later and gets LOCK_ALREADY_HELD naming the host, pid and user. When A finishes, B runs again and gets Nothing to migrate" />

A few details that matter in production:

- **It expires.** If a process is killed and never releases the lock, the lock goes stale after
  `lockTTLSeconds` (60 by default) and the next run can take it.
- **Long migrations keep it.** While a migration runs, mmk renews the lock every half TTL, so a
  20-minute backfill doesn't lose its lock halfway through.
- **You can clear it by hand.** [`mmk unlock`](/commands/unlock) shows who holds it and asks before
  removing it.
- **Read-only commands don't take it.** `status`, `list` and `dry-run` never wait for the lock.

If your app runs migrations on startup, [`runMigrations({ onLockHeld: 'wait' })`](/guide/api) makes
the other instances wait their turn instead of failing.

## Checksums

When a migration runs, mmk saves a SHA-256 checksum of the file. Later it compares the file on disk
with that checksum. If they differ, someone edited a migration after it ran.

That's a problem because the database was changed by the old code. The new code describes something
that never happened. Here's what it looks like:

<Cast name="checksum" alt="Terminal: a line is appended to an applied migration; mmk status shows MISMATCH in the Checksum column; mmk down refuses with CHECKSUM_MISMATCH and explains the options" />

- `mmk status` shows `MISMATCH` in the Checksum column.
- `mmk down` refuses to run an edited file's `down()` and tells you how to proceed. Rolling back
  with code that doesn't match what ran is the risky direction, so this check is always on.
- `mmk up` only looks at pending files, so it won't notice an edit to a file that already ran.
  That's why `mmk status` is the place to look. (If you name an applied file, as in
  `mmk up <file>`, mmk warns and skips it, or stops if `strict` is on.)

The fix is almost always the same: put the old file back (`git checkout`), and make the change in a
new migration. If you really mean it, `--force` gets you past the check.

## When a migration fails

The run stops at the failed file and mmk tells you what happened: the error, the line in your file
that threw it, and whether the writes it made are still in the database.

<Cast name="failure" alt="Terminal: mmk up fails with MIGRATION_EXECUTION_FAILED showing the E11000 reason, the file and line, and that the writes were rolled back because the migration used a transaction; mmk list --pending still lists it" />

That last part depends on whether the migration ran in a transaction. Without one, any writes made
before the error stay. With `export const useTransaction = true`, they're rolled back together with
the record. See [Transactions](/guide/transactions).

## Summary

| Thing | Where it lives | What it's for |
| --- | --- | --- |
| Migration files | `migrations/` in your repo | The changes, in name order |
| History | `_mmk_migrations` collection | Which files ran, when, by whom; never deleted |
| Lock | `_mmk_locks` collection | One run at a time per database |
| Checksum | on each history record | Notices files edited after they ran |
| Batch | on each history record | Groups one run, so one `down` can undo it |

## Next

[Writing migrations](/guide/writing-migrations) covers the file format in full and the habits that
make migrations easy to roll back. Using TypeScript? See [TypeScript](/guide/typescript) too.
