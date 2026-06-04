import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigratorKit } from '../../src/core/migrator.js';
import { MigrationExecutionFailedError } from '../../src/errors/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import {
  failingMigration,
  insertMigration,
  makeMigrator,
  makeProject,
} from '../helpers/project.js';

let mongo: TestMongo;
const DB = 'mmk_hooks_test';

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

describe('lifecycle hooks (integration)', () => {
  it('should fire onError when a migration fails', async () => {
    project = makeProject();
    const onError = vi.fn().mockResolvedValue(undefined);
    migrator = makeMigrator(mongo.uri, DB, project.dir, { hooks: { onError } });
    project.write('0001-bad.ts', failingMigration());
    await expect(migrator.up()).rejects.toBeInstanceOf(MigrationExecutionFailedError);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBe('0001-bad.ts');
  });

  it('should revert a specific batch with down({ batch })', async () => {
    project = makeProject();
    migrator = makeMigrator(mongo.uri, DB, project.dir);
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up();
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
    const results = await migrator.down(undefined, { batch: 1 });
    expect(results.map((r) => r.file)).toEqual(['0001-a.ts']);
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should skip the lock when noLock is true', async () => {
    project = makeProject();
    migrator = makeMigrator(mongo.uri, DB, project.dir);
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up(undefined, { noLock: true });
    expect(await mongo.db.collection('_mmk_locks').countDocuments()).toBe(0);
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });
});
