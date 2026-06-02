import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Db, MongoClient } from 'mongodb';
import {
  ChecksumMismatchError,
  ConnectionFailedError,
  MigrationFileNotFoundError,
  NotAppliedError,
} from '../errors/index.js';
import type {
  MigrationRecord,
  MmkConfig,
  MmkLogger,
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
import { MigrationLock, runWithLock } from './lock.js';
import { runMigration } from './runner.js';

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

/**
 * The main orchestration class. Every CLI command delegates here. Holds a
 * partial config that is resolved (merged with env/file/defaults) on first use.
 */
/** Additional construction options for {@link MigratorKit} */
export interface MigratorKitOptions {
  /** Explicit config file path — overrides auto-discovery */
  configPath?: string;
}

export class MigratorKit {
  private readonly partialConfig: Partial<MmkConfig>;
  private readonly configPath: string | undefined;
  private config: MmkConfig | undefined;
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private changelog: Changelog | undefined;

  constructor(config: Partial<MmkConfig> = {}, options: MigratorKitOptions = {}) {
    this.partialConfig = config;
    this.configPath = options.configPath;
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

      try {
        const { duration } = await runMigration({
          name,
          migration,
          direction: 'up',
          context,
          useTransaction,
          ...(config.hooks ? { hooks: config.hooks } : {}),
        });

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

    let names: string[];
    if (filename) {
      const record = await changelog.getByName(db, filename);
      if (!record || record.status !== 'applied') {
        throw new NotAppliedError('Migration is not applied', { filename });
      }
      names = [filename];
    } else {
      const batch = options.batch ?? (await changelog.getLastBatch(db));
      if (batch === null) {
        logger.info('Nothing to rollback');
        return [];
      }
      const records = await changelog.getByBatch(db, batch);
      names = records
        .filter((record) => record.status === 'applied')
        .map((record) => record.name)
        .sort()
        .reverse();
    }

    if (names.length === 0) {
      logger.info('Nothing to rollback');
      return [];
    }

    const context = buildContext(this.client as MongoClient, db, config.mongoose);
    const results: RunResult[] = [];

    await config.hooks?.beforeAll?.(context);

    for (const name of names) {
      await config.hooks?.beforeEach?.(name, context);
      const migration = await loadMigrationFile(this.filepath(name));
      const useTransaction = migration.useTransaction ?? config.useTransaction;

      try {
        const { duration } = await runMigration({
          name,
          migration,
          direction: 'down',
          context,
          useTransaction,
          ...(config.hooks ? { hooks: config.hooks } : {}),
        });
        await changelog.markReverted(db, name);
        logger.success(`↩ Reverted ${name}   [${duration}ms]`);
        results.push({ file: name, status: 'reverted', duration });
        await config.hooks?.afterEach?.(name, duration, context);
      } catch (error) {
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
}
