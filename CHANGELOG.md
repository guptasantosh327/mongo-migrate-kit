# Changelog

All notable changes to this project will be documented in this file.

## v1.6.0

### Added

- **`mmk config [--json]`** — shows the settings mmk resolved and where each one came from (a CLI
  flag, an `MMK_*` environment variable, the config file, or the default). It never connects, works
  without a connection string, and always hides the connection string's credentials. Paths are
  absolute. In code: `migrator.describeConfig()`, returning the new `ConfigSummary` type.
- `loadConfigWithSources()` — `loadConfig()` plus the config file it loaded and the layer of each
  value. `loadConfig()` is unchanged.
- **A failed run says what ran first.** When `up`, `down` or `redo` stops partway, the error's
  context has `results`: the `RunResult[]` of the files that ran before it stopped, with the failed
  file last (`status: 'error'`) when its own `up()` or `down()` threw. In `--json` output it's
  `error.details.results`; in code, `err.context.results`. A failed `redo` includes the revert.
  Errors that aren't an `MmkError` are passed on unchanged.
- **`StatusRow.checksum`**: the SHA-256 recorded when the migration was applied, on every applied
  row of `status`, `list` and `dry-run` (and their `--json` output). `checksumOk` already said
  whether the file still matches; now tools can see the value itself, e.g. to compare it with
  unsaved editor text or to find the commit whose version of the file ran. Absent on pending rows,
  and on an `mmk import` record that has no checksum.
- **`connect({ readOnly: true })`** (`ConnectOptions`, exported): connects without writing anything.
- **`mmk lock [--json]`** — shows who holds the migration lock (host, pid, user, namespace, since
  when, when it frees itself) and whether it has gone stale, so the next run takes it over. It never
  takes, renews or releases the lock and connects read-only, so a `read`-role user can run it.
  `--json` prints `{ "holder": LockInfo | null, "stale": boolean }`. In code:
  `migrator.lockStatus()`, returning the new `LockStatus` type.

### Changed

- **Read commands never write, so a read-only database user can run them.** `status`, `list`,
  `dry-run` and `status --all-namespaces` (and `pendingMigrations()`, `lockInfo()`) used to create
  the changelog index on connect, and with a `namespace` they also recorded the storage marker, so a
  user with only the `read` role got `CONNECTION_FAILED`. They now connect read-only. The check that
  refuses a newer storage format still runs, because it only reads. `connect()` and every command
  that changes something create the index as before, so the first write command on a new database
  creates the collection instead of the first `status`.

### Fixed

- **`--json` stdout holds only the JSON document.** A `console.log` (or `process.stdout.write`) in
  a migration, a hook or a config function used to print to stdout before the document, which
  broke `JSON.parse` and `jq`. In `--json` mode that output now goes to stderr. Without `--json`,
  nothing changes.
- **A write command with a `namespace`, run by a user that can't write, now reports
  `CONNECTION_FAILED`.** It used to fail with the driver's bare `not authorized` error, with no
  error code (also none in `--json`), because recording the storage format wasn't handled like
  creating the changelog index.

### Documentation

- **A page for the VS Code extension, Mongo Migrate Kit** (`/guide/vscode`), with recordings:
  installing it, the local workflow, staging and prod with read-only database users and the
  migration console, editing applied migrations, and which mongo-migrate-kit version each feature
  needs. The README and the docs home page show it in a short section.

## v1.5.0

Several repos, one database: give each repo a `namespace`.

### Added

- **`namespace`** (config / `MMK_NAMESPACE`) — one value per repo when several repos share a
  database. Each repo's changelog records carry its namespace and every query is scoped to it:
  `status` shows only this repo's migrations, batch numbers are per repo, and `down` / `down --steps`
  / `redo` never touch another repo's migrations. The collections stay shared (no new collections),
  and the unique index on `name` is unchanged. Without a `namespace`, nothing changes: existing
  records have no namespace field and belong to the default namespace as they are.
