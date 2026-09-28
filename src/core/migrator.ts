import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Db, MongoClient, type MongoClientOptions } from 'mongodb';
import {
  ChecksumMismatchError,
  ConnectionFailedError,
  ImportTargetNotEmptyError,
  InvalidArgumentError,
  IrreversibleMigrationError,
  MigrationFileNotFoundError,
  MigrationInvalidNameError,
  NotAppliedError,
  TransactionsUnsupportedError,
} from '../errors/index.js';
import type {
  ImportChecksumSource,
  ImportResult,
  ImportRow,
  LockInfo,
  MigrateMongoDoc,
  MigrationRecord,
  MmkConfig,
  MmkLogger,
  ProgressReporter,
  RunResult,
  StatusRow,
} from '../types/index.js';
import { computeChecksum } from '../utils/checksum.js';
import { didYouMean, explain, listOf, quote } from '../utils/explain.js';
import { loadMigrationFile } from '../utils/loader.js';
import { resolveLogger } from '../utils/logger.js';
import { redactMongoUri } from '../utils/redact.js';
import {
  type ConfigFormat,
  type ConfigValues,
  createConfigFile,
  createMigrationFile,
} from '../utils/template.js';
import { Changelog } from './changelog.js';
import { loadConfig } from './config.js';
import { buildContext } from './context.js';
import { isMigrateMongoDoc, mapMigrateMongoDocs } from './import.js';
import { type LockDocument, MigrationLock, runWithLock } from './lock.js';
import { runMigration } from './runner.js';

/** Default source collection name used by migrate-mongo */
const MIGRATE_MONGO_COLLECTION = 'changelog';

/** Options for {@link MigratorKit.up} */
export interface UpOptions {
  /** Skip lock acquisition (dev only) */
  noLock?: boolean;
  /**
   * Re-run a migration even if it is already applied. Only meaningful together
   * with a specific filename — a standalone `up` only ever targets pending
   * files, so `force` has no applied target to re-run.
   */
  force?: boolean;
  /**
   * Apply each migration in this run as its own batch (sequential, one per file)
   * instead of grouping the whole run into a single shared batch. This lets a
   * later `down` peel migrations off one at a time. Mirrors Laravel's
   * `migrate --step`.
   */
  step?: boolean;
}

/** Options for {@link MigratorKit.down} */
export interface DownOptions {
  /** Skip lock acquisition (dev only) */
  noLock?: boolean;
  /** Revert a specific batch number instead of the last batch */
  batch?: number;
  /**
   * Revert the last N applied migrations (counted as individual files, newest
   * first), regardless of how they were grouped into batches. Mirrors Laravel's
   * `migrate:rollback --step=N`. Mutually exclusive with `batch` and a filename.
   */
  steps?: number;
  /**
   * Roll back even when a target file's on-disk checksum no longer matches the
   * one recorded at apply time. Without it, a drifted file aborts the rollback
   * (running edited rollback code against production is unsafe). The CLI prompts
   * for confirmation before setting this.
   */
  force?: boolean;
}

/** Options for {@link MigratorKit.create} */
export interface CreateOptions {
  /** Path to a custom template file */
  template?: string;
  /** Generate a `.js` file instead of `.ts` */
  js?: boolean;
}

/** Options for {@link MigratorKit.init} */
export interface InitOptions {
  /** Config file format. Default: 'js' */
  format?: ConfigFormat;
  /** Overwrite an existing config file */
  force?: boolean;
  /**
   * Generate a runtime secret-loading config (an async factory that fetches the
   * connection from a secret manager) instead of a static object. Only valid
   * for `js`/`ts` formats.
   */
  secretProvider?: boolean;
}

/** Options for {@link MigratorKit.import} */
export interface ImportOptions {
  /** Source collection to read. Default: `changelog` (migrate-mongo's default) */
  from?: string;
  /** Target collection to write. Default: the config's `migrationsCollection` */
  to?: string;
  /** Preview the mapping without writing anything */
  dryRun?: boolean;
  /** Reuse the source `fileHash` verbatim instead of recomputing from disk */
  trustHash?: boolean;
  /** Proceed even when the target changelog already has records */
  force?: boolean;
  /** Skip lock acquisition (dev only) */
  noLock?: boolean;
}

/**
 * The main orchestration class. Every CLI command delegates here. Holds a
 * partial config that is resolved (merged with env/file/defaults) on first use.
 */
/** Additional construction options for {@link MigratorKit} */
export interface MigratorKitOptions {
  /** Explicit config file path — overrides auto-discovery */
  configPath?: string;
  /**
   * Optional lifecycle reporter, invoked around each migration's execution so a
   * UI (the CLI's ora spinner) can show progress. Core never imports a spinner
   * library — it only calls these callbacks.
   */
  progress?: ProgressReporter;
}

export class MigratorKit {
  private readonly partialConfig: Partial<MmkConfig>;
  private readonly configPath: string | undefined;
  private readonly progress: ProgressReporter | undefined;
  private config: MmkConfig | undefined;
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private changelog: Changelog | undefined;
  /**
   * Whether the connected deployment supports multi-document transactions
   * (replica set / sharded cluster). Detected once on connect; used to fail a
   * transactional migration fast on a standalone instead of at commit time.
   */
  private supportsTransactions = false;

