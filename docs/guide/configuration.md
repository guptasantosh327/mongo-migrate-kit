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
| `mongoClientOptions` | `MongoClientOptions` | — | Extra options merged into the `MongoClient` (TLS, timeouts, auth, read/write prefs) |
| `hooks` | `MigrationHooks` | — | [Lifecycle hooks](/guide/hooks) |
| `logger` | `MmkLogger \| null` | built-in | Custom logger; `null` silences all output |

## Connection hardening

`mmk` builds the `MongoClient` with safe defaults so a wrong URI fails fast:

- `serverSelectionTimeoutMS` and `connectTimeoutMS` of `10000` — an unreachable host errors in seconds
  instead of hanging.
- `retryWrites: true`.
- **No client-wide write concern is imposed** — your migration operations keep whatever durability your
  URI/cluster specifies (so a deliberate `?w=1` for a fast bulk migration is respected).
- Durability is pinned only where correctness depends on it: the lock collection (`_mmk_locks`) and
  changelog (`_mmk_migrations`) are always written with `w: 'majority'` (the lock is also read with
  `readConcern: 'majority'`) at the **collection** level, so mutual exclusion and the audit trail
  survive a primary failover regardless of your URI.

`mongoClientOptions` is merged **last**, so it overrides the defaults above. Use it to enable TLS, tune
timeouts, or set auth and read preferences for your production cluster:

```js
// mmk.config.js
export default {
  uri: process.env.MMK_URI,
  dbName: 'my_app',
  mongoClientOptions: {
    tls: true,
    serverSelectionTimeoutMS: 5000,
    readPreference: 'primary',
  },
};
```

::: warning Credentials in errors are redacted
The native driver often embeds the connection string in its error messages. `mmk` scrubs any
`user:pass@` from connection errors before they reach logs, `--json` output, or an error's `context`,
so a failed connection never leaks your password.
:::

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

## When configuration is wrong

`mmk` validates the fully merged configuration **before it connects to MongoDB**, and reports
**every** problem at once rather than one per run. Each problem names the option, the value that was
actually read, the layer it came from, and every accepted way to set it:

```
✖ CONFIG_INVALID: Invalid mongo-migrate-kit configuration — 2 problems found:

  1. uri is required but was not set
     Set it with: the --uri <uri> CLI flag, the MMK_URI environment variable,
     "uri" in mmk.config.js (see `mmk init`), or the config object passed to MigratorKit

  2. lockTTLSeconds must be a whole number, e.g. 60
     Received: "abc"
     Read from: the MMK_LOCK_TTL environment variable
     Set it with: the MMK_LOCK_TTL environment variable, "lockTTLSeconds" in mmk.config.js, …
```

### Nothing is silently ignored

The mistakes that used to fail quietly are all errors now:

| Mistake | What happens |
|---|---|
| `uri` is `localhost:27017` | Rejected — must start with `mongodb://` or `mongodb+srv://` |
| `dbName` contains `/ \ . " $ * < > : \| ?` or a space | Rejected before the driver sees it |
| `MMK_STRICT=maybe`, `MMK_LOCK_TTL=abc`, `MMK_CREATE_EXTENSION=py` | Rejected naming the variable, the value, and the accepted format |
| `migrationDir:` in a config file | Rejected — `rename it to "migrationsDir"` |
| `MMK_MIGRATION_DIR` in the environment | Warned — `Did you mean MMK_MIGRATIONS_DIR?` |
| `fileExtensions: ['ts']` | Rejected — extensions must start with a dot |
| `strict: 'true'` | Rejected — must be a real boolean |
| `hooks: { beforeALL }` | Rejected — `Did you mean "beforeAll"?` |
| A `logger` missing methods | Rejected, listing exactly which ones |
| `migrationsDir` points nowhere | Warned with the resolved path |

An **empty** environment variable (`MMK_STRICT=`) counts as unset, so you can comment a value out in
`.env` without deleting the line.

### Reading the problems as data

Every DB command accepts `--json`, which puts the same information on stdout:

```jsonc
{
  "error": {
    "code": "CONFIG_INVALID",
    "message": "Invalid mongo-migrate-kit configuration — 1 problem found: …",
    "details": {
      "issues": [
        { "key": "uri", "problem": "is required but was not set", "howToSet": "…" }
      ]
    }
  }
}
```

Programmatically the same array is on `error.context.issues`, typed as the exported `ConfigIssue`:

```ts
import { runMigrations, ConfigInvalidError, type ConfigIssue } from 'mongo-migrate-kit';

try {
  await runMigrations({ uri: process.env.MONGO_URL, dbName: 'my_app' });
} catch (error) {
  if (error instanceof ConfigInvalidError) {
    for (const issue of (error.context?.issues ?? []) as ConfigIssue[]) {
      console.error(issue.key, issue.problem, issue.source, issue.howToSet);
    }
  }
  throw error;
}
```
