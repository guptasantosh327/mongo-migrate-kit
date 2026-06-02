import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChecksumMismatchError, MigrationExecutionFailedError } from '../../src/errors/index.js';
import type { MigratorKit } from '../../src/core/migrator.js';
import { startTestMongo, type TestMongo } from '../helpers/mongo.js';
import { insertMigration, failingMigration, makeMigrator, makeProject } from '../helpers/project.js';

let mongo: TestMongo;
const DB = 'mmk_up_test';

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

describe('MigratorKit.up (integration)', () => {
  it('should run all pending migrations', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    const results = await migrator.up();
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should share one batch number across a run', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    const results = await migrator.up();
    expect(results[0]?.batch).toBe(1);
    expect(results[1]?.batch).toBe(1);
  });

  it('should run a single file by name', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    const results = await migrator.up('0001-a.ts');
    expect(results).toHaveLength(1);
    expect(results[0]?.file).toBe('0001-a.ts');
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should skip already-applied migrations on a second run', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const second = await migrator.up();
    expect(second).toEqual([]);
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should re-run an already-applied migration when force is true', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);

    const results = await migrator.up('0001-a.ts', { force: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('applied');
    // up() inserts again, so the marker doc count grows — proof it re-ran
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should re-run with force (not skip) even when the file checksum changed', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.tamper('0001-a.ts');

    // strict=false would normally skip an applied file with a changed checksum;
    // force overrides that and re-applies it instead.
    const results = await migrator.up('0001-a.ts', { force: true });
    expect(results[0]?.status).toBe('applied');
  });

  it('should warn and skip on checksum mismatch when strict=false', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.tamper('0001-a.ts');
    const results = await migrator.up('0001-a.ts');
    expect(results[0]?.status).toBe('skipped');
  });

  it('should throw on checksum mismatch when strict=true', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    await migrator.disconnect();
    project.tamper('0001-a.ts');
    const strict = makeMigrator(mongo.uri, DB, project.dir, { strict: true });
    await expect(strict.up('0001-a.ts')).rejects.toBeInstanceOf(ChecksumMismatchError);
    await strict.disconnect();
  });

  it('should stop the batch on the first error', async () => {
    setup();
    project.write('0001-ok.ts', insertMigration('things', 'ok'));
    project.write('0002-bad.ts', failingMigration());
    project.write('0003-never.ts', insertMigration('things', 'never'));
    await expect(migrator.up()).rejects.toBeInstanceOf(MigrationExecutionFailedError);
    // first applied, third never ran
    const applied = await migrator.list('applied');
    expect(applied.map((r) => r.file)).toEqual(['0001-ok.ts']);
  });

  it('should fire hooks in the correct order', async () => {
    project = makeProject();
    const calls: string[] = [];
    migrator = makeMigrator(mongo.uri, DB, project.dir, {
      hooks: {
        beforeAll: async () => {
          calls.push('beforeAll');
        },
        beforeEach: async (name) => {
          calls.push(`beforeEach:${name}`);
        },
        afterEach: async (name) => {
          calls.push(`afterEach:${name}`);
        },
        afterAll: async () => {
          calls.push('afterAll');
        },
      },
    });
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    expect(calls).toEqual([
      'beforeAll',
      'beforeEach:0001-a.ts',
      'afterEach:0001-a.ts',
      'afterAll',
    ]);
  });
});
