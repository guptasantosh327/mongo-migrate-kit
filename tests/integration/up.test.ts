import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MigratorKit } from '../../src/core/migrator.js';
import {
  ChecksumMismatchError,
  MigrationExecutionFailedError,
  MigrationFileNotFoundError,
  MigrationInvalidExportError,
  MigrationInvalidNameError,
} from '../../src/errors/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import {
  failingMigration,
  insertMigration,
  makeMigrator,
  makeProject,
} from '../helpers/project.js';

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
  it('should explain a mistyped filename with the directory and a suggestion', async () => {
    setup();
    project.write('0001-add-users.ts', insertMigration('things', 'a'));
    const error = await migrator.up('0001-add-user.ts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationFileNotFoundError);
    const message = (error as Error).message;
    expect(message).toContain('0001-add-user.ts');
    expect(message).toContain(project.dir);
    expect(message).toContain('Did you mean "0001-add-users.ts"?');
    expect(message).toContain('Migrations in that directory: 0001-add-users.ts');
  });

  it('should say the directory is empty rather than suggest nothing', async () => {
    setup();
    const error = await migrator.up('nope.ts').catch((e: unknown) => e);
    expect((error as Error).message).toContain('no migration files yet');
  });

  it('should reject a path-traversing filename instead of loading outside the dir', async () => {
    setup();
    // A real secret a traversal could try to read/execute; it must never be touched.
    await expect(migrator.up('../../etc/passwd')).rejects.toBeInstanceOf(MigrationInvalidNameError);
    await expect(migrator.up('sub/dir/0001-a.ts')).rejects.toBeInstanceOf(
      MigrationInvalidNameError,
    );
    await expect(migrator.up('..')).rejects.toBeInstanceOf(MigrationInvalidNameError);
  });

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

  it('should give each file its own batch with step=true', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    project.write('0003-c.ts', insertMigration('things', 'c'));
    const results = await migrator.up(undefined, { step: true });
    expect(results.map((r) => r.batch)).toEqual([1, 2, 3]);
  });

  it('should continue step batch numbering after an earlier run', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    project.write('0002-b.ts', insertMigration('things', 'b'));
    project.write('0003-c.ts', insertMigration('things', 'c'));
    const results = await migrator.up(undefined, { step: true });
    expect(results.map((r) => r.batch)).toEqual([2, 3]);
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
    const error = await strict.up('0001-a.ts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChecksumMismatchError);
    const message = (error as Error).message;
    expect(message).toContain('"0001-a.ts" has changed since it was applied');
    expect(message).toContain('Applied checksum:');
    expect(message).toContain('On-disk checksum:');
    expect(message).toContain('mmk up 0001-a.ts --force');
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
    expect(calls).toEqual(['beforeAll', 'beforeEach:0001-a.ts', 'afterEach:0001-a.ts', 'afterAll']);
  });

  it('should record the service from the nearest package.json', async () => {
    setup(); // project dir lives under this repo, so its package.json is nearest
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const record = await mongo.db.collection('_mmk_migrations').findOne({ name: '0001-a.ts' });
    expect(record?.service).toBe('mongo-migrate-kit');
  });

  it('should record an explicit service over the detected one', async () => {
    project = makeProject();
    migrator = makeMigrator(mongo.uri, DB, project.dir, { service: 'orders-service' });
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    const record = await mongo.db.collection('_mmk_migrations').findOne({ name: '0001-a.ts' });
    expect(record?.service).toBe('orders-service');
  });

  // ── author ──────────────────────────────────────────────────────────────────
  /** insertMigration with an `author` export prepended */
  function authored(author: string, value: string): string {
    return `export const author = '${author}';\n${insertMigration('things', value)}`;
  }

  it('should copy the file author onto the changelog record and status row', async () => {
    setup();
    project.write('0001-a.ts', authored('Jane Doe <jane@example.com>', 'a'));
    await migrator.up();
    const record = await mongo.db.collection('_mmk_migrations').findOne({ name: '0001-a.ts' });
    expect(record?.author).toBe('Jane Doe <jane@example.com>');
    expect(record?.executedBy).toBeTruthy(); // who ran it stays separate from who wrote it
    const [row] = await migrator.status();
    expect(row?.author).toBe('Jane Doe <jane@example.com>');
  });

  it('should omit author from the record when the file declares none', async () => {
    setup();
    project.write('0001-a.ts', authored('', 'a'));
    await migrator.up();
    const record = await mongo.db.collection('_mmk_migrations').findOne({ name: '0001-a.ts' });
    expect(record).not.toBeNull();
    expect(record).not.toHaveProperty('author');
  });

  it('should refuse the whole run under requireAuthor, naming every file without an author', async () => {
    project = makeProject();
    migrator = makeMigrator(mongo.uri, DB, project.dir, { requireAuthor: true });
    project.write('0001-a.ts', authored('Jane', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    project.write('0003-c.ts', authored('  ', 'c'));

    const error = await migrator.up().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationInvalidExportError);
    const message = (error as Error).message;
    expect(message).toContain('2 migrations have no author');
    expect(message).toContain('0002-b.ts');
    expect(message).toContain('0003-c.ts');
    expect(message).not.toContain('0001-a.ts');
    expect(message).toContain('Nothing was applied');
    // The preflight runs before anything — not even the authored first file applied.
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
    expect(await mongo.db.collection('_mmk_migrations').countDocuments()).toBe(0);
  });

  it('should use the singular form when one file lacks an author', async () => {
    project = makeProject();
    migrator = makeMigrator(mongo.uri, DB, project.dir, { requireAuthor: true });
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const error = await migrator.up().catch((e: unknown) => e);
    expect((error as Error).message).toContain('A migration has no author');
  });

  it('should apply normally under requireAuthor when every file has an author', async () => {
    project = makeProject();
    migrator = makeMigrator(mongo.uri, DB, project.dir, { requireAuthor: true });
    project.write('0001-a.ts', authored('Jane', 'a'));
    project.write('0002-b.ts', authored('Raj', 'b'));
    const results = await migrator.up();
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
  });

  it('should not block on already-applied files that predate requireAuthor', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a')); // legacy, no author
    await migrator.up();
    await migrator.disconnect();

    migrator = makeMigrator(mongo.uri, DB, project.dir, { requireAuthor: true });
    project.write('0002-b.ts', authored('Jane', 'b'));
    const results = await migrator.up();
    expect(results.map((r) => r.status)).toEqual(['applied']);
  });

  it('should check an already-applied file under requireAuthor when it is forced', async () => {
    setup();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await migrator.up();
    await migrator.disconnect();

    migrator = makeMigrator(mongo.uri, DB, project.dir, { requireAuthor: true });
    await expect(migrator.up('0001-a.ts', { force: true })).rejects.toBeInstanceOf(
      MigrationInvalidExportError,
    );
  });
});
