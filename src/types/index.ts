import type { ClientSession, Db, MongoClient } from 'mongodb';
import type { Mongoose } from 'mongoose';

// ─── Migration File Contract ───────────────────────────────────────────────────

/** Context object passed into every migration's up() and down() function */
export interface MigrationContext {
  /** Native MongoDB Db instance */
  db: Db;
  /** Native MongoClient instance — use for sessions/transactions */
  client: MongoClient;
  /** Mongoose instance — only present if passed in config */
  mongoose?: Mongoose;
  /**
   * Active session, present only when this migration runs inside a transaction.
   * Pass it to your operations (e.g. `{ session }`) so they join the transaction.
   */
  session?: ClientSession;
}

/** Shape of an imported migration file module */
export interface MigrationModule {
  up: (ctx: MigrationContext) => Promise<void>;
  down: (ctx: MigrationContext) => Promise<void>;
  /** If true, wraps this migration in a MongoDB session + transaction */
  useTransaction?: boolean;
  /** Optional description shown in status table */
  description?: string;
}

// ─── Changelog ────────────────────────────────────────────────────────────────

export type MigrationStatus = 'applied' | 'reverted';

/**
 * Where a changelog record originated. `'migrate-mongo'` marks a record adopted
 * via `mmk import`; such records are forward-only and cannot be reverted by mmk.
 * Absent (or `'mmk'`) means a natively-applied, reversible migration.
 */
export type MigrationOrigin = 'mmk' | 'migrate-mongo';

