---
title: "7 things I kept missing in migrate-mongo"
description: "Seven gaps in migrate-mongo that cost me time in production: single-file rollback, dry runs, locking that's off by default, edited files, redo, lost history and older batches."
date: 2026-06-24
author: Santosh Gupta
---

# 7 things I kept missing in migrate-mongo

I used migrate-mongo for years. It's simple and it does the basics well. But each of the gaps below
cost me time, stress, or a late night at some point, so here's the list.

For each one I'll say what went wrong and what I do now. Fair warning: "what I do now" is
mongo-migrate-kit, the tool I built after running into all of these.

## 1. Rolling back one specific migration

This one hurt the most. I shipped three migrations together and the third had a bug. I wanted to
undo just that one.

migrate-mongo's `down` undoes the most recently applied migration, and `down --block` undoes the
last group. Neither lets you say "this file". So I either rolled back two good migrations with the
bad one, or fixed it by hand. I fixed it by hand, on production.

**Now:**

```bash
npx mmk down 20261014103000-add-orders-customer-index.js   # just this one
npx mmk down --batch 3                                     # or an older release, by number
```

## 2. Seeing the plan before it runs

migrate-mongo runs migrations as soon as you ask. There's no "show me what you're about to do". In
production that's a small leap of faith every time. People have asked for a dry run in the
[issue tracker](https://github.com/seppevs/migrate-mongo/issues/43).

**Now:**

```bash
npx mmk dry-run up
npx mmk dry-run down
```

Both print the plan and write nothing. I run one before every production deploy.

## 3. A lock that's on by default

Two CI jobs started close together, and both ran migrations against the same database at the same
time. Cleaning that up took an afternoon.

To be fair, newer migrate-mongo versions have a lock. But it's off unless you set `lockTtl`, and we
hadn't. Most setups I've seen haven't either.

**Now:** mmk takes a lock in MongoDB before every run. A second run stops and tells you who holds
it. A crashed run's lock expires on its own, and long migrations keep renewing theirs. Nothing to
set up.

<Cast name="lock" alt="Two terminals: deploy A runs a slow migration; deploy B starts two seconds later and is stopped with LOCK_ALREADY_HELD naming the holder; when A finishes, B finds nothing to migrate" />

## 4. Noticing when an applied file was edited

Someone edits a migration that already ran. Maybe a "quick fix", maybe a bad merge. The file no
longer matches what actually changed the database, and environments quietly drift apart.

By default migrate-mongo only records the file name. Its `useFileHash` option stores a hash, but uses
it to re-run files whose contents changed, which is a different goal.

**Now:** mmk saves a checksum of each file when it runs. `mmk status` shows `MISMATCH` for edited
files, and `mmk down` refuses to run an edited file's rollback unless you add `--force`.

<Cast name="checksum" alt="Terminal: a line is appended to an applied migration; mmk status shows MISMATCH; mmk down refuses with CHECKSUM_MISMATCH" />

## 5. Redo

While writing a migration, my loop is: run it, check the data, it's wrong, undo, fix, run again. In
migrate-mongo that's `down` then `up` every time, and you'd better hope `down` undoes the right
thing.

**Now:**

```bash
npx mmk redo           # undo the latest and run it again
npx mmk redo <file>    # or a specific one
```

Small thing. I use it all the time.

## 6. Keeping history after a rollback

When migrate-mongo rolls a migration back, it deletes the changelog entry. The record that it ever
ran is gone.

That's the opposite of what you want for an audit trail. "Did this run last Tuesday and get rolled
back, or did it never run?" You can't answer that once the evidence is deleted.

**Now:** a rollback marks the record `reverted` and adds the time. Every record keeps its batch,
dates, duration, checksum, environment, who ran it and who wrote it.

## 7. Undoing an older release

Releases pile up. Sometimes the problem is two releases back, and everything since is fine.
migrate-mongo can undo the last block, but not an older one.

**Now:** each `mmk up` gets a batch number, and `mmk down --batch 2` undoes that one release.
`mmk down --steps 3` undoes the last three files whatever release they were in. This picture shows
the difference:

<Diagram name="batches" />

## To be fair

migrate-mongo isn't bad. For a small project that stays small, it's fine, and using it is how I
learned what I actually needed.

But each gap above shows up as a project grows: more migrations, more environments, more people
deploying. That's exactly when manual cleanup is most expensive.

If some of these sound familiar, switching is easier than you'd think, because mmk can import your
existing history:

```bash
npm install mongo-migrate-kit
npx mmk import --dry-run    # see what would be copied, write nothing
npx mmk import              # your old changelog isn't touched
npx mmk up
```

It's on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit). If this list saved you from learning
one of these the hard way, a star helps the next person find it.

---

### Related reading

- [Switching from migrate-mongo, step by step](./switching-from-migrate-mongo)
- [How to roll back a single MongoDB migration](./rollback-specific-mongodb-migration)