- **`mmk namespace adopt [--dry-run]`** — one-time move of a repo's records written before it had a
  namespace into its namespace (`MigratorKit.adopt()`, `AdoptResult`). The dry run lists who ran each
  record so a filename shared by two repos can be reviewed first.
- **`mmk status --all-namespaces`** — read-only overview of every namespace in the changelog
  collection (`MigratorKit.statusAllNamespaces()`, `NamespaceStatusRow`).
- **`mmk init --namespace <ns>`** — writes the namespace into the generated config. Without it, the
  template shows a commented-out example; the value is never guessed.
- **Safety checks** that refuse before anything runs:
  - `NAMESPACE_UNADOPTED` — a namespace is set but this repo's older records have none yet. Every
    command whose answer depends on what's applied refuses (`up`, `down`, `redo`, `import`,
    `dry-run`, `list --pending/--applied`, `pendingMigrations()`), so none of them reports applied
    migrations as pending. `status` and `list` warn instead and mark those rows `unadopted`
    (`StatusRow.unadopted`), and `status --check` names `adopt` as the reason.
  - `MIGRATION_NAME_CONFLICT` — a file to run is already recorded under another namespace. When
    several files sit under one other namespace, the message asks whether the namespace changed.
  - `SCHEMA_TOO_NEW` — on connect, when a newer mongo-migrate-kit wrote the database in a storage
    format this version doesn't understand. The marker lives in its own `_mmk_meta` collection and is
    written only by repos with a `namespace` — a single-repo database gets no new collection.
- **`mmk status` notes applied records without a file** — one info line, and `(no file)` after the
  name (`StatusRow.fileMissing`). Shown by `status` only, never by `up`.
- **`mmk import` with a namespace** imports only records whose files are in this repo
  (`ImportResult.notInRepo` lists the rest), stamps them with the namespace, and counts only this
  namespace for "target not empty" and batch numbering.
- **`LockInfo`** gains `namespace`, `acquiredAt` and `expiresAt`; `mmk unlock` shows the holder's
  namespace and warns when the lock belongs to another repo.

### Changed

- **The lock-held error names the holder** — namespace, host, pid, user, since when, and when the lock
  frees itself if the holder crashed — instead of `Migration lock is already held`.
