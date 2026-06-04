# Programmatic API

Everything the `mmk` CLI does is available programmatically through the `MigratorKit` class — useful
for running migrations from app startup, a deploy script, or tests.

```ts
import { MigratorKit } from 'mongo-migrate-kit';

const migrator = new MigratorKit({
  uri: 'mongodb://localhost:27017',
  dbName: 'my_app',
  migrationsDir: './migrations',
});

await migrator.connect();
const results = await migrator.up();
await migrator.disconnect();

console.log(results); // → RunResult[]
```

## `new MigratorKit(config?, options?)`

```ts
constructor(config?: Partial<MmkConfig>, options?: MigratorKitOptions)
```

- `config` — any subset of [`MmkConfig`](/guide/configuration#all-options). Anything omitted falls
  back to env vars, a config file, then defaults — the same precedence as the CLI.
- `options` — runtime extras such as a `logger`, a `configPath`, or a `progress` reporter.

::: tip Connection is lazy
Most methods call `connect()` for you if you haven't. Call it explicitly when you want to control
when the connection opens, and always pair it with `disconnect()`.
:::

## Methods

| Method | Returns | Description |
|---|---|---|
| `connect()` | `Promise<void>` | Open the MongoDB connection and ensure changelog indexes. |
| `disconnect()` | `Promise<void>` | Close the connection. |
| `up(filename?, options?)` | `Promise<RunResult[]>` | Apply all pending migrations, or one file. |
| `down(filename?, options?)` | `Promise<RunResult[]>` | Revert the last batch, or a file/batch/last-N. |
| `redo(filename?)` | `Promise<RunResult[]>` | Revert then re-apply. |
| `dryRun(direction, filename?, options?)` | `Promise<StatusRow[]>` | Preview `'up'`/`'down'` without writing. |
| `status()` | `Promise<StatusRow[]>` | Full status of every known migration. |
| `list(filter)` | `Promise<StatusRow[]>` | Filtered status: `'all' \| 'pending' \| 'applied'`. |
| `create(name, options?)` | `Promise<string>` | Scaffold a new migration; returns its path. |
| `init(options?)` | `Promise<string>` | Generate a config file; returns its path. |
| `import(options?)` | `Promise<ImportResult>` | Adopt a migrate-mongo changelog. |
| `lockInfo()` | `Promise<LockInfo \| null>` | Inspect the current lock holder, if any. |
| `forceUnlock()` | `Promise<LockInfo \| null>` | Force-release the lock; returns who held it. |

`up`/`down`/`redo` return a [`RunResult[]`](#runresult); `status`/`list`/`dryRun` return
[`StatusRow[]`](#statusrow).

## Common patterns

### Run migrations on app startup

```ts
const migrator = new MigratorKit(); // reads env / config file
try {
  await migrator.up();
} finally {
  await migrator.disconnect();
}
```

### Gate a deploy on pending migrations

```ts
const rows = await migrator.status();
const pending = rows.filter((r) => r.status === 'pending');
if (pending.length > 0) {
  throw new Error(`${pending.length} migration(s) pending — aborting deploy`);
}
```

### Silence output (e.g. in tests)

```ts
const migrator = new MigratorKit({ /* ... */, logger: null });
```

## Key types

### `RunResult`

```ts
interface RunResult {
  file: string;
  status: 'applied' | 'reverted' | 'skipped' | 'error';
  duration?: number;
  batch?: number;
  reason?: string;
  error?: string;
}
```

### `StatusRow`

```ts
interface StatusRow {
  file: string;
  status: 'applied' | 'pending';
  batch: number | null;
  appliedAt: Date | null;
  duration: number | null;
  checksumOk: boolean | null; // null = pending, true = match, false = mismatch
  description?: string;
}
```

All public types are exported from the package — `MmkConfig`, `MigrationContext`,
`MigrationRecord`, `RunResult`, `StatusRow`, `ImportResult`, `LockInfo`, and more. See the
[error classes](#errors) below and the [Error Codes reference](/reference/error-codes).

## Errors

Every error extends `MmkError`, which carries a typed `code` and an optional `context`:

```ts
import { MmkError } from 'mongo-migrate-kit';

try {
  await migrator.up();
} catch (err) {
  if (err instanceof MmkError) {
    console.error(err.code, err.message, err.context);
  }
}
```

Exported error classes include `LockAlreadyHeldError`, `ChecksumMismatchError`,
`ConnectionFailedError`, `NotAppliedError`, `IrreversibleMigrationError`, and more — see the full
table in the [Error Codes reference](/reference/error-codes).
