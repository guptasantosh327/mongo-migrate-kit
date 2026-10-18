import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pendingMigrations } from '../../src/core/run.js';
import { META_COLLECTION } from '../../src/core/storage-format.js';
import { ConnectionFailedError } from '../../src/errors/index.js';
import { insertMigration, makeMigrator, makeProject } from '../helpers/project.js';

/**
 * Read commands connect without writing (request R3 from the VS Code extension), so staging
 * and prod can be read with a user that has only the `read` role. Write commands still
 * prepare the database (changelog index, storage marker) on connect, as before.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, '..', '..', 'bin', 'mmk.ts');

const DB = 'mmk_read_only';
const ROOT = { user: 'root', password: 'root-pw' };
const READER = { user: 'reader', password: 'reader-pw' };

let server: MongoMemoryServer;
let admin: MongoClient;
let project: ReturnType<typeof makeProject>;

/** A connection string for `credentials` on the test server */
function uriFor(credentials: { user: string; password: string }, authSource: string): string {
  const { host, port } = new URL(server.getUri());
  return `mongodb://${credentials.user}:${credentials.password}@${host || `127.0.0.1:${port}`}/?authSource=${authSource}`;
}

const rootUri = (): string => uriFor(ROOT, 'admin');
const readerUri = (): string => uriFor(READER, DB);

async function collectionNames(): Promise<string[]> {
  const collections = await admin.db(DB).listCollections({}, { nameOnly: true }).toArray();
  return collections.map((collection) => collection.name).sort();
}

async function changelogIndexes(): Promise<string[]> {
  return (await admin.db(DB).collection('_mmk_migrations').indexes()).map((index) => index.name);
}

/** Run the CLI under tsx and capture its result */
function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', binPath, ...args], {
      env: { ...process.env, MMK_URI: '', MMK_DB: '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.stdin.end();
  });
}

beforeAll(async () => {
  server = await MongoMemoryServer.create({
    auth: {
      enable: true,
      customRootName: ROOT.user,
      customRootPwd: ROOT.password,
      extraUsers: [
        {
          createUser: READER.user,
          pwd: READER.password,
          roles: [{ role: 'read', db: DB }],
          database: DB,
        },
      ],
    },
  });
  admin = new MongoClient(rootUri());
  await admin.connect();
}, 60_000);

afterAll(async () => {
  await admin?.close();
  await server?.stop();
});

beforeEach(async () => {
  await admin.db(DB).dropDatabase();
  project = makeProject();
  project.write('0001-a.js', insertMigration('items', 'a'));
  project.write('0002-b.js', insertMigration('items', 'b'));
});

afterEach(() => {
  project?.cleanup();
});

