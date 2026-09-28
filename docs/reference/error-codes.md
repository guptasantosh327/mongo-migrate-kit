# Error Codes

Every error thrown by `mongo-migrate-kit` extends `MmkError` and carries a typed `code`, a `message`,
and an optional `context` object. Catch `MmkError` and switch on `code` for precise handling:

```ts
import { MmkError } from 'mongo-migrate-kit';

try {
  await migrator.up();
} catch (err) {
  if (err instanceof MmkError) {
    console.error(err.code, '—', err.message, err.context);
  }
}
```

In `--json` mode, the CLI prints `{ "error": { "code", "message", "details" } }` and exits 1, where
`details` is the error's `context` — e.g. the per-key `issues` array of a `CONFIG_INVALID`.

Every message is self-contained: it names the value that was received, where it was read from, and
what to change. You should never need to read the source to act on one.

## Reference

| Code | Error class | When it's thrown | What to do |
|---|---|---|---|
| `LOCK_ALREADY_HELD` | `LockAlreadyHeldError` | Another run holds the lock within its TTL | Wait, or [`mmk unlock`](/commands/unlock) if it's stale |
| `LOCK_RELEASE_FAILED` | `LockReleaseFailedError` | The lock couldn't be released | Check DB connectivity; retry |
| `CHECKSUM_MISMATCH` | `ChecksumMismatchError` | An applied file was edited — on `up` under `--strict`, or on **any** `down` (verified before reverting) | Don't edit applied files — write a new migration; or `mmk down --force` to revert the drifted file anyway |
| `MIGRATION_FILE_NOT_FOUND` | `MigrationFileNotFoundError` | A named migration file (or a `--template`) doesn't exist | The message names the directory searched, suggests the closest real filename, and lists what is there |
| `MIGRATION_INVALID_NAME` | `MigrationInvalidNameError` | A migration name escapes the migrations dir | Use a bare filename, not a path — the message shows what it received |
| `MIGRATION_INVALID_EXPORT` | `MigrationInvalidExportError` | A file is missing `up`/`down`, or one is not a function | The message says which one and lists the exports it did find |
| `MIGRATION_EXECUTION_FAILED` | `MigrationExecutionFailedError` | A migration's `up`/`down` threw | The message carries the underlying error, the file and line it was thrown at, and whether the writes were rolled back or are still in the database |
| `CONFIG_INVALID` | `ConfigInvalidError` | A `mmk.config.*` / `MMK_*` setting is missing, malformed, or unrecognized | Read the numbered problems — each names the key, the value read, the layer it came from, and every way to set it. `error.context.issues` holds the same as data (`ConfigIssue[]`) |
| `INVALID_ARGUMENT` | `InvalidArgumentError` | Something you **typed** is wrong: a malformed `--batch`/`--steps`, a bad `dry-run` direction, contradictory `--js --ts`, a name that slugifies to nothing, `--from` equal to `--to` | Read the `Received:` and `Try:` lines. Distinct from `CONFIG_INVALID` so you know whether to fix the command or the config |
| `CONFIG_FILE_EXISTS` | `ConfigFileExistsError` | `mmk init` found an existing config | Use `--force` to overwrite |
| `CONNECTION_FAILED` | `ConnectionFailedError` | Couldn't connect to MongoDB | The message carries the driver's reason (DNS, auth, timeout) with any password in the URI redacted |
| `ALREADY_APPLIED` | `AlreadyAppliedError` | A target migration is already applied | Use `--force` to re-run intentionally |
| `NOT_APPLIED` | `NotAppliedError` | Tried to revert a migration that isn't applied | Run `mmk status` to see what's applied |
| `IMPORT_TARGET_NOT_EMPTY` | `ImportTargetNotEmptyError` | `mmk import` target already has records | Use `--force` to import anyway |
| `MIGRATION_IRREVERSIBLE` | `IrreversibleMigrationError` | Tried to revert an imported migrate-mongo record | Write a new forward migration instead |
| `TRANSACTIONS_UNSUPPORTED` | `TransactionsUnsupportedError` | A migration requested a transaction but the deployment is a standalone `mongod` | Use a replica set / sharded cluster, or disable `useTransaction` |

See [Troubleshooting](/guide/troubleshooting) for step-by-step fixes for the most common ones.
