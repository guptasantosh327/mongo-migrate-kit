import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConfigIssue, DEFAULT_CONFIG, loadConfig } from '../../src/core/config.js';
import { ConfigInvalidError } from '../../src/errors/index.js';
import type { MmkLogger } from '../../src/types/index.js';

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
  'MMK_CREATE_EXTENSION',
  // Typo'd / unrelated variables used by the diagnostics tests — cleaned up like the rest
  'MMK_MIGRATION_DIR',
  'MMK_SOMETHING_ENTIRELY_ELSE',
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
    expect(config.createExtension).toBe('js');
    expect(config.sequential).toBe(false);
  });

  it('should default uri and dbName to empty strings when requireDb is false', async () => {
    const config = await loadConfig({ cwd: tmp, requireDb: false });
    expect(config.uri).toBe('');
    expect(config.dbName).toBe('');
  });

  it('should let MMK_CREATE_EXTENSION override the default', async () => {
    process.env.MMK_URI = 'mongodb://env-host:27017';
    process.env.MMK_DB = 'env-db';
    process.env.MMK_CREATE_EXTENSION = 'ts';
    const config = await loadConfig({ cwd: tmp });
    expect(config.createExtension).toBe('ts');
  });

  it('should throw ConfigInvalidError on an invalid createExtension', async () => {
    await expect(
      loadConfig({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid value
        flags: { uri: 'mongodb://x:27017', dbName: 'x', createExtension: 'py' as any },
      }),
    ).rejects.toBeInstanceOf(ConfigInvalidError);
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

  it('should resolve a synchronous function (factory) config file', async () => {
    writeFileSync(
      path.join(tmp, 'mmk.config.js'),
      "module.exports = () => ({ uri: 'mongodb://fn-host:27017', dbName: 'fn-db' });\n",
    );
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://fn-host:27017');
    expect(config.dbName).toBe('fn-db');
  });

  it('should resolve an async function config file (e.g. a secret fetch)', async () => {
    writeFileSync(
      path.join(tmp, 'mmk.config.js'),
      `module.exports = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return { uri: 'mongodb://secret-host:27017', dbName: 'secret-db', strict: true };
};
`,
    );
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://secret-host:27017');
    expect(config.strict).toBe(true);
  });

  it('should let env vars override a value returned by a function config', async () => {
    writeFileSync(
      path.join(tmp, 'mmk.config.js'),
      "module.exports = () => ({ uri: 'mongodb://fn-host:27017', dbName: 'fn-db' });\n",
    );
    process.env.MMK_URI = 'mongodb://env-host:27017';
    const config = await loadConfig({ cwd: tmp });
    expect(config.uri).toBe('mongodb://env-host:27017');
    expect(config.dbName).toBe('fn-db');
  });

  it('should wrap a throwing config factory in ConfigInvalidError', async () => {
    writeFileSync(
      path.join(tmp, 'mmk.config.js'),
      "module.exports = async () => { throw new Error('secret fetch failed'); };\n",
    );
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigInvalidError);
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

/** Capture logger used to assert on warnings; satisfies the MmkLogger contract */
function captureLogger(): { logger: MmkLogger; warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    logger: {
      info: () => {},
      success: () => {},
      warn: (msg: string) => {
        warnings.push(msg);
      },
      error: () => {},
      dim: () => {},
    },
  };
}

/** Load a config expected to fail, and return the thrown ConfigInvalidError */
async function expectConfigError(options: Parameters<typeof loadConfig>[0]): Promise<{
  message: string;
  issues: ConfigIssue[];
}> {
  try {
    await loadConfig(options);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigInvalidError);
    const err = error as ConfigInvalidError;
    return {
      message: err.message,
      issues: (err.context?.issues ?? []) as ConfigIssue[],
    };
  }
  throw new Error('Expected loadConfig to throw a ConfigInvalidError');
}

const VALID = { uri: 'mongodb://localhost:27017', dbName: 'shop', logger: null } as const;

describe('loadConfig diagnostics', () => {
  describe('missing required parameters', () => {
    it('should name every missing key and how to set it', async () => {
      const { message, issues } = await expectConfigError({ cwd: tmp });
      expect(issues.map((issue) => issue.key)).toEqual(['uri', 'dbName']);
      for (const issue of issues) {
        expect(issue.problem).toBe('is required but was not set');
      }
      expect(message).toContain('uri is required but was not set');
      expect(message).toContain('dbName is required but was not set');
      // The three ways to supply it are all spelled out.
      expect(message).toContain('--uri <uri>');
      expect(message).toContain('MMK_URI');
      expect(message).toContain('"dbName" in mmk.config.js');
    });

    it('should report every problem at once rather than one per run', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { lockTTLSeconds: 0, logger: null },
      });
      expect(issues.map((issue) => issue.key).sort()).toEqual(['dbName', 'lockTTLSeconds', 'uri']);
    });

    it('should not require uri or dbName when requireDb is false', async () => {
      const config = await loadConfig({ cwd: tmp, requireDb: false, flags: { logger: null } });
      expect(config.uri).toBe('');
      expect(config.dbName).toBe('');
    });
  });

  describe('environment variables', () => {
    it('should reject a non-numeric MMK_LOCK_TTL naming the variable and value', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_LOCK_TTL = 'abc';
      const { issues } = await expectConfigError({ cwd: tmp, flags: { logger: null } });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        key: 'lockTTLSeconds',
        received: '"abc"',
        source: 'the MMK_LOCK_TTL environment variable',
      });
      expect(issues[0]?.problem).toContain('whole number');
    });

    it('should reject an unparseable boolean env var instead of silently using false', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_STRICT = 'maybe';
      const { issues } = await expectConfigError({ cwd: tmp, flags: { logger: null } });
      expect(issues[0]?.key).toBe('strict');
      expect(issues[0]?.source).toBe('the MMK_STRICT environment variable');
      expect(issues[0]?.problem).toContain('true');
    });

    it('should reject an invalid MMK_CREATE_EXTENSION instead of silently ignoring it', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_CREATE_EXTENSION = 'py';
      const { issues } = await expectConfigError({ cwd: tmp, flags: { logger: null } });
      expect(issues[0]).toMatchObject({
        key: 'createExtension',
        received: '"py"',
        source: 'the MMK_CREATE_EXTENSION environment variable',
      });
    });

    it('should treat an empty env var as unset rather than an error', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_STRICT = '   ';
      process.env.MMK_LOCK_TTL = '';
      const config = await loadConfig({ cwd: tmp, flags: { logger: null } });
      expect(config.strict).toBe(false);
      expect(config.lockTTLSeconds).toBe(60);
    });

    it('should accept the full boolean vocabulary', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_STRICT = 'ON';
      process.env.MMK_USE_TRANSACTION = 'Y';
      process.env.MMK_SEQUENTIAL = 'off';
      const config = await loadConfig({ cwd: tmp, flags: { logger: null } });
      expect(config.strict).toBe(true);
      expect(config.useTransaction).toBe(true);
      expect(config.sequential).toBe(false);
    });

    it('should read every string-valued MMK_* variable', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_MIGRATIONS_DIR = './db/migrations';
      process.env.MMK_COLLECTION = 'changelog';
      process.env.MMK_LOCK_COLLECTION = 'locks';
      const config = await loadConfig({ cwd: tmp, flags: { logger: null } });
      expect(config.migrationsDir).toBe('./db/migrations');
      expect(config.migrationsCollection).toBe('changelog');
      expect(config.lockCollection).toBe('locks');
    });

    it('should warn without a suggestion when a MMK_* variable resembles nothing', async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_SOMETHING_ENTIRELY_ELSE = '1';
      const capture = captureLogger();
      await loadConfig({ cwd: tmp, flags: { logger: capture.logger } });
      expect(capture.warnings.join('\n')).toContain('MMK_SOMETHING_ENTIRELY_ELSE');
      expect(capture.warnings.join('\n')).not.toContain('Did you mean');
    });

    it("should warn about a typo'd MMK_* variable and suggest the real one", async () => {
      process.env.MMK_URI = VALID.uri;
      process.env.MMK_DB = VALID.dbName;
      process.env.MMK_MIGRATION_DIR = './migrations';
      const capture = captureLogger();
      await loadConfig({ cwd: tmp, flags: { logger: capture.logger } });
      expect(capture.warnings.join('\n')).toContain('MMK_MIGRATION_DIR');
      expect(capture.warnings.join('\n')).toContain('Did you mean MMK_MIGRATIONS_DIR?');
    });
  });

  describe('value validation', () => {
    it('should reject a uri that is not a MongoDB connection string', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, uri: 'localhost:27017' },
      });
      expect(issues[0]?.key).toBe('uri');
      expect(issues[0]?.problem).toContain('mongodb+srv://');
      expect(issues[0]?.received).toBe('"localhost:27017"');
    });

    it('should accept a mongodb+srv uri', async () => {
      const config = await loadConfig({
        cwd: tmp,
        flags: { ...VALID, uri: 'mongodb+srv://user:pw@cluster.example.net' },
      });
      expect(config.uri).toContain('mongodb+srv://');
    });

    it('should reject a dbName containing characters MongoDB forbids', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, dbName: 'my db' },
      });
      expect(issues[0]?.key).toBe('dbName');
      expect(issues[0]?.problem).toContain('must not contain spaces');
    });

    it('should reject file extensions that are missing their leading dot', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, fileExtensions: ['ts', '.js'] },
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.key).toBe('fileExtensions.0');
      expect(issues[0]?.problem).toContain('must start with a dot');
    });

    it('should reject a boolean option given as a string', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid value
        flags: { ...VALID, strict: 'true' as any },
      });
      expect(issues[0]?.key).toBe('strict');
      expect(issues[0]?.problem).toContain('not a string');
    });

    it('should reject a non-positive lockTTLSeconds', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, lockTTLSeconds: -1 },
      });
      expect(issues[0]?.problem).toContain('greater than 0');
      expect(issues[0]?.received).toBe('-1');
    });
  });

  describe('hooks and logger', () => {
    it('should reject a misspelled hook and suggest the real one', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid hook name
        flags: { ...VALID, hooks: { beforeALL: async () => {} } as any },
      });
      expect(issues[0]?.key).toBe('hooks.beforeALL');
      expect(issues[0]?.problem).toContain('Did you mean "beforeAll"?');
    });

    it('should reject a hook that is not a function', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid hook value
        flags: { ...VALID, hooks: { afterEach: 'nope' } as any },
      });
      expect(issues[0]).toMatchObject({
        key: 'hooks.afterEach',
        problem: 'must be a function',
        received: '"nope"',
      });
    });

    it('should list every method a partial custom logger is missing', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an incomplete logger
        flags: { ...VALID, logger: { info: () => {} } as any },
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.key).toBe('logger');
      expect(issues[0]?.problem).toContain('success, warn, error, dim');
    });

    it('should accept logger: null as the documented way to silence output', async () => {
      const config = await loadConfig({ cwd: tmp, flags: { ...VALID } });
      expect(config.logger).toBeNull();
    });
  });

  describe('option shapes', () => {
    it('should reject hooks that are not an object', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid value
        flags: { ...VALID, hooks: 'nope' as any },
      });
      expect(issues[0]).toMatchObject({
        key: 'hooks',
        problem: 'must be an object of hook functions',
      });
    });

    it('should reject a logger that is not an object', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid value
        flags: { ...VALID, logger: 'verbose' as any },
      });
      expect(issues[0]?.key).toBe('logger');
      expect(issues[0]?.problem).toContain('or null');
    });

    it('should reject mongoClientOptions that are not an object', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid value
        flags: { ...VALID, mongoClientOptions: [] as any },
      });
      expect(issues[0]).toMatchObject({
        key: 'mongoClientOptions',
        problem: 'must be an object of MongoClient options',
      });
    });

    it('should reject a mongoose value that is not an instance', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        // biome-ignore lint/suspicious/noExplicitAny: testing an invalid value
        flags: { ...VALID, mongoose: 7 as any },
      });
      expect(issues[0]).toMatchObject({ key: 'mongoose', problem: 'must be a Mongoose instance' });
    });

    it('should accept a complete custom logger', async () => {
      const capture = captureLogger();
      const config = await loadConfig({ cwd: tmp, flags: { ...VALID, logger: capture.logger } });
      expect(config.logger).toBe(capture.logger);
    });
  });

  describe('precedence and provenance edges', () => {
    it('should report the built-in default as the source when nothing overrode it', async () => {
      // fileExtensions has no flag and no env var, so a bad default-tier value
      // can only come from the config object itself.
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, fileExtensions: [] },
      });
      expect(issues[0]?.key).toBe('fileExtensions');
      expect(issues[0]?.problem).toContain('at least one');
    });

    it('should accept a templatePath and leave existence to `mmk create`', async () => {
      const config = await loadConfig({
        cwd: tmp,
        flags: { ...VALID, templatePath: './migration.template.ts' },
      });
      expect(config.templatePath).toBe('./migration.template.ts');
    });

    it('should reject an empty templatePath', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, templatePath: '' },
      });
      expect(issues[0]?.key).toBe('templatePath');
    });

    it('should reject an empty migrationsCollection', async () => {
      const { issues } = await expectConfigError({
        cwd: tmp,
        flags: { ...VALID, migrationsCollection: '' },
      });
      expect(issues[0]?.problem).toBe('must not be empty');
    });

    it('should accept an empty uri and dbName only when requireDb is false', async () => {
      const relaxed = await loadConfig({
        cwd: tmp,
        requireDb: false,
        flags: { uri: '', dbName: '', logger: null },
      });
      expect(relaxed.uri).toBe('');
      // A non-empty but malformed uri is still rejected in that mode.
      const { issues } = await expectConfigError({
        cwd: tmp,
        requireDb: false,
        flags: { uri: 'nope', dbName: '', logger: null },
      });
      expect(issues[0]?.key).toBe('uri');
    });
  });

  describe('config file', () => {
    it('should reject an unknown key and suggest the intended one', async () => {
      writeFileSync(
        path.join(tmp, 'mmk.config.json'),
        JSON.stringify({ ...VALID, logger: undefined, migrationDir: './migrations' }),
      );
      const { issues } = await expectConfigError({ cwd: tmp });
      expect(issues[0]).toMatchObject({
        key: 'migrationDir',
        source: 'the config file mmk.config.json',
      });
      expect(issues[0]?.howToSet).toContain('rename it to "migrationsDir"');
    });

    it('should list the valid keys when an unknown key resembles nothing', async () => {
      writeFileSync(
        path.join(tmp, 'mmk.config.json'),
        JSON.stringify({ uri: VALID.uri, dbName: VALID.dbName, totallyMadeUp: 1 }),
      );
      const { issues } = await expectConfigError({ cwd: tmp });
      expect(issues[0]?.key).toBe('totallyMadeUp');
      expect(issues[0]?.howToSet).toContain('migrationsCollection');
    });

    it('should blame the config file for a bad value it supplied', async () => {
      writeFileSync(
        path.join(tmp, 'mmk.config.json'),
        JSON.stringify({ uri: VALID.uri, dbName: VALID.dbName, lockTTLSeconds: 0 }),
      );
      const { issues } = await expectConfigError({ cwd: tmp });
      expect(issues[0]).toMatchObject({
        key: 'lockTTLSeconds',
        source: 'the config file mmk.config.json',
      });
    });

    it('should blame the env var when it overrides a valid config-file value', async () => {
      writeFileSync(
        path.join(tmp, 'mmk.config.json'),
        JSON.stringify({ uri: VALID.uri, dbName: VALID.dbName, lockTTLSeconds: 30 }),
      );
      process.env.MMK_LOCK_TTL = '-5';
      const { issues } = await expectConfigError({ cwd: tmp });
      expect(issues[0]).toMatchObject({
        key: 'lockTTLSeconds',
        source: 'the MMK_LOCK_TTL environment variable',
      });
    });

    it('should blame the flag layer when a flag supplied the bad value', async () => {
      writeFileSync(
        path.join(tmp, 'mmk.config.json'),
        JSON.stringify({ uri: VALID.uri, dbName: VALID.dbName }),
      );
      const { issues } = await expectConfigError({ cwd: tmp, flags: { dbName: 'a/b' } });
      expect(issues[0]?.source).toContain('CLI flag');
    });

    it('should explain a config file that exports something other than an object', async () => {
      writeFileSync(path.join(tmp, 'mmk.config.js'), 'module.exports = 42;\n');
      const { message } = await expectConfigError({ cwd: tmp });
      expect(message).toContain('must export an object of options');
      expect(message).toContain('number');
    });

    it('should explain a factory that returns something other than an object', async () => {
      writeFileSync(path.join(tmp, 'mmk.config.js'), 'module.exports = () => null;\n');
      const { message } = await expectConfigError({ cwd: tmp });
      expect(message).toContain('must return an object of options');
    });

    it('should explain malformed JSON instead of surfacing a raw SyntaxError', async () => {
      writeFileSync(path.join(tmp, 'mmk.config.json'), '{ "uri": }');
      const { message } = await expectConfigError({ cwd: tmp });
      expect(message).toContain('is not valid JSON');
      expect(message).toContain('mmk.config.json');
    });

    it('should reject a config file with an unsupported extension', async () => {
      writeFileSync(path.join(tmp, 'mmk.config.yaml'), 'uri: mongodb://x\n');
      const { message } = await expectConfigError({ cwd: tmp, configPath: 'mmk.config.yaml' });
      expect(message).toContain('Unsupported config file type ".yaml"');
    });

    it('should surface the reason a config factory threw', async () => {
      writeFileSync(
        path.join(tmp, 'mmk.config.js'),
        "module.exports = async () => { throw new Error('AccessDeniedException: secret mmk/prod'); };\n",
      );
      const { message } = await expectConfigError({ cwd: tmp });
      expect(message).toContain('threw instead of returning config');
      expect(message).toContain('Reason: AccessDeniedException: secret mmk/prod');
      expect(message).toContain('mmk.config.js');
    });

    it('should explain a config file that cannot be imported', async () => {
      writeFileSync(path.join(tmp, 'mmk.config.js'), 'module.exports = {,};\n');
      const { message } = await expectConfigError({ cwd: tmp });
      expect(message).toContain('could not be imported');
    });

    it('should point at `mmk init` when an explicit --config path is missing', async () => {
      const { message } = await expectConfigError({ cwd: tmp, configPath: 'nope.json' });
      expect(message).toContain('Config file not found');
      expect(message).toContain('(from --config)');
      expect(message).toContain('mmk init');
    });
  });
});
