import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MigratorKit } from '../../src/core/migrator.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';

let mongo: TestMongo;
const DB = 'mmk_status_test';

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

describe('MigratorKit.status (integration)', () => {
  it('should report checksumOk=true for unchanged applied files', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const rows = await migrator.status();
    expect(rows[0]?.status).toBe('applied');
    expect(rows[0]?.checksumOk).toBe(true);
  });

  it('should report checksumOk=false for tampered applied files', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.tamper('0001-a.ts');
    const rows = await migrator.status();
    expect(rows[0]?.checksumOk).toBe(false);
  });

  it('should report checksumOk=null for pending files', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const rows = await migrator.status();
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.checksumOk).toBeNull();
  });

  it('should filter applied and pending via list()', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up('0001-a.ts');
    expect((await migrator.list('applied')).map((r) => r.file)).toEqual(['0001-a.ts']);
    expect((await migrator.list('pending')).map((r) => r.file)).toEqual(['0002-b.ts']);
    expect(await migrator.list('all')).toHaveLength(2);
  });
});
