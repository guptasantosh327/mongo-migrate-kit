import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MigratorKit } from '../../src/core/migrator.js';
import { computeChecksum } from '../../src/utils/checksum.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';
import { makeRecord } from '../helpers/records.js';

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

describe('StatusRow.checksum (integration)', () => {
  it('should carry the checksum recorded when the file was applied', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const applied = computeChecksum(path.join(project.dir, '0001-a.ts'));
    await migrator.up();
    const [row] = await migrator.status();
    expect(row).toMatchObject({ status: 'applied', checksumOk: true, checksum: applied });
    expect(row?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should keep the recorded checksum after the file is edited', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const applied = computeChecksum(path.join(project.dir, '0001-a.ts'));
    await migrator.up();
    project.tamper('0001-a.ts');
    const [row] = await migrator.status();
    expect(row?.checksumOk).toBe(false);
    expect(row?.checksum).toBe(applied);
    expect(computeChecksum(path.join(project.dir, '0001-a.ts'))).not.toBe(applied);
  });

  it('should have no checksum on pending rows, including reverted ones', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up('0001-a.ts');
    await migrator.down('0001-a.ts');
    const rows = await migrator.status();
    expect(rows.map((row) => [row.status, 'checksum' in row])).toEqual([
      ['pending', false],
      ['pending', false],
    ]);
  });

  it('should be in list() and dry-run down rows too', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const applied = computeChecksum(path.join(project.dir, '0001-a.ts'));
    await migrator.up();
    expect((await migrator.list('applied'))[0]?.checksum).toBe(applied);
    expect((await migrator.dryRun('down'))[0]?.checksum).toBe(applied);
  });

  it('should be absent when the record has no checksum (an import without its file)', async () => {
    setup();
    await mongo.db
      .collection('_mmk_migrations')
      .insertOne(makeRecord({ name: '0001-gone.js', checksum: '', origin: 'migrate-mongo' }));
    const [row] = await migrator.status();
    expect(row).toMatchObject({ file: '0001-gone.js', status: 'applied', fileMissing: true });
    expect(row && 'checksum' in row).toBe(false);
  });
});
