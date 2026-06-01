import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../../src/core/config.js';
import { ConfigInvalidError } from '../../src/errors/index.js';

const MMK_ENV_KEYS = [
  'MMK_URI',
  'MMK_DB',
  'MMK_MIGRATIONS_DIR',
  'MMK_COLLECTION',
  'MMK_LOCK_COLLECTION',
  'MMK_LOCK_TTL',
  'MMK_STRICT',
  'MMK_USE_TRANSACTION',
  'MMK_SEQUENTIAL',
];

let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'mmk-config-'));
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

describe('loadConfig', () => {
  it('should apply defaults when only required fields are provided', async () => {
    const config = await loadConfig({
      cwd: tmp,
      flags: { uri: 'mongodb://localhost:27017', dbName: 'test' },
    });
    expect(config.migrationsDir).toBe(DEFAULT_CONFIG.migrationsDir);
    expect(config.migrationsCollection).toBe('_mmk_migrations');
    expect(config.lockCollection).toBe('_mmk_locks');
    expect(config.lockTTLSeconds).toBe(60);
    expect(config.strict).toBe(false);
    expect(config.useTransaction).toBe(false);
    expect(config.fileExtensions).toEqual(['.ts', '.js']);
    expect(config.sequential).toBe(false);
  });

  it('should work entirely from env vars with no config file', async () => {
    process.env.MMK_URI = 'mongodb://env-host:27017';
    process.env.MMK_DB = 'env-db';
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://env-host:27017');
    expect(config.dbName).toBe('env-db');
  });

  it('should let CLI flags override env vars', async () => {
    process.env.MMK_URI = 'mongodb://env-host:27017';
    process.env.MMK_DB = 'env-db';
    const config = await loadConfig({
      cwd: tmp,
      flags: { uri: 'mongodb://flag-host:27017' },
    });
    expect(config.uri).toBe('mongodb://flag-host:27017');
    expect(config.dbName).toBe('env-db');
  });

  it('should let env vars override config file', async () => {
    writeFileSync(
      path.join(tmp, 'mmk.config.json'),
      JSON.stringify({ uri: 'mongodb://file-host:27017', dbName: 'file-db' }),
    );
    process.env.MMK_DB = 'env-db';
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://file-host:27017');
    expect(config.dbName).toBe('env-db');
  });

  it('should treat the config file as optional', async () => {
    process.env.MMK_URI = 'mongodb://env-host:27017';
    process.env.MMK_DB = 'env-db';
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://env-host:27017');
  });

  it('should load values from a JSON config file', async () => {
    writeFileSync(
      path.join(tmp, 'mmk.config.json'),
      JSON.stringify({
        uri: 'mongodb://file-host:27017',
        dbName: 'file-db',
        lockTTLSeconds: 120,
        strict: true,
      }),
    );
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://file-host:27017');
    expect(config.lockTTLSeconds).toBe(120);
    expect(config.strict).toBe(true);
  });

  it('should honor an explicit configPath over auto-discovery', async () => {
    const explicit = path.join(tmp, 'custom.config.json');
    writeFileSync(explicit, JSON.stringify({ uri: 'mongodb://x:27017', dbName: 'x' }));
    const config = await loadConfig({ cwd: tmp, configPath: 'custom.config.json' });
    expect(config.dbName).toBe('x');
  });

  it('should throw ConfigInvalidError when required fields are missing', async () => {
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigInvalidError);
  });

  it('should throw ConfigInvalidError when lockTTLSeconds is not positive', async () => {
    await expect(
      loadConfig({
        cwd: tmp,
        flags: { uri: 'mongodb://x:27017', dbName: 'x', lockTTLSeconds: -1 },
      }),
    ).rejects.toBeInstanceOf(ConfigInvalidError);
  });

  it('should throw ConfigInvalidError when configPath does not exist', async () => {
    await expect(
      loadConfig({ cwd: tmp, configPath: 'does-not-exist.json' }),
    ).rejects.toBeInstanceOf(ConfigInvalidError);
  });

  it('should parse boolean env vars', async () => {
    process.env.MMK_URI = 'mongodb://env-host:27017';
    process.env.MMK_DB = 'env-db';
    process.env.MMK_STRICT = 'true';
    process.env.MMK_USE_TRANSACTION = '1';
    process.env.MMK_SEQUENTIAL = 'no';
    const config = await loadConfig({ cwd: tmp });
    expect(config.strict).toBe(true);
    expect(config.useTransaction).toBe(true);
    expect(config.sequential).toBe(false);
  });

  it('should load env vars from a .env file via dotenv', async () => {
    writeFileSync(
      path.join(tmp, '.env'),
      'MMK_URI=mongodb://dotenv-host:27017\nMMK_DB=dotenv-db\n',
    );
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://dotenv-host:27017');
    expect(config.dbName).toBe('dotenv-db');
  });
});
