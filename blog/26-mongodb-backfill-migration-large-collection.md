<!--
SEO target keyword: "mongodb backfill large collection migration"
Meta description: How to write a MongoDB migration that backfills millions of documents without
timing out, locking up production or leaving a mess when it crashes halfway: batches, bulkWrite,
filters that let it resume, no transactions, and a lock that renews itself.
Works with mongo-migrate-kit 1.4 and newer. Can be published any time.
-->

# Backfilling millions of documents in a MongoDB migration

Most migrations are small: add an index, rename a field on a config document. They finish in
milliseconds and nobody thinks about them.

Then one day you need to compute `total` for every one of eleven million orders. The obvious version
works perfectly on your laptop's 200 test orders, then takes production down for twenty minutes.
Here's how to write the big ones.

## The obvious version, and what's wrong with it

```js
export async function up({ db }) {
  const orders = await db.collection('orders').find().toArray(); // all 11M documents into memory
  for (const order of orders) {
    const total = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { total } }); // 11M round trips
  }
}
```

- `toArray()` loads every document into memory at once.
- One `updateOne` per document is eleven million network round trips.
- If it crashes at document six million, running it again starts from zero.

## The version that scales

```js
export const description = 'Backfill orders.total from line items';

const BATCH_SIZE = 1000;

export async function up({ db }) {
  const orders = db.collection('orders');
  // Only documents not converted yet, so a re-run after a crash continues where it stopped
  const cursor = orders
    .find({ total: { $exists: false } }, { projection: { items: 1 } })
    .batchSize(BATCH_SIZE);

  let ops = [];
  for await (const order of cursor) {
    const total = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    ops.push({ updateOne: { filter: { _id: order._id }, update: { $set: { total } } } });
    if (ops.length === BATCH_SIZE) {
      await orders.bulkWrite(ops, { ordered: false });
      ops = [];
    }
  }
  if (ops.length > 0) {
    await orders.bulkWrite(ops, { ordered: false });
  }
}

export async function down({ db }) {
  await db.collection('orders').updateMany({}, { $unset: { total: '' } });
}
```

What each piece does:

- **A cursor, not `toArray()`.** Documents stream in batches of 1,000, so memory stays flat whether
  there are a thousand orders or a hundred million.
- **A projection.** Only `items` comes over the network, not the whole document.
- **`bulkWrite` per 1,000 documents.** Eleven thousand round trips instead of eleven million.
  `ordered: false` lets the server apply each batch without stopping at the first problem.
- **A filter that skips finished work.** `total: { $exists: false }` means a second run only touches
  what the first one didn't reach. If the deploy is killed halfway, run it again and it carries on.

That last point matters more than the others. A migration like this can't be undone halfway: the
first five million documents are already written. Making it **safe to run again** is what turns a
crash from an incident into a retry.

A word on the `down`. It removes `total` from every order, which is a true undo only because no
order had a `total` before. If new code has started writing `total` in the meantime, this `down`
would remove those too, so roll the code back first.

## Don't use a transaction

For small migrations, transactions are great: everything commits or nothing does. For a backfill,
they're the wrong tool:

- MongoDB **aborts transactions older than 60 seconds** by default
  (`transactionLifetimeLimitSeconds`). An eleven-million-document backfill doesn't finish in 60
  seconds.
- A transaction holds every change in memory until commit. Millions of changes is exactly what that
  isn't designed for.

So leave `useTransaction` off for this file, and rely on the filter that skips finished work.

## The lock takes care of itself

A twenty-minute migration is longer than the default lock TTL of 60 seconds. Does another deploy
steal the lock halfway through? No. While a migration runs, mongo-migrate-kit renews the lock
every 30 seconds (half the TTL), so it never looks stale. **Don't raise `lockTTLSeconds`** for long
migrations; that only makes a crashed run block everyone for longer.

What *can* stop the renewal is blocking Node's event loop. The renewal is a timer in the same
process, and a long synchronous loop (computing something over a huge in-memory array without a
single `await`) starves it. The cursor-and-batches pattern above `await`s constantly, so it's fine.

## Be kind to production

A backfill competes with your real traffic for the same database. A few habits:

- **Run it when traffic is low**, if you can choose.
- **Pause between batches** if the cluster is busy:
  `await new Promise((resolve) => setTimeout(resolve, 50));` after each `bulkWrite`.
- **Index builds are a separate migration.** Building an index on a large collection takes time but
  doesn't block reads and writes for its duration on MongoDB 4.2+. Keep it in its own file so you can
  see in `mmk status` which part was slow.
- **Give big migrations their own deploy.** `mmk up --step` records each file as its own batch, so
  `mmk down` can undo just the backfill if something looks wrong.

## The app has to cope while it runs

For twenty minutes, some orders have `total` and some don't. And with migrations running before the
new code rolls out, the *old* code is running the whole time. Write the change in steps: first ship
code that works with or without `total`, then backfill, then rely on it. That's
[expand and contract](./28-zero-downtime-mongodb-schema-changes-expand-contract.md).

## If you migrate on app startup

`runMigrations({ onLockHeld: 'wait' })` makes other instances wait while one migrates, but only for
`lockWaitTimeoutMs`, 30 seconds by default. For a twenty-minute backfill, either raise it above the
migration's duration, or (better) run big migrations from a deploy step instead of app startup.

## In short

Cursor plus `bulkWrite` in batches, a projection, a filter that skips finished documents, no
transaction, and the default lock TTL. Test it once against a production-sized copy, and the big
migrations become as boring as the small ones.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk create backfill-order-totals
npx mmk up --step
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/writing-migrations** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Zero-downtime MongoDB schema changes](./28-zero-downtime-mongodb-schema-changes-expand-contract.md):
  how the app copes with a half-finished backfill.
- [Habits that make MongoDB migrations safe](./09-mongodb-migration-best-practices.md): the habits behind
  this one.
