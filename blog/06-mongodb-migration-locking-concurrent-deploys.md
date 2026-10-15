<!--
SEO target keyword: "mongodb migration lock concurrent deploys" / "prevent concurrent migrations"
Meta description: Two deploys running migrations at once can leave MongoDB in a mess. How a lock
stored in MongoDB prevents it, and the three cases a simple lock gets wrong: crashes, races and long
migrations.
Published copy: docs/blog/mongodb-migration-locking-concurrent-deploys.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Locking MongoDB migrations so two deploys can't collide

Here's a bug you'll never see in development: **two things run your migrations at the same time.**

A CI job gets retried while the first attempt is still running. A deploy starts two app instances
that both migrate on boot. A teammate runs `up` against staging while the pipeline does the same.
Two processes now race to apply the same pending migration, and MongoDB is happy to let them. You can
end up with the same data transformed twice, or a half-applied state that matches nobody's picture
of the database.

The fix is a lock: only one migration run may touch a database at a time. This post explains how
that works in mongo-migrate-kit, and the three places where a simple lock goes wrong.

## The simple lock

Keep a `_locks` collection. Before running, write a "locked" document. When done, delete it. While
it exists, nobody else runs.

To make "take the lock" safe when two processes try at the same instant, it has to be a single
atomic operation. MongoDB gives you that with `findOneAndUpdate` and `upsert: true`: exactly one
writer wins. Good start. But this version has three holes.

### Hole 1: the holder crashes

A process takes the lock and then dies: out of memory, `kill -9`, a cancelled CI job. The lock
document is still there. Nobody can run migrations until a person deletes it. You've swapped a race
for a deadlock.

**Fix: an expiry time.** The lock says when it expires. A lock past that time counts as abandoned,
and the next run can take it. In mmk the default is 60 seconds (`lockTTLSeconds`), and the time is
checked with the database server's clock, so a laptop or runner with a wrong clock can't get it
wrong.

If you don't want to wait, `mmk unlock` shows who holds the lock and asks before removing it.

### Hole 2: two processes reclaim the same expired lock

The expiry fixes the deadlock but opens a smaller race. Two processes look at the same expired lock
at the same moment. Both think "it's abandoned, I'll take it". Both writes succeed. Now both believe
they hold the lock.

**Fix: an owner token, and read it back.** Each attempt writes a fresh random `owner` value, then
reads the lock back. Only one write can be the last one, so only one process sees its own token. The
other sees someone else's and backs off.

Releasing works the same way: mmk deletes the lock only if `owner` is still its own token. So a
process can never delete a lock that someone else has since taken.

### Hole 3: the long migration

The expiry that saves you from crashed holders can also bite you. Your TTL is 60 seconds and you have
a backfill that takes four minutes. After a minute, your own lock looks abandoned, and another run
can take it **while your migration is still going.**

**Fix: a heartbeat.** While a migration runs, mmk pushes the lock's expiry forward every half TTL.
A four-minute migration keeps its lock the whole way through. If a renewal ever finds the lock is no
longer its own, mmk prints a loud warning, because that means something else started.

## What it looks like

You don't set any of this up. It's on for every `mmk up`, `down`, `redo` and `import`. Here's two
deploys starting two seconds apart:

![Two terminals: deploy A runs a slow migration; deploy B starts two seconds later and is stopped with LOCK_ALREADY_HELD naming the host, pid and user; when A finishes, B runs again and finds nothing to migrate](https://mongo-migrate-kit.vercel.app/gifs/lock.gif)

The second one stops at once and says who has the lock, since when, and when it frees itself if the
holder crashed:

```text
✖ LOCK_ALREADY_HELD: The migration lock is held by the default namespace
  Holder: host deploy-a, pid 16152, user asha, since 2026-10-15 22:24:21 (2s ago)
  Why: all repos on this database take turns — one migration run at a time
  If the holder crashed, the lock frees itself at 2026-10-15 22:25:21; `mmk unlock` releases it now (check the holder first)
  Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))
```

When several app instances boot together and you'd rather they wait than fail, the programmatic API
can wait for the lock. See
[running migrations on startup](./07-run-migrations-on-startup-serverless.md).

For your own machine, where nothing else is running, you can skip the lock. mmk warns you when you
do:

```text
$ npx mmk up --no-lock
⚠ Running without a lock (--no-lock) — concurrent runs are unsafe
```

Don't use that in CI.

## Summary

A lock stops mattering only when exactly one thing can ever deploy your app. Past that point, it's
the difference between a retried job being harmless and being a mess. What separates a real lock
from a toy one is the unhappy paths: an **expiry** for crashed holders, an **owner token** for the
reclaim race, and a **heartbeat** for long migrations.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk up
```

The [How it works](https://mongo-migrate-kit.vercel.app/guide/concepts#the-lock) page has more on the lock. The package is on
[npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Running MongoDB migrations on app start and in serverless](./07-run-migrations-on-startup-serverless.md),
  where waiting for the lock is useful.
- [Why I built a new MongoDB migration tool](./01-why-i-built-mongo-migrate-kit.md). A CI race was one of
  the reasons.
