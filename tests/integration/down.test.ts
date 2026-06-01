import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotAppliedError } from '../../src/errors/index.js';
import { Changelog } from '../../src/core/changelog.js';
import type { MigratorKit } from '../../src/core/migrator.js';
import { startTestMongo, type TestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';

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
});