/** A single record in the _mmk_migrations changelog collection */
export interface MigrationRecord {
  /** Migration filename e.g. 20240526143021-add-users-index.ts */
  name: string;
  /** Sequential batch number. All migrations run together share the same batch */
  batch: number;
  status: MigrationStatus;
  appliedAt: Date;
  revertedAt?: Date;
  /** Execution time in milliseconds */
  duration: number;
  /** SHA-256 hash of the file at time of execution */
  checksum: string;
  /** value of process.env.NODE_ENV at time of execution */
  environment: string;
  /** os.userInfo().username at time of execution */
  executedBy: string;
  /** Optional description from migration file */
  description?: string;
  /**
   * Origin of this record. Set to `'migrate-mongo'` for records adopted via
   * `mmk import` — these are not reversible by mmk. Absent for native records.
   */
  origin?: MigrationOrigin;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface MigrationHooks {
  /** Runs once before any migration in the batch starts */
  beforeAll?: (ctx: MigrationContext) => Promise<void>;
  /** Runs once after all migrations in the batch complete */
  afterAll?: (ctx: MigrationContext) => Promise<void>;
  /** Runs before each individual migration */
  beforeEach?: (name: string, ctx: MigrationContext) => Promise<void>;
  /** Runs after each individual migration completes successfully */
  afterEach?: (name: string, duration: number, ctx: MigrationContext) => Promise<void>;
  /** Runs when a migration throws — receives the error before it propagates */
  onError?: (name: string, error: Error, ctx: MigrationContext) => Promise<void>;
}

/** File type a created migration is written as */
export type MigrationExtension = 'ts' | 'js';

export interface MmkConfig {
  /** MongoDB connection URI */
  uri: string;
  /** Database name */
  dbName: string;
  /** Path to migrations directory. Default: './migrations' */
  migrationsDir: string;
  /** Collection name for migration records. Default: '_mmk_migrations' */
  migrationsCollection: string;
  /** Collection name for distributed lock. Default: '_mmk_locks' */
  lockCollection: string;
  /** How long (seconds) a lock is considered stale. Default: 60 */
  lockTTLSeconds: number;
  /**
   * If true, abort when a migration file's checksum differs from what was applied.
   * If false, warn but continue. Default: false
   */
  strict: boolean;
  /** Wrap all migrations in transactions globally. Can be overridden per file. Default: false */
  useTransaction: boolean;
  /** File extensions to scan. Default: ['.ts', '.js'] */
  fileExtensions: string[];
  /**
   * File type `mmk create` generates by default. Overridden per run by the
   * `--js` / `--ts` flags. Default: 'js'
   */
  createExtension: MigrationExtension;
  /** Use sequential numbering (0001-) instead of timestamps. Default: false */
  sequential: boolean;
  /** Path to a custom migration template file */
  templatePath?: string;
  /** Mongoose instance — required only if your migrations use Mongoose models */
  mongoose?: Mongoose;
  hooks?: MigrationHooks;
  /** Custom logger — set to null to silence all output (useful in tests) */
  logger?: MmkLogger | null;
}

/**
 * What a config file (`mmk.config.{ts,js}`) may export: either a config object
 * or a (sync or async) factory that returns one. The factory form is resolved
 * at load time, so you can fetch values — e.g. a connection `uri` from AWS
 * Secrets Manager or Google Secret Manager — without ever writing them to disk.
 *
 * The fetched value lives in memory for that command only; the config file
 * itself is never rewritten. JSON config files cannot use the factory form.
 */
export type MmkConfigInput =
  | Partial<MmkConfig>
  | (() => Partial<MmkConfig> | Promise<Partial<MmkConfig>>);

// ─── Logger ───────────────────────────────────────────────────────────────────

export interface MmkLogger {
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  dim: (msg: string) => void;
}

// ─── Progress Reporter ─────────────────────────────────────────────────────────

/**
 * Receives migration lifecycle callbacks so a presentation layer (e.g. an ora
 * spinner) can react. Deliberately separate from {@link MigrationHooks}: hooks
 * run user DB logic inside the migration; this only drives a UI indicator and
 * never touches the database. The CLI uses it to show a spinner while each
 * migration executes; core invokes it but never imports any spinner library.
 */
export interface ProgressReporter {
  /** A migration's up()/down() is about to execute */
  onStart: (name: string, direction: 'up' | 'down') => void;
  /** The in-flight migration finished (success or error) — stop any indicator */
  onStop: () => void;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export type RunResultStatus = 'applied' | 'reverted' | 'skipped' | 'error';

export interface RunResult {
  file: string;
  status: RunResultStatus;
  duration?: number;
  batch?: number;
  reason?: string;
  error?: string;
}

export interface StatusRow {
  file: string;
  status: 'applied' | 'pending';
  batch: number | null;
  appliedAt: Date | null;
  duration: number | null;
  /** null = never applied, true = match, false = mismatch */
  checksumOk: boolean | null;
  description?: string;
}

// ─── Import (migrate-mongo adoption) ────────────────────────────────────────────

/**
 * The shape of a record in a migrate-mongo `changelog` collection. Only
 * `fileName` and `appliedAt` are guaranteed; `fileHash` exists only when
 * migrate-mongo ran with `useFileHash`, and `migrationBlock` only on newer
 * versions.
 */
export interface MigrateMongoDoc {
  fileName: string;
  appliedAt: Date;
  fileHash?: string;
  migrationBlock?: number;
}

/** How an imported record's checksum was resolved */
export type ImportChecksumSource = 'reused' | 'recomputed' | 'missing';

/** One mapped row produced by `mmk import` */
export interface ImportRow {
  file: string;
  batch: number;
  appliedAt: Date;
  checksum: string;
  checksumSource: ImportChecksumSource;
}

/** Outcome of an `mmk import` run */
export interface ImportResult {
  /** Source collection that was read (e.g. `changelog`) */
  source: string;
  /** Target collection records were written to (e.g. `_mmk_migrations`) */
  target: string;
  /** Number of records written (0 when `dryRun` is true) */
  imported: number;
  /** Number of source docs skipped as invalid (missing `fileName`) */
  skipped: number;
  /** True when the run previewed only and wrote nothing */
  dryRun: boolean;
  /** The mapped rows, in apply order */
  rows: ImportRow[];
}

// ─── Error Codes ──────────────────────────────────────────────────────────────

export type MmkErrorCode =
  | 'LOCK_ALREADY_HELD'
  | 'LOCK_RELEASE_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'MIGRATION_FILE_NOT_FOUND'
  | 'MIGRATION_INVALID_EXPORT'
  | 'MIGRATION_EXECUTION_FAILED'
  | 'CONFIG_INVALID'
  | 'CONFIG_FILE_EXISTS'
  | 'CONNECTION_FAILED'
  | 'ALREADY_APPLIED'
  | 'NOT_APPLIED'
  | 'IMPORT_TARGET_NOT_EMPTY'
  | 'MIGRATION_IRREVERSIBLE';
