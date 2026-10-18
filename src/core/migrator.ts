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
  MigrationInvalidExportError,
  MigrationInvalidNameError,
  MigrationNameConflictError,
  MmkError,
  NamespaceUnadoptedError,
  NotAppliedError,
  TransactionsUnsupportedError,
} from '../errors/index.js';
import type {
  AdoptResult,
  AdoptRow,
  ConfigSource,
  ConfigSummary,
  ImportChecksumSource,
  ImportResult,
  ImportRow,
  LockInfo,
  LockStatus,
  MigrateMongoDoc,
  MigrationRecord,
  MmkConfig,
  MmkLogger,
  NamespaceStatusRow,
  ProgressReporter,
  RunResult,
  StatusRow,
} from '../types/index.js';
import { detectAuthor } from '../utils/author.js';
import { computeChecksum } from '../utils/checksum.js';
import { didYouMean, explain, listOf, quote } from '../utils/explain.js';
import { loadMigrationFile } from '../utils/loader.js';
import { resolveLogger } from '../utils/logger.js';
import { namespaceLabel, namespaceProblem } from '../utils/namespace.js';
import {
  hasPassword,
  hasUnescapedCredentials,
  redactConnectionString,
  redactMongoUri,
  withoutCredentials,
} from '../utils/redact.js';
import { detectService } from '../utils/service.js';
import {
  type ConfigFormat,
  type ConfigValues,
  createConfigFile,
  createMigrationFile,
} from '../utils/template.js';
import { Changelog } from './changelog.js';
import { type LoadConfigOptions, loadConfigWithSources } from './config.js';
import { buildContext } from './context.js';
import { isMigrateMongoDoc, mapMigrateMongoDocs } from './import.js';
import { type LockDocument, MigrationLock, runWithLock } from './lock.js';
import { runMigration } from './runner.js';
import { checkStorageFormat, recordStorageFormat } from './storage-format.js';

/** Default source collection name used by migrate-mongo */
const MIGRATE_MONGO_COLLECTION = 'changelog';

/**
 * Oldest MongoDB wire version supported: 8 = server 4.2, the first with `$$NOW`
 * and aggregation-pipeline updates, which the lock relies on.
 */
const MIN_WIRE_VERSION = 8;

/**
 * Record on a failed run's error which files ran before it stopped, as `context.results` (so
 * `--json` prints them under `details.results`). Without this, a caller only learns that the run
 * failed, not what it applied or reverted first. Only an {@link MmkError} has a context; any other
 * error is returned unchanged.
 */
function withRunResults(error: unknown, results: readonly RunResult[]): unknown {
  if (error instanceof MmkError) {
    // `context` is readonly to callers; this is the one place that adds to it after the throw.
    Object.assign(error, { context: { ...error.context, results: [...results] } });
  }
  return error;
}

/** The results {@link withRunResults} recorded on `error`, or none */
function runResultsOf(error: unknown): RunResult[] {
  const results = error instanceof MmkError ? error.context?.results : undefined;
  return Array.isArray(results) ? (results as RunResult[]) : [];
}

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
  /**
   * Author written into the file. Default: config `author`, then git
   * `user.name <user.email>`, then the OS username.
   */
  author?: string;
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
  /**
   * Namespace written into the generated config (one per repo, for repos that
   * share a database). Omitted: the file has a commented-out example instead.
   */
  namespace?: string;
}

/** Options for {@link MigratorKit.adopt} */
export interface AdoptOptions {
  /** Preview which records would move, without writing anything */
  dryRun?: boolean;
  /** Skip lock acquisition (dev only) */
  noLock?: boolean;
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

/** Options for {@link MigratorKit.connect} */
export interface ConnectOptions {
  /**
   * Connect without writing anything: skip creating the changelog index and
   * recording the storage format. The read commands (`status`, `list`,
   * `dry-run`, `status --all-namespaces`) connect this way, so they work with a
   * user that has only the `read` role. The check that refuses a newer storage
   * format still runs: it only reads.
   */
  readOnly?: boolean;
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
  /** The config file the config came from (null: none), set with {@link config} */
  private configFile: string | null = null;
  /** The kind of layer each config value came from, set with {@link config} */
  private configSources = new Map<keyof MmkConfig, ConfigSource>();
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private changelog: Changelog | undefined;
  /**
   * Whether the connected deployment supports multi-document transactions
   * (replica set / sharded cluster). Detected once on connect; used to fail a
   * transactional migration fast on a standalone instead of at commit time.
   */
  private supportsTransactions = false;
  /** The server's wire version from the connect-time probe; undefined if the probe failed */
  private maxWireVersion: number | undefined;
  /** Whether connect() has created the changelog index (and recorded the storage format) */
  private preparedForWrites = false;

