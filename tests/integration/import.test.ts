import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MigratorKit } from '../../src/core/migrator.js';
import {
  ImportTargetNotEmptyError,
  IrreversibleMigrationError,
} from '../../src/errors/index.js';
import type { MigrationRecord } from '../../src/types/index.js';
import { computeChecksum } from '../../src/utils/checksum.js';
import { startTestMongo, type TestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';
import { makeRecord } from '../helpers/records.js';

let mongo: TestMongo;
const DB = 'mmk_import_test';
const TARGET = '_mmk_migrations';

beforeAll(async () => {
  mongo = await startTestMongo(DB);
});

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.dropDatabase();
});

let project: ReturnType<typeof makeProject>;
let migrator: MigratorKit;

afterEach(async () => {
  await migrator?.disconnect();
  project?.cleanup();
});

function setup(): void {
  project = makeProject();
  migrator = makeMigrator(mongo.uri, DB, project.dir);
}

/** Seed a migrate-mongo style changelog collection */
async function seedChangelog(docs: Record<string, unknown>[]): Promise<void> {
  await mongo.db.collection('changelog').insertMany(docs);
}

function targetRecords(): Promise<MigrationRecord[]> {
  return mongo.db.collection<MigrationRecord>(TARGET).find().sort({ name: 1 }).toArray();
}

