import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Changelog } from '../../src/core/changelog.js';
import type { MigratorKit } from '../../src/core/migrator.js';
import {
  ConfigInvalidError,
  MigrationInvalidNameError,
  NotAppliedError,
} from '../../src/errors/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';
import { makeRecord } from '../helpers/records.js';

let mongo: TestMongo;
const DB = 'mmk_down_test';

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

describe('MigratorKit.down (integration)', () => {
  it('should refuse a path-traversing name even from a crafted applied record', async () => {
    setup();
    // Simulate a tampered changelog record whose name escapes the migrations dir.
    // The down preflight must reject it before loading/executing any file.
    const collection = new Changelog('_mmk_migrations');
    await migrator.connect();
    await collection.markApplied(mongo.db, makeRecord({ name: '../../evil.js', batch: 1 }));
    await expect(migrator.down('../../evil.js')).rejects.toBeInstanceOf(MigrationInvalidNameError);
  });

  it('should revert the last batch', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up();
    const results = await migrator.down();
    expect(results.every((r) => r.status === 'reverted')).toBe(true);
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
  });

  it('should revert a single file by name', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up();
    const results = await migrator.down('0001-a.ts');
    expect(results).toHaveLength(1);
    expect(results[0]?.file).toBe('0001-a.ts');
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should throw NotAppliedError when reverting an unapplied file', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await expect(migrator.down('0001-a.ts')).rejects.toBeInstanceOf(NotAppliedError);
  });

  it('should mark records reverted while preserving history', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    await migrator.down('0001-a.ts');
    const changelog = new Changelog('_mmk_migrations');
    const record = await changelog.getByName(mongo.db, '0001-a.ts');
    expect(record?.status).toBe('reverted');
    expect(record?.revertedAt).toBeInstanceOf(Date);
    expect(await mongo.db.collection('_mmk_migrations').countDocuments()).toBe(1);
  });

  it('should report nothing to rollback when no batch is applied', async () => {
    setup();
    const results = await migrator.down();
    expect(results).toEqual([]);
  });

  it('should revert the last N migrations with steps, newest first, ignoring batches', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    project.write('0003-c.ts', insertMigration('things', 'c'));
    // Two separate runs → batch 1 holds a, batch 2 holds b+c.
    await migrator.up('0001-a.ts');
    await migrator.up();
    const results = await migrator.down(undefined, { steps: 2 });
    expect(results.map((r) => r.file)).toEqual(['0003-c.ts', '0002-b.ts']);
    // 0001-a.ts (batch 1) is untouched even though steps crossed into batch 2.
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should revert just the last applied file with steps=1', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up();
    const results = await migrator.down(undefined, { steps: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]?.file).toBe('0002-b.ts');
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should clamp steps to the number of applied migrations', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const results = await migrator.down(undefined, { steps: 5 });
    expect(results).toHaveLength(1);
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
  });

  it('should reject steps combined with a filename', async () => {
    setup();
    await expect(migrator.down('0001-a.ts', { steps: 1 })).rejects.toBeInstanceOf(
      ConfigInvalidError,
    );
  });

  it('should reject steps combined with batch', async () => {
    setup();
    await expect(migrator.down(undefined, { steps: 1, batch: 1 })).rejects.toBeInstanceOf(
      ConfigInvalidError,
    );
  });

  it('should reject a non-positive steps value', async () => {
    setup();
    await expect(migrator.down(undefined, { steps: 0 })).rejects.toBeInstanceOf(ConfigInvalidError);
  });
});
