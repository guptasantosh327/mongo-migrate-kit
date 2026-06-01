import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MigratorKit } from '../../src/core/migrator.js';
import { startTestMongo, type TestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';

let mongo: TestMongo;
const DB = 'mmk_dryrun_test';

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

describe('MigratorKit.dryRun (integration)', () => {
  it('should list pending migrations for up without touching the DB', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    const rows = await migrator.dryRun('up');
    expect(rows.map((r) => r.file)).toEqual(['0001-a.ts', '0002-b.ts']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
    expect(await mongo.db.collection('_mmk_migrations').countDocuments()).toBe(0);
  });

  it('should list the last batch for down', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const rows = await migrator.dryRun('down');
    expect(rows.map((r) => r.file)).toEqual(['0001-a.ts']);
  });

  it('should leave DB state unchanged after a dry-run', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const before = await mongo.db.collection('things').countDocuments();
    await migrator.dryRun('up');
    await migrator.dryRun('down');
    const after = await mongo.db.collection('things').countDocuments();
    expect(after).toBe(before);
  });
});