describe('read commands with a read-only user', () => {
  beforeEach(async () => {
    // A writer applies the first migration, as a deploy would.
    await makeMigrator(rootUri(), DB, project.dir).up('0001-a.js');
  });

  it('should read status, list, dry-run and every namespace', async () => {
    const reader = makeMigrator(readerUri(), DB, project.dir);
    try {
      const status = await reader.status();
      expect(status.map((row) => [row.file, row.status, row.checksumOk])).toEqual([
        ['0001-a.js', 'applied', true],
        ['0002-b.js', 'pending', null],
      ]);
      expect((await reader.list('pending')).map((row) => row.file)).toEqual(['0002-b.js']);
      expect((await reader.list('applied')).map((row) => row.file)).toEqual(['0001-a.js']);
      expect((await reader.dryRun('up')).map((row) => row.file)).toEqual(['0002-b.js']);
      expect((await reader.dryRun('down')).map((row) => row.file)).toEqual(['0001-a.js']);
      expect((await reader.statusAllNamespaces()).map((row) => row.file)).toEqual(['0001-a.js']);
      expect(await reader.lockInfo()).toBeNull();
    } finally {
      await reader.disconnect();
    }
  });

  it('should read with a namespace without writing the storage marker', async () => {
    await admin.db(DB).dropDatabase();
    await makeMigrator(rootUri(), DB, project.dir, { namespace: 'orders-api' }).up('0001-a.js');
    await admin.db(DB).collection(META_COLLECTION).deleteMany({});

    const reader = makeMigrator(readerUri(), DB, project.dir, { namespace: 'orders-api' });
    try {
      const rows = await reader.status();
      expect(rows.map((row) => [row.file, row.status, row.namespace])).toEqual([
        ['0001-a.js', 'applied', 'orders-api'],
        ['0002-b.js', 'pending', 'orders-api'],
      ]);
    } finally {
      await reader.disconnect();
    }
    expect(await admin.db(DB).collection(META_COLLECTION).countDocuments()).toBe(0);
  });

  it('should answer pendingMigrations()', async () => {
    const pending = await pendingMigrations({
      uri: readerUri(),
      dbName: DB,
      migrationsDir: project.dir,
      logger: null,
    });
    expect(pending.map((row) => row.file)).toEqual(['0002-b.js']);
  });

  it('should still refuse a write command: it needs to create the changelog index', async () => {
    const reader = makeMigrator(readerUri(), DB, project.dir);
    try {
      const error = await reader.up().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConnectionFailedError);
      expect((error as Error).message).toContain('not authorized');
    } finally {
      await reader.disconnect();
    }
    expect((await admin.db(DB).collection('items').find().toArray()).length).toBe(1);
  });

  it('should refuse a write command with a namespace as CONNECTION_FAILED', async () => {
    // With a namespace the first write on connect is the storage marker, not the index.
    const reader = makeMigrator(readerUri(), DB, project.dir, { namespace: 'orders-api' });
    try {
      const error = await reader.up().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConnectionFailedError);
      expect((error as Error).message).toContain('not authorized');
    } finally {
      await reader.disconnect();
    }
    expect((await admin.db(DB).collection('items').find().toArray()).length).toBe(1);
  });

  it('should run the read commands from the CLI, with and without --json', async () => {
    const base = ['--uri', readerUri(), '--db', DB, '--dir', project.dir];

    const status = await runCli(['status', '--json', ...base]);
    expect(status.code, status.stderr).toBe(0);
    expect(
      (JSON.parse(status.stdout) as Array<{ file: string; status: string }>).map((row) => [
        row.file,
        row.status,
      ]),
    ).toEqual([
      ['0001-a.js', 'applied'],
      ['0002-b.js', 'pending'],
    ]);

    // Without --json the CLI connects before the command, behind its spinner.
    const table = await runCli(['status', ...base]);
    expect(table.code, table.stderr).toBe(0);
    expect(table.stdout).toContain('0002-b.js');

    const list = await runCli(['list', '--pending', '--json', ...base]);
    expect(list.code, list.stderr).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(1);

    const dryRun = await runCli(['dry-run', 'up', ...base]);
    expect(dryRun.code, dryRun.stderr).toBe(0);

    const all = await runCli(['status', '--all-namespaces', '--json', ...base]);
    expect(all.code, all.stderr).toBe(0);
    expect(JSON.parse(all.stdout)).toHaveLength(1);
  }, 60_000);
});

describe('what connecting writes', () => {
  it('should create nothing when only read commands run on a new database', async () => {
    const migrator = makeMigrator(rootUri(), DB, project.dir, { namespace: 'orders-api' });
    try {
      await migrator.status();
      await migrator.list('pending');
      await migrator.dryRun('up');
      await migrator.statusAllNamespaces();
    } finally {
      await migrator.disconnect();
    }
    expect(await collectionNames()).toEqual([]);
  });

  it('should prepare for writes when a write command follows a read on one connection', async () => {
    const migrator = makeMigrator(rootUri(), DB, project.dir, { namespace: 'orders-api' });
    try {
      await migrator.status();
      expect(await collectionNames()).toEqual([]);
      await migrator.up();
    } finally {
      await migrator.disconnect();
    }
    expect(await collectionNames()).toEqual(
      ['_mmk_locks', META_COLLECTION, '_mmk_migrations', 'items'].sort(),
    );
    expect(await changelogIndexes()).toContain('name_1');
  });

  it('should create the changelog index on a plain connect(), as before', async () => {
    const migrator = makeMigrator(rootUri(), DB, project.dir);
    try {
      await migrator.connect();
    } finally {
      await migrator.disconnect();
    }
    expect(await changelogIndexes()).toContain('name_1');
  });

  it('should prepare again after reconnecting', async () => {
    const migrator = makeMigrator(rootUri(), DB, project.dir);
    try {
      await migrator.connect();
      await migrator.disconnect();
      await admin.db(DB).dropDatabase();
      await migrator.connect();
    } finally {
      await migrator.disconnect();
    }
    expect(await changelogIndexes()).toContain('name_1');
  });
});
