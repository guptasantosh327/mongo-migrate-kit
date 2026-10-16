---
title: When something goes wrong
description: The mongo-migrate-kit errors you're most likely to see, what they mean, and how to fix them. Lock held, failed migrations, connection errors, checksum mismatches and more.
---

# When something goes wrong

<p class="page-meta">Step 3 of the learning path · read the parts you need</p>

mmk's error messages are written to be read. Each one starts with a code (like `LOCK_ALREADY_HELD`),
then says what happened, what it found, and what to try. Most of the time the message alone is
enough. This page adds the background for the errors people hit most.

All the output below is real.

## Before anything else

1. **Read the whole message.** The useful part is often on the third or fourth line.
2. **Run `npx mmk status`.** It shows what's applied, what's pending, and which files changed since
   they ran.
3. **Preview before you fix.** `npx mmk dry-run up` or `npx mmk dry-run down` shows what a command
   would do, without doing it.

## Another run holds the lock

```text
✖ LOCK_ALREADY_HELD: The migration lock is held by the default namespace
  Holder: host deploy-a, pid 16152, user asha, since 2026-10-15 22:24:21 (2s ago)
  Why: all repos on this database take turns — one migration run at a time
  If the holder crashed, the lock frees itself at 2026-10-15 22:25:21; `mmk unlock` releases it now (check the holder first)
  Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))
```

**What it means:** another `mmk` process is running migrations on this database right now, or one
crashed without letting go of the lock.

**What to do:**

- If the holder is a real deploy that's still going, wait and run again. The lock is doing its job.
- If the holder crashed (a cancelled CI job, a killed pod), the lock frees itself at the time shown.
  To clear it sooner, run `npx mmk unlock`. It shows the holder and asks before removing it.
