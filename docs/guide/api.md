---
title: Running from your code
description: Run MongoDB migrations from Node.js code with mongo-migrate-kit. runMigrations() for app start-up and serverless, pendingMigrations() for health checks, and the full MigratorKit API.
---

# Running from your code

<p class="page-meta">Step 3 of the learning path · about 8 minutes</p>

Everything the `mmk` command does, you can also do from JavaScript or TypeScript. Most people only
need one of two functions:

- `runMigrations()` runs pending migrations, for example when your app starts.
- `pendingMigrations()` tells you what hasn't run yet, without changing anything.

Both open their own connection and always close it, even when something throws.

## Run migrations when the app starts

```ts
import { runMigrations } from 'mongo-migrate-kit';

const { applied, upToDate } = await runMigrations({
  uri: process.env.MONGO_URL!,
  dbName: 'shop',
  migrationsDir: './migrations',
});

if (!upToDate) console.log(`Applied ${applied.length} migration(s)`);

app.listen(3000); // only after the database is ready
```

If a migration fails, `runMigrations()` throws and your app doesn't start. That's on purpose: it's
better than serving traffic against a half-migrated database.

Settings you leave out are read the usual way: environment variables, then the config file, then
defaults. So `await runMigrations()` with no arguments works if `MMK_URI` and `MMK_DB` are set.

### Several instances starting at once

Say you deploy three instances and they all boot together. Only one gets the lock. By default the
other two throw `LockAlreadyHeldError` and fail to start, which is rarely what you want. Tell them to
wait instead:

```ts
await runMigrations(
  { uri: process.env.MONGO_URL!, dbName: 'shop' },
  { onLockHeld: 'wait', lockWaitTimeoutMs: 120_000 },
);
```

The waiting instances check every half second. When the lock is free, they look again, find nothing
pending (the first instance already ran everything) and carry on. If the wait goes past
`lockWaitTimeoutMs`, they give up and throw.

Set the timeout longer than your slowest migration. The default is 30 seconds.

### Serverless

The same call works in a Lambda or Cloud Function cold start. Keep `onLockHeld: 'wait'` so cold
starts that happen together don't fail, and you don't need to clean up afterwards: the connection is
always closed.

For long data migrations, a function with a short timeout is the wrong place. Run those from a
pipeline step instead (see [Deploying and CI](/guide/ci-cd)).

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `onLockHeld` | `'throw'` | `'wait'` waits for another run to finish instead of failing. |
| `lockWaitTimeoutMs` | `30000` | How long to wait before giving up. |
| `lockPollIntervalMs` | `500` | How often to check whether the lock is free. |
| `noLock` | `false` | Skip the lock entirely. Only for local development. |
| `configPath` | auto | Use this config file instead of looking for one. |

It returns:

```ts
interface MigrationSummary {
  applied: RunResult[]; // what this call ran (empty if nothing was pending)
  upToDate: boolean;    // true if there was nothing to run
  waited: boolean;      // true if it had to wait for another instance
}
```

## Check what's pending (health checks)

`pendingMigrations()` connects, reads, and disconnects. It never takes the lock and never writes.

```ts
import { pendingMigrations } from 'mongo-migrate-kit';

const pending = await pendingMigrations({ uri: process.env.MONGO_URL!, dbName: 'shop' });

if (pending.length > 0) {
  throw new Error(`Database is ${pending.length} migration(s) behind`);
}
```

This works well as a readiness check, or as a test in a deploy pipeline that should fail when
someone forgot to run migrations.

## Full control with MigratorKit

For anything else, every command is a method on `MigratorKit`. Here you open and close the
connection yourself:

```ts
import { MigratorKit } from 'mongo-migrate-kit';

const migrator = new MigratorKit({ uri: process.env.MONGO_URL!, dbName: 'shop' });

try {
  await migrator.connect();
  const plan = await migrator.dryRun('up');
  console.log(plan.map((row) => row.file));
  await migrator.up();
} finally {
  await migrator.disconnect();
}
```

| Method | Returns | Same as |
| --- | --- | --- |
| `connect(options?)` / `disconnect()` | `Promise<void>` | |
| `up(file?, options?)` | `RunResult[]` | `mmk up` |
| `down(file?, options?)` | `RunResult[]` | `mmk down` |
| `redo(file?)` | `RunResult[]` | `mmk redo` |
| `dryRun('up' \| 'down', file?, options?)` | `StatusRow[]` | `mmk dry-run` |
| `status()` | `StatusRow[]` | `mmk status` |
| `list('all' \| 'pending' \| 'applied')` | `StatusRow[]` | `mmk list` |
| `create(name, options?)` | path of the new file | `mmk create` |
| `init(options?)` | path of the new file | `mmk init` |
| `import(options?)` | `ImportResult` | `mmk import` |
| `adopt(options?)` | `AdoptResult` | `mmk namespace adopt` |
| `lockInfo()` | `LockInfo \| null` | `mmk unlock` (looking only) |
| `forceUnlock()` | `LockInfo \| null` | `mmk unlock --yes` |

Options use the same names as the command-line flags: `up(undefined, { step: true })`,
`down(undefined, { batch: 3 })`, `down(undefined, { steps: 2 })`, `up(file, { force: true })`.

Most methods connect for you if you forget, but always pair that with `disconnect()`.

`connect()` creates the changelog collection's index, which needs write access. To only read, use
`connect({ readOnly: true })`: it writes nothing, so it works with a user that has only the `read`
role. `status()`, `list()`, `dryRun()`, `statusAllNamespaces()`, `lockInfo()` and
`pendingMigrations()` connect this way on their own. A later write method on the same migrator
creates the index then.

## The result types

```ts
interface RunResult {
  file: string;
  status: 'applied' | 'reverted' | 'skipped' | 'error';
  duration?: number; // milliseconds
  batch?: number;
  reason?: string;
  error?: string;
}

interface StatusRow {
  file: string;
  status: 'applied' | 'pending';
  batch: number | null;
  appliedAt: Date | null;
  duration: number | null;
  checksumOk: boolean | null; // null = pending, true = unchanged, false = edited since it ran
  description?: string;
  author?: string;
}
```

Every public type is exported from the package: `MmkConfig`, `MigrationContext`,
`MigrationRecord`, `RunResult`, `StatusRow`, `ImportResult`, `LockInfo` and the rest.

## Errors

Everything mmk throws extends `MmkError`, which has a `code` you can switch on:

```ts
import { MmkError, LockAlreadyHeldError } from 'mongo-migrate-kit';

try {
  await runMigrations();
} catch (err) {
  if (err instanceof LockAlreadyHeldError) {
    // another deploy is migrating right now
  } else if (err instanceof MmkError) {
    console.error(err.code, err.message);
  }
  throw err;
}
```

The message is written for people and says what to do next. `err.context` has the same details as
data. The full list is in [Error codes](/reference/error-codes).

When `up()`, `down()`, `redo()` or `runMigrations()` stops partway, `err.context.results` is the
`RunResult[]` of the files that ran before it stopped. If a migration's own `up()` or `down()`
threw, it comes last with `status: 'error'`. An error that isn't an `MmkError` (one your hook threw
itself, for example) reaches you unchanged.

## Quiet output in tests

Pass `logger: null` and mmk prints nothing:

```ts
await runMigrations({ uri, dbName: 'test', logger: null });
```

## Next

[Transactions](/guide/transactions) shows how to make a migration all-or-nothing.
