import type { MmkConfig } from 'mongo-migrate-kit';

/**
 * mongo-migrate-kit configuration.
 * Precedence (highest first): CLI flags > MMK_* env vars > this file > defaults.
 * Every field is optional; the values below are the built-in defaults.
 */
const config: Partial<MmkConfig> = {
  // ── Connection ─────────────────────────────────────────────

  /**
   * MongoDB connection string. Required.
   * Env: MMK_URI · Flag: --uri
   * To load it from a secret manager instead, run: mmk init --secret-provider
   */
  uri: 'mongodb://localhost:27017',

  /**
   * Database the migrations run against. Required.
   * Env: MMK_DB · Flag: --db
   */
  dbName: 'myapp',

  // ── Migration files ────────────────────────────────────────

  /**
   * Folder holding your migration files, relative to where you run mmk.
   * Default: './migrations' · Env: MMK_MIGRATIONS_DIR · Flag: --dir
   */
  migrationsDir: './migrations',

  /**
   * File extensions mmk treats as migrations when it scans migrationsDir.
   * .ts files need Node 22.18+ (or a TypeScript loader) when mmk runs them.
   * Default: ['.ts', '.js']
   */
  fileExtensions: ['.ts', '.js'],

  /**
   * File type `mmk create` writes: 'js' or 'ts'.
   * Default: 'js' · Env: MMK_CREATE_EXTENSION · Per run: mmk create <name> --js / --ts
   */
  createExtension: 'ts',

  /**
   * Name new migrations 0001-, 0002-, … instead of with a timestamp.
   * Keep timestamps if several repos share a database: sequential names clash.
   * Default: false · Env: MMK_SEQUENTIAL
   */
  sequential: false,

  /**
   * Your own template for `mmk create`, copied as-is into each new file.
   * Per run: mmk create <name> --template <path>
   */
  // templatePath: './migration.template.ts',

  /**
   * `mmk create` writes this into new migrations (`export const author`), and
   * `mmk up` records it — who wrote a migration, not who ran it.
   * Default: your git `user.name <user.email>`, then your OS username
   * Env: MMK_AUTHOR · Per run: mmk create <name> --author <name>
   */
  // author: 'Jane Doe <jane@example.com>',

  // ── Bookkeeping collections ────────────────────────────────

  /**
   * Collection that records which migrations have run (the history).
   * Change it only to give a group of repos its own history on a shared database.
   * Default: '_mmk_migrations' · Env: MMK_COLLECTION
   */
  migrationsCollection: '_mmk_migrations',

  /**
   * Collection holding the lock that stops two runs migrating at the same time.
   * Every repo on a database must use the same value, or they stop taking turns.
   * Default: '_mmk_locks' · Env: MMK_LOCK_COLLECTION
   */
  lockCollection: '_mmk_locks',

  /**
   * Scopes this repo's migration history when several repos share this database.
   * One value per repo, e.g. the repo name (lowercase letters, digits, . _ -).
   * Set it once and never change it — it decides which migrations count as applied.
   * Not needed when this repo has the database to itself.
   * Env: MMK_NAMESPACE
   */
  // namespace: 'marketplace',

  /**
   * Seconds after which a lock left behind by a crashed run counts as stale and
   * can be taken over. A running migration keeps renewing its lock, so this does
   * not limit how long a migration may take.
   * Default: 60 · Env: MMK_LOCK_TTL
   */
  lockTTLSeconds: 60,

  // ── Behavior ───────────────────────────────────────────────

  /**
   * What `mmk up <file>` does when that file is already applied and has changed
   * since it ran: false = warn and skip it, true = stop with an error.
   * (`mmk down` always refuses a changed file; `mmk status` shows it as MISMATCH.)
   * Default: false · Env: MMK_STRICT · Per run: mmk up --strict
   */
  strict: false,

  /**
   * Run every migration inside a transaction, so a failure rolls back its writes.
   * Needs a replica set or sharded cluster. Override per file with
   * `export const useTransaction = true` (or false).
   * Default: false · Env: MMK_USE_TRANSACTION
   */
  useTransaction: false,

  /**
   * Refuse `mmk up` while any migration about to run has no `author` export.
   * Checked before anything runs.
   * Default: false · Env: MMK_REQUIRE_AUTHOR
   */
  requireAuthor: false,

  // ── Lifecycle hooks (code only — not available in JSON config) ──

  /**
   * Functions mmk calls around migrations: once before and after the whole run,
   * and before, after, or on error for each migration. Each receives the same
   * context as your migrations ({ db, client, … }).
   */
  // hooks: {
  //   beforeAll: async (ctx) => {},
  //   afterAll: async (ctx) => {},
  //   beforeEach: async (name, ctx) => {},
  //   afterEach: async (name, duration, ctx) => {},
  //   onError: async (name, error, ctx) => {},
  // },
};

export default config;
