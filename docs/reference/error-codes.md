---
title: Error codes
description: Every error code mongo-migrate-kit can return, what causes it, and what to do about it.
---

# Error codes

Everything mmk throws is an `MmkError` with a `code`. The CLI prints the code at the start of the
message (`✖ LOCK_ALREADY_HELD: …`). In `--json` mode you get
`{ "error": { "code", "message", "details" } }` and exit code `1`.

In code, check the class or switch on `code`:

```ts
import { MmkError } from 'mongo-migrate-kit';

try {
  await migrator.up();
} catch (err) {
  if (err instanceof MmkError) {
    console.error(err.code, err.message, err.context);
  }
  throw err;
}
```

Every message says what was received, where it came from, and what to change, so you shouldn't need
to read mmk's source to act on one. The [troubleshooting page](/guide/troubleshooting) has real
examples of the common ones.

## Running migrations

| Code | Class | Cause | What to do |
| --- | --- | --- | --- |
| `LOCK_ALREADY_HELD` | `LockAlreadyHeldError` | Another run holds the lock. On a shared database it may be another repo. | The message names the holder and when the lock frees itself. Wait and run again, or [`mmk unlock`](/commands/unlock) if the holder is dead. |
| `LOCK_RELEASE_FAILED` | `LockReleaseFailedError` | The lock couldn't be released. | Usually a lost connection. Check the database is reachable and try again. |
| `MIGRATION_EXECUTION_FAILED` | `MigrationExecutionFailedError` | Your `up` or `down` threw. | The message has the original error, the line it came from, and whether the writes were rolled back. Fix the file and run again. |
| `TRANSACTIONS_UNSUPPORTED` | `TransactionsUnsupportedError` | A migration wants a transaction, but the server is a standalone `mongod`. | Use a replica set or sharded cluster, or remove `useTransaction`. |
| `CHECKSUM_MISMATCH` | `ChecksumMismatchError` | A file changed after it ran. Raised by any `down`, and by `up <file>` with `strict`. | Restore the old file and put the change in a new migration, or use `--force` if you're sure. |
| `ALREADY_APPLIED` | `AlreadyAppliedError` | The migration has already run. | Use `mmk up <file> --force` if you really want to run it again. |
| `NOT_APPLIED` | `NotAppliedError` | You tried to roll back something that isn't applied. | The message lists what is applied. |
| `MIGRATION_IRREVERSIBLE` | `IrreversibleMigrationError` | You tried to roll back a record imported from migrate-mongo. | Write a new migration that reverses the change. |

## Files

| Code | Class | Cause | What to do |
| --- | --- | --- | --- |
| `MIGRATION_FILE_NOT_FOUND` | `MigrationFileNotFoundError` | A named file (or `--template`) doesn't exist. | The message shows where mmk looked, the closest match, and the files that are there. |
| `MIGRATION_INVALID_NAME` | `MigrationInvalidNameError` | The name is a path (it has `/` or `..`), not a plain file name. | Pass just the file name. |
| `MIGRATION_INVALID_EXPORT` | `MigrationInvalidExportError` | `up` or `down` is missing or isn't a function. Also raised when the file can't be loaded: it's `.ts` on a Node that can't run TypeScript, or it uses `export` where Node expects `module.exports` (or the other way round). And by `requireAuthor` when files have no author. | The message says which export is wrong and lists what it found. For a file that won't load, it names the cause and the fix (see [ES modules or CommonJS](/guide/writing-migrations#es-modules-or-commonjs) and [TypeScript](/guide/typescript)). For `requireAuthor`, it lists every file without an author. Nothing ran. |

## Settings and commands

| Code | Class | Cause | What to do |
| --- | --- | --- | --- |
| `CONFIG_INVALID` | `ConfigInvalidError` | A setting is missing, has a bad value, or isn't a real setting. Also raised when the config file itself can't be loaded: bad JSON, the wrong module style, a `.ts` config on a Node that can't run TypeScript, or a config function that throws. | Read the numbered list. Each item has the setting, the value read, where it came from, and how to set it. Also on `error.context.issues`. A file that won't load gets one message naming the file, the cause and the fix. |
| `INVALID_ARGUMENT` | `InvalidArgumentError` | Something you typed is wrong: a bad `--batch`, flags that can't go together, an empty name. | Read the `Received:` and `Try:` lines. This is about the command, not the config. |
| `CONFIG_FILE_EXISTS` | `ConfigFileExistsError` | `mmk init` found a config file already. | Add `--force` to replace it. |
| `CONNECTION_FAILED` | `ConnectionFailedError` | mmk couldn't connect, or the server is older than MongoDB 4.2. | The message has the driver's reason (DNS, auth, timeout), with the password hidden. |
| `IMPORT_TARGET_NOT_EMPTY` | `ImportTargetNotEmptyError` | `mmk import` found records in mmk's history already. | Add `--force` to import anyway. |

## Shared databases

These only come up when several repos share a database with [namespaces](/guide/shared-database).

| Code | Class | Cause | What to do |
| --- | --- | --- | --- |
| `NAMESPACE_UNADOPTED` | `NamespaceUnadoptedError` | This repo has a namespace, but some of its migrations ran before it had one. Commands that depend on what's applied refuse; `status` and `list` only warn. | Run [`mmk namespace adopt --dry-run`](/commands/namespace), then `mmk namespace adopt`. |
| `MIGRATION_NAME_CONFLICT` | `MigrationNameConflictError` | A file you're about to run is already recorded under another namespace. | If several files are affected, the namespace probably changed: set it back. If it's one file, two repos used the same name: rename yours. |
| `SCHEMA_TOO_NEW` | `SchemaTooNewError` | A newer version of mmk wrote this database in a format this version doesn't understand. | Upgrade mongo-migrate-kit in this repo. The message names the version that wrote it. |
