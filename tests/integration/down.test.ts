import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Changelog } from '../../src/core/changelog.js';
import type { MigratorKit } from '../../src/core/migrator.js';
import {
  ChecksumMismatchError,
  InvalidArgumentError,
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

  it('should explain a drifted file instead of only logging around the error', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.tamper('0001-a.ts');
    const error = await migrator.down().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChecksumMismatchError);
    const message = (error as Error).message;
    expect(message).toContain('0001-a.ts');
    expect(message).toContain('changed since being applied');
    expect(message).toContain('mmk down 0001-a.ts --force');
  });

  it('should name the rejected value when a filename is not a bare name', async () => {
    setup();
    const error = await migrator.down('../../etc/passwd').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationInvalidNameError);
    expect((error as Error).message).toContain('Received: "../../etc/passwd"');
    expect((error as Error).message).toContain('bare filename');
  });

  it('should list what is applied when rolling back an unapplied file', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const error = await migrator.down('0002-b.ts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAppliedError);
    const message = (error as Error).message;
    expect(message).toContain('0002-b.ts');
    expect(message).toContain('Currently applied: 0001-a.ts');
    expect(message).toContain('mmk status');
  });

  it('should reject an explicit batch that holds nothing, listing real batches', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const error = await migrator.down(undefined, { batch: 99 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidArgumentError);
    expect((error as Error).message).toContain('No applied migrations found in batch 99');
    expect((error as Error).message).toContain('Batches that still have applied migrations: 1');
  });

  it('should reject steps combined with a filename, explaining both options', async () => {
    setup();
    const error = await migrator.down('0001-a.ts', { steps: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidArgumentError);
    expect((error as Error).message).toContain('mmk down 0001-a.ts');
    expect((error as Error).message).toContain('mmk down --steps 1');
  });

  it('should reject steps combined with batch', async () => {
    setup();
    await expect(migrator.down(undefined, { steps: 1, batch: 1 })).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('should reject a non-positive steps value, naming what it received', async () => {
    setup();
    const error = await migrator.down(undefined, { steps: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidArgumentError);
    expect((error as Error).message).toContain('Received: 0');
  });

  it('should reject a filename combined with batch', async () => {
    setup();
    await expect(migrator.down('0001-a.ts', { batch: 1 })).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('should reject a non-positive batch', async () => {
    setup();
    await expect(migrator.down(undefined, { batch: 0 })).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('should refuse to roll back a file whose checksum drifted', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    // Rewrite the file (still valid up/down) so its checksum no longer matches.
    project.write('0001-a.ts', `${insertMigration('things', 'a')}// drifted\n`);
    await expect(migrator.down('0001-a.ts')).rejects.toBeInstanceOf(ChecksumMismatchError);
    // The preflight aborts before running anything — the record stays applied.
    expect(await migrator.down('0001-a.ts').catch(() => null)).toBeNull();
    expect((await new Changelog('_mmk_migrations').getByName(mongo.db, '0001-a.ts'))?.status).toBe(
      'applied',
    );
  });

  it('should roll back a drifted file when force is set', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.write('0001-a.ts', `${insertMigration('things', 'a')}// drifted\n`);
    const results = await migrator.down('0001-a.ts', { force: true });
    expect(results[0]?.status).toBe('reverted');
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
  });
});
