import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Db, MongoClient } from 'mongodb';
import {
  ChecksumMismatchError,
  ConnectionFailedError,
  ImportTargetNotEmptyError,
  IrreversibleMigrationError,
  MigrationFileNotFoundError,
  NotAppliedError,
} from '../errors/index.js';
import type {
  ImportChecksumSource,
  ImportResult,
  ImportRow,
  MigrateMongoDoc,
  MigrationRecord,
  MmkConfig,
  MmkLogger,
  ProgressReporter,
  RunResult,
  StatusRow,
} from '../types/index.js';
import { computeChecksum } from '../utils/checksum.js';
import { loadMigrationFile } from '../utils/loader.js';
import { resolveLogger } from '../utils/logger.js';
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
import { MigrationLock, runWithLock } from './lock.js';
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
}

/** Options for {@link MigratorKit.down} */
export interface DownOptions {
  /** Skip lock acquisition (dev only) */
  noLock?: boolean;
  /** Revert a specific batch number instead of the last batch */
  batch?: number;
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
      this.client = new MongoClient(config.uri);
      await this.client.connect();
      this.db = this.client.db(config.dbName);
      this.changelog = new Changelog(config.migrationsCollection);
      await this.changelog.ensureIndexes(this.db);
    } catch (error) {
      throw new ConnectionFailedError('Failed to connect to MongoDB', {
        cause: error instanceof Error ? error.message : String(error),
      });
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

  private filepath(name: string): string {
    return path.join(this.migrationsPath(), name);
  }

  /** List migration files on disk, sorted ascending */
  private listMigrationFiles(): string[] {
    const dir = this.migrationsPath();
    if (!existsSync(dir)) {
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
      if (!existsSync(this.filepath(filename))) {
        throw new MigrationFileNotFoundError('Migration file not found', { filename });
      }
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
    const batch = await this.nextBatch();

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
            throw new ChecksumMismatchError(`Checksum mismatch for ${name}`, {
              name,
              expected: existing?.checksum,
              actual: checksum,
            });
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

      this.progress?.onStart(name, 'up');
      try {
        const { duration } = await runMigration({
          name,
          migration,
          direction: 'up',
          context,
          useTransaction,
          ...(config.hooks ? { hooks: config.hooks } : {}),
        });
        this.progress?.onStop();

        const record: MigrationRecord = {
          name,
          batch,
          status: 'applied',
          appliedAt: new Date(),
          duration,
          checksum,
          environment: process.env.NODE_ENV ?? 'development',
          executedBy: os.userInfo().username,
          ...(migration.description ? { description: migration.description } : {}),
        };
        await changelog.markApplied(db, record);

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

  /** Rollback the last batch, a specific batch, or a specific named file */
  async down(filename?: string, options: DownOptions = {}): Promise<RunResult[]> {
    const config = await this.ensureConfig();
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
    if (filename) {
      const record = await changelog.getByName(db, filename);
      if (!record || record.status !== 'applied') {
        throw new NotAppliedError('Migration is not applied', { filename });
      }
      toRevert = [record];
    } else {
      const batch = options.batch ?? (await changelog.getLastBatch(db));
      if (batch === null) {
        logger.info('Nothing to rollback');
        return [];
      }
      const records = await changelog.getByBatch(db, batch);
      toRevert = records.filter((record) => record.status === 'applied');
    }

    if (toRevert.length === 0) {
      logger.info('Nothing to rollback');
      return [];
    }

    // Preflight, before running or writing anything: migrate-mongo-imported
    // records are forward-only. Refuse the whole rollback up front with a clear
    // reason so the changelog and collection are never left half-reverted.
    this.assertReversible(toRevert);

    const names = toRevert
      .map((record) => record.name)
      .sort()
      .reverse();

    const context = buildContext(this.client as MongoClient, db, config.mongoose);
    const results: RunResult[] = [];

    await config.hooks?.beforeAll?.(context);

    for (const name of names) {
      await config.hooks?.beforeEach?.(name, context);
      const migration = await loadMigrationFile(this.filepath(name));
      const useTransaction = migration.useTransaction ?? config.useTransaction;

      this.progress?.onStart(name, 'down');
      try {
        const { duration } = await runMigration({
          name,
          migration,
          direction: 'down',
          context,
          useTransaction,
          ...(config.hooks ? { hooks: config.hooks } : {}),
        });
        this.progress?.onStop();
        await changelog.markReverted(db, name);
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

  /** Rollback then re-apply: the last applied migration, or a specific file */
  async redo(filename?: string): Promise<RunResult[]> {
    await this.ensureConfig();
    await this.connect();
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

    const downResults = await this.down(target);
    const upResults = await this.up(target);
    return [...downResults, ...upResults];
  }

  /** Preview what would run — never writes to the database */
  async dryRun(direction: 'up' | 'down', filename?: string): Promise<StatusRow[]> {
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
      names = filename
        ? [filename]
        : this.listMigrationFiles().filter((file) => !applied.has(file));
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
