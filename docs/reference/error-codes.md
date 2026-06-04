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

In `--json` mode, the CLI prints `{ "error": { "code", "message" } }` and exits 1.

## Reference

| Code | Error class | When it's thrown | What to do |
|---|---|---|---|
| `LOCK_ALREADY_HELD` | `LockAlreadyHeldError` | Another run holds the lock within its TTL | Wait, or [`mmk unlock`](/commands/unlock) if it's stale |
| `LOCK_RELEASE_FAILED` | `LockReleaseFailedError` | The lock couldn't be released | Check DB connectivity; retry |
| `CHECKSUM_MISMATCH` | `ChecksumMismatchError` | An applied file was edited (in `--strict`) | Don't edit applied files — write a new migration |
| `MIGRATION_FILE_NOT_FOUND` | `MigrationFileNotFoundError` | A named migration file doesn't exist | Check the filename and `migrationsDir` |
| `MIGRATION_INVALID_NAME` | `MigrationInvalidNameError` | A migration name escapes the migrations dir | Use a bare filename, not a path |
| `MIGRATION_INVALID_EXPORT` | `MigrationInvalidExportError` | A file is missing `up`/`down` functions | Export both `up` and `down` |
| `MIGRATION_EXECUTION_FAILED` | `MigrationExecutionFailedError` | A migration's `up`/`down` threw | Read the cause; fix the migration logic |
| `CONFIG_INVALID` | `ConfigInvalidError` | Config failed validation | Check required fields and types |
| `CONFIG_FILE_EXISTS` | `ConfigFileExistsError` | `mmk init` found an existing config | Use `--force` to overwrite |
| `CONNECTION_FAILED` | `ConnectionFailedError` | Couldn't connect to MongoDB | Verify `uri`/`dbName` and that Mongo is up |
| `ALREADY_APPLIED` | `AlreadyAppliedError` | A target migration is already applied | Use `--force` to re-run intentionally |
| `NOT_APPLIED` | `NotAppliedError` | Tried to revert a migration that isn't applied | Run `mmk status` to see what's applied |
| `IMPORT_TARGET_NOT_EMPTY` | `ImportTargetNotEmptyError` | `mmk import` target already has records | Use `--force` to import anyway |
| `MIGRATION_IRREVERSIBLE` | `IrreversibleMigrationError` | Tried to revert an imported migrate-mongo record | Write a new forward migration instead |

See [Troubleshooting](/guide/troubleshooting) for step-by-step fixes for the most common ones.
