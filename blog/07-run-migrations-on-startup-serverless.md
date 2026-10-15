<!--
SEO target keyword: "run mongodb migrations on app startup nodejs" / "run migrations serverless"
Meta description: How to run MongoDB migrations from your Node.js app's start-up code or a
serverless function without leaking connections, racing other instances, or serving traffic too
early.
Published copy: docs/blog/run-migrations-on-startup-serverless.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Running MongoDB migrations on app start and in serverless

At some point in most projects someone asks: "can't the app just run the migrations when it starts?"
No separate deploy step, nothing to remember. The app brings the database up to date itself.

It's a fair idea. It's also an easy place to create quiet bugs. Here's how to do it without them.

## What goes wrong when you write it yourself

The first version usually looks like this:

```js
const client = await MongoClient.connect(uri);
// ...run the migrations...
// and if one throws, is the client ever closed?
```

Three problems tend to show up:

- **Leaked connections.** If a migration throws and the client isn't closed, every failed start
  leaks a connection. In serverless, with a cold start every few minutes, that can use up your
  Atlas connection limit surprisingly fast.
- **Instances racing.** A deploy starts five instances at once. All five reach the migration code
  together and try to apply the same migration. (More on that in the
  [locking post](./06-mongodb-migration-locking-concurrent-deploys.md).)
- **Serving too early.** You want the app to accept traffic only after migrations finish, and to
  refuse to start if they failed.

You can handle all of that by hand. You shouldn't have to.

## runMigrations()

mongo-migrate-kit has one function for this. It opens its own connection, runs whatever is pending,
and always closes the connection, whether things worked or not.

```js
import { runMigrations } from 'mongo-migrate-kit';

await runMigrations({ uri: process.env.MONGO_URL, dbName: 'shop' });
app.listen(3000); // only after the database is ready
```

If a migration fails, `runMigrations` throws and the app doesn't start. Your platform won't send
traffic to an instance running against a half-migrated database, which is what you want.

## Several instances: wait instead of failing

Five instances boot together. One gets the lock and runs the migrations. The other four find the lock
taken, and by default they throw. Four crashed boots is not what you want. So tell them to wait:

```js
await runMigrations(
  { uri: process.env.MONGO_URL, dbName: 'shop' },
  { onLockHeld: 'wait', lockWaitTimeoutMs: 60_000 },
);
```

The waiting instances check every half second. When the first one finishes, they see nothing is
pending and carry on. Set `lockWaitTimeoutMs` longer than your slowest migration.

The result tells you what happened on each instance:

```js
const { applied, upToDate, waited } = await runMigrations(/* ... */);
// applied:  what this call ran (empty on the instances that waited)
// upToDate: true if nothing was pending
// waited:   true if this instance waited for another one
```

## Serverless: check, don't run

In a serverless function you often don't want to run migrations on every cold start. You want to
check that the database is up to date, and fail fast if a deploy forgot to migrate. There's a
read-only function for that:

```js
import { pendingMigrations } from 'mongo-migrate-kit';

const pending = await pendingMigrations({ uri: process.env.MONGO_URL, dbName: 'shop' });
if (pending.length > 0) {
  throw new Error(`Database is ${pending.length} migration(s) behind`);
}
```

It connects, reads, and disconnects. No lock, no writes. Put it in a health check, and you'll find
out at deploy time, not from a customer, that code shipped expecting a schema that doesn't exist yet.

Long backfills don't belong in a function with a 30-second timeout anyway. Run those from a
[pipeline step](./08-mongodb-migrations-ci-cd-github-actions.md).

## The connection settings

`runMigrations` creates the MongoDB client with sensible defaults: 10-second connect and server
selection timeouts, so a wrong address fails quickly, and retryable writes. mmk's own history and
lock are written with `w: 'majority'`, so they survive a primary failover. Your migrations keep the
write concern from your connection string. For TLS, auth options or different timeouts, pass
`mongoClientOptions` and they're applied on top.

## All together

```js
import { runMigrations, pendingMigrations } from 'mongo-migrate-kit';

// on start: run, and wait if another instance is already migrating
await runMigrations(
  { uri: process.env.MONGO_URL, dbName: 'shop' },
  { onLockHeld: 'wait', lockWaitTimeoutMs: 60_000 },
);

// in a health check: is the database up to date? (read-only)
const pending = await pendingMigrations({ uri: process.env.MONGO_URL, dbName: 'shop' });
```

## Try it

```bash
npm install mongo-migrate-kit mongodb
```

More examples are on the [Running from your code](https://mongo-migrate-kit.vercel.app/guide/api) page. The package is on
[npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Locking MongoDB migrations so two deploys can't collide](./06-mongodb-migration-locking-concurrent-deploys.md),
  the lock that makes waiting safe.
- [MongoDB migrations in GitHub Actions](./08-mongodb-migrations-ci-cd-github-actions.md), the other
  common place to run them.
