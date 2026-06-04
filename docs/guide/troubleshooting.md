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

**Why:** you're running under a Node runtime that can't import `.ts` directly.

**Fix:** any one of:
- Use the `mmk` CLI, which runs `.ts` through `tsx` automatically.
- Use Node ≥ 22.18, or register a loader (`node --import tsx ...`).
- Or author the migration as `.js` (`mmk create <name> --js`).

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
