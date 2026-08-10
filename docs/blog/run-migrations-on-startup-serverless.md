---
title: "Running MongoDB Migrations on App Startup and in Serverless (Safely)"
description: "How to run MongoDB migrations safely from your app's startup code or a serverless function — without leaking connections or letting parallel instances race."
date: 2026-07-15
author: Santosh Gupta
---

# Running MongoDB Migrations on App Startup and in Serverless (Safely)

There's a moment in most projects where someone says: "can't we just run the migrations when the app
boots?" No separate deploy step, no remembering to run `mmk up` — the app brings the schema up to
date itself.

It's a reasonable wish. It's also where a lot of people quietly create bugs: leaked database
connections, migrations racing across parallel instances, or a half-migrated app serving traffic.
Here's how to do it properly.

## The trap with hand-rolling it

The naive version looks fine:

```js
const client = await MongoClient.connect(uri);
// ...run migrations somehow...
// 🔥 forgot to disconnect, or didn't disconnect on the error path
```

The problems pile up fast:

- **Connection leaks.** If a migration throws, do you still close the client? In serverless, a
  leaked connection per cold start will exhaust your Atlas connection limit by lunchtime.
- **Parallel instances racing.** A rolling deploy or a serverless burst spins up *N* instances at
  once. All *N* hit the migration code simultaneously. Without coordination, they race (see
  [migration locking](./mongodb-migration-locking-concurrent-deploys)).
- **Serving traffic mid-migration.** You want the app to wait until migrations are *done* before it
  accepts requests, and to fail loudly if they didn't apply.

You can solve all of these by hand. You shouldn't have to.

## The blessed entry point: `runMigrations()`

**mongo-migrate-kit** ships a programmatic API designed for exactly this. One call that opens its
own connection, runs everything pending, and **always disconnects in a `finally`** — leak or no
leak, error or success.

```js
import { runMigrations } from 'mongo-migrate-kit';

const summary = await runMigrations({
  uri: process.env.MONGO_URI,
  dbName: process.env.MONGO_DB,
});

console.log(`Applied ${summary.applied.length} migration(s)`);
```

Put that at the top of your server bootstrap, *before* you start listening:

```js
await runMigrations({ uri, dbName });   // schema is now up to date, or this threw
app.listen(3000);                       // only now do we accept traffic
```

If a migration fails, `runMigrations` throws — your boot fails fast and your orchestrator doesn't
route traffic to a half-migrated instance. That's the behavior you want.

## Parallel instances: wait, don't fail

Here's the part that matters for rolling deploys and serverless bursts. When five instances boot at
once, they all call `runMigrations`. One wins the lock and runs the migrations. The other four hit a
held lock — and you do **not** want four crashed boots.

So tell them to wait:

```js
await runMigrations(
  { uri, dbName },
  { onLockHeld: 'wait', lockWaitTimeoutMs: 60_000 },
);
```

Now the four losers poll until the winner finishes, see there's nothing left to apply, and continue
booting cleanly. Set `lockWaitTimeoutMs` comfortably longer than your slowest migration. The
returned summary tells you which instance actually did the work:

```js
const { applied, upToDate, waited } = await runMigrations(/* ... */);
// applied: what THIS call ran (empty on the instances that waited)
// upToDate: true if nothing was pending
// waited: true if this instance queued behind the lock holder
```

## Serverless: the readiness probe

In a serverless function you often don't want to *run* migrations on every cold start — you want to
**check** whether the database is up to date and fail fast if a deploy forgot to migrate. There's a
read-only probe for that:

```js
import { pendingMigrations } from 'mongo-migrate-kit';

const pending = await pendingMigrations({ uri, dbName });
if (pending.length > 0) {
  throw new Error(`Database is behind: ${pending.length} migration(s) pending`);
}
```

It connects, lists what's pending, and disconnects — no lock, no writes. Wire it into a health
check or a function's init and you'll never again discover at runtime that a deploy shipped code
expecting a schema that was never migrated.

## A note on the connection itself

`runMigrations` builds its `MongoClient` with sane production defaults — sensible
server-selection/connect timeouts, `retryWrites`, and majority write concern on the collections
that need durability (the lock and the changelog) so mutual exclusion and your audit trail survive a
primary failover. If you need TLS, custom auth, or different timeouts, pass `mongoClientOptions` and
they're merged over the defaults. You're not giving up control to get the convenience.

## The whole pattern

```js
import { runMigrations, pendingMigrations } from 'mongo-migrate-kit';

// On boot — run, wait for the lock if another instance is migrating:
await runMigrations({ uri, dbName }, { onLockHeld: 'wait', lockWaitTimeoutMs: 60_000 });

// In a health check — read-only "are we up to date?"
const pending = await pendingMigrations({ uri, dbName });
```

Connection lifecycle handled. Parallel boots handled. No leaks. No racing. No serving traffic
against a schema that isn't there yet.

## Try it

```bash
npm install mongo-migrate-kit mongodb
```

Then drop `runMigrations` into your bootstrap. Recipes for app-start, multi-instance, and serverless
are in the docs: **https://mongo-migrate-kit.vercel.app** · npm/GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Stop Concurrent Deploys From Corrupting Your Database](./mongodb-migration-locking-concurrent-deploys)
  — the lock that makes `onLockHeld: 'wait'` safe.
- [MongoDB Migrations in CI/CD](./mongodb-migrations-ci-cd-github-actions) — the other common
  place to run migrations: the pipeline.
