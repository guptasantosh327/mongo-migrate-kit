<!--
SEO target keyword: "mongodb migration lock multiple services"
Meta description: When twenty repos share one MongoDB database, whose migration runs first? How
mongo-migrate-kit's single database-wide lock works: busy messages, long migrations, crashed
holders, and why finer-grained locks were left out.
Requires mongo-migrate-kit 1.5. Publish after 1.5.0 is on npm.
-->

# How locking works when 20 repos share one database

A migration lock makes sure only one migration run touches a database at a time.
[The basics](./06-mongodb-migration-locking-concurrent-deploys.md) (expiry, owner tokens, heartbeats)
are the same whether one repo uses the database or twenty. What changes with twenty is the question:
**whose lock is it?**

## One lock per database

In mongo-migrate-kit, every repo on a database takes the **same** lock: a single document in
`_mmk_locks`, whatever the repo's namespace or history collection:

```js
{
  _id: 'mmk_lock',
  namespace: 'orders-worker',            // who holds it
  host: 'worker-7c9f', pid: 41, executedBy: 'deploy',
  acquiredAt: ISODate('2026-10-15T13:39:17Z'),
  lockedAt:   ISODate('2026-10-15T13:39:17Z'),
  expiresAt:  ISODate('2026-10-15T13:40:17Z'), // server clock + the holder's TTL
  owner: '2f16bfc9-…',
}
```

So no two migration runs ever touch a database at the same time. Not from the same repo, not from
different repos, not from different products. It's the strictest rule there is, and there's
nothing to set up.

## When the lock is busy

The second run stops at once and tells you exactly who it's waiting for. Here are two deploys of the
same repo, two seconds apart:

![Two terminals: deploy A runs a slow migration; deploy B starts two seconds later and is stopped with LOCK_ALREADY_HELD naming the holder; when A finishes, B finds nothing to migrate](https://mongo-migrate-kit.vercel.app/gifs/lock.gif)

With several repos, the message also names the repo that holds it:

```text
✖ LOCK_ALREADY_HELD: The migration lock is held by namespace "orders-worker"
  Holder: host worker-7c9f, pid 41, user deploy, since 2026-10-15 19:09:17 (4s ago)
  Why: all repos on this database take turns — one migration run at a time
  If the holder crashed, the lock frees itself at 2026-10-15 19:10:17; `mmk unlock` releases it now (check the holder first)
  Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))
```

What to do depends on where it ran:

- **CI:** re-run the job. Most migration runs take seconds.
- **App start:** use `runMigrations({ onLockHeld: 'wait' })` and it waits its turn. Set
  `lockWaitTimeoutMs` above your longest migration. The default is 30 seconds.

## Why not one lock per repo?

It's the first thing everyone asks: if `orders-api` and `notifications` have separate histories,
why can't they migrate in parallel?

I designed it (per-collection locks, per-namespace locks, a lock policy stored in the database) and
left it out, for one reason: **each repo would choose its lock scope in its own config.** If one repo
locks per namespace and another per collection, they take *different* lock documents and run at the
same time, each thinking it's protected. A safety feature you can configure into quietly not working
is worse than none.

What you'd gain is speed: two runs in parallel instead of a few seconds of waiting. What you'd risk
is two products' migrations colliding on shared data. One lock per database can't be configured
wrong. (Lock documents are temporary, so finer locking can still be added later without
touching stored data, if a real need appears.)

The one thing you *can* get wrong: **keep `lockCollection` at its default in every repo.** A repo
with a different lock collection stops taking turns with the rest.

## Each holder's TTL is respected

Repos can have different `lockTTLSeconds`. In 1.5, the holder writes its own deadline into the lock
(`expiresAt`), and everyone else judges staleness by **that**, not by their own TTL. So a repo with
a 30-second TTL can't decide that another repo's lock is stale after 30 seconds.

The deadline is set and compared on the **database server's clock**, so a CI runner whose clock is
off can't mistake a fresh lock for a stale one.

## Long migrations keep their lock

A five-minute migration with the default 60-second TTL is fine. While it runs, the holder renews the
lock every 30 seconds (half the TTL), pushing `expiresAt` forward each time. Nobody else ever sees
it as stale. **Don't raise the TTL for long migrations.** Renewal already handles them, and a bigger
TTL only means a *crashed* run blocks everyone for longer.

Two things can still stop renewal: synchronous code that blocks Node's event loop for longer than
the TTL, and losing the connection to MongoDB for longer than the TTL.

## Crashed holders free themselves

If the process holding the lock dies, it stops renewing, and the lock frees itself at `expiresAt`,
at most one TTL later. The next run just takes it.

If you can't wait, `mmk unlock` releases it now. It shows the holder first, and warns loudly when
the lock belongs to another repo:

```text
$ npx mmk unlock
⚠ Lock held by namespace "orders-worker": pid 41 on worker-7c9f (deploy) since 2026-10-15T13:39:17.867Z
⚠ This lock belongs to "orders-worker", not this repo ("orders-api") — releasing it may let two migrations run at once
Force-release this lock? [y/N]
```

Take that warning seriously. If the holder is actually alive, it keeps running. It doesn't stop when
you delete its lock. At its next renewal it notices, and says so on every renewal after that:

```text
⚠ Lost the migration lock mid-run (renewal failed) — another run may have started
✔ Applied  20261013070000-rebuild-job-stats.js   [7001ms]
```

Meanwhile any other repo can take the free lock and run alongside it. So check the holder (host,
pid, how long ago) before you unlock. A lock that's seconds old is almost certainly still in use.

## During a rolling upgrade

While some repos are still on 1.4, keep every repo's `lockTTLSeconds` at the default. A 1.4 run
doesn't know about `expiresAt`; it judges staleness by `lockedAt` and its own TTL. With 60 seconds
everywhere, a 1.5 holder renews every 30 seconds and 1.4 leaves it alone.

## In short

One lock per database: every repo takes turns, the busy message names the holder, long migrations
keep their lock by renewing it, and crashed holders free themselves. The only setting to protect is
`lockCollection`. Leave it at the default everywhere.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk up          # takes the database's lock, renews it while running, releases it after
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/shared-database** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Locking MongoDB migrations so two deploys can't collide](./06-mongodb-migration-locking-concurrent-deploys.md):
  how the lock itself works (expiry, owner tokens, heartbeats).
- [Several repos, one MongoDB database, one team](./12-multiple-repos-same-mongodb-database-migrations.md):
  the setup where this lock matters most.
