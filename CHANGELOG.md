# Changelog

All notable changes to this project will be documented in this file.

## v1.3.0

Know which service ran a migration, and errors that tell you exactly what to fix.

### Added

- **`service` on every changelog record** — shows which codebase applied a migration, useful when
  several services share a cluster. No setup: mmk uses the `name` of the nearest `package.json`
  above your migrations directory (or `npm_package_name` when run from an npm script). Override it
  with the new optional `service` config key / `MMK_SERVICE` env var; if no name is found the field
  is left out. Existing records are unaffected.
- **`InvalidArgumentError`** (code `INVALID_ARGUMENT`) — raised for a missing, malformed, or
  contradictory command argument/flag, distinct from `CONFIG_INVALID` so it always points at what
  you typed. Exported, along with the new `ConfigIssue` type.
- **CLI suggestions** — a mistyped command answers `(Did you mean status?)`, and argument errors
  show the relevant help.

### Changed

- **Configuration errors list every problem at once**, each with the key, what is wrong, the value
  received, where it was read from (flag / env var / config file), and every way to set it. The
  structured list is on `error.context.issues` and in `--json` output.
- **Clearer runtime errors** — `CONNECTION_FAILED` now includes the redacted URI and the driver's
  reason; `MIGRATION_EXECUTION_FAILED` includes the migration's own error, where it was thrown, and
  whether its writes were rolled back; checksum, file-not-found, not-applied, invalid-name, and
  invalid-export errors now name the input, what exists instead, and how to fix it.
- `--batch`, `--steps`, and the `dry-run` direction are validated **before connecting**.
- A missing `migrationsDir` now logs a warning with the resolved path instead of silently reporting
  nothing to migrate.

### Behavior changes

These inputs were silently ignored or misread before; they are now errors. They only affect setups
that were already not doing what their author intended.

- An **unknown key in a config file** (e.g. `migrationDir`) is an error with a "did you mean"
  suggestion.
- An **unparseable `MMK_*` value** (e.g. `MMK_STRICT=maybe`, `MMK_CREATE_EXTENSION=py`) is an error.
  An empty value still means "unset"; an unknown `MMK_*` variable is only a warning.
- New value checks: `uri` must start with `mongodb://` or `mongodb+srv://`; `dbName` must be a valid
  MongoDB database name; `fileExtensions` entries must start with `.`; booleans must not be strings.
- `mmk down --batch abc` / a nonexistent batch, `mmk create "   "`, `mmk create x --js --ts`, and
  `mmk import` with the same `--from` and `--to` now fail instead of exiting 0 or writing a bogus
  file.
- Invalid `--steps` / `--batch` values now throw `InvalidArgumentError` instead of
  `ConfigInvalidError` — update any `catch` that checks the class or `code`.

### Documentation

- New blog posts on MongoDB migrations and CI/CD practices, a "Runtime failures" troubleshooting
  section, and a refreshed error-code reference.


## v1.2.2
### Documentation

- **New documentation website** at <https://mongo-migrate-kit.vercel.app/> — guides, a full command
  reference, a programmatic API overview, an FAQ, and a migrate-mongo migration guide.
- Clarified the TypeScript runtime story: `.ts` migrations run natively on **Node ≥ 22.18** (built-in
  type stripping) or under a TypeScript loader such as `tsx` (the CLI does not bundle one); `.js`
  migrations run on Node 18+ with no setup.

### Internal

- No change to the published package's runtime behaviour. Dev-tooling only: upgraded `vitest` and
  `@vitest/coverage-v8` to v4 (developing/testing now requires Node ≥ 20; the package's Node ≥ 18
  floor is unchanged) and refreshed `bumpp`/`changelogen` to drop a vulnerable transitive `tar`.
  Added unit tests to keep the coverage gate green under v4's stricter counting.


## v1.2.1

### Changed

- **Dropped the `date-fns` runtime dependency** — the only two usages were fixed-pattern,
  local-time formats (`yyyyMMddHHmmss` for migration filenames and `yyyy-MM-dd HH:mm:ss` in the
  status/list/import tables). Both are now produced by a tiny dependency-free helper
  (`src/utils/date.ts`: `formatStamp` / `formatDateTime`). Output is byte-for-byte identical;
  one fewer dependency in the install tree.

## v1.2.0

CI-friendly output, an unlock escape hatch, and security/robustness hardening.

### Added
- ** step controls** — finer-grained apply/rollback alongside the default batch model:
  - **`mmk up --step`** — apply each pending file as its **own** sequential batch (instead of one
    shared batch for the run), so a later `down` can peel migrations off one at a time.
  - **`mmk down --steps <n>`** — revert the **last N applied migrations**, newest first, counted as
    individual files **regardless of batch**. Mutually exclusive with `--batch` and a filename.
  - **`mmk dry-run down --steps <n>`** — preview the same last-N rollback without touching the
    database.
- **`--json` machine-readable output** — pass `--json` to any data command (`up`, `down`, `redo`,
  `status`, `list`, `dry-run`, `import`, `create`, `unlock`) to emit a single JSON document on
  stdout (the natural payload — run results, status rows, import result, etc.). Human logs and the
  spinner are routed to stderr so stdout stays pipe-safe; on failure the command prints
  `{ "error": { "code?", "message" } }` and exits 1. (`mmk init --json` is unchanged — there it
  still selects the `mmk.config.json` file format.)
- **`mmk status --check`** — exits with code 1 when any migration is pending, so a CI step can gate
  a deploy on a fully-migrated database.
- **`mmk unlock`** — force-release a stuck lock left behind by a crashed run. Shows the current
  holder (pid / host / user / since) and prompts for confirmation unless `--yes`; `--json` returns
  `{ released, holder }`. New `MigratorKit.lockInfo()` / `forceUnlock()` and public `LockInfo` type.
- **`mmk up <file> --force --yes`** — confirm a forced re-run non-interactively. In `--json` mode
  `--force` without `--yes` is now refused (rather than silently re-running), so automation never
  re-applies a migration without explicit consent.

### Fixed / hardened

- **Path-traversal protection** — migration names are validated to be bare filenames and confined to
  the migrations directory, so a crafted name (e.g. via `mmk up ../../evil.js` or an imported
  changelog record) can no longer load or read a file outside it. New `MigrationInvalidNameError`
  (`MIGRATION_INVALID_NAME`).
- **Lock safety for long migrations** — the lock now renews on a heartbeat (at half the TTL) while a
  migration runs, so a migration longer than `lockTTLSeconds` can no longer have its lock reclaimed
  mid-run. Acquisition carries an `owner` token (atomic stale-reclaim), and release/renew are
  owner-scoped so a run never deletes a lock that was reclaimed from it.
- **Clear `.ts` runtime error** — when a Node runtime can't import a `.ts` migration, the loader now
  throws an actionable error (use Node ≥ 22.18, a TypeScript loader such as `tsx`, or a `.js` file)
  instead of a cryptic `ERR_UNKNOWN_FILE_EXTENSION`.
- `prepublishOnly` now runs `typecheck` + `lint` + `test` before `build`, so a broken release can't
  be published.

### Added exports

- `LockInfo` type and `MigrationInvalidNameError` error class.

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
