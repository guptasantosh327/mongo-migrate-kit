---
title: "Using Mongoose in migrations (and why you mostly shouldn't)"
description: "Your app uses Mongoose. Should your migrations? Why importing app models into migrations goes wrong, what to use instead, and how to pass Mongoose in safely when you really need it."
date: 2026-10-16
author: Santosh Gupta
order: 24
---

# Using Mongoose in migrations (and why you mostly shouldn't)

If your app is built on Mongoose, the natural first migration looks like this:

```js
import { User } from '../src/models/user.js';

export async function up() {
  await User.updateMany({ role: { $exists: false } }, { role: 'member' });
}
```

It works today. The problem is that a migration isn't only run today. It runs **whenever a database
needs it**: in CI next week, on a new developer's laptop next month, on a fresh staging environment
next year. And by then, `User` is a different model.

## Why app models and migrations don't mix

**The model changes. The migration must not.** A migration is a snapshot of one change at one point
in time. Your `User` model keeps evolving: fields get renamed, validators get stricter, defaults
change. Six months from now, this migration will run against *today's* data shape using *that day's*
model. A new `required` field fails validation. A renamed field means the update quietly does
nothing. The migration "succeeds" and leaves the data wrong.

**Models do more than you asked.** Mongoose middleware (`pre('save')`, `pre('updateMany')`),
defaults, setters and timestamps all run inside a migration that goes through a model. A hook that
sends an email or writes an audit row on every save will happily do it for every document your
backfill touches.

**Migrations can outlive the model.** Delete the `User` model one day and every old migration that
imports it breaks, including on a fresh database that needs to run them all.

## Use the native driver instead

Every mongo-migrate-kit migration receives the native MongoDB `db`, whatever the app uses:

```js
export async function up({ db }) {
  await db.collection('users').updateMany(
    { role: { $exists: false } },
    { $set: { role: 'member' } },
  );
}

export async function down({ db }) {
  await db.collection('users').updateMany({ role: 'member' }, { $unset: { role: '' } });
}
```

It does exactly what it says, nothing more, and it will do the same thing in five years. The query
language is the same one you write inside Mongoose's `updateMany`. You're just skipping the layer
that changes over time.

## Transactions: models don't take part

mongo-migrate-kit can run a migration in a transaction (`export const useTransaction = true`). The
transaction lives on **mmk's** MongoDB client, and arrives in your migration as `session`:

```js
export const useTransaction = true;

export async function up({ db, session }) {
  await db.collection('accounts').updateMany({}, { $set: { tier: 'free' } }, { session });
  await db.collection('audit').insertOne({ event: 'tier-backfill' }, { session });
}
```

Mongoose models talk to the database through **Mongoose's own** connection. Their writes aren't part
of mmk's transaction, and you can't hand them mmk's `session` either. Pass it to a model's
`updateMany` and the driver refuses:

```text
Reason: MongoInvalidArgumentError: ClientSession must be from the same MongoClient
```

If a migration needs to be atomic, use `db` and `session`.

## When you really need Mongoose

Sometimes a migration really needs Mongoose. A plugin that computes a value you don't want to write
again, say. mongo-migrate-kit lets you pass an instance in; migrations then receive it as
`mongoose`:

```js
export async function up({ mongoose }) {
  const User = mongoose.model('User');
  // ...
}
```

mmk passes the instance through but **never connects or disconnects it**. That's up to you. The
clean way is to run migrations from code that already manages the connection, such as your app's
startup:

```js
import mongoose from 'mongoose';
import { runMigrations } from 'mongo-migrate-kit';

await mongoose.connect(process.env.MONGO_URI, { dbName: 'shop' });
await runMigrations({ dbName: 'shop', mongoose });
// ...start the app, which already uses this connection
```

**Don't connect Mongoose inside `mmk.config.js` for the CLI.** It works, once. mmk finishes, but
the open Mongoose connection keeps Node alive, so `mmk up` never exits. In CI, that's a job that
hangs until it times out.

And even when you use the instance, define a small schema **inside the migration** rather than
importing the app's model. That keeps the migration a snapshot:

```js
export async function up({ mongoose }) {
  const schema = new mongoose.Schema({ role: String }, { strict: false });
  const Users = mongoose.models.UsersMigration20261012
    ?? mongoose.model('UsersMigration20261012', schema, 'users');
  await Users.updateMany({ role: { $exists: false } }, { $set: { role: 'member' } });
}
```

At which point you're writing roughly what the native driver gives you for free.

## In short

- Write migrations against `db`, not your app's models. Models change, and migrations must not.
- Use `db` and `session` for transactional migrations. Models don't take part in mmk's transaction.
- If you must use Mongoose, pass it via `runMigrations({ mongoose })` from code that owns the
  connection, and never connect it in the CLI config.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk create backfill-user-roles
```

More in the docs: [Writing migrations](/guide/writing-migrations). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Habits that make MongoDB migrations safe](./mongodb-migration-best-practices): more habits that
  keep migrations safe to run years later.
- [Why I built a new MongoDB migration tool](./why-i-built-mongo-migrate-kit): the story
  behind mongo-migrate-kit.
