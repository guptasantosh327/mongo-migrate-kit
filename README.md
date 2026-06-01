# mongo-migrate-kit

> Production-grade MongoDB migration toolkit for Node.js

`mongo-migrate-kit` (CLI: `mmk`) is a strict-TypeScript migration runner for MongoDB with
first-class `.ts` **and** `.js` support, a MongoDB-native concurrency lock, SHA-256 tamper
detection, opt-in transactions, lifecycle hooks, dry-run previews, and a full audit trail that
is **never** deleted.

```bash
npm install mongo-migrate-kit
# peer deps you provide:
npm install mongodb            # required
npm install mongoose           # optional
```

## Why

| Gap in other tools | How `mongo-migrate-kit` solves it |
|---|---|
| Can't run a single file | `mmk up <file>` / `mmk down <file>` |
| `down` only rolls back the last one | `mmk down --batch 3` or `mmk down <file>` |
| No `redo` | `mmk redo` / `mmk redo <file>` |
| No dry-run | `mmk dry-run up` previews without touching the DB |
| Config file mandatory | Works entirely from env vars — zero files required |
| No concurrency lock | MongoDB-native lock in `_mmk_locks` |
| No tamper detection | SHA-256 checksum verified, surfaced in `status` |
| No lifecycle hooks | `beforeAll` / `afterAll` / `beforeEach` / `afterEach` / `onError` |
| No transactions | Opt-in per file: `export const useTransaction = true` |
| No rich audit trail | Stores duration, checksum, env, user, batch — never deletes |

## Quick start

```bash
# 1. Configure (env vars are enough — no config file needed)
export MMK_URI="mongodb://localhost:27017"
export MMK_DB="my_app"
export MMK_MIGRATIONS_DIR="./migrations"

# 2. Scaffold a migration
mmk create "add users email index"

# 3. Edit the generated file, then run it
mmk up

# 4. Inspect
mmk status
```

## Writing a migration

A migration exports async `up` and `down` functions. Three formats are supported:

```ts
// TypeScript (recommended)
import type { MigrationContext } from 'mongo-migrate-kit';

export const description = 'Add unique index on users.email';
export const useTransaction = true; // optional, per-file

export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('users').dropIndex('email_1');
}
```

```js
// JavaScript ESM
export async function up({ db }) { /* ... */ }
export async function down({ db }) { /* ... */ }
```

```js
// JavaScript CommonJS
module.exports = {
  async up({ db }) { /* ... */ },
  async down({ db }) { /* ... */ },
};
```

When a migration runs inside a transaction, pass the provided `session` to your operations:

```ts
export const useTransaction = true;
export async function up({ db, session }: MigrationContext): Promise<void> {
  await db.collection('a').insertOne({ x: 1 }, { session });
  await db.collection('b').insertOne({ y: 2 }, { session });
}
```

## CLI

```bash
mmk up [file]                       # Run all pending, or one file
mmk up [file] --no-lock             # Skip the concurrency lock (dev only)
mmk up [file] --strict              # Abort on checksum mismatch

mmk down [file]                     # Rollback the last batch, or one file
mmk down --batch <n>                # Rollback a specific batch

mmk redo [file]                     # down + up: last applied, or a file

mmk status                          # Full status table
mmk list --pending                  # Only pending
mmk list --applied                  # Only applied

mmk dry-run up [file]               # Preview an up
mmk dry-run down [file]             # Preview a down

mmk create <name>                   # Scaffold a new .ts migration
mmk create <name> --js              # Scaffold a .js migration
mmk create <name> --template <path> # Use a custom template
```

Global flags (any command): `--uri <uri>`, `--db <name>`, `--dir <path>`, `--config <path>`.

## Configuration

Resolution order (highest wins): **CLI flags → environment variables → config file → defaults**.

A config file is optional. If present, it is auto-discovered in the cwd in this order:
`mmk.config.ts`, `mmk.config.js`, `mmk.config.json`.

| Env var | Config key | Default |
|---|---|---|
| `MMK_URI` | `uri` | — (required) |
| `MMK_DB` | `dbName` | — (required) |
| `MMK_MIGRATIONS_DIR` | `migrationsDir` | `./migrations` |
| `MMK_COLLECTION` | `migrationsCollection` | `_mmk_migrations` |
| `MMK_LOCK_COLLECTION` | `lockCollection` | `_mmk_locks` |
| `MMK_LOCK_TTL` | `lockTTLSeconds` | `60` |
| `MMK_STRICT` | `strict` | `false` |
| `MMK_USE_TRANSACTION` | `useTransaction` | `false` |
| `MMK_SEQUENTIAL` | `sequential` | `false` |

```ts
// mmk.config.ts — supports hooks, a custom logger, and a Mongoose instance
import type { MmkConfig } from 'mongo-migrate-kit';

const config: Partial<MmkConfig> = {
  uri: process.env.MONGO_URL!,
  dbName: 'my_app',
  migrationsDir: './migrations',
  hooks: {
    beforeAll: async () => { /* ... */ },
    onError: async (name, error) => { /* alert ... */ },
  },
};

export default config;
```

## Programmatic API

```ts
import { MigratorKit } from 'mongo-migrate-kit';

const migrator = new MigratorKit({
  uri: 'mongodb://localhost:27017',
  dbName: 'my_app',
  migrationsDir: './migrations',
});

await migrator.connect();
const results = await migrator.up();      // RunResult[]
const rows = await migrator.status();     // StatusRow[]
await migrator.disconnect();
```

All errors extend `MmkError` and carry a typed `code` (e.g. `LOCK_ALREADY_HELD`,
`CHECKSUM_MISMATCH`, `NOT_APPLIED`).

## Concurrency lock

Runs acquire an atomic lock document in `_mmk_locks`. A lock older than `lockTTLSeconds`
is considered stale and reclaimable. The lock is always released in a `finally` block.
Use `--no-lock` only for local development.

## Audit trail

Every record in `_mmk_migrations` stores `batch`, `status`, `appliedAt`, `revertedAt`,
`duration`, `checksum`, `environment`, and `executedBy`. Reverting a migration sets its
status to `reverted` and stamps `revertedAt` — the record is never deleted.

## License

MIT
