import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigratorKit } from '../../src/core/migrator.js';
import { ConfigInvalidError } from '../../src/errors/index.js';

const MMK_ENV_KEYS = ['MMK_URI', 'MMK_DB', 'MMK_MIGRATIONS_DIR', 'MMK_NAMESPACE'];

let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'mmk-describe-'));
  for (const key of MMK_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const key of MMK_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

/** A JSON config in a temp dir, passed explicitly so the repo's own config isn't discovered */
function configFile(contents: Record<string, unknown>): string {
  const file = path.join(tmp, 'mmk.config.json');
  writeFileSync(file, JSON.stringify(contents));
  return file;
}

describe('MigratorKit.describeConfig (in-process)', () => {
  it('should describe the resolved config, with absolute paths and where each value came from', async () => {
    const file = configFile({
      migrationsDir: 'db/migrations',
      namespace: 'billing-api',
      createExtension: 'ts',
    });
    process.env.MMK_DB = 'orders_dev';
    const kit = new MigratorKit(
      { uri: 'mongodb://alice:s3cret@db.example.com:27017', logger: null },
      { configPath: file },
    );

    expect(await kit.describeConfig()).toEqual({
      configFile: file,
      // Relative to the working directory, as every command resolves it
      migrationsDir: path.resolve('db/migrations'),
      fileExtensions: ['.ts', '.js'],
      createExtension: 'ts',
      sequential: false,
      migrationsCollection: '_mmk_migrations',
      lockCollection: '_mmk_locks',
      lockTTLSeconds: 60,
      strict: false,
      useTransaction: false,
      requireAuthor: false,
      namespace: 'billing-api',
      dbName: 'orders_dev',
      uri: 'mongodb://***:***@db.example.com:27017',
      sources: {
        migrationsDir: 'file',
        migrationsCollection: 'default',
        lockCollection: 'default',
        lockTTLSeconds: 'default',
        strict: 'default',
        useTransaction: 'default',
        fileExtensions: 'default',
        createExtension: 'file',
        sequential: 'default',
        requireAuthor: 'default',
        namespace: 'file',
        dbName: 'env',
        uri: 'flag',
      },
    });
  });

  it('should report a missing connection as null instead of refusing', async () => {
    const summary = await new MigratorKit(
      { logger: null },
      { configPath: configFile({}) },
    ).describeConfig();
    expect(summary.uri).toBeNull();
    expect(summary.dbName).toBeNull();
    expect(summary.sources.uri).toBeUndefined();
    expect(summary).not.toHaveProperty('namespace');
  });

  it('should still refuse to connect without a uri after describing the config', async () => {
    const kit = new MigratorKit({ logger: null }, { configPath: configFile({}) });
    await kit.describeConfig();
    await expect(kit.connect()).rejects.toBeInstanceOf(ConfigInvalidError);
  });

  it('should describe the config a command has already resolved', async () => {
    const kit = new MigratorKit(
      { uri: 'mongodb://localhost:27017', dbName: 'app', logger: null },
      { configPath: configFile({ namespace: 'shared' }) },
    );
    await kit.resolveConfig();
    expect(await kit.describeConfig()).toMatchObject({ namespace: 'shared', dbName: 'app' });
  });

  it('should include the author and an absolute template path when they are set', async () => {
    const summary = await new MigratorKit(
      { logger: null },
      { configPath: configFile({ author: 'Jane Doe', templatePath: 'templates/migration.js' }) },
    ).describeConfig();
    expect(summary.author).toBe('Jane Doe');
    expect(summary.templatePath).toBe(path.resolve('templates/migration.js'));
  });
});
