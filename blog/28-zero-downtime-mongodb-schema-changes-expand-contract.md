<!--
SEO target keyword: "mongodb zero downtime migration"
Meta description: Migrations run before the new code is live, so for a few minutes old code runs
against the new data. The expand-and-contract pattern for MongoDB (renaming a field, adding a
required field, adding a unique index) without downtime or broken rollbacks.
Published copy: docs/blog/zero-downtime-mongodb-schema-changes-expand-contract.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Zero-downtime MongoDB schema changes: expand, migrate, contract

"MongoDB is schemaless, so I don't need to worry about migrations breaking things." Every team
believes this until the first deploy where they rename a field.

Your *database* may not enforce a schema. Your *code* does. Every `user.name` is a schema. And
during a deploy, two versions of your code run against the same data.

## The window nobody plans for

The safe order for a deploy is: **migrate first, then roll out the new code.** That's what a CI
step, a Kubernetes pre-upgrade Job, or `runMigrations()` on startup all do. If the migration fails,
the new code never goes live.

But it means that for a few minutes, **the old code runs against the new data**. With a rolling
deploy it's worse: old and new pods serve traffic side by side. And if you roll back the code, the
old version runs against the new data again, possibly for days.

So every migration has to answer one question: *can the version that's running right now survive
this change?*

## The pattern: expand, migrate, contract

Split every breaking change into steps, each deployed separately:

1. **Expand:** add the new thing next to the old one. Nothing that's running breaks.
2. **Migrate:** move the data over, and switch the code to the new thing.
3. **Contract:** remove the old thing, once nothing uses it.

![Expand, backfill, contract: renaming a field across three deploys](https://mongo-migrate-kit.vercel.app/diagrams/png/expand-contract.png)

It costs extra deploys. It buys you a database that every running version can always read.

## Example 1: renaming a field

Rename `name` to `fullName` on users. The one-step version (a migration that renames the field, plus
code that reads `fullName`) breaks the old code the moment the migration runs. It reads `name`, finds
nothing, and shows blank names until the rollout finishes.

**Release 1, expand.** Code writes **both** fields and reads the new one with a fallback:

```js
// app code
const fullName = user.fullName ?? user.name;
await users.updateOne({ _id }, { $set: { fullName: value, name: value } });
```

**Release 2, migrate.** A migration copies the data over, in a way that's safe to run twice:

```js
export async function up({ db }) {
  await db.collection('users').updateMany(
    { fullName: { $exists: false }, name: { $exists: true } },
    [{ $set: { fullName: '$name' } }], // pipeline update: copy one field to another
  );
}

export async function down() {
  // nothing to undo: `name` is still there, and release 1 code reads either
}
```

Code now reads `fullName` only, and still writes both, because the previous release still needs
`name`.

**Release 3, contract.** Once no running version reads `name` (and you're sure you won't roll back
past release 2), stop writing it and remove it:

```js
export async function up({ db }) {
  await db.collection('users').updateMany({ name: { $exists: true } }, { $unset: { name: '' } });
}

export async function down({ db }) {
  // put it back from fullName, so a rollback to release 2 still finds it
  await db.collection('users').updateMany(
    { name: { $exists: false }, fullName: { $exists: true } },
    [{ $set: { name: '$fullName' } }],
  );
}
```

At no point did any running version see data it couldn't read.

## Example 2: adding a required field

New orders must have a `currency`. If the new code *requires* it and old documents don't have it,
reads blow up.

1. **Expand:** code writes `currency` on new orders, and treats a missing one as the default
   (`order.currency ?? 'USD'`).
2. **Migrate:** a backfill sets `currency: 'USD'` where it's missing (batched, if the collection is
   large; see [backfilling millions of documents](./26-mongodb-backfill-migration-large-collection.md)).
3. **Contract:** only now make it required, in your validation layer or as a MongoDB
   `$jsonSchema` validator.

## Example 3: a unique index

A unique index on `users.email` is a schema change too, and it fails outright if the data already has
duplicates:

1. **Expand:** code stops creating duplicates (normalise case, check before insert).
2. **Migrate:** a migration finds and resolves existing duplicates, merging them or flagging them
   for a person. Don't just delete them.
3. **Contract:** a migration creates the unique index. If a duplicate slipped in anyway, the index
   build fails as a whole (no half-built index) and `mmk up` stops with the duplicate key in the
   error, before the new code rolls out.

On MongoDB 4.2 and newer, building the index doesn't block reads and writes for its duration, so
this step can go out during normal traffic.

## Rollbacks are part of the plan

`mmk down` reverts a migration, but it can't bring back data a migration destroyed. That's why the
contract step comes last and gets a `down()` that restores what the old code needs. It's also why
destructive steps (dropping a field, dropping a collection) deserve a deploy of their own, after a
waiting period. If you might roll the code back to release 1, don't contract yet.

## When you can skip all this

Not every migration needs three releases. Additive changes are already safe in one step:

- adding a new collection;
- adding a non-unique index;
- adding an optional field that old code ignores.

The pattern is for changes that **rename, remove, or start requiring** something.

## In short

Migrations run before new code, so old code always meets new data. Expand first, migrate the data,
contract last, and every running version always has data it can read.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk create add-full-name
npx mmk dry-run up
```

More in the docs: [Writing migrations](https://mongo-migrate-kit.vercel.app/guide/writing-migrations). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [MongoDB migrations on Kubernetes](./22-mongodb-migrations-kubernetes-job-helm.md): where the
  "migrate before rollout" window comes from.
- [Habits that make MongoDB migrations safe](./09-mongodb-migration-best-practices.md): reversibility and
  the other habits this pattern builds on.
