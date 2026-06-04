# Configuration

`mongo-migrate-kit` resolves configuration from four sources, in priority order:

```
CLI flags  >  Environment variables  >  Config file  >  Defaults
```

A config file is **never required** — env vars alone are always sufficient.

## Config file

On startup, `mmk` looks in the current working directory for the first of:

1. `mmk.config.ts`
2. `mmk.config.js`
3. `mmk.config.json`

Generate one with [`mmk init`](/commands/create#mmk-init). Override discovery with `--config <path>`.

::: code-group

```js [mmk.config.js]
export default {
  uri: process.env.MMK_URI ?? 'mongodb://localhost:27017',
  dbName: 'my_app',
  migrationsDir: './migrations',
  migrationsCollection: '_mmk_migrations',
  strict: false,
  useTransaction: false,
  createExtension: 'js',
};
```

```ts [mmk.config.ts]
import type { MmkConfig } from 'mongo-migrate-kit';

const config: Partial<MmkConfig> = {
  uri: process.env.MMK_URI ?? 'mongodb://localhost:27017',
  dbName: 'my_app',
  migrationsDir: './migrations',
  createExtension: 'ts',
};

export default config;
```

```json [mmk.config.json]
{
  "uri": "mongodb://localhost:27017",
  "dbName": "my_app",
  "migrationsDir": "./migrations"
}
```

:::

## Async / factory config (secret managers)

A `.ts`/`.js` config may `export default` a **function** (sync or async) that returns the config.
This is the dependency-free way to load a connection from a secret manager at runtime — the library
ships no cloud SDKs, you bring your own inside the function:

```ts
import type { MmkConfigInput } from 'mongo-migrate-kit';

const loadConfig: MmkConfigInput = async () => {
  const { uri, dbName } = await fetchFromSecretsManager(); // your code
  return { uri, dbName, migrationsDir: './migrations' };
};

export default loadConfig;
```

Generate a ready-made AWS Secrets Manager template with `mmk init --secret-provider` (swap the body
for Google/Vault/Azure/any source — it just must return `{ uri, dbName }`).

## All options

| Option | Type | Default | Description |
|---|---|---|---|
| `uri` | `string` | — | MongoDB connection URI **(required)** |
| `dbName` | `string` | — | Database name **(required)** |
| `migrationsDir` | `string` | `'./migrations'` | Directory holding migration files |
| `migrationsCollection` | `string` | `'_mmk_migrations'` | Collection storing the changelog |
| `lockCollection` | `string` | `'_mmk_locks'` | Collection used for the concurrency lock |
| `lockTTLSeconds` | `number` | `60` | Seconds before a lock is considered stale |
| `strict` | `boolean` | `false` | Abort (vs. warn) on a checksum mismatch |
| `useTransaction` | `boolean` | `false` | Wrap every migration in a transaction globally |
| `fileExtensions` | `string[]` | `['.ts', '.js']` | Extensions scanned in the migrations dir |
| `createExtension` | `'ts' \| 'js'` | `'js'` | Default file type for `mmk create` |
| `sequential` | `boolean` | `false` | Use `0001-` numbering instead of timestamps |
| `templatePath` | `string` | — | Path to a custom migration template |
| `mongoose` | `Mongoose` | — | Mongoose instance, if your migrations use it |
| `hooks` | `MigrationHooks` | — | [Lifecycle hooks](/guide/hooks) |
| `logger` | `MmkLogger \| null` | built-in | Custom logger; `null` silences all output |

## Environment variables

Every core option has an `MMK_*` variable. These **override the config file**:

| Env var | Maps to |
|---|---|
| `MMK_URI` | `uri` |
| `MMK_DB` | `dbName` |
| `MMK_MIGRATIONS_DIR` | `migrationsDir` |
| `MMK_COLLECTION` | `migrationsCollection` |
| `MMK_LOCK_COLLECTION` | `lockCollection` |
| `MMK_LOCK_TTL` | `lockTTLSeconds` |
| `MMK_STRICT` | `strict` |
| `MMK_USE_TRANSACTION` | `useTransaction` |
| `MMK_SEQUENTIAL` | `sequential` |
| `MMK_CREATE_EXTENSION` | `createExtension` |

`.env` files are loaded automatically (via `dotenv`) before env vars are read.

```bash
# .env
MMK_URI=mongodb://localhost:27017
MMK_DB=my_app
```

## Global CLI flags

These flags work on every command and have the **highest** precedence:

| Flag | Overrides |
|---|---|
| `--uri <uri>` | `MMK_URI` / `uri` |
| `--db <name>` | `MMK_DB` / `dbName` |
| `--dir <path>` | `MMK_MIGRATIONS_DIR` / `migrationsDir` |
| `--config <path>` | Config file auto-discovery |

```bash
mmk up --uri "mongodb://localhost:27017" --db my_app --dir ./db/migrations
```
