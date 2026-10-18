import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Changelog } from '../../src/core/changelog.js';
import type { MigratorKit } from '../../src/core/migrator.js';
import { MigrationExecutionFailedError } from '../../src/errors/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';

let mongo: TestMongo;
const DB = 'mmk_redo_test';

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

describe('MigratorKit.redo (integration)', () => {
  it('should redo the last applied migration', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await migrator.up();
    const results = await migrator.redo();
    expect(results.map((r) => r.status)).toEqual(['reverted', 'applied']);
    expect(results.every((r) => r.file === '0002-b.ts')).toBe(true);
    // still applied afterwards
    const changelog = new Changelog('_mmk_migrations');
    const record = await changelog.getByName(mongo.db, '0002-b.ts');
    expect(record?.status).toBe('applied');
  });

  it('should redo a specific file', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const results = await migrator.redo('0001-a.ts');
    expect(results.map((r) => r.status)).toEqual(['reverted', 'applied']);
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should report nothing to redo when no migrations are applied', async () => {
    setup();
    const results = await migrator.redo();
    expect(results).toEqual([]);
  });

  it('should report the revert together with a failed re-apply in the error context', async () => {
    setup();
    // up() works the first time and fails once the flag exists; down() leaves the flag.
    project.write(
      '0001-a.ts',
      [
        'export async function up({ db }) {',
        "  if ((await db.collection('flags').countDocuments()) > 0) {",
        "    throw new Error('second up fails');",
        '  }',
        "  await db.collection('flags').insertOne({ ran: true });",
        '}',
        'export async function down() {}',
        '',
      ].join('\n'),
    );
    await migrator.up();
    const error = await migrator.redo('0001-a.ts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationExecutionFailedError);
    expect((error as MigrationExecutionFailedError).context?.results).toEqual([
      { file: '0001-a.ts', status: 'reverted', duration: expect.any(Number) },
      { file: '0001-a.ts', status: 'error', error: expect.stringContaining('second up fails') },
    ]);
  });
});
