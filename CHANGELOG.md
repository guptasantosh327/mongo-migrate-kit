# Changelog

All notable changes to this project will be documented in this file.

## v1.1.0

Adopt an existing `migrate-mongo` project without re-running a single migration.

- **`mmk import`** — read an existing `migrate-mongo` `changelog` and record that history in the mmk
  changelog, so `mmk up` runs only what is new. One-time and forward-only; the source collection is
  never modified.
  - `--from <collection>` (source, default `changelog`) and `--to <collection>` (target, default the
    config's `migrationsCollection`).
  - `--dry-run` previews the mapping, `--trust-hash` reuses `migrate-mongo`'s `fileHash` instead of
    recomputing, `--force` imports into a non-empty changelog, `--no-lock` skips the lock.
  - Each imported migration gets a unique, sequential batch number, continuing after any existing
    records; files on disk that are not in the source changelog stay pending.
- **Forward-only safety** — imported records are tagged `origin: 'migrate-mongo'`. Because their files
  use `migrate-mongo`'s positional `up(db, client)` signature, `mmk down`/`mmk redo` refuse them up
  front (before running or writing anything) with a clear reason, so the collection is never corrupted.
- New public exports: `ImportOptions`, `ImportResult`, `ImportRow`, `ImportChecksumSource`,
  `MigrateMongoDoc`, `MigrationOrigin`, and the `IrreversibleMigrationError` / `ImportTargetNotEmptyError`
  error classes.

## v1.0.0

Initial release.

- Core `MigratorKit` orchestration: `up`, `down`, `redo`, `dryRun`, `status`, `list`, `create`, `init`
- `mmk` CLI with `init`, `up`, `down`, `redo`, `status`, `list`, `dry-run`, and `create` commands
- Config loader with priority: CLI flags → env vars → config file → defaults (zod-validated)
- Function / async config files — `export default` a (sync or async) factory returning the config,
  for loading the connection from a secret manager at runtime with no bundled cloud SDKs
- First-class `.ts` and `.js` (ESM + CJS) migration loading
- MongoDB-native concurrency lock with TTL-based stale reclaim
- SHA-256 checksum tamper detection, surfaced in `status`
- Opt-in transactions (per-file or global) with automatic commit/abort
- Lifecycle hooks: `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `onError`
- Append-only audit trail in `_mmk_migrations` — reverts are never deleted
- `mmk init` config-file generator (`--ts`/`--js`/`--json`, `--force`, `--secret-provider`)
- `createExtension` option + `mmk create --js`/`--ts` to choose the generated file type
- `mmk up <file> --force` to re-run an already-applied migration (with confirmation)
