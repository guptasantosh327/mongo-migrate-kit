---
title: "MongoDB Migration Best Practices: Lessons From a Bad Friday Deploy"
description: "Ten MongoDB migration best practices learned the hard way — reversibility, checksums, locking, dry runs, transactions, never deleting history, and running them in CI."
date: 2026-07-29
author: Santosh Gupta
---

# MongoDB Migration Best Practices: Lessons From a Bad Friday Deploy

I learned most of these the hard way — specifically on a Friday afternoon when I shipped a bad
migration, couldn't cleanly roll it back, and ended up doing database surgery by hand. This is the
checklist I wish I'd had before that day.

It's tool-agnostic advice. Where a practice maps to something concrete, I'll show it with
**mongo-migrate-kit** (`mmk`), the tool I [eventually built](./why-i-built-mongo-migrate-kit)
because my old setup didn't support half of this list.

## 1. Every migration must be reversible

Write the `down()` when you write the `up()`, not "later." Later never comes, and the one time you
need to roll back is the one time you'll discover there's no path back.

```js
export async function up({ db })   { await db.collection('users').createIndex({ email: 1 }, { unique: true }); }
export async function down({ db }) { await db.collection('users').dropIndex('email_1'); }
```

If a migration is *genuinely* irreversible (a destructive data transform), say so loudly in the
file's description and treat deploying it as a one-way door. Don't pretend a no-op `down()` is a
rollback.

## 2. Be able to roll back ONE migration, not just "the last one"

This is the practice that started everything for me. "Undo the most recent migration" falls apart
the moment you've deployed several together or have multiple environments. You want to revert a
*specific* file:

```bash
mmk down <file>          # exactly one
mmk down --batch <n>     # one whole release
mmk down --steps <n>     # the last N, ignoring batches
```

If your tool can't do this, you'll eventually do it by hand. (I wrote a
[whole post on it](./rollback-specific-mongodb-migration) because it's that common.)

## 3. Preview before you run — always, in production

Never run a migration against production without first seeing the plan. A dry run that touches
nothing turns "leap of faith" into "informed decision":

```bash
mmk dry-run up      # prints the plan, writes nothing
```

Two seconds. Do it every time.

## 4. Lock against concurrent runs

Two deploys, two CI jobs, or two app instances booting at once can all race to apply the same
migration. Without a lock, that's silent corruption. With one, the second run waits or fails fast.
This should be **on by default**, not something you remember to enable. (How a real lock survives
crashed holders and long migrations: [the locking deep-dive](./mongodb-migration-locking-concurrent-deploys).)

## 5. Checksum your migrations to catch edits

Here's a quiet killer: a migration runs in production, then someone *edits* that file (a "quick fix")
and it ships again. Now the code on disk doesn't match what actually ran. Different environments
silently diverge.

Record a SHA-256 of each file when it's applied, and verify it on every subsequent run. If a file was
edited after being applied, you want to *know* — not find out during an incident. `mmk` flags it in
`status` and refuses to roll back a file whose checksum drifted, unless you explicitly `--force`.

## 6. Use transactions for multi-step migrations

If a migration does three writes and dies after the second, you're left in a state that's neither
"before" nor "after." On a replica set or sharded cluster, wrap it in a transaction so it's all or
nothing:

```js
export const useTransaction = true;
export async function up({ db, client }) {
  // every write here commits together, or none of them do
}
```

Bonus: the migration's *changelog record* should commit inside the same transaction, so you never
get the nasty "the migration ran but wasn't recorded, so it runs again next time" window. (`mmk`
does this — the record is written before commit, atomically with the migration's writes.)

## 7. Never delete migration history

When you roll a migration back, **don't erase the record** — mark it reverted and keep it. The
question "what ran against this database, when, and by whom" is one you'll need answered during an
incident or an audit. A migration tool that deletes rows on rollback is throwing away the exact
evidence you'll want at 2am. Keep duration, checksum, environment, and user on every record.

## 8. Run migrations in CI, not from laptops

The moment more than one person ships, "I ran it locally" stops being a deployment strategy. Put
migrations in the pipeline: a gate that fails the build if something's pending
(`mmk status --check`), a dry-run preview step, and an apply step on deploy. Same way every time,
logged, reviewable. (A full [GitHub Actions setup here](./mongodb-migrations-ci-cd-github-actions).)

## 9. Keep config out of the repo

Connection strings don't belong in committed files. Drive everything from environment variables
(`MMK_URI`, `MMK_DB`, …) so the same migration commands work locally, in CI, and in production with
zero file changes — and so a secret never lands in git history. Better still, load the URI from a
secret manager at runtime.

## 10. Name migrations so order is obvious

Timestamp- or sequence-prefix every file (`20260101120000-add-users-index.js`). Migrations are
order-dependent; the filename should make that order unambiguous at a glance, and sort correctly in
a directory listing. `mmk create <name>` does this for you.

## The one-paragraph version

Write reversible migrations and test the `down`. Be able to roll back one file, not just the last.
Dry-run before production. Lock against concurrency. Checksum to catch edits. Use transactions for
multi-step changes. Never delete history. Run it all in CI. Keep secrets out of the repo. Name files
so order is obvious. Do those ten things and migrations stop being the scary part of a deploy.

Most of them, I only adopted *after* the Friday that taught me why they matter. You don't have to
wait for your own.

## Try it

```bash
npm install mongo-migrate-kit mongodb
mmk dry-run up    # start with the safest possible command
```

Docs and recipes for every practice above: **https://mongo-migrate-kit.vercel.app** · npm/GitHub:
**mongo-migrate-kit**.

---

### Related reading

- [How to Roll Back a Single MongoDB Migration](./rollback-specific-mongodb-migration) —
  best practice #2, in depth.
- [Why I Built a New MongoDB Migration Tool](./why-i-built-mongo-migrate-kit) — the Friday
  these lessons came from.
