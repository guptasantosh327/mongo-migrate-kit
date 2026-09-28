# Troubleshooting

Common problems and how to fix them. Each entry names the error you'll see, why it happens, and what
to do. For the full list of error codes, see the [Error Codes reference](/reference/error-codes).

## "Lock already held"

```
LockAlreadyHeldError: Migration lock is held by pid 48213 on host deploy-runner-7
```

**Why:** another `mmk` process is running migrations, *or* a previous run crashed and left the lock
behind.

**Fix:**
- If a migration really is running elsewhere, wait — this is the lock doing its job.
- If you're sure nothing is running (e.g. a CI job was killed), clear it:
  ```bash
  mmk unlock
  ```
- The lock also auto-expires after `lockTTLSeconds` (default 60), so waiting works too.

## "Checksum mismatch"

```
⚠ Warning  Checksum mismatch: 2026...-add-users-index.js
```

**Why:** the file was **edited after it was already applied**. `mmk` detects this to stop you
silently changing history.

**Fix:**
- **Never edit an applied migration.** Instead, write a *new* migration for the change.
- If the edit was intentional and harmless (a comment, formatting), the warning is informational in
  the default (non-strict) mode and the file is skipped.
- If you truly need to re-run it, that's `mmk up <file> --force` — but understand you're rewriting
  history. See [`mmk up --force`](/commands/up#re-running-an-applied-migration).

## "Connection failed"

```
ConnectionFailedError: Failed to connect to MongoDB
```

**Why:** the `uri`/`dbName` is wrong, MongoDB isn't running, or the network/credentials are off.

**Fix:**
- Verify the server is up: `mongosh "<your-uri>"`.
- Check your config or env vars (`MMK_URI`, `MMK_DB`). See [Configuration](/guide/configuration).
- In Docker/CI, make sure the host is reachable (often `mongodb://mongo:27017`, not `localhost`).

## A `.ts` migration won't load

```
Cannot import a TypeScript migration: ERR_UNKNOWN_FILE_EXTENSION
```

**Why:** you're on a Node version below 22.18, which can't import `.ts` directly, and no TypeScript
loader is registered. `mmk` runs under your Node and does not bundle a loader.

**Fix:** any one of:
- **Upgrade to Node ≥ 22.18** — `.ts` then loads natively, no setup.
- **Register a loader:** install `tsx` and run mmk under it, e.g.
  `node --import tsx node_modules/mongo-migrate-kit/dist/mmk.cjs up`.
- **Use `.js` instead** (`mmk create <name> --js`) — runs on Node 18+ with zero setup.

See [Running TypeScript migrations](/guide/writing-migrations#running-typescript-migrations) for the
full breakdown.

## "Transaction numbers are only allowed on a replica set"

**Why:** you set `useTransaction` but your MongoDB is a standalone server. Transactions require a
replica set or sharded cluster.

**Fix:**
- Run a single-node replica set locally, or use a managed cluster (Atlas) which already is one.
- Or drop `useTransaction` for that migration if you don't need atomicity.

See [Transactions](/guide/transactions).

## "Migration is not applied"

```
NotAppliedError: 2026...-add-users-index.js has not been applied
```

**Why:** you tried to `down` (revert) a migration that isn't currently applied.

**Fix:** run `mmk status` to see what's actually applied, then target a file that is.

## An imported migration won't revert

```
IrreversibleMigrationError: 2026...-legacy.js was imported from migrate-mongo and cannot be reverted
```

**Why:** migrations adopted via [`mmk import`](/commands/import) use migrate-mongo's positional
`up(db, client)` signature, which mmk can't run safely in reverse. This is intentional — it's caught
*before* anything is touched.

**Fix:** imported history is forward-only. To undo such a change, write a new migration that performs
the reverse operation.

## Still stuck?

- Run any command with `--json` to get a structured error object you can inspect.
- Check the [Error Codes reference](/reference/error-codes) for the exact `code` and its meaning.
- Open an issue: <https://github.com/guptasantosh327/mongo-migrate-kit/issues>.

## Wrong command arguments

Argument problems carry the `INVALID_ARGUMENT` code — distinct from `CONFIG_INVALID`, so you always
know whether to fix your **command** or your **config**. Flags are validated before mmk connects, so
a typo costs nothing and the message is never buried under the connection spinner.

```
$ mmk down --batch abc
✖ INVALID_ARGUMENT: --batch must be a positive whole number
  Received: "abc"
  Try: mmk down --batch 3
```

Nothing is a silent no-op. Each of these used to exit 0 (or quietly do the wrong thing) and now
fails with an explanation:

| Command | What you get |
|---|---|
| `mmk down --batch abc` | Rejected before connecting, naming the value it received |
| `mmk down --batch 99` (no such batch) | Rejected, listing the batches that still have applied migrations |
| `mmk down <file> --steps 2` | Rejected, spelling out what each option would roll back |
| `mmk up typo.js` | Names the directory searched, suggests the closest real filename, lists what is there |
| `mmk down not-applied.js` | Lists what *is* currently applied |
| `mmk dry-run sideways` | Rejected before connecting, showing both valid directions |
| `mmk create "   "` | Rejected — the name slugifies to nothing (it used to write `<stamp>-.js`) |
| `mmk create x --js --ts` | Rejected as contradictory (it used to silently pick `.ts`) |
| `mmk create x --template ./missing.js` | Names the absolute path it resolved the template to |
| `mmk import --from c --to c` | Rejected — importing a collection into itself would rewrite the source |
| `mmk stauts` | `(Did you mean status?)` |
| A migration missing `down()` | Says which export is missing or the wrong type, and lists the exports found |

Catch them programmatically with `InvalidArgumentError`:

```ts
import { MigratorKit, InvalidArgumentError } from 'mongo-migrate-kit';

try {
  await new MigratorKit(config).down(undefined, { steps: 0 });
} catch (error) {
  if (error instanceof InvalidArgumentError) {
    console.error(error.message); // includes the received value and a command to try
  }
  throw error;
}
```

## Runtime failures

These three carry everything you need in the message itself — nothing important is hidden in
`error.context` any more.

**A migration threw.** You get the migration's own error, the line it came from, and — critically —
whether its writes survived:

```
✖ MIGRATION_EXECUTION_FAILED: Migration "0001-add-users.js" threw while running up()
  Reason: E11000 duplicate key error collection: shop.users index: email_1
  Thrown at: /app/migrations/0001-add-users.js:4:11
  This migration did not run in a transaction, so any writes it already made are still in the database
  The batch stopped here — later migrations were not run
```

Set `export const useTransaction = true` in the migration to make that last point read
"rolled back" instead (requires a replica set or sharded cluster).

**Couldn't connect.** The driver's reason is in the message, and any password in the URI is redacted
before it reaches your logs, `--json` output, or the error context:

```
✖ CONNECTION_FAILED: Failed to connect to MongoDB at mongodb://***:***@db.internal:27017
  Reason: getaddrinfo ENOTFOUND db.internal
  Database: "shop"
  Check the host/port is reachable, the credentials are right, and any TLS or IP allow-list requirement is met
```

**An applied migration was edited.** `down` always verifies checksums (not just under `--strict`),
because reverting edited code is the riskier direction:

```
✖ CHECKSUM_MISMATCH: Refusing to roll back a file that changed since being applied: 0001-a.ts
  Rolling back would run the CURRENT down(), which may not undo what the applied up() did
  Restore the file to the version that was applied, then roll back
  Or roll back with the current code anyway: mmk down 0001-a.ts --force
```

::: tip Detecting drift before it bites
A plain `mmk up --strict` only checks the migrations it is about to run, so it will not flag drift in
an **already-applied** file. Use `mmk status` (the `Checksum` column) for that, or name the file:
`mmk up 0001-a.ts --strict`.
:::
