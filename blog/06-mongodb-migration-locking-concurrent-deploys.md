<!--
SEO target keyword: "mongodb migration lock concurrent deploys" / "prevent concurrent migrations"
Meta description: Two deploys running migrations at the same time can corrupt your database. Here's
how a MongoDB-native distributed lock prevents it — with TTLs, stale-lock reclaim, and heartbeats.
-->

# Stop Concurrent Deploys From Corrupting Your Database: MongoDB Migration Locking

Here's a bug that doesn't show up in development and is brutal in production: **two things run your
migrations at the same time.**

Two CI jobs fire on a retry. A rolling deploy spins up two app instances that both run migrations on
boot. A teammate runs `up` locally against the shared staging DB while the pipeline does the same.
Whatever the cause, two processes now race to apply the same pending migration — and MongoDB has no
opinion about that. Both can run. You can end up with the same index built twice, the same data
transformed twice, or a half-applied mess that matches no one's mental model.

The fix is a **migration lock**: a guarantee that only one migration run touches the database at a
time. This is what it is, and how it works in **mongo-migrate-kit**.

## The naive lock (and why it's not enough)

The obvious approach: keep a `_locks` collection, write a "locked" document before running, delete
it after. While it exists, nobody else may run.

The atomic version uses `findOneAndUpdate` with `upsert: true` as a test-and-set — MongoDB
guarantees only one writer wins the upsert, so only one process gets the lock. Good start. But a
naive lock has three holes, and each one is a real incident waiting to happen.

### Hole 1: the crashed holder (stale locks)

A process acquires the lock and then **dies** — OOM, `kill -9`, a crashed container. The lock
document is still sitting there. Now nobody can ever run migrations again until a human logs in and
deletes it by hand. You've traded a race condition for a deadlock.

**The fix is a TTL.** Each lock records `lockedAt`. A lock is only respected if it's *fresh* —
within `lockTTLSeconds` (default 60). Acquisition logic:

```text
if a lock exists AND lockedAt is within the TTL  → someone is really running → refuse
otherwise (no lock, or it's stale)               → take it
```

A crashed holder's lock goes stale after the TTL and the next run reclaims it automatically. No
human required. If you do want a human in the loop, `mmk unlock` shows you who holds it and releases
it on confirmation.

### Hole 2: the stale-reclaim race

The TTL fixes the deadlock but opens a subtler race. Two processes both see the *same* stale lock at
the same instant. Both decide "it's stale, I'll take it." Both upserts succeed. Now **both think
they hold the lock** — exactly the concurrency you were trying to prevent.

The fix is a **per-acquire owner token**. Every acquisition writes a fresh random `owner` value into
the lock document, then **reads it back**. Because the upsert is last-writer-wins, only one
process's token survives. The winner reads back its own token and proceeds; the loser reads back a
*different* token and knows it lost — it refuses instead of running. The readback is what closes the
race.

```text
{ _id: 'mmk_lock', lockedAt, pid, host, executedBy, owner: '<random-per-acquire-token>' }
```

Release is then scoped to that token — `deleteOne({ _id, owner })` — so a process can never delete a
lock that has since been legitimately reclaimed by someone else.

### Hole 3: the long migration

The TTL that saves you from crashed holders can also betray you. Say your TTL is 60 seconds and you
have a migration that backfills a large collection and takes **four minutes**. At the 60-second mark
your *own* lock looks stale to everyone else — and another process can reclaim it and start running
**while your migration is still going.** The medicine became the disease.

The fix is a **heartbeat**. While a migration runs, the lock holder renews `lockedAt` every
`TTL/2` seconds (an `updateOne` scoped to its own `owner`). A four-minute migration keeps its lock
fresh the whole way through, so it's never stolen mid-run. The heartbeat timer is `unref`-ed (it
never keeps the process alive on its own) and cleared in a `finally` block. And if a renewal ever
discovers it *no longer* owns the lock, it logs a loud warning — that's a signal something else
started, and you want to know.

## What this looks like in practice

You don't configure any of this for the common case — it's on by default:

```bash
mmk up          # acquires the lock, runs, releases it in a finally block — always
```

If a second run starts while the first holds the lock, it fails fast and tells you who's holding it,
instead of quietly racing:

```text
✖ Lock already held by pid 4821 on ci-runner-7 (locked 3s ago)
```

Tune the staleness window if your migrations are long:

```js
// mmk.config.js
export default { lockTTLSeconds: 300 };   // 5 minutes
```

For multi-instance deploys where you *expect* a brief collision (two app instances booting at once),
the programmatic API can **wait** for the lock instead of failing — see
[running migrations on startup](./07-run-migrations-on-startup-serverless.md).

And the escape hatch for local solo dev, used loudly and on purpose:

```bash
mmk up --no-lock   # skips the lock — prints a warning — never do this against shared infra
```

## The takeaway

A migration lock isn't a nice-to-have once more than one thing can deploy your app. The detail that
separates a real lock from a toy one is how it handles the unhappy paths: **TTL** for crashed
holders, an **owner token + readback** for the reclaim race, and a **heartbeat** for long
migrations. Get those three right and "two deploys at once" stops being a way to corrupt your
database.

## Try it

```bash
npm install mongo-migrate-kit mongodb
mmk up          # locked by default — safe under concurrent deploys
```

Docs: **https://mongo-migrate-kit.vercel.app** · npm/GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Running MongoDB Migrations on App Startup and Serverless](./07-run-migrations-on-startup-serverless.md)
  — where the "wait for the lock" mode earns its keep.
- [Why I Built a New MongoDB Migration Tool](./01-why-i-built-mongo-migrate-kit.md) — a CI race is
  one of the gaps that pushed me to build this.