- **Lock staleness respects each holder's own `lockTTLSeconds` and uses the server clock.** The lock
  document carries `expiresAt` (server time + the holder's TTL). Previously the run *trying* to take
  the lock judged staleness by its own TTL and its own clock, so a repo with a short TTL — or a
  machine whose clock ran ahead — could take over a lock while a long migration was still running.
  Locks written by older versions (no `expiresAt`) are judged by the old rule.
- **`mmk init` config files document every option in a `/** … */` block** — what it does, its
  default, and its env var or flag — instead of terse `//` comments. Options that are off by default
  stay as `// key: value` lines so one keystroke turns them on. The `--secret-provider` templates use
  the same wording and now also list `templatePath`, `author` and `hooks`.
- **The `status` / `list` / `dry-run` table no longer has a Duration column.** `duration` is still
  recorded and still in `--json` output and `StatusRow`.
- **`mmk init --uri` refuses a URI with a password in it** (`INVALID_ARGUMENT`, nothing written).
  The config file usually gets committed, so the password would end up in the repository. The
  message shows the command without the credentials and points to `MMK_URI` (which overrides the
  file) or `--secret-provider`. A username alone (x.509, AWS IAM) is still written, and
  `--secret-provider` never writes the URI, so it accepts any.
- **MongoDB server 4.2 or newer is required** (the lock uses the server clock and pipeline updates).
  Connecting to an older server fails with `CONNECTION_FAILED` and a message naming its version.

### Fixed

- **Config errors no longer print the password in a malformed `uri`.** A URI that fails validation
  (a leading space in `MMK_URI`, a `mongodb:/` typo) was echoed in full on the `Received:` line, and
  twice in `--json` output. The credentials are now hidden whatever the scheme looks like; the rest
  of the value, including a leading space, stays visible.
- **`CONNECTION_FAILED` no longer leaks a password with unescaped characters.** The redaction stopped
  at the first `/` or `@`, so `alice:pa/ss@host` was printed in full and `alice:pa@ss@host` showed
  `ss`. It now hides everything up to the last `@`. When the username or password has characters
  that must be percent-encoded (`: / ? # [ ] @`), the driver's own message is withheld too, because
  it can quote part of the password as a host name (`ENOTFOUND ss`). The message explains the
  encoding instead.
- **`Loaded config from …` no longer lands on the spinner's line** (`⠋ Connecting to MongoDB…Loaded
  config from mmk.config.ts`) in every command that connects. The config is now loaded before the
  spinner starts, so it and any config warnings print on their own lines — and `Loaded config` now
  comes before the warnings about that config. New `MigratorKit.resolveConfig()` resolves the config
  without connecting.
- **`mmk init` and `mmk create` work in CommonJS projects.** They used to write `export` syntax
  everywhere, so in a project whose `package.json` isn't `"type": "module"` — including every new
  `npm init -y` project — the very next command failed with `Unexpected token 'export'`. Both now
  read the nearest `package.json`, as Node does, and write an ES module only for `"type": "module"`;
  otherwise they write CommonJS (`module.exports = { … }`, `module.exports = config;`). This covers
  `.js` and `.ts` migrations and the `--ts` and `--secret-provider` configs (the CommonJS TypeScript
  forms keep only `import type`, which Node strips, so they run under Node 22.18+ type stripping and
  under `tsx`). Existing files and custom templates are untouched.
- **A migration or config file in the wrong module style is explained** instead of failing with
  Node's bare `Unexpected token 'export'` / `module is not defined in ES module scope` (which, for a
  migration, didn't even name the file). The message names the file and the `package.json` that
  decided its format, and gives both fixes: rewrite the file, or — for an applied migration, whose
  checksum must not change — add a `package.json` with the right `"type"` to its folder.
- **A `mmk.config.ts` on a Node that can't run TypeScript is explained** — naming the running Node
  version and the three ways out (Node 22.18+, `tsx`, or a `.js` config) — instead of Node's
  `Unknown file extension ".ts"`. `.ts` migrations already got this message.

### Deprecated

- **`service`** (config / `MMK_SERVICE` / `MigrationRecord.service`) — use `namespace`. They are not
  the same: `service` only labels records, `namespace` decides which migrations count as applied.
  Setting `service` explicitly prints a notice; it is removed in 2.0. Existing records keep the field.

## v1.4.0

Know who wrote a migration, not just who ran it.

### Added

- **`author` on migrations and changelog records** — `mmk create` now writes an
  `export const author = '…'` line into every new file, resolved from `--author`, then the new
  `author` config key / `MMK_AUTHOR`, then your git `user.name <user.email>`, then your OS username.
  `mmk up` copies it onto the changelog record (`MigrationRecord.author`), separate from
  `executedBy` (who ran it). It is captured once on your machine and committed with the file, so
  `mmk up` never needs git, and it is covered by the file checksum. Files without an author keep
  working; the field is simply left out.
- **`requireAuthor`** (config / `MMK_REQUIRE_AUTHOR`, default `false`) — when on, `mmk up` checks
  every file it is about to apply before running any of them, and refuses the run with
  `MIGRATION_INVALID_EXPORT`, listing every file without an author. Already-applied files are not
  checked unless re-run with `--force`.
- **`mmk create --author <name>`** — set the author for one file. An empty value is rejected.
- **`Author` column** in `mmk status` / `mmk list`, and `author` on `StatusRow` (`--json` output).
- `mmk init` templates document `author` and `requireAuthor`.

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
