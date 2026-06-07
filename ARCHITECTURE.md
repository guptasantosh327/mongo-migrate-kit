# Architecture & Contributor Guide — `mongo-migrate-kit`

> **Audience:** maintainers and new contributors who need to *understand and change* the codebase
> (not end-users — they have the [docs site](https://mongo-migrate-kit.vercel.app/) and `README.md`).
>
> **What this is:** a systematic, ground-up explanation of how the library is built, why each piece
> exists, how data flows through it, and every non-obvious nuance you need to make a safe change.
>

**Snapshot at time of writing:** v1.2.2 · 246 test cases across 35 files · Node ≥ 18 (published) /
Node ≥ 20 (to develop & test) · runtime deps: `commander`, `chalk@4`, `cli-table3`, `ora@5`,
`dotenv`, `zod` · peer deps: `mongodb`, optional `mongoose`.

---

## Table of contents

1. [The 5-minute mental model](#1-the-5-minute-mental-model)
2. [Repository layout](#2-repository-layout)
3. [The layered architecture](#3-the-layered-architecture)
4. [End-to-end: what happens when you run `mmk up`](#4-end-to-end-what-happens-when-you-run-mmk-up)
5. [Module reference](#5-module-reference)
6. [Deep dives on the subtle subsystems](#6-deep-dives-on-the-subtle-subsystems)
7. [Cross-cutting conventions](#7-cross-cutting-conventions)
8. [The nuances / intentional deviations (read before changing anything)](#8-the-nuances--intentional-deviations)
9. [Testing strategy](#9-testing-strategy)
10. [Build, typecheck, lint, release](#10-build-typecheck-lint-release)
11. [Recipe: how to add a new command/feature](#11-recipe-how-to-add-a-new-commandfeature)
12. [Glossary](#12-glossary)

---

## 1. The 5-minute mental model

mongo-migrate-kit is a MongoDB migration tool with two faces over **one engine**:

- **A CLI** (`mmk`) — what most users run.
- **A programmatic API** (`MigratorKit` + helper functions) — for app startup, serverless, tests.

Both faces are thin. All real logic lives in **one orchestrator class**, [`MigratorKit`](src/core/migrator.ts),
which coordinates a handful of small, single-responsibility modules:

```
            ┌────────────────────────────────────────────────┐
   mmk CLI ─┤                                                  │
            │              MigratorKit (orchestrator)          ├─ MongoDB
  your code ┤                                                  │
            └───┬──────┬───────┬────────┬────────┬────────┬───┘
              config  lock  changelog  loader  runner  context
```

Three ideas explain almost everything:

1. **Config is resolved once, then everything reads it.** Priority: CLI flags > env vars > config
   file > defaults ([config.ts](src/core/config.ts)).
2. **The changelog is an append-mostly audit trail.** Applying a migration *upserts* a record;
   reverting *updates* it to `status:'reverted'` — it **never deletes** ([changelog.ts](src/core/changelog.ts)).
3. **A MongoDB-native lock makes concurrent runs safe.** Only one process migrates at a time; a
   heartbeat keeps long migrations from losing their lock ([lock.ts](src/core/lock.ts)).

If you internalize those three, the rest is detail.

---

## 2. Repository layout

```
src/
├── index.ts                 # Public API barrel — the ONLY thing users import
├── types/index.ts           # ALL shared types & interfaces (single source)
├── errors/index.ts          # MmkError base + one subclass per error code
├── core/                    # The engine
│   ├── migrator.ts          # MigratorKit — orchestrates everything (the heart)
│   ├── config.ts            # Config loader + zod validation + precedence
│   ├── lock.ts              # MongoDB distributed lock + heartbeat + runWithLock()
│   ├── changelog.ts         # Read/write the _mmk_migrations collection
│   ├── runner.ts            # Execute ONE migration up()/down() (+ transactions)
│   ├── context.ts           # Build the MigrationContext passed to each migration
│   ├── import.ts            # PURE migrate-mongo → MigrationRecord mapping
│   └── run.ts               # Programmatic helpers: runMigrations(), pendingMigrations()
├── utils/
│   ├── logger.ts            # Chalk logger (+ silent + stream-routed variants)
│   ├── checksum.ts          # SHA-256 file hashing
│   ├── loader.ts            # Dynamic-import a migration file (.ts/.js, ESM/CJS)
│   ├── template.ts          # Generate migration files & config files
│   └── date.ts              # Dependency-free timestamp formatting
└── cli/
    ├── index.ts             # commander root: registers commands + global flags
    ├── shared.ts            # withMigrator(), confirm(), emitJson(), partialFromOpts()
    ├── table.ts             # cli-table3 renderers (status/list/import)
    └── commands/*.ts        # One file per command — thin wrappers over MigratorKit

bin/mmk.ts                   # CLI shebang entry → calls cli/index.ts run()
tests/                       # unit/ (mocked) + integration/ (mongodb-memory-server)
docs/                        # VitePress user-facing site (dev-only, never published to npm)
```

**Golden rule of navigation:** a behavior change almost always lands in `src/core/migrator.ts` (the
flow) plus one small module (the mechanism). The CLI command files rarely contain logic — they parse
flags and delegate.

---

## 3. The layered architecture

There are three layers. Keep logic in the lowest layer it belongs to.

| Layer | Files | Responsibility | Must NOT |
|---|---|---|---|
| **Presentation** | `cli/`, `bin/` | Parse args, render tables/JSON, spinner, prompts, exit codes | Contain migration logic; touch the DB directly |
| **Orchestration** | `core/migrator.ts`, `core/run.ts` | Sequence the steps of each command; own the connection lifecycle | Import a spinner / chalk directly; render tables |
| **Mechanism** | `core/{lock,changelog,runner,context,import,config}.ts`, `utils/` | One job each, pure-ish, unit-testable | Know about the CLI; call `console.*` |

**Why this matters for you:** the CLI's ora spinner lives *entirely* in [cli/shared.ts](src/cli/shared.ts)
and is injected into core as a `ProgressReporter` callback. Core never imports `ora`. Likewise the
`--json` routing, the `y/N` prompts, and exit codes are all presentation concerns. If you find
yourself wanting to `import ora` inside `core/`, stop — pass a callback instead. This separation is
what lets the same engine power both the CLI and `runMigrations()`.

---

## 4. End-to-end: what happens when you run `mmk up`

Trace this once and you understand the whole system. Command: `mmk up --strict`.

```
bin/mmk.ts
  └─ run(process.argv)                              [cli/index.ts]
       └─ commander parses → up command action      [cli/commands/up.ts]
            ├─ pre-flight validation (--force/--json rules) — presentation only
            └─ withMigrator(opts, fn, {spinner})    [cli/shared.ts]
                 ├─ partialFromOpts(opts) → Partial<MmkConfig>   (flags only)
                 ├─ new MigratorKit(partial, {progress: spinnerReporter})
                 ├─ migrator.connect()              ← spinner: "Connecting…"
                 └─ fn(migrator):
                      └─ migrator.up(file, {noLock, force, step})  [core/migrator.ts]
                           ├─ ensureConfig()         → loadConfig()          [config.ts]
                           │     flags > env > file > defaults, zod-validated
                           ├─ connect() (idempotent) → MongoClient + ensureIndexes  [changelog.ts]
                           └─ runWithLock(lock, …, () => runUp(...))         [lock.ts]
                                ├─ lock.acquire()  (atomic test-and-set + owner readback)
                                ├─ start heartbeat (renew every ttlMs/2)
                                ├─ runUp():                                  [core/migrator.ts]
                                │    ├─ getAppliedNames()                    [changelog.ts]
                                │    ├─ resolve targets (file | pending dir files)
                                │    ├─ nextBatch()
                                │    ├─ hooks.beforeAll
                                │    └─ for each target:
                                │         ├─ computeChecksum()               [checksum.ts]
                                │         ├─ skip/strict-throw if already applied
                                │         ├─ loadMigrationFile()             [loader.ts]
                                │         ├─ progress.onStart() (spinner)
                                │         ├─ runMigration() (txn?)           [runner.ts]
                                │         ├─ markApplied() (upsert)          [changelog.ts]
                                │         └─ hooks.afterEach
                                └─ finally: clearInterval(heartbeat); lock.release()
                 └─ finally: migrator.disconnect()
            └─ on any error: withMigrator prints "✖ CODE: message", process.exitCode = 1
```

Key observations:

- **The lock wraps the *whole batch*, not each file.** One acquire/release per `up` call.
- **Errors stop the batch.** `runUp`'s loop rethrows on the first failure; already-applied files in
  that run stay applied (changelog records them as they succeed), the failing one does not.
- **`connect()` is idempotent** — both `withMigrator` and `up()` call it; the second is a no-op.
- **`disconnect()` always runs** in `withMigrator`'s `finally`. The programmatic helpers do the same.

---

## 5. Module reference

Each entry: **responsibility · key exports · nuances you must know.**

### `src/types/index.ts` — the shared vocabulary
- **Responsibility:** every cross-module type. No type is defined inline elsewhere.
- **Key types:** `MmkConfig`, `MmkConfigInput` (object *or* factory fn), `MigrationContext`,
  `MigrationModule`, `MigrationRecord`, `MigrationHooks`, `MmkLogger`, `RunResult`, `StatusRow`,
  `ProgressReporter`, `LockInfo`, `MmkErrorCode`, the import types.
- **Nuances:** `MigrationContext.session` is an *intentional* addition beyond the original spec —
  it's how transactions reach your migration. `MigrationRecord.origin` marks migrate-mongo imports
  as forward-only. When you add a config field, it goes here **and** in the zod schema **and** the
  defaults **and** (if env-settable) the env reader.

### `src/errors/index.ts` — the error model
- **Responsibility:** `MmkError` base class (carries a typed `code` + `context`) and exactly one
  subclass per `MmkErrorCode`.
- **Nuances:** never `throw new Error(...)` anywhere in `src/`. Always a domain error. The `code` is
  what the CLI prints (`✖ LOCK_ALREADY_HELD: …`) and what `--json` emits as `error.code`. Adding an
  error = add the literal to `MmkErrorCode` in types, add the subclass here, export from
  [index.ts](src/index.ts) if it's part of the public surface.

### `src/core/config.ts` — configuration resolution
- **Responsibility:** merge config from all sources, validate, return a complete `MmkConfig`.
- **Key exports:** `loadConfig(options)`, `DEFAULT_CONFIG`.
- **Precedence (highest wins):** `flags` → `MMK_*` env vars → config file → `DEFAULT_CONFIG`,
  implemented as successive `mergeDefined()` calls onto a defaults base ([config.ts:160-178](src/core/config.ts#L160-L178)).
- **Nuances:**
  - `dotenv.config({ override: false })` runs first so a real env var beats `.env`.
  - The config file may export an **object or a (sync/async) factory function** — the factory is
    awaited ([config.ts:136-145](src/core/config.ts#L136-L145)). This is the secret-manager story; a
    throwing factory becomes `ConfigInvalidError`.
  - `requireDb: false` (used by `create`/`init`) relaxes the schema so `uri`/`dbName` may be empty —
    those commands never connect.
  - Validation is zod; failures throw `ConfigInvalidError` with per-issue `path`+`message`.

### `src/core/lock.ts` — distributed lock (the subtlest module)
- **Responsibility:** ensure only one migration run executes at a time, cluster-wide.
- **Key exports:** `MigrationLock` (acquire/renew/release/inspect/forceRelease), `runWithLock()`.
- See the [deep dive](#62-the-lock-the-most-important-thing-to-get-right) — read it before touching
  anything here.

### `src/core/changelog.ts` — the audit trail
- **Responsibility:** read/write `MigrationRecord`s in `_mmk_migrations`.
- **Key methods:** `getAll`, `getAppliedNames`, `getByName`, `getLastBatch`, `getByBatch`, `count`,
  `getForeignDocs` (raw read for import), `markApplied`, `markReverted`, `ensureIndexes`.
- **Nuances:**
  - `markApplied` is a **`replaceOne(..., {upsert:true})` keyed on `name`** — *not* `insertOne`. This
    is deliberate: `redo` / `up --force` / `import` must overwrite a record without violating the
    unique `name` index ([changelog.ts:81-83](src/core/changelog.ts#L81-L83)).
  - `markReverted` **never deletes** — it sets `status:'reverted'` + `revertedAt`. Audit history is
    sacred.
  - `ensureIndexes` creates the unique index on `name`; called on every `connect()`.

### `src/core/runner.ts` — single-migration execution
- **Responsibility:** run exactly one `up()` or `down()`, optionally inside a transaction, time it,
  fire `onError`, and translate any throw into `MigrationExecutionFailedError`.
- **Key export:** `runMigration(params)`.
- **Nuances:** when `useTransaction`, it starts a session, injects it into a *copy* of the context
  (`{...context, session}`), commits on success, **aborts on failure (swallowing the abort error so
  it can't mask the original)**, and always `endSession()` in `finally`. `onError` runs *before* the
  wrapped error is thrown. Errors are never swallowed.

### `src/core/context.ts` — the migration's world
- **Responsibility:** build the `MigrationContext` (`{ client, db, mongoose? }`) handed to migrations.
- **Nuance:** `mongoose` is only attached when present. The `session` is added later by the runner,
  not here.

### `src/core/import.ts` — migrate-mongo adoption (pure)
- **Responsibility:** **pure** transform from raw migrate-mongo changelog docs to `MigrationRecord`s.
- **Key exports:** `mapMigrateMongoDocs`, `isMigrateMongoDoc`.
- **Nuances:** all impure inputs (disk checksum, identity) are injected via `MapOptions` so the
  mapper is trivially unit-testable. Each imported record gets a **unique sequential batch** in apply
  order, offset past the target's existing batches; `origin:'migrate-mongo'` marks it forward-only.

### `src/core/migrator.ts` — the orchestrator (the heart)
- **Responsibility:** every command's flow. `up`/`down`/`redo`/`dryRun`/`status`/`list`/`create`/
  `init`/`import`/`lockInfo`/`forceUnlock`, plus connection lifecycle.
- **Shape:** public method validates + connects + wraps the *private* `runX` worker in `runWithLock`.
  The `runX` worker is where the actual sequencing lives. This split keeps lock handling in one place.
- **Nuances:** `filepath(name)` centralizes **path-traversal defense** — every user-supplied name
  flows through it ([migrator.ts:256-279](src/core/migrator.ts#L256-L279)). Batch numbers come from
  `nextBatch()` (monotonic max+1). `down --steps` and its dry-run share `selectLastApplied` +
  `assertStepsValid`. `assertReversible` preflights migrate-mongo records before any write.

### `src/core/run.ts` — programmatic entry points
- **Responsibility:** the "blessed" lifecycle-safe helpers for app startup / serverless / tests.
- **Key exports:** `runMigrations(config, options)` → `MigrationSummary`; `pendingMigrations(config)`
  → `StatusRow[]`.
- **Nuances:** both manage their own connect/disconnect in a `finally`. `runMigrations` adds
  multi-instance lock handling: `onLockHeld: 'wait'` polls past `LockAlreadyHeldError` up to
  `lockWaitTimeoutMs`. See the [deep dive](#65-the-programmatic-api-runts).

### `src/utils/`
- **logger.ts** — `createLogger(stream)` (info/success/dim → stream; warn/error → stderr always),
  `silentLogger`, `resolveLogger(null→silent, undefined→default, custom→custom)`. The stream param
  is how `--json` keeps stdout clean (human lines → stderr).
- **checksum.ts** — `computeChecksum` (SHA-256 hex of file contents), `verifyChecksum`.
- **loader.ts** — `loadMigrationFile(filepath)`: dynamic `import()`, `mod.default ?? mod` for CJS,
  validates `up`/`down` are functions. Translates the `.ts`-can't-load failure into a clear error —
  see the [loader deep dive](#64-the-loader-and-the-ts-runtime-caveat).
- **template.ts** — generates migration files (`createMigrationFile`) and config files
  (`createConfigFile`), including the secret-provider template. Owns filename stamping (timestamp vs
  sequential) and the inline-commented config output.
- **date.ts** — `formatStamp`/`formatDateTime`, dependency-free (replaced `date-fns`).

### `src/cli/`
- **index.ts** — builds the commander program, registers global flags (`--uri/--db/--dir/--config`)
  and every command. `run(argv)` parses & dispatches.
- **shared.ts** — the CLI's workhorse:
  - `withMigrator(opts, fn, {spinner, json})` — constructs `MigratorKit`, drives the ora spinner,
    routes output for `--json`, runs `fn`, **always disconnects**, maps errors to exit code 1.
  - `partialFromOpts` — flags → `Partial<MmkConfig>`.
  - `emitJson` — one JSON doc to stdout.
  - `confirm` — `y/N` prompt via `node:readline/promises`.
- **table.ts** — cli-table3 renderers for human output.
- **commands/*.ts** — one `registerX(program)` per command. They parse flags, do presentation-only
  pre-flight checks, then call `withMigrator`. Look at [up.ts](src/cli/commands/up.ts) as the
  canonical example (force/yes/json pre-flight rules + delegation).

### `bin/mmk.ts`
- Six lines: import `run`, call it with `process.argv`, print + exit 1 on an unhandled throw. The
  shipped binary is the **CJS** build of this (`dist/mmk.cjs`) with a `#!/usr/bin/env node` banner.

---

## 6. Deep dives on the subtle subsystems

### 6.1 Config resolution
The whole function is [`loadConfig`](src/core/config.ts#L155-L208). Order of operations:
1. `dotenv.config({ override:false })` — load `.env` without clobbering real env.
2. Start from `{...DEFAULT_CONFIG}`.
3. If a config file is found (explicit `--config` path, else discover `mmk.config.{ts,js,json}` in
   cwd), load it (awaiting a factory if exported) and `mergeDefined` onto the base.
4. `mergeDefined(readEnvConfig())` — env beats file.
5. `mergeDefined(flags)` — flags beat env.
6. If `requireDb:false`, default empty `uri`/`dbName` so validation passes.
7. zod `safeParse`; on failure throw `ConfigInvalidError` with structured issues.

`mergeDefined` only copies **defined** keys, so a partial source never erases a lower-priority value
with `undefined`. This is why precedence works cleanly.

### 6.2 The lock (the most important thing to get right)
File: [lock.ts](src/core/lock.ts). The lock is a single document `{_id:'mmk_lock'}` in
`_mmk_locks`. Three mechanisms combine:

**(a) Atomic test-and-set with stale reclaim** — `acquire()`:
```
updateOne(
  { _id:'mmk_lock', lockedAt: { $lt: now - ttl } },   // matches only a stale/absent lock
  { $set: { ...holderInfo, owner: randomUUID() } },
  { upsert:true }
)
```
- If a **fresh** lock exists, the filter doesn't match and the upsert collides on `_id` →
  duplicate-key error → `LockAlreadyHeldError` (with the current holder attached).
- If **no** lock or a **stale** one exists, the upsert inserts/overwrites it.

**(b) Owner-token readback (closes a race)** — after the upsert, `acquire()` reads the doc back and
checks `owner === ourToken`. If two processes both reclaim the same stale lock, both `updateOne`s
succeed but only the last writer's `owner` survives; the loser sees a different token and throws
instead of running concurrently ([lock.ts:92-98](src/core/lock.ts#L92-L98)).

**(c) Heartbeat (makes long migrations safe)** — `runWithLock` starts a `setInterval` that calls
`renew()` every `ttlMs/2`. `renew()` is scoped to `{_id, owner}` so it only refreshes *our* lock and
returns `false` if we've lost it (logging a warning). The interval is `.unref()`-ed so it never keeps
the process alive, and is `clearInterval`-ed in `finally` ([lock.ts:170-195](src/core/lock.ts#L170-L195)).

**Release** — `deleteOne({_id, owner})`, owner-scoped so we never delete a lock since reclaimed by
someone else. `forceRelease()` (for `mmk unlock`) deletes unconditionally by `_id`.

> **Why TTL + heartbeat instead of just TTL?** TTL alone means a migration longer than `lockTTLSeconds`
> would let its own lock go stale and be stolen mid-run. The heartbeat refreshes it; the TTL is only
> the *crash-recovery* window (a dead holder's lock becomes reclaimable after TTL).

**Interactions to remember:** MongoDB's own `transactionLifetimeLimitSeconds` (~60s default) is
*independent* of this lock — a 5-minute single transaction fails regardless. And `runMigrations`'
`lockWaitTimeoutMs` must exceed a long migration's duration or waiting peers time out.

### 6.3 The changelog & batches
- A **batch** groups migrations applied together. Default `up` assigns one shared batch to the whole
  run (`nextBatch()` = max existing batch + 1). `up --step` gives each file its own sequential batch.
- `down` (no args) reverts the **last batch**; `down --batch N` a specific batch; `down --steps N`
  the last N applied files ignoring batches (newest-first, `appliedAt` desc).
- Records are upserted by `name`, so re-applying overwrites cleanly. Reverting flips `status` and
  stamps `revertedAt` but keeps the row — `status()` and `getAppliedNames()` filter on
  `status:'applied'`.

### 6.4 The loader and the `.ts` runtime caveat
File: [loader.ts](src/utils/loader.ts). It dynamic-`import()`s the migration via a `file://` URL and
resolves `mod.default ?? mod` (CJS default vs ESM named). It validates both `up` and `down` are
functions, else `MigrationInvalidExportError`.

**The caveat that confuses everyone:** the *shipped* binary is plain-Node CJS; `tsx` is a
**devDependency only**. So a `.ts` migration imports natively only on **Node ≥ 22.18** (built-in type
stripping) or under a user-provided loader. On older Node, `import('foo.ts')` throws
`ERR_UNKNOWN_FILE_EXTENSION`. `tsLoadErrorOrNull()` detects exactly that and rethrows an actionable
`MigrationInvalidExportError` ("use Node ≥ 22.18 / a TS loader / a .js file") instead of a cryptic
Node error. This is why `createExtension` defaults to `'js'`. The real-world behavior is verified by
[tests/integration/runtime-ts.test.ts](tests/integration/runtime-ts.test.ts), which runs the built
`dist/mmk.cjs` under plain node.

### 6.5 The programmatic API (run.ts)
File: [run.ts](src/core/run.ts).
- `runMigrations(config, options)` — `new MigratorKit` → `connect` → loop `up()` → `disconnect`
  (finally). The loop only re-iterates when `onLockHeld:'wait'` **and** the error is
  `LockAlreadyHeldError` **and** there's time left before `lockWaitTimeoutMs`; otherwise it rethrows.
  Returns `{ applied, upToDate, waited }`.
- `pendingMigrations(config)` — connect → `list('pending')` → disconnect (finally). Read-only
  readiness probe.
- **Design intent:** these are the *blessed* one-call entry points so users never hand-roll the
  connect/run/disconnect dance (and never leak a connection). They are exported from
  [src/index.ts](src/index.ts) alongside `MigratorKit`.

---

## 7. Cross-cutting conventions

These are enforced (biome + review). Violating them is how a PR gets bounced.

- **Types:** `strict` TS, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. No `any` (use
  `unknown` + narrowing). Explicit return types on public functions. JSDoc on public methods.
- **Errors:** never `throw new Error`. Always a `MmkError` subclass with a typed `code`. Never
  swallow — rethrow or route to `onError`.
- **Logging:** never `console.*`. Always the injected `MmkLogger`. Core resolves it via
  `resolveLogger`; the CLI builds stream-targeted loggers. `null` logger = silent (used in all tests).
- **Imports/exports:** named exports only (config files are the sole default-export exception).
  Internal `.js` import specifiers (NodeNext) even though sources are `.ts`.
- **Style:** biome — single quotes, semicolons, 100-col, sorted imports, no unused.
- **Public surface:** anything users should touch must be re-exported from [src/index.ts](src/index.ts).
  If it's not there, it's private.

---

## 8. The nuances / intentional deviations

These look like bugs or oversights but are deliberate. **Do not "fix" them without discussion.**
The high-impact ones for code changes:

- **`markApplied` upserts (not inserts)** — required for `redo`/`force`/`import` over the unique index.
- **`markReverted` never deletes** — audit trail. Reverted ≠ gone.
- **`MigrationContext.session`** — beyond the original type spec; how transactions actually work.
- **Spinner / prompts / JSON routing live in the CLI**, never in core. Core takes a `ProgressReporter`
  callback. Don't import `ora`/`chalk` in `core/`.
- **`createExtension` defaults to `'js'`** and `.ts` is opt-in — because of the shipped-binary
  runtime caveat above. The "first-class .ts" claim is about *authoring/types*, not guaranteed
  runtime on the shipped CJS binary.
- **migrate-mongo imports are forward-only** (`origin:'migrate-mongo'`). `down`/`redo` preflight
  `assertReversible` and refuse them with `IrreversibleMigrationError`.
- **Path traversal is blocked centrally in `filepath()`** — every user-supplied migration name (even
  one read back from a tampered changelog) is validated there.
- **`--json` is per-command, not global**, and is *not* on `init` (where `--json` means "generate
  mmk.config.json"). In JSON mode, human/progress output goes to stderr; stdout is one JSON doc.
- **`down --steps` preserves selection order** (newest-first) via a `preserveOrder` flag, instead of
  the usual filename-desc sort.

---

## 9. Testing strategy

- **Runner:** vitest v4 (needs Node ≥ 20 to run the suite). `npm test` = `vitest run`.
- **Two tiers:**
  - `tests/unit/` — mock the DB; test pure logic (config precedence, checksum, loader, mapping,
    lock semantics with a fake collection, template, date, errors).
  - `tests/integration/` — real in-memory MongoDB via `mongodb-memory-server` (a **replica set**, so
    transactions work). Start in `beforeAll`, stop in `afterAll`, `dropDatabase` in `beforeEach`.
- **Harness:** [tests/helpers/](tests/helpers/) — `startTestMongo` (replica set + client),
  `makeProject` (throwaway migrations dir with `write`/`tamper`/`cleanup`), `makeMigrator`
  (a `MigratorKit` pointed at the test mongo with `logger:null`), and migration-body factories
  (`insertMigration`, `failingMigration`).
- **Rules:** every feature ships with tests in the same PR. Silence the logger (`logger:null`). No
  `.only`/`.skip` committed. Test file names mirror source names. Coverage gate: **90% lines / 90%
  funcs / 85% branches**.
- **Gotcha:** Node caches dynamic `import()` by path. A test that rewrites the *same* migration
  filename mid-run will re-load the *cached* module. Use a new filename, or assert via a read-only
  path (`pendingMigrations`), when you need "changed file" behavior.
- **Memory note:** running the *entire* integration suite **with v8 coverage** can OOM on
  constrained machines (many `mongodb-memory-server` instances + instrumentation). `vitest run` alone
  is fine; scope `--coverage` to specific files when verifying a single module.

Useful commands:
```bash
npm test                                  # full suite
npx vitest run tests/integration/up.test.ts   # one file
npx vitest run --coverage --coverage.include='src/core/run.ts'  # coverage for one module
```

## 10. Build, typecheck, lint, release

- **Build:** `npm run build` → tsup produces, into `dist/`: the library as **CJS + ESM + `.d.ts`**
  (from `src/index.ts`) and the CLI as **CJS only** (from `bin/mmk.ts`, with the shebang banner).
  See [tsup.config.ts](tsup.config.ts). The `mmk` version string is injected at build time
  (`MMK_VERSION`); unbundled dev runs fall back to `0.0.0-dev`.
- **Typecheck:** `npx tsc --noEmit` (covers `src/` + `bin/`).
- **Lint/format:** `npx biome check src/ bin/ tests/` (and `biome format --write` to fix).
- **Published artifact:** only `dist/`, `README.md`, `CHANGELOG.md` (the `files` field). The `docs/`
  site and this `ARCHITECTURE.md` live in the repo but are **never** shipped to npm (the `files`
  field is `dist`-scoped).
- **Release:** `npm run release` = `bumpp` (version + tag, conventional-commits changelog) then
  `npm publish`. `prepublishOnly` re-runs typecheck + lint + test + build as a gate.
- **Commits:** Conventional Commits required (`feat(scope):`, `fix(scope):`, `test(...)`, etc.).

## 11. Recipe: how to add a new command/feature

Concrete worked path — say you're adding `mmk verify` (re-checks all checksums):

1. **Types** ([src/types/index.ts](src/types/index.ts)) — add any new result/option type and, if
   needed, a new `MmkErrorCode` literal.
2. **Errors** ([src/errors/index.ts](src/errors/index.ts)) — add the matching `MmkError` subclass.
3. **Core logic** ([src/core/migrator.ts](src/core/migrator.ts)) — add a public method `verify()`.
   If it touches the DB and mutates, wrap the worker in `runWithLock`; if it's read-only (this one
   is), just `ensureConfig()` + `connect()`. Reuse existing mechanism modules — don't reimplement
   checksum/changelog logic.
4. **Public API** ([src/index.ts](src/index.ts)) — export any new types/errors users need.
5. **CLI command** (`src/cli/commands/verify.ts`) — `registerVerify(program)`: define flags
   (`--json` if it emits data), do presentation-only pre-flight, then `withMigrator(opts, fn, {...})`.
   Copy [up.ts](src/cli/commands/up.ts) as the template.
6. **Register it** ([src/cli/index.ts](src/cli/index.ts)) — import + call `registerVerify(program)`.
7. **Rendering** ([src/cli/table.ts](src/cli/table.ts)) — add a renderer if it has table output.
8. **Tests** — unit test the pure bits; integration test the flow against `mongodb-memory-server`.
   Both in the same PR.
9. **Docs** — update `README.md` and add `docs/commands/verify.md` for the user site. Update the
   relevant section of this file if you introduced a nuance.
10. **Verify:** `tsc --noEmit` → `biome check` → `vitest run` → `npm run build`.

**Where logic goes (decision rule):** mutation sequencing → a `runX` worker in `migrator.ts`; a
reusable mechanism (hashing, locking, mapping) → its own `core/`/`utils/` module; anything about how
it *looks* or *exits* → the CLI layer.

## 12. Glossary

- **Batch** — a group of migrations applied together, sharing a `batch` number; the unit `down`
  reverts by default.
- **Changelog** — the `_mmk_migrations` collection; the append-mostly audit trail of `MigrationRecord`s.
- **Checksum** — SHA-256 of a migration file at apply time; re-checked later to detect tampering.
- **Context** — the `{ db, client, mongoose?, session? }` object passed into every `up`/`down`.
- **Heartbeat** — the periodic `renew()` that keeps a long migration's lock fresh.
- **Hooks** — user callbacks (`beforeAll`/`afterAll`/`beforeEach`/`afterEach`/`onError`) run around
  migrations.
- **Migrator** — `MigratorKit`, the orchestrator class.
- **Origin** — `'migrate-mongo'` marks an imported, forward-only record (cannot be reverted).
- **Owner token** — the random UUID proving which process currently holds the lock.
- **Progress reporter** — the CLI-injected callback that drives the spinner without core importing ora.
- **Step** — Laravel-style per-file batching (`up --step`) / per-file rollback (`down --steps N`).

---

*Keep this file honest. If you change behavior and this doc still describes the old way, the doc is a
bug — fix it in the same PR.*