  constructor(config: Partial<MmkConfig> = {}, options: MigratorKitOptions = {}) {
    this.partialConfig = config;
    this.configPath = options.configPath;
    this.progress = options.progress;
  }

  /** Resolve and cache the full configuration */
  private async ensureConfig(requireDb = true): Promise<MmkConfig> {
    if (!this.config) {
      const loaded = await loadConfigWithSources(this.loadOptions(requireDb));
      this.config = loaded.config;
      this.configFile = loaded.configFile;
      this.configSources = loaded.sources;
    }
    return this.config;
  }

  /** Options for loading this migrator's config */
  private loadOptions(requireDb: boolean): LoadConfigOptions {
    return {
      flags: this.partialConfig,
      requireDb,
      ...(this.configPath ? { configPath: this.configPath } : {}),
    };
  }

  private get logger(): MmkLogger {
    return resolveLogger(this.config?.logger);
  }

  /**
   * Connect to MongoDB. Unless `readOnly` is set, also prepare the database for
   * writes: create the changelog index and, when a namespace is set, record the
   * storage format. Those are the only writes connecting makes, so a read-only
   * connect works with a user that has only the `read` role. Connecting again
   * without `readOnly` after a read-only connect prepares for writes then.
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    const config = await this.ensureConfig();
    if (!this.client || !this.db) {
      await this.open(config);
    }
    if (options.readOnly || this.preparedForWrites) {
      return;
    }
    // The first writes. Either one fails the same way (a user without write
    // access gets `not authorized` in the reason), and the client is closed so a
    // later connect() starts clean.
    try {
      // Only a namespaced run writes data older versions would misread, so only
      // it records the marker; every run still refuses a newer format (in open()).
      if (config.namespace !== undefined) {
        await recordStorageFormat(this.requireDb());
      }
      await this.requireChangelog().ensureIndexes(this.requireDb());
    } catch (error) {
      await this.disconnect();
      throw this.connectionFailedError(config, error);
    }
    this.preparedForWrites = true;
  }

  /**
   * Open the client and run the read-only checks every command needs: the
   * server version and the storage format. Writes nothing.
   */
  private async open(config: MmkConfig): Promise<void> {
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
      const server = await this.probeServer(this.client);
      this.supportsTransactions = server.supportsTransactions;
      this.maxWireVersion = server.maxWireVersion;
    } catch (error) {
      throw this.connectionFailedError(config, error);
    }
    // Connected — refuse an unsupported server or a newer storage format
    // BEFORE writing anything. On any failure the client is closed so a later
    // connect() starts clean.
    try {
      this.assertServerSupported();
      await checkStorageFormat(this.requireDb());
      this.changelog = new Changelog(config.migrationsCollection, config.namespace);
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  /**
   * The `CONNECTION_FAILED` error for a driver failure while connecting (or
   * preparing the database for writes). Driver errors frequently embed the
   * connection string verbatim, so credentials are redacted before they reach a
   * log, JSON output, or error context. The redacted driver message is the only
   * clue to WHY it failed (bad host, auth, TLS, timeout, permissions), so it
   * belongs in the message — not only in the context, where the terminal never
   * shows it.
   *
   * The one exception: when the username or password has characters it should
   * have percent-encoded, the driver mis-splits the URI and its message can
   * quote part of the password as a host name. That message is withheld and the
   * encoding problem, which is the real cause, is explained instead.
   */
  private connectionFailedError(config: MmkConfig, error: unknown): ConnectionFailedError {
    const raw = error instanceof Error ? error.message : String(error);
    const unescaped = hasUnescapedCredentials(config.uri);
    const cause = unescaped
      ? 'The username or password contains a character that must be percent-encoded (: / ? # [ ] @). The driver message is not shown because it can include part of the password'
      : redactMongoUri(raw);
    const uri = redactConnectionString(config.uri);
    return new ConnectionFailedError(
      explain(`Failed to connect to MongoDB at ${uri}`, [
        `Reason: ${cause}`,
        `Database: ${quote(config.dbName)}`,
        unescaped
          ? 'Encode the username and password, e.g. with encodeURIComponent(password): "p@ss/word" becomes "p%40ss%2Fword"'
          : 'Check the host/port is reachable, the credentials are right, and any TLS or IP allow-list requirement is met',
        'Set the connection with --uri, the MMK_URI environment variable, or "uri" in your config file',
      ]),
      { cause, uri, dbName: config.dbName },
    );
  }

  /**
   * Probe the deployment once on connect: whether it can run multi-document
   * transactions — true for a replica set (`setName` present) or a sharded
   * cluster (mongos, `msg === 'isdbgrid'`), false for a standalone — and its
   * wire version. Best-effort: if the probe itself fails we assume transaction
   * support and skip the version check (fail open), rather than block a working
   * setup on a flaky admin command.
   */
  private async probeServer(
    client: MongoClient,
  ): Promise<{ supportsTransactions: boolean; maxWireVersion: number | undefined }> {
    try {
      const hello = (await client.db('admin').command({ hello: 1 })) as {
        setName?: string;
        msg?: string;
        maxWireVersion?: number;
      };
      return {
        supportsTransactions: hello.setName !== undefined || hello.msg === 'isdbgrid',
        maxWireVersion: hello.maxWireVersion,
      };
    } catch {
      return { supportsTransactions: true, maxWireVersion: undefined };
    }
  }

  /** Refuse a server older than 4.2 with a clear message instead of a driver error mid-run */
  private assertServerSupported(): void {
    if (this.maxWireVersion !== undefined && this.maxWireVersion < MIN_WIRE_VERSION) {
      throw new ConnectionFailedError(
        explain('This MongoDB server is too old for mongo-migrate-kit — it needs 4.2 or newer', [
          `Server wire version: ${this.maxWireVersion} (4.2 is wire version ${MIN_WIRE_VERSION})`,
          'The migration lock uses the server clock ($$NOW) and pipeline updates, added in MongoDB 4.2',
          'Upgrade the server, or point --uri / MMK_URI at a 4.2+ deployment',
        ]),
        { maxWireVersion: this.maxWireVersion, minWireVersion: MIN_WIRE_VERSION },
      );
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
      this.preparedForWrites = false;
    }
  }

  /** Map an internal lock document to the public {@link LockInfo} shape */
  private toLockInfo(doc: LockDocument | null): LockInfo | null {
    if (!doc) {
      return null;
    }
    return {
      lockedAt: doc.lockedAt,
      pid: doc.pid,
      host: doc.host,
      executedBy: doc.executedBy,
      ...(doc.namespace !== undefined ? { namespace: doc.namespace } : {}),
      ...(doc.acquiredAt !== undefined ? { acquiredAt: doc.acquiredAt } : {}),
      ...(doc.expiresAt !== undefined ? { expiresAt: doc.expiresAt } : {}),
    };
  }

  /**
   * Build the lock (assumes connected). Every repo on a database takes this same
   * lock whatever its namespace; the namespace is only recorded so others can
   * see who holds it.
   */
  private buildLock(): MigrationLock {
    const config = this.config as MmkConfig;
    return new MigrationLock(
      this.requireDb(),
      config.lockCollection,
      config.lockTTLSeconds,
      config.namespace,
    );
  }

  /**
   * Resolve and cache the effective configuration — CLI flags, `MMK_*` env vars,
   * config file and defaults merged and validated — without connecting. Any
   * lines config loading prints ("Loaded config from …", env warnings) happen
   * here, which lets a caller print them before starting a spinner.
   * @throws {@link ConfigInvalidError} when the configuration is invalid
   */
  async resolveConfig(): Promise<MmkConfig> {
    return this.ensureConfig();
  }

  /**
   * The effective configuration as plain data, for `mmk config`: resolved the
   * way every other command resolves it, but never connecting, and not
   * requiring a connection string or database name. Paths are absolute and the
   * connection string's credentials are hidden.
   * @throws {@link ConfigInvalidError} when the configuration is invalid
   */
  async describeConfig(): Promise<ConfigSummary> {
    // Not cached when loaded here: without `requireDb`, a later connect() would
    // run with an empty uri instead of reporting it missing.
    const loaded = this.config
      ? { config: this.config, configFile: this.configFile, sources: this.configSources }
      : await loadConfigWithSources(this.loadOptions(false));
    const { config } = loaded;
    return {
      configFile: loaded.configFile,
      migrationsDir: path.resolve(config.migrationsDir),
      fileExtensions: [...config.fileExtensions],
      createExtension: config.createExtension,
      sequential: config.sequential,
      migrationsCollection: config.migrationsCollection,
      lockCollection: config.lockCollection,
      lockTTLSeconds: config.lockTTLSeconds,
      strict: config.strict,
      useTransaction: config.useTransaction,
      requireAuthor: config.requireAuthor ?? false,
      ...(config.namespace !== undefined ? { namespace: config.namespace } : {}),
      ...(config.author ? { author: config.author } : {}),
      ...(config.templatePath ? { templatePath: path.resolve(config.templatePath) } : {}),
      dbName: config.dbName === '' ? null : config.dbName,
      uri: config.uri === '' ? null : redactConnectionString(config.uri),
      // `logger` is how output is shown, not a setting (the CLI sets its own in --json mode).
      sources: Object.fromEntries([...loaded.sources].filter(([key]) => key !== 'logger')),
    };
  }

  /**
   * The namespace this migrator is scoped to, or undefined for the default
   * namespace (no `namespace` configured). Resolves the config if needed.
   */
  async getNamespace(): Promise<string | undefined> {
    return (await this.resolveConfig()).namespace;
  }

  /** Print which namespace a command works in — only when one is set */
  private announceNamespace(): void {
    const namespace = this.config?.namespace;
    if (namespace !== undefined) {
      this.logger.dim(`Namespace: ${namespace}`);
    }
  }

  /**
   * Safety check 2: this repo's files whose records were written before it had
   * a namespace (they carry none yet). Empty when no namespace is set — then
   * those records are this repo's own.
   */
  private async unadoptedFiles(changelog: Changelog): Promise<string[]> {
    if (changelog.namespace === undefined || !existsSync(this.migrationsPath())) {
      return [];
    }
    const files = this.listMigrationFiles();
    if (files.length === 0) {
      return [];
    }
    const records = await changelog.getUnnamespaced(this.requireDb(), files);
    return records.map((record) => record.name);
  }

  /**
   * Safety check 2, the one place every command runs it — once per command.
   *
   * - `'refuse'`: every command whose answer depends on what is applied in this
   *   namespace — `up`, `down`, `redo`, `import`, `dry-run`, and `list` filtered
   *   to pending/applied (and so `pendingMigrations()`). Unadopted records would
   *   make applied migrations look pending, so these refuse rather than give a
   *   wrong answer (or, for `up`, run them a second time). Runs before check 1,
   *   which would otherwise give the wrong advice.
   * - `'warn'`: `status` and unfiltered `list` — the views that show the whole
   *   picture. They warn and mark those rows `unadopted` instead.
   *
   * Returns the unadopted names (empty when refusing succeeds or none exist).
   */
  private async checkAdopted(
    changelog: Changelog,
    onUnadopted: 'refuse' | 'warn',
  ): Promise<Set<string>> {
    const names = await this.unadoptedFiles(changelog);
    if (names.length === 0) {
      return new Set();
    }
    const namespace = namespaceLabel(changelog.namespace);
    if (onUnadopted === 'warn') {
      this.logger.warn(
        `⚠ ${names.length} file(s) here have records from before this repo had a namespace — they are applied, not pending. Run \`mmk namespace adopt\` to move them into ${quote(namespace)}`,
      );
      return new Set(names);
    }
    throw new NamespaceUnadoptedError(
      explain(
        `${names.length === 1 ? '1 migration' : `${names.length} migrations`} in this folder ${names.length === 1 ? 'was' : 'were'} applied before this repo had a namespace`,
        [
          `Their records have no namespace yet, so in namespace ${quote(namespace)} they would look pending (and \`mmk up\` would run them a second time)`,
          `Files: ${listOf(names)}`,
          'Preview the move:  mmk namespace adopt --dry-run',
          `Then move them:    mmk namespace adopt   (into ${quote(namespace)})`,
          'Nothing was run',
        ],
      ),
      { namespace, names },
    );
  }

  /**
   * Safety check 1: refuse — before any write or transaction — when a file to
   * run is already recorded under another *named* namespace in this collection
   * (any status: even a reverted record holds the unique name). Without it, a
   * non-transactional migration would run first and only then fail to record
   * itself, leaving its writes behind unrecorded. The message tells apart a
   * changed/mistyped namespace (several files, all under one other namespace)
   * from two repos that used the same filename.
   */
  private async assertNoNameConflicts(changelog: Changelog, names: string[]): Promise<void> {
    const conflicts = await changelog.getInOtherNamespaces(this.requireDb(), names);
    if (conflicts.length === 0) {
      return;
    }
    const mine = namespaceLabel(changelog.namespace);
    const owners = [...new Set(conflicts.map((record) => namespaceLabel(record.namespace)))];
    const files = conflicts.map((record) => record.name);
    const context = {
      namespace: mine,
      conflicts: conflicts.map((record) => ({
        name: record.name,
        namespace: record.namespace,
        status: record.status,
      })),
    };

    const [onlyOwner] = owners;
    if (conflicts.length >= 2 && owners.length === 1 && onlyOwner !== undefined) {
      throw new MigrationNameConflictError(
        explain(
          `These ${conflicts.length} files are recorded under namespace ${quote(onlyOwner)}, but this run uses ${quote(mine)}`,
          [
            'Did the namespace change? Changing it makes every migration look pending',
            `Files: ${listOf(files)}`,
            `If this repo's namespace is ${quote(onlyOwner)}, set it back in its config: namespace: '${onlyOwner}'`,
            'Nothing was run',
          ],
        ),
        context,
      );
    }

    const lines = conflicts.map(
      (record) =>
        `${quote(record.name)} is already used by namespace ${quote(namespaceLabel(record.namespace))}${record.status === 'reverted' ? ' (reverted)' : ''}`,
    );
    throw new MigrationNameConflictError(
      explain(
        conflicts.length === 1
          ? (lines[0] ?? 'A migration filename is already used by another namespace')
          : `${conflicts.length} migration filenames are already used by other namespaces`,
        [
          ...(conflicts.length === 1 ? [] : lines),
          `This run uses namespace ${quote(mine)}; filenames must be unique within a changelog collection`,
          'Rename the file (e.g. recreate it with `mmk create`), or give this repo its own migrationsCollection',
          'Nothing was run',
        ],
      ),
      context,
    );
  }

  /**
   * Inspect the current migration lock without modifying it. Returns the holder,
   * or null when no lock is held.
   */
  async lockInfo(): Promise<LockInfo | null> {
    await this.ensureConfig();
    await this.connect({ readOnly: true });
    return this.toLockInfo(await this.buildLock().inspect());
  }

  /**
   * Who holds the migration lock and whether it has gone stale (the holder
   * stopped renewing it, so the next run takes it over) — what `mmk lock`
   * shows. Only reads: it connects read-only and never takes, renews or
   * releases the lock, so it works with a user that has only the `read` role.
   */
  async lockStatus(): Promise<LockStatus> {
    await this.ensureConfig();
    await this.connect({ readOnly: true });
    const state = await this.buildLock().status();
    return state
      ? { holder: this.toLockInfo(state.holder), stale: state.stale }
      : { holder: null, stale: false };
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
    await this.ensureConfig();
    await this.connect();
    this.announceNamespace();
    const lock = this.buildLock();
    return runWithLock(
      lock,
      { logger: this.logger, ...(options.noLock ? { noLock: true } : {}) },
      async () => {
        await this.checkAdopted(this.requireChangelog(), 'refuse');
        return this.runUp(filename, options);
      },
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

    // Check 1, before any hook, write, or transaction.
    await this.assertNoNameConflicts(changelog, targets);

    const context = buildContext(this.client as MongoClient, db, config.mongoose);
    const results: RunResult[] = [];
    // Without --step every file in this run shares one batch. With --step each
    // applied file gets its own sequential batch (base, base+1, …) so a later
    // `down` can revert them individually. Only successful applies advance the
    // counter, so --step never leaves gaps.
    const baseBatch = await this.nextBatch();
    let appliedCount = 0;
    const service = detectService(config.migrationsDir, config.service);

    if (config.requireAuthor) {
      // Files that will only be skipped (already applied, no --force) are not checked.
      await this.assertAuthors(force ? targets : targets.filter((name) => !appliedNames.has(name)));
    }

    // From here the user's code runs. If anything fails, the error says which files ran first.
    try {
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
                ...(migration.author ? { author: migration.author } : {}),
                ...(service ? { service } : {}),
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
    } catch (error) {
      throw withRunResults(error, results);
    }
    return results;
  }

  /**
   * `requireAuthor` preflight: load every file about to run and reject the whole
   * run — before any hook or write — if one lacks a non-empty `author` export.
   * All offenders are reported at once.
   */
  private async assertAuthors(names: string[]): Promise<void> {
    const missing: string[] = [];
    for (const name of names) {
      const migration = await loadMigrationFile(this.filepath(name));
      if (!migration.author) {
        missing.push(name);
      }
    }
    if (missing.length === 0) {
      return;
    }
    throw new MigrationInvalidExportError(
      explain(
        `${missing.length === 1 ? 'A migration has' : `${missing.length} migrations have`} no author, and requireAuthor is on`,
        [
          `Missing an author: ${listOf(missing)}`,
          "Add to each file: export const author = 'Jane Doe <jane@example.com>';",
          'Nothing was applied — the check runs before any migration starts',
          'To allow migrations without an author, set requireAuthor: false (or MMK_REQUIRE_AUTHOR=false)',
        ],
      ),
      { missing },
    );
  }

  /** Rollback the last batch, a specific batch, a specific file, or the last N steps */
  async down(filename?: string, options: DownOptions = {}): Promise<RunResult[]> {
    this.assertStepsValid(options.steps, filename, options.batch);
    this.assertBatchValid(options.batch, filename);
    await this.ensureConfig();
    // Validate the name before the changelog lookup, so a traversing name is
    // reported as an invalid name rather than as "not applied".
    if (filename) {
      this.filepath(filename);
    }
    await this.connect();
    this.announceNamespace();
    const lock = this.buildLock();
    return runWithLock(
      lock,
      { logger: this.logger, ...(options.noLock ? { noLock: true } : {}) },
      async () => {
        await this.checkAdopted(this.requireChangelog(), 'refuse');
        return this.runDown(filename, options);
      },
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

    // From here the user's code runs. If anything fails, the error says which files ran first.
    try {
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
    } catch (error) {
      throw withRunResults(error, results);
    }
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
    await this.ensureConfig();
    await this.connect();
    this.announceNamespace();
    const lock = this.buildLock();
    return runWithLock(lock, { logger: this.logger }, async () => {
      const changelog = this.requireChangelog();
      // Once, before picking the target: unadopted records would make the
      // namespace look empty ("Nothing to redo") rather than explain what to do.
      await this.checkAdopted(changelog, 'refuse');

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
      let upResults: RunResult[];
      try {
        upResults = await this.runUp(target);
      } catch (error) {
        // The revert happened, and the file stays reverted: report it with the failed re-apply.
        throw withRunResults(error, [...downResults, ...runResultsOf(error)]);
      }
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
    await this.connect({ readOnly: true });
    this.announceNamespace();
    const db = this.requireDb();
    const changelog = this.requireChangelog();
    const logger = this.logger;
    // A dry run predicts `up`/`down`, so it refuses exactly when they would.
    await this.checkAdopted(changelog, 'refuse');

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
    await this.connect({ readOnly: true });
    this.announceNamespace();
    const unadopted = await this.checkAdopted(this.requireChangelog(), 'warn');
    return this.statusRows(unadopted);
  }

  /** Rows for every known file and record, marking `unadopted` ones */
  private async statusRows(unadopted: Set<string>): Promise<StatusRow[]> {
    const records = await this.requireChangelog().getAll(this.requireDb());
    const recordByName = new Map(records.map((record) => [record.name, record]));

    const names = new Set<string>([...this.listMigrationFiles(), ...recordByName.keys()]);
    return [...names].sort().map((name) => {
      const row = this.buildStatusRow(name, recordByName.get(name));
      return unadopted.has(name) ? { ...row, unadopted: true } : row;
    });
  }

  /**
   * Every record in the changelog collection, across all namespaces — a
   * read-only overview for whoever manages a shared database. Raw records (incl.
   * reverted ones); files on disk are not compared, since they belong to other
   * repos.
   */
  async statusAllNamespaces(): Promise<NamespaceStatusRow[]> {
    await this.ensureConfig();
    await this.connect({ readOnly: true });
    const records = await this.requireChangelog().getAllNamespaces(this.requireDb());
    return records.map((record) => ({
      ...(record.namespace !== undefined ? { namespace: record.namespace } : {}),
      file: record.name,
      status: record.status,
      batch: record.batch,
      appliedAt: record.appliedAt,
      ...(record.revertedAt ? { revertedAt: record.revertedAt } : {}),
      ...(record.author ? { author: record.author } : {}),
    }));
  }

  /**
   * Filtered list of migrations. Unfiltered it is the same view as `status`.
   * Filtered to pending/applied it answers "what is applied" — which unadopted
   * records would make wrong — so it refuses with `NAMESPACE_UNADOPTED` until
   * `mmk namespace adopt` has run (as `up` does).
   */
  async list(filter: 'all' | 'pending' | 'applied'): Promise<StatusRow[]> {
    if (filter === 'all') {
      return this.status();
    }
    await this.ensureConfig();
    await this.connect({ readOnly: true });
    this.announceNamespace();
    await this.checkAdopted(this.requireChangelog(), 'refuse');
    const rows = await this.statusRows(new Set());
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
      ...(isApplied && record?.checksum ? { checksum: record.checksum } : {}),
      ...(record?.description ? { description: record.description } : {}),
      ...(isApplied && record?.author ? { author: record.author } : {}),
      ...(this.config?.namespace !== undefined ? { namespace: this.config.namespace } : {}),
      ...(record && !fileExists ? { fileMissing: true } : {}),
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
    const author = detectAuthor({
      cwd: dir,
      ...(options.author !== undefined ? { explicit: options.author } : {}),
      ...(config.author ? { configured: config.author } : {}),
    });
    const filepath = createMigrationFile({
      dir,
      name,
      sequential: config.sequential,
      js,
      ...(templatePath ? { templatePath } : {}),
      ...(author ? { author } : {}),
    });
    this.logger.success(`✔ Created  ${path.basename(filepath)}`);
    return filepath;
  }

  /**
   * Create an mmk config file in the working directory and return its path.
   * @throws {@link InvalidArgumentError} when the `uri` to write contains a
   * password (except with `secretProvider`, whose template never writes it)
   */
  async init(options: InitOptions = {}): Promise<string> {
    const values: ConfigValues = {};
    if (this.partialConfig.uri) values.uri = this.partialConfig.uri;
    // A static config would hold the password in plain text, in a file that
    // usually gets committed. The secret-provider template never writes the URI.
    if (values.uri !== undefined && !options.secretProvider && hasPassword(values.uri)) {
      throw new InvalidArgumentError(
        explain('--uri contains a password, and mmk init would write it into the config file', [
          `Received: ${quote(redactConnectionString(values.uri))}`,
          'Config files are usually committed, which would put the password in your repository',
          `Try: mmk init --uri ${withoutCredentials(values.uri)}   and put the full URI in MMK_URI (environment or a git-ignored .env); MMK_URI overrides the file`,
          'Or: mmk init --secret-provider   (loads the URI from a secret manager when mmk runs)',
        ]),
        { uri: redactConnectionString(values.uri) },
      );
    }
    if (this.partialConfig.dbName) values.dbName = this.partialConfig.dbName;
    if (this.partialConfig.migrationsDir) values.migrationsDir = this.partialConfig.migrationsDir;
    if (options.namespace !== undefined) {
      const problem = namespaceProblem(options.namespace);
      if (problem !== undefined) {
        throw new InvalidArgumentError(
          explain(`--namespace ${problem}`, [
            `Received: ${quote(options.namespace)}`,
            'Use one value per repo, e.g. the repo name: mmk init --namespace orders-api',
          ]),
          { namespace: options.namespace },
        );
      }
      values.namespace = options.namespace;
    }

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
    await this.ensureConfig();
    await this.connect();
    this.announceNamespace();
    const lock = this.buildLock();
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
    // Either way it is scoped to this repo's namespace.
    const targetChangelog =
      target === config.migrationsCollection ? changelog : new Changelog(target, config.namespace);
    if (targetChangelog !== changelog && !dryRun) {
      await targetChangelog.ensureIndexes(db);
    }
    await this.checkAdopted(targetChangelog, 'refuse');

    const rawDocs = await changelog.getForeignDocs(db, source);
    if (rawDocs.length === 0) {
      logger.info(`Nothing to import from "${source}"`);
      return { source, target, imported: 0, skipped: 0, notInRepo: [], dryRun, rows: [] };
    }

    const valid: MigrateMongoDoc[] = [];
    const notInRepo: string[] = [];
    let skipped = 0;
    for (const doc of rawDocs) {
      if (!isMigrateMongoDoc(doc)) {
        skipped += 1;
        logger.warn('⚠ Skipping source doc without a usable fileName');
      } else if (config.namespace !== undefined && !existsSync(this.filepath(doc.fileName))) {
        // A shared source changelog holds other repos' records too; a namespace
        // imports only the migrations whose files are in this repo.
        notInRepo.push(doc.fileName);
      } else {
        valid.push(doc);
      }
    }
    if (notInRepo.length > 0) {
      logger.warn(
        `⚠ Skipping ${notInRepo.length} record(s) whose files are not in this repo — namespace ${quote(config.namespace)} imports only its own migrations: ${listOf(notInRepo)}`,
      );
    }

    const existing = await targetChangelog.getAll(db);
    if (!options.force && !dryRun && existing.length > 0) {
      const where =
        config.namespace === undefined ? '' : ` in namespace ${quote(config.namespace)}`;
      throw new ImportTargetNotEmptyError(
        `Target collection "${target}" already has ${existing.length} record(s)${where} — re-run with force to proceed`,
        {
          target,
          existing: existing.length,
          ...(config.namespace ? { namespace: config.namespace } : {}),
        },
      );
    }

    // Check 1 on the incoming names, so an import can't collide with another
    // namespace's record halfway through.
    await this.assertNoNameConflicts(
      targetChangelog,
      valid.map((doc) => doc.fileName),
    );

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
      return { source, target, imported: 0, skipped, notInRepo, dryRun, rows };
    }

    for (const record of records) {
      await targetChangelog.markApplied(db, record);
    }

    logger.success(`✔ Imported ${records.length} record(s) from "${source}" → "${target}"`);
    return { source, target, imported: records.length, skipped, notInRepo, dryRun, rows };
  }

  /**
   * Move this repo's records that were written before it had a namespace into
   * its namespace (`mmk namespace adopt`). Only records whose filename is in
   * this repo's migrations directory move; everything else stays in the default
   * namespace. Works within the current `migrationsCollection` only.
   *
   * @throws {@link InvalidArgumentError} when no `namespace` is configured
   */
  async adopt(options: AdoptOptions = {}): Promise<AdoptResult> {
    const config = await this.ensureConfig();
    if (config.namespace === undefined) {
      throw new InvalidArgumentError(
        explain('Set a namespace before adopting — adopt moves records into it', [
          'This repo has no "namespace" configured',
          "Add one to this repo's config file, e.g. namespace: 'orders-api' (or set MMK_NAMESPACE)",
          'Then preview: mmk namespace adopt --dry-run',
        ]),
        {},
      );
    }
    await this.connect();
    this.announceNamespace();
    return runWithLock(
      this.buildLock(),
      { logger: this.logger, ...(options.noLock ? { noLock: true } : {}) },
      () => this.runAdopt(config.namespace as string, options.dryRun ?? false),
    );
  }

  private async runAdopt(namespace: string, dryRun: boolean): Promise<AdoptResult> {
    const db = this.requireDb();
    const changelog = this.requireChangelog();
    const logger = this.logger;

    const files = new Set(this.listMigrationFiles());
    const unnamespaced = await changelog.getUnnamespaced(db);
    const matching = unnamespaced.filter((record) => files.has(record.name));
    const leftInDefault = unnamespaced.length - matching.length;

    // executedBy / appliedAt / service are review hints: if two repos once used
    // the same filename, only one record exists and the first adopter takes it.
    const rows: AdoptRow[] = matching.map((record) => ({
      file: record.name,
      status: record.status,
      batch: record.batch,
      appliedAt: record.appliedAt,
      executedBy: record.executedBy,
      ...(record.service ? { service: record.service } : {}),
    }));
    const result = (adopted: number): AdoptResult => ({
      namespace,
      rows,
      adopted,
      leftInDefault,
      dryRun,
    });

    if (matching.length === 0) {
      logger.info(
        `Nothing to adopt — no record without a namespace matches a file in ${this.migrationsPath()}`,
      );
      return result(0);
    }
    if (dryRun) {
      logger.info(
        `◎ Dry-run  Would adopt ${matching.length} record(s) into namespace ${quote(namespace)}`,
      );
      return result(0);
    }

    const adopted = await changelog.adoptUnnamespaced(
      db,
      matching.map((record) => record.name),
    );
    logger.success(`✔ Adopted ${adopted} record(s) into namespace ${quote(namespace)}`);
    if (leftInDefault > 0) {
      logger.dim(
        `${leftInDefault} record(s) without a namespace were left as they are — no file with that name is in this repo (deleted long ago, or another repo's)`,
      );
    }
    return result(adopted);
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