  constructor(config: Partial<MmkConfig> = {}, options: MigratorKitOptions = {}) {
    this.partialConfig = config;
    this.configPath = options.configPath;
    this.progress = options.progress;
  }

  /** Resolve and cache the full configuration */
  private async ensureConfig(requireDb = true): Promise<MmkConfig> {
    if (!this.config) {
      this.config = await loadConfig({
        flags: this.partialConfig,
        requireDb,
        ...(this.configPath ? { configPath: this.configPath } : {}),
      });
    }
    return this.config;
  }

  private get logger(): MmkLogger {
    return resolveLogger(this.config?.logger);
  }

  /** Connect to MongoDB and ensure changelog indexes exist */
  async connect(): Promise<void> {
    const config = await this.ensureConfig();
    if (this.client && this.db) {
      return;
    }
    try {
      // Safe defaults so a wrong URI / unreachable host fails fast instead of
      // hanging. We deliberately do NOT set a client-wide write concern: that
      // would override the user's URI and change the durability/throughput of
      // their own migration writes. Durability where it matters — the lock and
      // changelog collections — is pinned to `w:'majority'` at the collection
      // level instead (see MigrationLock.coll() / Changelog.coll()). The user's
      // `mongoClientOptions` override these defaults.
      const clientOptions: MongoClientOptions = {
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
        retryWrites: true,
        ...(config.mongoClientOptions ?? {}),
      };
      this.client = new MongoClient(config.uri, clientOptions);
      await this.client.connect();
      this.db = this.client.db(config.dbName);
      this.supportsTransactions = await this.detectTransactionSupport(this.client);
      this.changelog = new Changelog(config.migrationsCollection);
      await this.changelog.ensureIndexes(this.db);
    } catch (error) {
      // Driver errors frequently embed the connection string verbatim — redact
      // any credentials before they reach a log, JSON output, or error context.
      const raw = error instanceof Error ? error.message : String(error);
      const cause = redactMongoUri(raw);
      // The redacted driver message is the only clue to WHY the connection
      // failed (bad host, auth, TLS, timeout), so it belongs in the message —
      // not only in the context, where the terminal never shows it.
      throw new ConnectionFailedError(
        explain(`Failed to connect to MongoDB at ${redactMongoUri(config.uri)}`, [
          `Reason: ${cause}`,
          `Database: ${quote(config.dbName)}`,
          'Check the host/port is reachable, the credentials are right, and any TLS or IP allow-list requirement is met',
          'Set the connection with --uri, the MMK_URI environment variable, or "uri" in your config file',
        ]),
        { cause, uri: redactMongoUri(config.uri), dbName: config.dbName },
      );
    }
  }

  /**
   * Detect whether the deployment can run multi-document transactions — true for
   * a replica set (`setName` present) or a sharded cluster (mongos, `msg ===
   * 'isdbgrid'`), false for a standalone. Best-effort: if the probe itself
   * fails we assume support (fail open) and let a real commit surface the error,
   * rather than block a working setup on a flaky admin command.
   */
  private async detectTransactionSupport(client: MongoClient): Promise<boolean> {
    try {
      const hello = (await client.db('admin').command({ hello: 1 })) as {
        setName?: string;
        msg?: string;
      };
      return hello.setName !== undefined || hello.msg === 'isdbgrid';
    } catch {
      return true;
    }
  }

  /**
   * Guard a transactional migration before it runs: on a standalone deployment
   * transactions are unsupported and would only fail at commit — after the body
   * already executed. Fail fast with an actionable error instead.
   */
  private assertTransactionSupported(name: string): void {
    if (!this.supportsTransactions) {
      throw new TransactionsUnsupportedError(
        `Migration "${name}" requests a transaction, but this MongoDB deployment is a standalone server, which does not support transactions. Use a replica set (even single-node) or a sharded cluster, or disable useTransaction for this migration.`,
        { name },
      );
    }
  }