- If your app runs migrations on start-up and several instances boot together, use
  `runMigrations({ onLockHeld: 'wait' })` so the others wait instead of failing. See
  [Running from your code](/guide/api#several-instances-starting-at-once).

## A migration failed

```text
✖ Error    20261015120000-seed-plans.js
✖ MIGRATION_EXECUTION_FAILED: Migration "20261015120000-seed-plans.js" threw while running up()
  Reason: MongoBulkWriteError: E11000 duplicate key error collection: shop.plans index: _id_ dup key: { _id: "free" }
  Thrown at: /home/asha/shop-api/migrations/20261015120000-seed-plans.js:8:3
  This migration ran in a transaction, so its database writes were rolled back
  The batch stopped here — later migrations were not run
```

**What it means:** your `up` (or `down`) threw. `Reason` is the original error. `Thrown at` points
to the line in your file.

**What to do:**

1. Read the line about writes. If it says they were **rolled back**, the database is as it was
   before this file. If it says they are **still in the database**, the migration got partway.
   Check what it changed before you run it again.
2. Fix the file. It hasn't been recorded as applied, so editing it is fine.
3. Run `npx mmk up` again. It picks up from this file.

If partial writes are a worry for a migration, give it `export const useTransaction = true`. See
[Transactions](/guide/transactions).

## Can't connect to MongoDB

```text
✖ CONNECTION_FAILED: Failed to connect to MongoDB at mongodb://***:***@db.internal.example:27017
  Reason: getaddrinfo ENOTFOUND db.internal.example
  Database: "shop"
  Check the host/port is reachable, the credentials are right, and any TLS or IP allow-list requirement is met
  Set the connection with --uri, the MMK_URI environment variable, or "uri" in your config file
```

**What it means:** the address, the network or the credentials are wrong. The password is hidden in
the message on purpose.

**What to do:**

- `ENOTFOUND` means the host name doesn't resolve. In Docker or Kubernetes, use the service name
  (`mongo`), not `localhost`.
- `Authentication failed` means the user or password is wrong, or the user belongs to a different
  `authSource`.
- A timeout usually means a firewall or an IP allow-list (on Atlas, check Network Access).
- If the password has any of `: / ? # [ ] @` in it, they must be percent-encoded: `p@ss/word`
  becomes `p%40ss%2Fword` (`encodeURIComponent` does this). mmk tells you so instead of showing the
  driver's message, because that message can contain part of the password.
- Test the same URI with `mongosh "<your uri>"`. If that fails too, it's not an mmk problem.

mmk also refuses servers older than MongoDB 4.2 with this code. The message says which version it
found.

## A file was edited after it ran

```text
✖ CHECKSUM_MISMATCH: Refusing to roll back a file that changed since being applied: 20261012091500-backfill-order-status.js
  Rolling back would run the CURRENT down(), which may not undo what the applied up() did
  Restore the file to the version that was applied, then roll back
  Or roll back with the current code anyway: mmk down 20261012091500-backfill-order-status.js --force
```

**What it means:** the file on disk isn't the file that ran. `mmk status` shows `MISMATCH` for it.

**What to do:** in most cases, put the old version back (`git log` and `git checkout` the file) and
put your change in a new migration. If the edit really doesn't matter, or you've checked that the
current `down()` is right, run the command with `--force`. It asks you to confirm.

`mmk up` doesn't look at files that already ran, so it won't stop you here. Check `mmk status` in
CI if you want edits caught early. See [Checksums](/guide/concepts#checksums).

## "It is not currently applied"

```text
✖ NOT_APPLIED: Cannot roll back "20261015120000-seed-plans.js" — it is not currently applied
  It has no changelog record
  Currently applied: 20261012090000-add-users-email-index.js
  Run `mmk status` to see what is applied
```

You tried to roll back something that hasn't run (or was already rolled back). The message lists
what is applied, so you can pick the right file.

## A typo in a command

mmk checks what you typed before it connects, so a mistake costs nothing:

```text
$ npx mmk down --batch abc
✖ INVALID_ARGUMENT: --batch must be a positive whole number
  Received: "abc"
  Try: mmk down --batch 3

$ npx mmk down --steps 1 --batch 2
✖ INVALID_ARGUMENT: Cannot combine --batch with --steps — they select different things
  Received: --batch 2 and --steps 1
  --batch 2 rolls back everything applied in batch 2
  --steps 1 rolls back the last 1 migration(s), ignoring batches

$ npx mmk stauts
error: unknown command 'stauts'
(Did you mean status?)
```

A file name that doesn't exist gets the folder mmk looked in, the closest match, and the files that
are there:

```text
✖ MIGRATION_FILE_NOT_FOUND: Migration file not found: "0001-add-user.ts"
  Looked in: /app/migrations
  Did you mean "0001-add-users.ts"?
  Migrations in that directory: 0001-add-users.ts, 0002-backfill.ts
  Run `mmk status` to see every migration mmk knows about
```

Nothing quietly does the wrong thing. A few cases that are errors on purpose:

| You typed | What happens |
| --- | --- |
| `mmk down --batch 99` (no such batch) | Error listing the batches that do exist |
| `mmk create "   "` | Error: the name is empty once cleaned up |
| `mmk create x --js --ts` | Error: pick one |
| `mmk import --from changelog --to changelog` | Error: that would overwrite the source |
| `mmk dry-run sideways` | Error: it's `up` or `down` |
| A migration without `down()` | Error naming the missing export and listing the ones it found |

## Transactions aren't supported

```text
✖ TRANSACTIONS_UNSUPPORTED: Migration "20261015120000-seed-plans.js" requests a transaction, but this MongoDB deployment is a standalone server, which does not support transactions. Use a replica set (even single-node) or a sharded cluster, or disable useTransaction for this migration.
```

The migration asked for a transaction and your MongoDB is a single standalone server. mmk stops
before running anything. Run MongoDB as a replica set (a single node is enough, Atlas always is one),
or remove `useTransaction` from that file. See [Transactions](/guide/transactions#what-it-needs).

## "uses ES module syntax … but Node loads it as CommonJS"

```text
✖ CONFIG_INVALID: Config file "mmk.config.js" uses ES module syntax (export/import), but Node loads it as CommonJS
  Why: /app/package.json has "type": "commonjs"
  Fix: replace `export default` with `module.exports =`, the form `mmk init` uses here
```

**What it means:** the file is written in the other module style from your project. Node reads the
nearest `package.json`: `"type": "module"` means `export`, anything else means `module.exports`.
Files that `mmk init` and `mmk create` write always match it; this happens to files written by hand,
copied from another project, or created before the `package.json` changed. (Older versions of mmk
reported only Node's `Unexpected token 'export'`.)

For `export` in a CommonJS project, Node also prints its own warning above this one
(`Failed to load the ES module`, or `To load an ES module` on Node 20) suggesting
`"type": "module"`. Changing your whole project's type is rarely what you want. Follow mmk's message
instead.

**What to do:** follow the `Fix:` line. For a migration that has already run, use the `Or:` line
instead. It adds a `package.json` to the migrations folder, so the file and its checksum stay the
same. See [ES modules or CommonJS](/guide/writing-migrations#es-modules-or-commonjs).

## A .ts migration or config won't load

```text
✖ CONFIG_INVALID: Config file mmk.config.ts is TypeScript, and this Node (v20.20.0) can't run TypeScript by itself
```

A `.ts` migration fails the same way, with
`Cannot load TypeScript migration "…" — this Node runtime cannot import .ts files`.

**What it means:** the Node running mmk is older than 22.18, which can't load TypeScript by itself,
and no TypeScript loader is set up. mmk uses your Node and doesn't include a compiler. The message
names the Node version, which in CI is often not the one you expected.

**What to do**, any one of:

- Use Node 22.18 or newer. `.ts` files then just work.
- Install `tsx` and run mmk through it:
  `node --import tsx node_modules/mongo-migrate-kit/dist/mmk.cjs up`
- Write `.js` migrations (`mmk create <name> --js`) and a `.js` config, which work on Node 18 and up.

See [TypeScript](/guide/typescript#which-node-runs-it).

## "TypeScript enum is not supported in strip-only mode"

**What it means:** Node 22.18+ runs `.ts` files by removing the types, without compiling. `enum`,
`namespace` blocks with code, constructor parameter properties, `import x = require()` and
`export =` need a compiler, so Node refuses them.

**What to do:** use the plain-JavaScript alternative (an `enum` becomes an `as const` object). The
table in [TypeScript → What TypeScript you can write](/guide/typescript#what-typescript-you-can-write)
lists each one, and the [tsconfig there](/guide/typescript#type-check-your-migrations) catches them
before they run.

## An imported migration won't roll back

```text
These were adopted via `mmk import` (forward-only). Their files use the positional migrate-mongo signature, which mmk cannot run. Revert them manually or re-author them in mmk format.
✖ Cannot roll back 1 migrate-mongo-imported migration(s): 20250101000000-legacy.js
✖ MIGRATION_IRREVERSIBLE: Cannot roll back migrate-mongo-imported migration(s): 20250101000000-legacy.js
```

Migrations brought over with [`mmk import`](/commands/import) were written for migrate-mongo, which
calls `down(db, client)`. mmk calls `down({ db, client })`, so running the old file could do the
wrong thing. mmk refuses before touching anything.

To undo one of those changes, write a new migration that reverses it. Or rewrite the old file in
mmk's format if you want it to be reversible.

## Config errors

`CONFIG_INVALID` lists every problem with your settings at once, with the value it read and where
from. See [Configuration → When a setting is wrong](/guide/configuration#when-a-setting-is-wrong).

## Namespace errors

`NAMESPACE_UNADOPTED`, `MIGRATION_NAME_CONFLICT` and `SCHEMA_TOO_NEW` only happen when several repos
share a database. They're explained in [Sharing a database](/guide/shared-database#mistakes-mmk-catches).

## Still stuck?

- Run the command with `--json`. You get the error code and all the details as data.
- Look the code up in [Error codes](/reference/error-codes).
- [Open an issue](https://github.com/guptasantosh327/mongo-migrate-kit/issues) with the full message
  (passwords are already hidden). I read every one.