describe('MigratorKit.import (integration)', () => {
  it('should map migrate-mongo docs into the mmk changelog', async () => {
    setup();
    project.write('20260101000000-a.js', insertMigration('things', 'a'));
    await seedChangelog([
      {
        fileName: '20260101000000-a.js',
        appliedAt: new Date('2026-01-01T00:00:00Z'),
        migrationBlock: 100,
      },
    ]);

    const result = await migrator.import();
    expect(result.imported).toBe(1);
    expect(result.source).toBe('changelog');
    expect(result.target).toBe(TARGET);

    const records = await targetRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: '20260101000000-a.js',
      batch: 1,
      status: 'applied',
      duration: 0,
      environment: 'imported',
      executedBy: 'mmk-import',
    });
  });

  it('should give every migration a unique sequential batch in apply order', async () => {
    setup();
    await seedChangelog([
      { fileName: 'a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'b.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'c.js', appliedAt: new Date(), migrationBlock: 200 },
    ]);

    await migrator.import();
    const records = await targetRecords();
    const byName = new Map(records.map((r) => [r.name, r.batch]));
    expect(byName.get('a.js')).toBe(1);
    expect(byName.get('b.js')).toBe(2);
    expect(byName.get('c.js')).toBe(3);
  });

  it('should not duplicate batch ids when all entries share one migrationBlock and files are absent', async () => {
    setup();
    // Reproduces the reported case: a changelog applied in a single migrate-mongo
    // run (one shared migrationBlock), with none of the files present on disk.
    await seedChangelog([
      { fileName: 'a.js', appliedAt: new Date('2026-06-02T11:35:49.001Z'), migrationBlock: 1780400149448 },
      { fileName: 'b.js', appliedAt: new Date('2026-06-02T11:35:49.002Z'), migrationBlock: 1780400149448 },
      { fileName: 'c.js', appliedAt: new Date('2026-06-02T11:35:49.003Z'), migrationBlock: 1780400149448 },
    ]);

    await migrator.import();

    const batches = (await targetRecords()).map((r) => r.batch).sort((a, b) => a - b);
    expect(batches).toEqual([1, 2, 3]);
    expect(new Set(batches).size).toBe(batches.length);
  });

  it('should make imported migrations skip on a subsequent up()', async () => {
    setup();
    project.write('20260101000000-a.js', insertMigration('things', 'a'));
    await seedChangelog([
      { fileName: '20260101000000-a.js', appliedAt: new Date(), migrationBlock: 100 },
    ]);

    await migrator.import();
    const results = await migrator.up();
    expect(results).toEqual([]);
    // up() must NOT have re-run the migration
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
  });

  it('should reuse the fileHash when it matches the file on disk', async () => {
    setup();
    const body = insertMigration('things', 'a');
    project.write('20260101000000-a.js', body);
    const realHash = computeChecksum(`${project.dir}/20260101000000-a.js`);
    await seedChangelog([
      { fileName: '20260101000000-a.js', appliedAt: new Date(), fileHash: realHash },
    ]);

    const result = await migrator.import();
    expect(result.rows[0]?.checksumSource).toBe('reused');
    expect(result.rows[0]?.checksum).toBe(realHash);
  });

  it('should recompute the checksum when no matching fileHash is present', async () => {
    setup();
    project.write('20260101000000-a.js', insertMigration('things', 'a'));
    await seedChangelog([{ fileName: '20260101000000-a.js', appliedAt: new Date() }]);

    const result = await migrator.import();
    expect(result.rows[0]?.checksumSource).toBe('recomputed');
  });

  it('should still import a record whose file is missing on disk', async () => {
    setup();
    await seedChangelog([{ fileName: 'gone.js', appliedAt: new Date(), fileHash: 'h1' }]);

    const result = await migrator.import();
    expect(result.imported).toBe(1);
    expect(result.rows[0]?.checksumSource).toBe('reused');
    expect(result.rows[0]?.checksum).toBe('h1');
  });

  it('should skip source docs without a usable fileName', async () => {
    setup();
    await seedChangelog([
      { fileName: 'a.js', appliedAt: new Date() },
      { appliedAt: new Date() },
    ]);

    const result = await migrator.import();
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('should write to a custom target collection when "to" is given', async () => {
    setup();
    await seedChangelog([{ fileName: 'a.js', appliedAt: new Date() }]);

    const result = await migrator.import({ to: 'custom_changelog' });
    expect(result.target).toBe('custom_changelog');

    expect(await mongo.db.collection('custom_changelog').countDocuments()).toBe(1);
    // The default collection is left empty.
    expect(await mongo.db.collection(TARGET).countDocuments()).toBe(0);
  });

  it('should leave the source collection untouched', async () => {
    setup();
    await seedChangelog([{ fileName: 'a.js', appliedAt: new Date() }]);
    await migrator.import();
    expect(await mongo.db.collection('changelog').countDocuments()).toBe(1);
  });

  it('should not write anything in dry-run mode', async () => {
    setup();
    project.write('a.js', insertMigration('things', 'a'));
    await seedChangelog([{ fileName: 'a.js', appliedAt: new Date() }]);

    const result = await migrator.import({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(await mongo.db.collection(TARGET).countDocuments()).toBe(0);
  });

  it('should refuse a non-empty target without force', async () => {
    setup();
    await seedChangelog([{ fileName: 'a.js', appliedAt: new Date() }]);
    await migrator.import();
    // second seed + import should be blocked
    await mongo.db.collection('changelog').insertOne({ fileName: 'b.js', appliedAt: new Date() });
    await expect(migrator.import()).rejects.toBeInstanceOf(ImportTargetNotEmptyError);
  });

  it('should be idempotent when re-run with force', async () => {
    setup();
    await seedChangelog([
      { fileName: 'a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'b.js', appliedAt: new Date(), migrationBlock: 100 },
    ]);
    await migrator.import();
    await migrator.import({ force: true });
    expect(await mongo.db.collection(TARGET).countDocuments()).toBe(2);
  });

  it('should report nothing to import for an empty source', async () => {
    setup();
    const result = await migrator.import();
    expect(result).toMatchObject({ imported: 0, skipped: 0, rows: [] });
  });

  it('should tag imported records with origin=migrate-mongo', async () => {
    setup();
    await seedChangelog([{ fileName: 'a.js', appliedAt: new Date() }]);
    await migrator.import();
    const records = await targetRecords();
    expect(records[0]?.origin).toBe('migrate-mongo');
  });

  it('should refuse to down a single imported migration and leave it applied', async () => {
    setup();
    // No file on disk on purpose — the guard must fire before any file load/write.
    await seedChangelog([{ fileName: '20260101000000-a.js', appliedAt: new Date() }]);
    await migrator.import();

    await expect(migrator.down('20260101000000-a.js')).rejects.toBeInstanceOf(
      IrreversibleMigrationError,
    );

    // Record must be untouched — still applied, never marked reverted.
    const records = await targetRecords();
    expect(records[0]?.status).toBe('applied');
    expect(records[0]?.revertedAt).toBeUndefined();
  });

  it('should refuse a batch rollback that contains imported migrations', async () => {
    setup();
    await seedChangelog([
      { fileName: 'a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'b.js', appliedAt: new Date(), migrationBlock: 100 },
    ]);
    await migrator.import();

    await expect(migrator.down()).rejects.toBeInstanceOf(IrreversibleMigrationError);
    const records = await targetRecords();
    expect(records.every((r) => r.status === 'applied')).toBe(true);
  });

  it('should refuse redo of an imported migration', async () => {
    setup();
    await seedChangelog([{ fileName: 'a.js', appliedAt: new Date() }]);
    await migrator.import();
    await expect(migrator.redo('a.js')).rejects.toBeInstanceOf(IrreversibleMigrationError);
  });

  it('should continue batch numbering when the target already has records', async () => {
    setup();
    // A native migration already applied → batch 1 in the target.
    project.write('0001-native.js', insertMigration('things', 'n1'));
    await migrator.up();

    await seedChangelog([
      { fileName: 'mm-a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'mm-b.js', appliedAt: new Date(), migrationBlock: 200 },
    ]);
    await migrator.import({ force: true });

    const byName = new Map((await targetRecords()).map((r) => [r.name, r.batch]));
    expect(byName.get('0001-native.js')).toBe(1);
    // Imported batches continue after the existing max (1), not restart at 1.
    expect(byName.get('mm-a.js')).toBe(2);
    expect(byName.get('mm-b.js')).toBe(3);
  });

  it('should never produce duplicate batch numbers, even with prior records for missing files', async () => {
    setup();
    // Simulate already-applied migrations whose files are no longer on disk.
    await mongo.db
      .collection(TARGET)
      .insertMany([
        makeRecord({ name: 'gone-1.js', batch: 1 }),
        makeRecord({ name: 'gone-2.js', batch: 2 }),
      ]);

    await seedChangelog([
      { fileName: 'mm-a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'mm-b.js', appliedAt: new Date(), migrationBlock: 200 },
    ]);
    await migrator.import({ force: true });

    const batches = (await targetRecords()).map((r) => r.batch).sort((a, b) => a - b);
    expect(batches).toEqual([1, 2, 3, 4]);
    // No batch value appears more than once.
    expect(new Set(batches).size).toBe(batches.length);
  });

  it('should keep imported batch numbers stable on a forced re-import', async () => {
    setup();
    await seedChangelog([
      { fileName: 'a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'b.js', appliedAt: new Date(), migrationBlock: 200 },
    ]);
    await migrator.import();
    await migrator.import({ force: true });

    const batches = (await targetRecords()).map((r) => r.batch).sort((a, b) => a - b);
    // Re-importing the same set must not shift batches to 3,4.
    expect(batches).toEqual([1, 2]);
  });

  it('should ignore on-disk files that are not in the changelog and leave them pending', async () => {
    setup();
    // In changelog AND on disk:
    project.write('20260101000000-a.js', insertMigration('things', 'a'));
    project.write('20260101000001-b.js', insertMigration('things', 'b'));
    // New files on disk only — NOT in the source changelog:
    project.write('20260201000000-c.js', insertMigration('things', 'c'));
    project.write('20260201000001-d.js', insertMigration('things', 'd'));
    await seedChangelog([
      { fileName: '20260101000000-a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: '20260101000001-b.js', appliedAt: new Date(), migrationBlock: 100 },
    ]);

    const result = await migrator.import();

    // Only the two changelog files are imported.
    expect(result.imported).toBe(2);
    const importedNames = (await targetRecords()).map((r) => r.name);
    expect(importedNames).toEqual(['20260101000000-a.js', '20260101000001-b.js']);

    // The new files show as pending, not applied.
    const pending = (await migrator.list('pending')).map((r) => r.file);
    expect(pending).toEqual(['20260201000000-c.js', '20260201000001-d.js']);

    // up() runs only the new files; the imported ones are skipped.
    const upResults = await migrator.up();
    expect(upResults.map((r) => r.file)).toEqual([
      '20260201000000-c.js',
      '20260201000001-d.js',
    ]);
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });
});