  /** Disconnect from MongoDB */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.db = undefined;
    }
  }

  /** Map an internal lock document to the public {@link LockInfo} shape */
  private toLockInfo(doc: LockDocument | null): LockInfo | null {
    if (!doc) {
      return null;
    }
    return { lockedAt: doc.lockedAt, pid: doc.pid, host: doc.host, executedBy: doc.executedBy };
  }

  /** Build a lock bound to the configured collection (assumes connected) */
  private buildLock(): MigrationLock {
    const config = this.config as MmkConfig;
    return new MigrationLock(this.requireDb(), config.lockCollection, config.lockTTLSeconds);
  }

  /**
   * Inspect the current migration lock without modifying it. Returns the holder,
   * or null when no lock is held.
   */
  async lockInfo(): Promise<LockInfo | null> {
    await this.ensureConfig();
    await this.connect();
    return this.toLockInfo(await this.buildLock().inspect());
  }

  /**
   * Force-release the migration lock regardless of who holds it — for clearing a
   * lock left behind by a crashed run (`mmk unlock`). Returns the holder that was
   * removed, or null if no lock was held.
   */
  async forceUnlock(): Promise<LockInfo | null> {
    await this.ensureConfig();
    await this.connect();
    return this.toLockInfo(await this.buildLock().forceRelease());
  }

  /** Internal accessors that assume a successful connect() */
  private requireDb(): Db {
    if (!this.db) {
      throw new ConnectionFailedError('Not connected — call connect() first');
    }
    return this.db;
  }

  private requireChangelog(): Changelog {
    if (!this.changelog) {
      throw new ConnectionFailedError('Not connected — call connect() first');
    }
    return this.changelog;
  }

  private migrationsPath(): string {
    return path.resolve(this.config?.migrationsDir ?? './migrations');
  }

  /**
   * Resolve a migration name to an absolute path inside the migrations dir.
   *
   * The name must be a bare filename: a name containing a path separator, a
   * NUL byte, or `.`/`..` is rejected with {@link MigrationInvalidNameError}.
   * This prevents path traversal — e.g. `mmk up ../../evil.js` would otherwise
   * resolve (and `loadMigrationFile` execute) a file outside the migrations
   * directory. A final containment check guards against any residual escape.
   */
  private filepath(name: string): string {
    const dir = this.migrationsPath();
    if (
      name.length === 0 ||
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('\0')
    ) {
      throw new MigrationInvalidNameError(
        explain('Invalid migration name — it must be a bare filename', [
          `Received: ${quote(name)}`,
          'A name may not contain "/", "\\", a NUL byte, or be "." / ".." — this blocks reading code from outside the migrations directory',
          'Pass just the filename as `mmk status` lists it, e.g. mmk up 20240526143021-add-users-index.js',
        ]),
        { name },
      );
    }
    const resolved = path.join(dir, name);
    const relative = path.relative(dir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new MigrationInvalidNameError(
        explain('Migration name escapes the migrations directory', [
          `Received: ${quote(name)}`,
          `Migrations directory: ${dir}`,
          'Pass just the filename as `mmk status` lists it',
        ]),
        {
          name,
        },
      );
    }
    return resolved;
  }

  /** List migration files on disk, sorted ascending */
  private listMigrationFiles(): string[] {
    const dir = this.migrationsPath();
    if (!existsSync(dir)) {
      // Silently returning [] here reads as "nothing to migrate", which hides a
      // mistyped migrationsDir. Say which path was looked at and where it came from.
      const hint =
        'set it with --dir <path>, the MMK_MIGRATIONS_DIR environment variable, ' +
        'or "migrationsDir" in your config file';
      this.logger.warn(`⚠ Migrations directory not found: ${dir} — ${hint}`);
      return [];
    }
    const extensions = this.config?.fileExtensions ?? ['.ts', '.js'];
    return readdirSync(dir)
      .filter((file) => extensions.some((ext) => file.endsWith(ext)))
      .sort();
  }

  /** Compute the next batch number (monotonic across the full history) */
  private async nextBatch(): Promise<number> {
    const records = await this.requireChangelog().getAll(this.requireDb());
    const maxBatch = records.reduce((max, record) => Math.max(max, record.batch), 0);
    return maxBatch + 1;
  }

  /**
   * Validate the `--steps` option for `down`/`dry-run down`: a positive integer,
   * mutually exclusive with a filename and `--batch`. No-op when steps is unset.
   */
  private assertStepsValid(steps: number | undefined, filename?: string, batch?: number): void {
    if (steps === undefined) {
      return;
    }
    if (filename) {
      throw new InvalidArgumentError(
        explain('Cannot combine a migration filename with --steps — they select different things', [
          `Received: file ${quote(filename)} and --steps ${steps}`,
          `To roll back just that file:      mmk down ${filename}`,
          `To roll back the last ${steps} migration(s): mmk down --steps ${steps}`,
        ]),
        { filename, steps },
      );
    }
    if (batch !== undefined) {
      throw new InvalidArgumentError(
        explain('Cannot combine --batch with --steps — they select different things', [
          `Received: --batch ${batch} and --steps ${steps}`,
          `--batch ${batch} rolls back everything applied in batch ${batch}`,
          `--steps ${steps} rolls back the last ${steps} migration(s), ignoring batches`,
        ]),
        { batch, steps },
      );
    }
    if (!Number.isInteger(steps) || steps < 1) {
      throw new InvalidArgumentError(
        explain('--steps must be a positive whole number', [
          `Received: ${quote(steps)}`,
          'Try: mmk down --steps 3   (roll back the 3 most recently applied migrations)',
        ]),
        { steps },
      );
    }
  }

  /**
   * Validate the `--batch` option for `down`: a positive integer, and not
   * combined with a filename (which would select a different set silently).
   */
  private assertBatchValid(batch: number | undefined, filename?: string): void {
    if (batch === undefined) {
      return;
    }
    if (filename) {
      throw new InvalidArgumentError(
        explain('Cannot combine a migration filename with --batch — they select different things', [
          `Received: file ${quote(filename)} and --batch ${batch}`,
          `To roll back just that file:        mmk down ${filename}`,
          `To roll back everything in a batch: mmk down --batch ${batch}`,
        ]),
        { filename, batch },
      );
    }
    if (!Number.isInteger(batch) || batch < 1) {
      throw new InvalidArgumentError(
        explain('--batch must be a positive whole number', [
          `Received: ${quote(batch)}`,
          'Try: mmk down --batch 3   (roll back every migration applied in batch 3)',
          'Run `mmk status` to see the batch number of each applied migration',
        ]),
        { batch },
      );
    }
  }

  /**
   * Resolve a migration filename to an existing file, or explain what is wrong.
   *
   * A name that does not exist is the most common typo, so the error names the
   * directory that was searched, suggests the closest real filename, and lists
   * what is actually there.
   */
  private requireMigrationFile(filename: string): string {
    const filepath = this.filepath(filename);
    if (existsSync(filepath)) {
      return filepath;
    }
    const available = this.listMigrationFiles();
    throw new MigrationFileNotFoundError(
      explain(`Migration file not found: ${quote(filename)}`, [
        `Looked in: ${this.migrationsPath()}`,
        didYouMean(filename, available),
        available.length > 0
          ? `Migrations in that directory: ${listOf(available)}`
          : 'That directory has no migration files yet — create one with `mmk create <name>`',
        'Run `mmk status` to see every migration mmk knows about',
      ]),
      { filename, migrationsDir: this.migrationsPath(), available },
    );
  }

  /**
   * Select the last N applied migrations, newest first (by `appliedAt`, tie-broken
   * by name desc), ignoring batch grouping. Shared by `down --steps` and its dry-run.
   */
  private selectLastApplied(records: MigrationRecord[], steps: number): MigrationRecord[] {
    return records
      .filter((record) => record.status === 'applied')
      .sort((a, b) => {
        const byTime = b.appliedAt.getTime() - a.appliedAt.getTime();
        return byTime !== 0 ? byTime : b.name.localeCompare(a.name);
      })
      .slice(0, steps);
  }

  /** Run all pending migrations, or a specific named file */
  async up(filename?: string, options: UpOptions = {}): Promise<RunResult[]> {
    const config = await this.ensureConfig();
    await this.connect();
    const lock = new MigrationLock(this.requireDb(), config.lockCollection, config.lockTTLSeconds);
    return runWithLock(
      lock,
      { logger: this.logger, ...(options.noLock ? { noLock: true } : {}) },
      () => this.runUp(filename, options),
    );
  }

  private async runUp(filename?: string, options: UpOptions = {}): Promise<RunResult[]> {
    const force = options.force ?? false;
    const config = this.config as MmkConfig;
    const db = this.requireDb();
    const changelog = this.requireChangelog();
    const logger = this.logger;

    const appliedNames = new Set(await changelog.getAppliedNames(db));

    let targets: string[];
    if (filename) {
      this.requireMigrationFile(filename);
      targets = [filename];
    } else {
      targets = this.listMigrationFiles().filter((file) => !appliedNames.has(file));
    }

    if (targets.length === 0) {
      logger.info('Nothing to migrate');
      return [];
    }

    const context = buildContext(this.client as MongoClient, db, config.mongoose);
    const results: RunResult[] = [];
    // Without --step every file in this run shares one batch. With --step each
    // applied file gets its own sequential batch (base, base+1, …) so a later
    // `down` can revert them individually. Only successful applies advance the
    // counter, so --step never leaves gaps.
    const baseBatch = await this.nextBatch();
    let appliedCount = 0;

    await config.hooks?.beforeAll?.(context);

    for (const name of targets) {
      await config.hooks?.beforeEach?.(name, context);
      const filepath = this.filepath(name);
      const checksum = computeChecksum(filepath);

      if (appliedNames.has(name)) {
        if (!force) {
          const existing = await changelog.getByName(db, name);
          const mismatch = existing !== null && existing.checksum !== checksum;
          if (mismatch && config.strict) {
            throw new ChecksumMismatchError(
              explain(`${quote(name)} has changed since it was applied`, [
                `Applied checksum: ${(existing?.checksum ?? '').slice(0, 12)}…`,
                `On-disk checksum: ${checksum.slice(0, 12)}…`,
                'strict mode refuses to continue when an applied migration is edited',
                'Revert the file to the version that was applied, or write a new migration for the change',
                `To re-run this file against the database on purpose: mmk up ${name} --force`,
              ]),
              { name, expected: existing?.checksum, actual: checksum },
            );
          }
          if (mismatch) {
            logger.warn(`⚠ Warning  Checksum mismatch: ${name}`);
          }
          logger.dim(`⏭ Skipped  ${name}`);
          results.push({ file: name, status: 'skipped', reason: 'Already applied' });
          continue;
        }
        // force: fall through and re-run, ignoring applied state and checksum
        logger.warn(`⚠ Forcing   re-run of already-applied ${name}`);
      }

      const migration = await loadMigrationFile(filepath);
      const useTransaction = migration.useTransaction ?? config.useTransaction;
      if (useTransaction) {
        this.assertTransactionSupported(name);
      }

      // Batch is fixed before the run so the changelog record can be persisted
      // inside the migration's transaction (see the persist callback below).
      const batch = options.step ? baseBatch + appliedCount : baseBatch;

      this.progress?.onStart(name, 'up');
      try {
        const { duration } = await runMigration({
          name,
          migration,
          direction: 'up',
          context,
          useTransaction,
          ...(config.hooks ? { hooks: config.hooks } : {}),
          // Write the changelog record within the same transaction as the
          // migration's own writes, so applying and recording are atomic.
          persist: async (runDuration, session) => {
            const record: MigrationRecord = {
              name,
              batch,
              status: 'applied',
              appliedAt: new Date(),
              duration: runDuration,
              checksum,
              environment: process.env.NODE_ENV ?? 'development',
              executedBy: os.userInfo().username,
              ...(migration.description ? { description: migration.description } : {}),
            };
            await changelog.markApplied(db, record, session);
          },
        });
        this.progress?.onStop();
        appliedCount += 1;

        logger.success(`✔ Applied  ${name}   [${duration}ms]`);
        results.push({ file: name, status: 'applied', duration, batch });
        await config.hooks?.afterEach?.(name, duration, context);
      } catch (error) {
        this.progress?.onStop();
        logger.error(`✖ Error    ${name}`);
        results.push({
          file: name,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    await config.hooks?.afterAll?.(context);
    return results;
  }

  /** Rollback the last batch, a specific batch, a specific file, or the last N steps */
  async down(filename?: string, options: DownOptions = {}): Promise<RunResult[]> {
    this.assertStepsValid(options.steps, filename, options.batch);
    this.assertBatchValid(options.batch, filename);
    const config = await this.ensureConfig();
    // Validate the name before the changelog lookup, so a traversing name is
    // reported as an invalid name rather than as "not applied".
    if (filename) {
      this.filepath(filename);
    }
    await this.connect();
    const lock = new MigrationLock(this.requireDb(), config.lockCollection, config.lockTTLSeconds);
    return runWithLock(
      lock,
      { logger: this.logger, ...(options.noLock ? { noLock: true } : {}) },
      () => this.runDown(filename, options),
    );
  }

  private async runDown(filename?: string, options: DownOptions = {}): Promise<RunResult[]> {
    const config = this.config as MmkConfig;
    const db = this.requireDb();
    const changelog = this.requireChangelog();
    const logger = this.logger;

    let toRevert: MigrationRecord[];
    // When true, `toRevert` is already in revert order (newest applied first) and
    // must not be re-sorted by filename below.
    let preserveOrder = false;
    if (filename) {
      const record = await changelog.getByName(db, filename);
      if (!record || record.status !== 'applied') {
        const applied = (await changelog.getAll(db))
          .filter((candidate) => candidate.status === 'applied')
          .map((candidate) => candidate.name);
        throw new NotAppliedError(
          explain(`Cannot roll back ${quote(filename)} — it is not currently applied`, [
            record
              ? `Its last recorded status is "${record.status}"`
              : 'It has no changelog record',
            didYouMean(filename, applied),
            applied.length > 0
              ? `Currently applied: ${listOf(applied)}`
              : 'No migrations are currently applied',
            'Run `mmk status` to see what is applied',
          ]),
          { filename, applied },
        );
      }
      toRevert = [record];
    } else if (options.steps !== undefined) {
      // Revert the last N applied migrations, newest first, ignoring batches.
      toRevert = this.selectLastApplied(await changelog.getAll(db), options.steps);
      preserveOrder = true;
    } else {
      const batch = options.batch ?? (await changelog.getLastBatch(db));
      if (batch === null) {
        logger.info('Nothing to rollback');
        return [];
      }
      const records = await changelog.getByBatch(db, batch);
      toRevert = records.filter((record) => record.status === 'applied');
      // An explicit --batch that matches nothing is a mistake, not a no-op:
      // silently reporting "Nothing to rollback" reads as success.
      if (options.batch !== undefined && toRevert.length === 0) {
        const batches = [
          ...new Set(
            (await changelog.getAll(db))
              .filter((record) => record.status === 'applied')
              .map((record) => record.batch),
          ),
        ].sort((a, b) => a - b);
        throw new InvalidArgumentError(
          explain(`No applied migrations found in batch ${batch}`, [
            batches.length > 0
              ? `Batches that still have applied migrations: ${batches.join(', ')}`
              : 'No migrations are currently applied',
            'Run `mmk status` to see the batch number of each migration',
          ]),
          { batch, batches },
        );
      }
    }

    if (toRevert.length === 0) {
      logger.info('Nothing to rollback');
      return [];
    }

    // Preflight, before running or writing anything: migrate-mongo-imported
    // records are forward-only. Refuse the whole rollback up front with a clear
    // reason so the changelog and collection are never left half-reverted.
    this.assertReversible(toRevert);

    const names = preserveOrder
      ? toRevert.map((record) => record.name)
      : toRevert
          .map((record) => record.name)
          .sort()
          .reverse();

    // Preflight, before running anything: refuse to roll back a file whose
    // on-disk checksum drifted from what was applied — executing edited rollback
    // code against production is unsafe. `force` (CLI prompts first) bypasses it.
    if (!(options.force ?? false)) {
      this.assertDownChecksums(names, new Map(toRevert.map((record) => [record.name, record])));
    }

    const context = buildContext(this.client as MongoClient, db, config.mongoose);
    const results: RunResult[] = [];

    await config.hooks?.beforeAll?.(context);

    for (const name of names) {
      await config.hooks?.beforeEach?.(name, context);
      const migration = await loadMigrationFile(this.filepath(name));
      const useTransaction = migration.useTransaction ?? config.useTransaction;
      if (useTransaction) {
        this.assertTransactionSupported(name);
      }

      this.progress?.onStart(name, 'down');
      try {
        const { duration } = await runMigration({
          name,
          migration,
          direction: 'down',
          context,
          useTransaction,
          ...(config.hooks ? { hooks: config.hooks } : {}),
          // Record the revert within the same transaction as the down() writes.
          persist: async (_duration, session) => {
            await changelog.markReverted(db, name, session);
          },
        });
        this.progress?.onStop();
        logger.success(`↩ Reverted ${name}   [${duration}ms]`);
        results.push({ file: name, status: 'reverted', duration });
        await config.hooks?.afterEach?.(name, duration, context);
      } catch (error) {
        this.progress?.onStop();
        logger.error(`✖ Error    ${name}`);
        results.push({
          file: name,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    await config.hooks?.afterAll?.(context);
    return results;
  }

  /**
   * Refuse rollback of any migrate-mongo-imported record. These are forward-only:
   * their files use migrate-mongo's positional `up(db, client)`/`down(db, client)`
   * signature, which mmk cannot invoke safely, so reverting them could corrupt the
   * collection. Throws before any migration runs or the changelog is touched.
   */
  private assertReversible(records: MigrationRecord[]): void {
    const blocked = records.filter((record) => record.origin === 'migrate-mongo');
    if (blocked.length === 0) {
      return;
    }
    const names = blocked.map((record) => record.name);
    this.logger.error(
      `✖ Cannot roll back ${names.length} migrate-mongo-imported migration(s): ${names.join(', ')}`,
    );
    this.logger.dim(
      'These were adopted via `mmk import` (forward-only). Their files use the positional ' +
        'migrate-mongo signature, which mmk cannot run. Revert them manually or re-author ' +
        'them in mmk format.',
    );
    throw new IrreversibleMigrationError(
      `Cannot roll back migrate-mongo-imported migration(s): ${names.join(', ')}`,
      { names },
    );
  }

  /**
   * Refuse a rollback whose on-disk migration file no longer matches the
   * checksum recorded when it was applied. Reverting drifted code against
   * production is the riskiest place to run an unverified `down()`, so — unlike
   * `up`, which can safely skip — `down` aborts the whole batch on any mismatch
   * (regardless of `strict`); `--force` is the explicit, confirmed override.
   * Files missing on disk are left to the loader, which throws a clearer error.
   */
  private assertDownChecksums(names: string[], recordByName: Map<string, MigrationRecord>): void {
    const mismatched: string[] = [];
    for (const name of names) {
      const record = recordByName.get(name);
      if (!record) {
        continue;
      }
      const filepath = this.filepath(name);
      if (!existsSync(filepath)) {
        continue;
      }
      if (computeChecksum(filepath) !== record.checksum) {
        mismatched.push(name);
      }
    }
    if (mismatched.length === 0) {
      return;
    }
    throw new ChecksumMismatchError(
      explain(
        `Refusing to roll back ${mismatched.length === 1 ? 'a file' : 'files'} that changed since being applied: ${listOf(mismatched)}`,
        [
          'Rolling back would run the CURRENT down(), which may not undo what the applied up() did',
          'Restore the file to the version that was applied, then roll back',
          `Or roll back with the current code anyway: mmk down ${mismatched[0] ?? '<file>'} --force`,
        ],
      ),
      { names: mismatched },
    );
  }

  /**
   * Rollback then re-apply: the last applied migration, or a specific file.
   *
   * The whole down→up runs under a **single** lock acquisition, so no other
   * process can interleave between the revert and the re-apply (the previous
   * implementation locked twice, leaving a window — and, if `up` failed, the
   * migration stranded in a reverted state). The down half is forced past the
   * checksum guard, since redoing an edited migration is the common reason to
   * run it.
   */
  async redo(filename?: string): Promise<RunResult[]> {
    const config = await this.ensureConfig();
    await this.connect();
    const lock = new MigrationLock(this.requireDb(), config.lockCollection, config.lockTTLSeconds);
    return runWithLock(lock, { logger: this.logger }, async () => {
      const changelog = this.requireChangelog();

      let target = filename;
      if (!target) {
        const records = await changelog.getAll(this.requireDb());
        const applied = records.filter((record) => record.status === 'applied');
        if (applied.length === 0) {
          this.logger.info('Nothing to redo');
          return [];
        }
        applied.sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime());
        target = applied[applied.length - 1]?.name;
      }

      if (!target) {
        return [];
      }

      const downResults = await this.runDown(target, { force: true });
      const upResults = await this.runUp(target);
      return [...downResults, ...upResults];
    });
  }

  /** Preview what would run — never writes to the database */
  async dryRun(
    direction: 'up' | 'down',
    filename?: string,
    options: { steps?: number } = {},
  ): Promise<StatusRow[]> {
    this.assertStepsValid(options.steps, filename);
    await this.ensureConfig();
    await this.connect();
    const db = this.requireDb();
    const changelog = this.requireChangelog();
    const logger = this.logger;

    const records = await changelog.getAll(db);
    const recordByName = new Map(records.map((record) => [record.name, record]));

    let names: string[];
    if (direction === 'up') {
      const applied = new Set(
        records.filter((record) => record.status === 'applied').map((record) => record.name),
      );
      if (filename) {
        // Mirror `up`: a typo'd filename must not render a plausible-looking row.
        this.requireMigrationFile(filename);
        names = [filename];
      } else {
        names = this.listMigrationFiles().filter((file) => !applied.has(file));
      }
    } else if (options.steps !== undefined) {
      // Mirror `down --steps`: the last N applied migrations, newest first.
      names = this.selectLastApplied(records, options.steps).map((record) => record.name);
    } else {
      const lastBatch = await changelog.getLastBatch(db);
      if (filename) {
        names = [filename];
      } else if (lastBatch === null) {
        names = [];
      } else {
        names = (await changelog.getByBatch(db, lastBatch))
          .filter((record) => record.status === 'applied')
          .map((record) => record.name);
      }
    }

    const rows = names.map((name) => this.buildStatusRow(name, recordByName.get(name)));
    logger.info(`◎ Dry-run  Would ${direction === 'up' ? 'apply' : 'revert'}: ${rows.length}`);
    return rows;
  }

  /** Full migration status for all known files and records */
  async status(): Promise<StatusRow[]> {
    await this.ensureConfig();
    await this.connect();
    const records = await this.requireChangelog().getAll(this.requireDb());
    const recordByName = new Map(records.map((record) => [record.name, record]));

    const names = new Set<string>([...this.listMigrationFiles(), ...recordByName.keys()]);
    return [...names].sort().map((name) => this.buildStatusRow(name, recordByName.get(name)));
  }

  /** Filtered list of migrations */
  async list(filter: 'all' | 'pending' | 'applied'): Promise<StatusRow[]> {
    const rows = await this.status();
    if (filter === 'all') {
      return rows;
    }
    return rows.filter((row) => row.status === filter);
  }

  /** Build a StatusRow for a migration, verifying checksum when possible */
  private buildStatusRow(name: string, record: MigrationRecord | undefined): StatusRow {
    const filepath = this.filepath(name);
    const fileExists = existsSync(filepath);
    const isApplied = record?.status === 'applied';

    let checksumOk: boolean | null = null;
    if (isApplied && record && fileExists) {
      checksumOk = computeChecksum(filepath) === record.checksum;
    }

    return {
      file: name,
      status: isApplied ? 'applied' : 'pending',
      batch: isApplied && record ? record.batch : null,
      appliedAt: isApplied && record ? record.appliedAt : null,
      duration: isApplied && record ? record.duration : null,
      checksumOk,
      ...(record?.description ? { description: record.description } : {}),
    };
  }

  /** Create a new migration file and return its absolute path */
  async create(name: string, options: CreateOptions = {}): Promise<string> {
    const config = await this.ensureConfig(false);
    const dir = this.migrationsPath();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const templatePath = options.template ?? config.templatePath;
    const js = options.js ?? config.createExtension === 'js';
    const filepath = createMigrationFile({
      dir,
      name,
      sequential: config.sequential,
      js,
      ...(templatePath ? { templatePath } : {}),
    });
    this.logger.success(`✔ Created  ${path.basename(filepath)}`);
    return filepath;
  }

  /** Create an mmk config file in the working directory and return its path */
  async init(options: InitOptions = {}): Promise<string> {
    const values: ConfigValues = {};
    if (this.partialConfig.uri) values.uri = this.partialConfig.uri;
    if (this.partialConfig.dbName) values.dbName = this.partialConfig.dbName;
    if (this.partialConfig.migrationsDir) values.migrationsDir = this.partialConfig.migrationsDir;

    const filepath = createConfigFile({
      dir: process.cwd(),
      format: options.format ?? 'js',
      force: options.force ?? false,
      values,
      ...(options.secretProvider ? { secretProvider: true } : {}),
    });
    this.logger.success(`✔ Created  ${path.basename(filepath)}`);
    return filepath;
  }

  /**
   * Adopt an existing migrate-mongo `changelog` collection by mapping its
   * records into our schema and writing them to `migrationsCollection`. The
   * source collection is never modified. Forward-only: it records applied
   * history so `up` skips it correctly — it does not adapt legacy migration
   * file signatures, so `down`/`redo` on imported files is unsupported.
   */
  async import(options: ImportOptions = {}): Promise<ImportResult> {
    const config = await this.ensureConfig();
    await this.connect();
    const lock = new MigrationLock(this.requireDb(), config.lockCollection, config.lockTTLSeconds);
    return runWithLock(
      lock,
      { logger: this.logger, ...(options.noLock ? { noLock: true } : {}) },
      () => this.runImport(options),
    );
  }

  private async runImport(options: ImportOptions): Promise<ImportResult> {
    const config = this.config as MmkConfig;
    const db = this.requireDb();
    const changelog = this.requireChangelog();
    const logger = this.logger;

    const source = options.from ?? MIGRATE_MONGO_COLLECTION;
    const target = options.to ?? config.migrationsCollection;
    const dryRun = options.dryRun ?? false;

    // Importing a collection into itself would rewrite the source it is reading.
    if (source === target) {
      throw new InvalidArgumentError(
        explain(`Cannot import ${quote(source)} into itself — --from and --to must differ`, [
          `Source (--from): ${quote(source)}`,
          options.to === undefined
            ? `Target (--to): ${quote(target)} — defaulted from your config's migrationsCollection`
            : `Target (--to): ${quote(target)}`,
          'Point --from at your migrate-mongo changelog, or --to at a different collection',
        ]),
        { source, target },
      );
    }

    // Records are written to `target`; reuse the connected changelog when it
    // already points there, otherwise bind a fresh one (and ensure its index).
    const targetChangelog =
      target === config.migrationsCollection ? changelog : new Changelog(target);
    if (targetChangelog !== changelog && !dryRun) {
      await targetChangelog.ensureIndexes(db);
    }

    const rawDocs = await changelog.getForeignDocs(db, source);
    if (rawDocs.length === 0) {
      logger.info(`Nothing to import from "${source}"`);
      return { source, target, imported: 0, skipped: 0, dryRun, rows: [] };
    }

    const valid: MigrateMongoDoc[] = [];
    let skipped = 0;
    for (const doc of rawDocs) {
      if (isMigrateMongoDoc(doc)) {
        valid.push(doc);
      } else {
        skipped += 1;
        logger.warn('⚠ Skipping source doc without a usable fileName');
      }
    }

    const existing = await targetChangelog.getAll(db);
    if (!options.force && !dryRun && existing.length > 0) {
      throw new ImportTargetNotEmptyError(
        `Target collection "${target}" already has ${existing.length} record(s) — re-run with force to proceed`,
        { target, existing: existing.length },
      );
    }

    // Continue batch numbering after the batches already in the target so imported
    // records never collide with existing ones. Records this import will overwrite
    // (same name) are excluded, keeping a forced re-import's batch numbers stable.
    const incomingNames = new Set(valid.map((doc) => doc.fileName));
    const batchOffset = existing
      .filter((record) => !incomingNames.has(record.name))
      .reduce((max, record) => Math.max(max, record.batch), 0);

    const rowSources = new Map<string, ImportChecksumSource>();
    const records = mapMigrateMongoDocs(valid, {
      environment: 'imported',
      executedBy: 'mmk-import',
      batchOffset,
      resolveChecksum: (fileName, fileHash) => {
        const resolved = this.resolveImportChecksum(fileName, fileHash, options.trustHash ?? false);
        rowSources.set(fileName, resolved.source);
        if (resolved.source === 'missing') {
          logger.warn(`⚠ File not found on disk: ${fileName} — checksum unverifiable`);
        }
        return resolved;
      },
    });

    const rows: ImportRow[] = records.map((record) => ({
      file: record.name,
      batch: record.batch,
      appliedAt: record.appliedAt,
      checksum: record.checksum,
      checksumSource: rowSources.get(record.name) ?? 'missing',
    }));

    if (dryRun) {
      logger.info(
        `◎ Dry-run  Would import ${rows.length} record(s) from "${source}" → "${target}"`,
      );
      return { source, target, imported: 0, skipped, dryRun, rows };
    }

    for (const record of records) {
      await targetChangelog.markApplied(db, record);
    }

    logger.success(`✔ Imported ${records.length} record(s) from "${source}" → "${target}"`);
    return { source, target, imported: records.length, skipped, dryRun, rows };
  }

  /**
   * Decide the checksum to store for an imported migration. Order: when
   * `trustHash`, reuse the source `fileHash` if present; otherwise reuse it only
   * when it matches a freshly computed hash (algorithms align), else recompute
   * from disk; when the file is missing, fall back to the source hash or empty.
   */
  private resolveImportChecksum(
    fileName: string,
    fileHash: string | undefined,
    trustHash: boolean,
  ): { checksum: string; source: ImportChecksumSource } {
    const filepath = this.filepath(fileName);
    const exists = existsSync(filepath);

    if (trustHash && fileHash) {
      return { checksum: fileHash, source: 'reused' };
    }
    if (exists) {
      const recomputed = computeChecksum(filepath);
      if (fileHash && fileHash === recomputed) {
        return { checksum: fileHash, source: 'reused' };
      }
      return { checksum: recomputed, source: 'recomputed' };
    }
    if (fileHash) {
      return { checksum: fileHash, source: 'reused' };
    }
    return { checksum: '', source: 'missing' };
  }
}
