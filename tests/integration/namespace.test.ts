import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Changelog } from '../../src/core/changelog.js';
import { LOCK_ID, MigrationLock } from '../../src/core/lock.js';
import type { MigratorKit } from '../../src/core/migrator.js';
import { pendingMigrations } from '../../src/core/run.js';
import { META_COLLECTION, META_ID, STORAGE_FORMAT_VERSION } from '../../src/core/storage-format.js';
import {
  InvalidArgumentError,
  LockAlreadyHeldError,
  MigrationNameConflictError,
  NamespaceUnadoptedError,
  NotAppliedError,
  SchemaTooNewError,
} from '../../src/errors/index.js';
import type { MmkConfig, MmkLogger } from '../../src/types/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import {
  type TestProject,
  insertMigration,
  makeMigrator,
  makeProject,
} from '../helpers/project.js';

let mongo: TestMongo;
const projects: TestProject[] = [];
const migrators: MigratorKit[] = [];

beforeAll(async () => {
  mongo = await startTestMongo('mmk_namespace_test');
}, 60_000);

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.dropDatabase();
});

afterEach(async () => {
  for (const migrator of migrators.splice(0)) {
    await migrator.disconnect();
  }
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

/** A repo: its own migrations folder, holding the given files */
function repo(files: string[]): TestProject {
  const project = makeProject();
  for (const file of files) {
    project.write(file, insertMigration('things', file));
  }
  projects.push(project);
  return project;
}

/** A migrator for `project` on the shared test database, cleaned up after each test */
function kit(project: TestProject, overrides: Partial<MmkConfig> = {}): MigratorKit {
  const migrator = makeMigrator(mongo.uri, mongo.dbName, project.dir, overrides);
  migrators.push(migrator);
  return migrator;
}

/** A logger that records warnings, for asserting on the read-only check-2 notice */
function captureLogger(): { logger: MmkLogger; warnings: string[] } {
  const warnings: string[] = [];
  const noop = (): void => undefined;
  return {
    warnings,
    logger: { info: noop, success: noop, error: noop, dim: noop, warn: (m) => warnings.push(m) },
  };
}

const changelog = () => mongo.db.collection('_mmk_migrations');

describe('namespace isolation', () => {
  it('should stamp named records and leave default records without the field', async () => {
    await kit(repo(['0001-a.js']), { namespace: 'orders-api' }).up();
    await kit(repo(['0002-b.js'])).up();
    const named = await changelog().findOne({ name: '0001-a.js' });
    const unnamed = await changelog().findOne({ name: '0002-b.js' });
    expect(named?.namespace).toBe('orders-api');
    expect(unnamed).not.toHaveProperty('namespace');
  });

  it("should show only this repo's migrations in status", async () => {
    await kit(repo(['0001-a.js']), { namespace: 'orders-api' }).up();
    await kit(repo(['0002-b.js']), { namespace: 'billing-api' }).up();
    const rows = await kit(repo(['0001-a.js']), { namespace: 'orders-api' }).status();
    expect(rows.map((row) => row.file)).toEqual(['0001-a.js']);
    expect(rows[0]).toMatchObject({ status: 'applied', namespace: 'orders-api' });
  });

  it('should number batches per namespace', async () => {
    const orders = repo(['0001-a.js']);
    await kit(orders, { namespace: 'orders-api' }).up();
    orders.write('0003-c.js', insertMigration('things', 'c'));
    await kit(orders, { namespace: 'orders-api' }).up();
    const [billing] = await kit(repo(['0002-b.js']), { namespace: 'billing-api' }).up();
    expect(billing?.batch).toBe(1);
    expect((await changelog().findOne({ name: '0003-c.js' }))?.batch).toBe(2);
  });

  it("should roll back only this repo's last batch, never another's", async () => {
    const orders = repo(['0001-a.js']);
    await kit(orders, { namespace: 'orders-api' }).up();
    // billing ran last — before namespaces this made orders' `down` target billing.
    await kit(repo(['0002-b.js']), { namespace: 'billing-api' }).up();

    const reverted = await kit(orders, { namespace: 'orders-api' }).down();
    expect(reverted.map((result) => result.file)).toEqual(['0001-a.js']);
    expect((await changelog().findOne({ name: '0002-b.js' }))?.status).toBe('applied');
  });

  it('should scope down --steps and redo to this namespace', async () => {
    const orders = repo(['0001-a.js']);
    await kit(orders, { namespace: 'orders-api' }).up();
    await kit(repo(['0002-b.js']), { namespace: 'billing-api' }).up();

    const stepped = await kit(orders, { namespace: 'orders-api' }).down(undefined, { steps: 1 });
    expect(stepped.map((result) => result.file)).toEqual(['0001-a.js']);

    await kit(orders, { namespace: 'orders-api' }).up();
    const redone = await kit(orders, { namespace: 'orders-api' }).redo();
    expect(redone.map((result) => result.file)).toEqual(['0001-a.js', '0001-a.js']);
    expect((await changelog().findOne({ name: '0002-b.js' }))?.status).toBe('applied');
  });

  it("should treat another namespace's file as not applied here", async () => {
    await kit(repo(['0002-b.js']), { namespace: 'billing-api' }).up();
    const orders = repo(['0002-b.js']);
    await expect(kit(orders, { namespace: 'orders-api' }).down('0002-b.js')).rejects.toBeInstanceOf(
      NotAppliedError,
    );
  });

  it('should make repos take turns on one lock, whatever their collection, and name the holder', async () => {
    const holder = new MigrationLock(mongo.db, '_mmk_locks', 60, 'orders-worker');
    await holder.acquire();
    try {
      const lockDoc = await mongo.db.collection('_mmk_locks').findOne({ _id: LOCK_ID });
      expect(lockDoc?.namespace).toBe('orders-worker');

      for (const overrides of [
        { namespace: 'billing-api' },
        { namespace: 'catalog-api', migrationsCollection: '_mmk_migrations_catalog' },
      ]) {
        const error = await kit(repo(['0001-a.js']), overrides)
          .up()
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(LockAlreadyHeldError);
        expect((error as Error).message).toContain('held by namespace "orders-worker"');
      }
    } finally {
      await holder.release();
    }
  });

  it('should report the holder namespace through lockInfo', async () => {
    const holder = new MigrationLock(mongo.db, '_mmk_locks', 60, 'orders-worker');
    await holder.acquire();
    try {
      const info = await kit(repo([])).lockInfo();
      expect(info).toMatchObject({ namespace: 'orders-worker' });
      expect(info?.acquiredAt).toBeInstanceOf(Date);
      expect(info?.expiresAt).toBeInstanceOf(Date);
    } finally {
      await holder.release();
    }
  });
});

describe('safety check 2 — not yet adopted', () => {
  /** A repo that used mmk before it had a namespace: its records carry none */
  async function legacyRepo(files: string[]): Promise<TestProject> {
    const project = repo(files);
    await kit(project).up();
    return project;
  }

  it('should refuse up, down and redo before anything runs, pointing at adopt', async () => {
    const project = await legacyRepo(['0001-a.js', '0002-b.js']);
    const named = { namespace: 'orders-api' };
    for (const run of [
      () => kit(project, named).up(),
      () => kit(project, named).down(),
      () => kit(project, named).redo(),
    ]) {
      const error = await run().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NamespaceUnadoptedError);
      expect((error as Error).message).toContain('2 migrations in this folder were applied');
      expect((error as Error).message).toContain('mmk namespace adopt --dry-run');
      // Check 2 runs before check 1, so the advice is never "set it back".
      expect((error as Error).message).not.toContain('set it back');
    }
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should count a reverted record without a namespace as unadopted', async () => {
    const project = await legacyRepo(['0001-a.js']);
    await kit(project).down();
    await expect(kit(project, { namespace: 'orders-api' }).up()).rejects.toBeInstanceOf(
      NamespaceUnadoptedError,
    );
  });

  it('should only warn in status and unfiltered list, and mark the rows', async () => {
    const project = await legacyRepo(['0001-a.js']);
    const capture = captureLogger();
    const migrator = kit(project, { namespace: 'orders-api', logger: capture.logger });

    const rows = await migrator.status();
    expect(rows[0]).toMatchObject({ file: '0001-a.js', unadopted: true });
    expect((await migrator.list('all'))[0]).toMatchObject({ unadopted: true });

    expect(capture.warnings).toHaveLength(2);
    expect(capture.warnings[0]).toContain('they are applied, not pending');
    expect(capture.warnings[0]).toContain('mmk namespace adopt');
  });

  it('should refuse every answer about what is applied or pending, like up does', async () => {
    const project = await legacyRepo(['0001-a.js']);
    const migrator = kit(project, { namespace: 'orders-api' });
    for (const run of [
      () => migrator.dryRun('up'),
      () => migrator.dryRun('down'),
      () => migrator.list('pending'),
      () => migrator.list('applied'),
      () =>
        pendingMigrations({
          uri: mongo.uri,
          dbName: mongo.dbName,
          migrationsDir: project.dir,
          namespace: 'orders-api',
          logger: null,
        }),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(NamespaceUnadoptedError);
    }
  });

  it('should run the check once per command, even for redo', async () => {
    const project = repo(['0001-a.js']);
    await kit(project, { namespace: 'orders-api' }).up();
    const spy = vi.spyOn(Changelog.prototype, 'getUnnamespaced');
    try {
      await kit(project, { namespace: 'orders-api' }).redo();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('should never fire for a repo without a namespace', async () => {
    const project = await legacyRepo(['0001-a.js']);
    const capture = captureLogger();
    await kit(project, { logger: capture.logger }).status();
    expect(capture.warnings).toEqual([]);
  });
});

describe('safety check 1 — name conflict', () => {
  it('should ask whether the namespace changed when every file is under one other namespace', async () => {
    const project = repo(['0001-a.js', '0002-b.js']);
    await kit(project, { namespace: 'orders-api' }).up();
    const error = await kit(project, { namespace: 'orders-apo' })
      .up()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationNameConflictError);
    const message = (error as Error).message;
    expect(message).toContain('These 2 files are recorded under namespace "orders-api"');
    expect(message).toContain('this run uses "orders-apo"');
    expect(message).toContain('Did the namespace change?');
    expect(message).toContain("namespace: 'orders-api'");
  });

  it('should report a filename clash and run nothing', async () => {
    await kit(repo(['0001-init.js']), { namespace: 'billing-api' }).up();
    const orders = repo(['0001-init.js', '0002-other.js']);
    const error = await kit(orders, { namespace: 'orders-api' })
      .up()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationNameConflictError);
    expect((error as Error).message).toContain(
      '"0001-init.js" is already used by namespace "billing-api"',
    );
    expect((error as Error).message).toContain('Nothing was run');
    // 0002-other.js was not applied: the check runs before any migration.
    expect(await changelog().findOne({ name: '0002-other.js' })).toBeNull();
  });

  it('should treat a reverted record in another namespace as a conflict', async () => {
    const billing = repo(['0001-init.js']);
    await kit(billing, { namespace: 'billing-api' }).up();
    await kit(billing, { namespace: 'billing-api' }).down();
    const error = await kit(repo(['0001-init.js']), { namespace: 'orders-api' })
      .up()
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toContain('(reverted)');
  });

  it('should catch a default-namespace run whose file a named namespace uses', async () => {
    await kit(repo(['0001-init.js']), { namespace: 'billing-api' }).up();
    await expect(kit(repo(['0001-init.js'])).up()).rejects.toBeInstanceOf(
      MigrationNameConflictError,
    );
  });
});

describe('namespace adopt', () => {
  it('should refuse without a namespace', async () => {
    await expect(kit(repo([])).adopt()).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('should preview with review hints and write nothing on a dry run', async () => {
    const project = repo(['0001-a.js']);
    await kit(project).up();
    const result = await kit(project, { namespace: 'orders-api' }).adopt({ dryRun: true });
    expect(result).toMatchObject({ namespace: 'orders-api', adopted: 0, dryRun: true });
    expect(result.rows[0]).toMatchObject({ file: '0001-a.js', status: 'applied' });
    expect(result.rows[0]?.executedBy).toBeTruthy();
    expect(await changelog().findOne({ name: '0001-a.js' })).not.toHaveProperty('namespace');
  });

  it("should move this repo's records and leave others in the default namespace", async () => {
    const project = repo(['0001-a.js', '0002-b.js']);
    await kit(project).up();
    // A record whose file is no longer in this repo (deleted long ago, or another repo's).
    await changelog().insertOne({
      name: '0000-gone.js',
      batch: 1,
      status: 'applied',
      appliedAt: new Date(),
      duration: 1,
      checksum: '',
      environment: 'test',
      executedBy: 'someone',
    });

    const result = await kit(project, { namespace: 'orders-api' }).adopt();
    expect(result).toMatchObject({ adopted: 2, leftInDefault: 1, dryRun: false });
    expect((await changelog().findOne({ name: '0001-a.js' }))?.namespace).toBe('orders-api');
    expect(await changelog().findOne({ name: '0000-gone.js' })).not.toHaveProperty('namespace');

    // Adopted, so the namespace now sees them as applied and nothing re-runs.
    const after = kit(project, { namespace: 'orders-api' });
    expect(await after.up()).toEqual([]);
    expect((await after.status()).every((row) => row.status === 'applied')).toBe(true);
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should report nothing to adopt', async () => {
    const result = await kit(repo(['0001-a.js']), { namespace: 'orders-api' }).adopt();
    expect(result).toMatchObject({ adopted: 0, rows: [], leftInDefault: 0 });
  });
});

describe('status --all-namespaces', () => {
  it('should list raw records of every namespace, including reverted ones', async () => {
    const orders = repo(['0001-a.js']);
    await kit(orders, { namespace: 'orders-api' }).up();
    await kit(orders, { namespace: 'orders-api' }).down();
    await kit(repo(['0002-b.js'])).up();

    const rows = await kit(repo([])).statusAllNamespaces();
    expect(rows).toEqual([
      expect.objectContaining({ file: '0002-b.js', status: 'applied' }),
      expect.objectContaining({ namespace: 'orders-api', file: '0001-a.js', status: 'reverted' }),
    ]);
    expect(rows[0]).not.toHaveProperty('namespace');
  });
});

describe('import with a namespace', () => {
  async function seedMigrateMongo(fileNames: string[]): Promise<void> {
    await mongo.db.collection('changelog').insertMany(
      fileNames.map((fileName, index) => ({
        fileName,
        appliedAt: new Date(Date.UTC(2025, 0, index + 1)),
      })),
    );
  }

  it("should import only this repo's files from a shared source changelog", async () => {
    await seedMigrateMongo(['0001-a.js', '0002-other-repo.js']);
    const result = await kit(repo(['0001-a.js']), { namespace: 'orders-api' }).import();
    expect(result.imported).toBe(1);
    expect(result.notInRepo).toEqual(['0002-other-repo.js']);
    expect((await changelog().findOne({ name: '0001-a.js' }))?.namespace).toBe('orders-api');
    expect(await changelog().findOne({ name: '0002-other-repo.js' })).toBeNull();
  });

  it("should not count other namespaces' records as a non-empty target", async () => {
    await kit(repo(['0009-billing.js']), { namespace: 'billing-api' }).up();
    await seedMigrateMongo(['0001-a.js']);
    const result = await kit(repo(['0001-a.js']), { namespace: 'orders-api' }).import();
    expect(result.imported).toBe(1);
    expect(result.rows[0]?.batch).toBe(1);
  });

  it('should import everything when no namespace is set', async () => {
    await seedMigrateMongo(['0001-a.js', '0002-other-repo.js']);
    const result = await kit(repo(['0001-a.js'])).import();
    expect(result.imported).toBe(2);
    expect(result.notInRepo).toEqual([]);
  });
});

describe('safety check 4 — storage format', () => {
  const meta = () => mongo.db.collection<{ _id: string }>(META_COLLECTION);
  const collectionNames = async (): Promise<string[]> =>
    (await mongo.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);

  it('should record the storage format in _mmk_meta when a namespace is set', async () => {
    await kit(repo([]), { namespace: 'orders-api' }).connect();
    const marker = await meta().findOne({ _id: META_ID });
    expect(marker?.schemaVersion).toBe(STORAGE_FORMAT_VERSION);
    expect(typeof marker?.writtenBy).toBe('string');
    // Nothing but the lock ever lives in the lock collection.
    expect(await mongo.db.collection('_mmk_locks').countDocuments()).toBe(0);
  });

  it('should create no marker and no _mmk_meta collection without a namespace', async () => {
    const project = repo(['0001-a.js']);
    await kit(project).up();
    await kit(project).status();
    expect(await collectionNames()).not.toContain(META_COLLECTION);
  });

  it('should refuse a newer format even without a namespace, and stay disconnected', async () => {
    await meta().insertOne({
      _id: META_ID,
      schemaVersion: 99,
      writtenBy: '9.0.0',
      updatedAt: new Date(),
    });
    const migrator = kit(repo([]));
    const error = await migrator.connect().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SchemaTooNewError);
    expect((error as Error).message).toContain('last used by mongo-migrate-kit 9.0.0');
    // Not left half-connected: a retry checks again instead of skipping the guard.
    await expect(migrator.connect()).rejects.toBeInstanceOf(SchemaTooNewError);
    // Refused before the first write: the changelog index was never created.
    expect(await collectionNames()).not.toContain('_mmk_migrations');
  });

  it('should refresh an existing marker and rewrite a deleted one', async () => {
    await meta().insertOne({
      _id: META_ID,
      schemaVersion: STORAGE_FORMAT_VERSION,
      writtenBy: 'older',
      updatedAt: new Date(0),
    });
    await kit(repo([]), { namespace: 'orders-api' }).connect();
    expect((await meta().findOne({ _id: META_ID }))?.writtenBy).not.toBe('older');

    await meta().deleteOne({ _id: META_ID });
    await kit(repo([]), { namespace: 'orders-api' }).connect();
    expect((await meta().findOne({ _id: META_ID }))?.schemaVersion).toBe(STORAGE_FORMAT_VERSION);
  });
});
