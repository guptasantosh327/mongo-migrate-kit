import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigFileExistsError,
  ConfigInvalidError,
  MigrationFileNotFoundError,
} from '../../src/errors/index.js';
import {
  buildPrefix,
  configTemplateContent,
  createConfigFile,
  createMigrationFile,
  defaultConfigJs,
  defaultConfigJson,
  defaultConfigTs,
  defaultTemplateJs,
  defaultTemplateTs,
  nextSequenceIndex,
  resolveTemplateContent,
  secretConfigJs,
  secretConfigTs,
  slugify,
  toSingleQuoted,
} from '../../src/utils/template.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'mmk-template-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('slugify', () => {
  it('should kebab-case a mixed-case spaced name', () => {
    expect(slugify('Add Users Index')).toBe('add-users-index');
  });

  it('should strip leading and trailing separators', () => {
    expect(slugify('  __Hello!! World__  ')).toBe('hello-world');
  });
});

describe('buildPrefix', () => {
  it('should zero-pad sequential indexes to 4 digits', () => {
    expect(buildPrefix({ sequential: true, index: 7 })).toBe('0007');
  });

  it('should produce a 14-digit timestamp when not sequential', () => {
    expect(buildPrefix({ sequential: false, index: 1 })).toMatch(/^\d{14}$/);
  });
});

describe('nextSequenceIndex', () => {
  it('should return 1 for a missing directory', () => {
    expect(nextSequenceIndex(path.join(tmp, 'nope'), ['.ts', '.js'])).toBe(1);
  });

  it('should count existing migration files', () => {
    writeFileSync(path.join(tmp, '0001-a.ts'), '');
    writeFileSync(path.join(tmp, '0002-b.js'), '');
    writeFileSync(path.join(tmp, 'README.md'), '');
    expect(nextSequenceIndex(tmp, ['.ts', '.js'])).toBe(3);
  });
});

describe('default templates', () => {
  it('should include up and down in the TS template', () => {
    const tpl = defaultTemplateTs();
    expect(tpl).toContain('export async function up');
    expect(tpl).toContain('export async function down');
    expect(tpl).toContain('MigrationContext');
  });

  it('should include up and down in the JS template', () => {
    const tpl = defaultTemplateJs();
    expect(tpl).toContain('export async function up');
    expect(tpl).toContain('export async function down');
  });
});

describe('migration template author', () => {
  it('should write the given author into both built-in templates', () => {
    expect(defaultTemplateTs('Jane Doe <jane@example.com>')).toContain(
      "export const author = 'Jane Doe <jane@example.com>';",
    );
    expect(defaultTemplateJs('Jane Doe <jane@example.com>')).toContain(
      "export const author = 'Jane Doe <jane@example.com>';",
    );
  });

  it('should leave an empty author placeholder when none is known', () => {
    expect(defaultTemplateJs()).toContain("export const author = '';");
    expect(defaultTemplateTs()).toContain("export const author = '';");
  });

  it('should escape quotes, backslashes, and newlines so the file stays valid', () => {
    expect(toSingleQuoted("Conan O'Brien")).toBe("'Conan O\\'Brien'");
    expect(toSingleQuoted('a\\b')).toBe("'a\\\\b'");
    expect(toSingleQuoted('line1\nline2')).toBe("'line1 line2'");
  });

  it('should pass the author through createMigrationFile', () => {
    const file = createMigrationFile({
      dir: tmp,
      name: 'with author',
      sequential: true,
      js: true,
      author: 'Jane',
      moduleFormat: 'esm',
    });
    expect(readFileSync(file, 'utf8')).toContain("export const author = 'Jane';");
  });

  it('should write the author as an object property in CommonJS templates', () => {
    expect(defaultTemplateJs('Jane', 'cjs')).toContain("  author: 'Jane',");
    expect(defaultTemplateTs('Jane', 'cjs')).toContain("  author: 'Jane',");
    expect(defaultTemplateTs(undefined, 'cjs')).toContain("  author: '',");
  });

  it('should copy a custom template verbatim, without injecting an author', () => {
    const custom = path.join(tmp, 'custom-tpl.js');
    writeFileSync(custom, '// custom');
    expect(resolveTemplateContent(custom, true, 'Jane')).toBe('// custom');
  });
});

describe('resolveTemplateContent', () => {
  it('should read a custom template when provided', () => {
    const custom = path.join(tmp, 'my-template.ts');
    writeFileSync(custom, '// custom');
    expect(resolveTemplateContent(custom, false)).toBe('// custom');
  });

  it('should throw MigrationFileNotFoundError for a missing custom template', () => {
    expect(() => resolveTemplateContent(path.join(tmp, 'missing.ts'), false)).toThrow(
      MigrationFileNotFoundError,
    );
  });
});

describe('createMigrationFile', () => {
  it('should create a timestamped .ts file by default', () => {
    writeFileSync(path.join(tmp, 'package.json'), '{ "type": "module" }');
    const file = createMigrationFile({ dir: tmp, name: 'Add Index', sequential: false, js: false });
    expect(existsSync(file)).toBe(true);
    expect(file).toMatch(/\d{14}-add-index\.ts$/);
    expect(readFileSync(file, 'utf8')).toContain('export async function up');
  });

  it('should create a sequential .js file when requested', () => {
    const file = createMigrationFile({ dir: tmp, name: 'First', sequential: true, js: true });
    expect(file).toMatch(/0001-first\.js$/);
  });

  it('should write CommonJS when the nearest package.json is not "type": "module"', () => {
    writeFileSync(path.join(tmp, 'package.json'), '{ "type": "commonjs" }');
    const js = readFileSync(
      createMigrationFile({ dir: tmp, name: 'a', sequential: true, js: true }),
      'utf8',
    );
    const ts = readFileSync(
      createMigrationFile({ dir: tmp, name: 'b', sequential: true, js: false }),
      'utf8',
    );
    expect(js).toContain('module.exports = {');
    expect(js).not.toContain('export ');
    expect(ts).toContain('module.exports = {');
    expect(ts).not.toMatch(/^export /m);
  });

  it('should write an ES module when a closer package.json says "type": "module"', () => {
    writeFileSync(path.join(tmp, 'package.json'), '{ "type": "commonjs" }');
    const dir = path.join(tmp, 'migrations');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }');
    const file = createMigrationFile({ dir, name: 'a', sequential: true, js: true });
    expect(readFileSync(file, 'utf8')).toContain('export async function up');
  });

  it('should let an explicit moduleFormat override detection', () => {
    writeFileSync(path.join(tmp, 'package.json'), '{ "type": "module" }');
    const file = createMigrationFile({
      dir: tmp,
      name: 'a',
      sequential: true,
      js: true,
      moduleFormat: 'cjs',
    });
    expect(readFileSync(file, 'utf8')).toContain('module.exports = {');
  });
});

describe('CommonJS templates', () => {
  it('should export up, down and metadata through module.exports (JS)', () => {
    const tpl = defaultTemplateJs('Jane', 'cjs');
    expect(tpl).toContain('module.exports = {');
    expect(tpl).toContain("  description: '',");
    expect(tpl).toContain('  async up({ db }) {');
    expect(tpl).toContain('  async down({ db }) {');
    expect(tpl).not.toContain('export ');
    // Parses as a CommonJS script — no ESM syntax slipped in
    expect(() => new Script(tpl)).not.toThrow();
  });

  it('should keep only an erasable type import as ESM syntax (TS)', () => {
    const tpl = defaultTemplateTs('Jane', 'cjs');
    expect(tpl).toContain("import type { MigrationContext } from 'mongo-migrate-kit';");
    expect(tpl).toContain('  async up({ db }: MigrationContext): Promise<void> {');
    expect(tpl).not.toMatch(/^export /m);
  });

  it('should pass the module format through resolveTemplateContent', () => {
    expect(resolveTemplateContent(undefined, true, 'Jane', 'cjs')).toContain('module.exports');
    expect(resolveTemplateContent(undefined, false, 'Jane', 'cjs')).toContain('module.exports');
  });

  it('should export configs with module.exports', () => {
    expect(defaultConfigJs({}, 'cjs')).toContain('module.exports = config;');
    expect(defaultConfigJs({}, 'cjs')).not.toContain('export default');
    expect(() => new Script(defaultConfigJs({}, 'cjs'))).not.toThrow();
    expect(defaultConfigTs({}, 'cjs')).toContain('module.exports = config;');
    expect(defaultConfigTs({}, 'cjs')).not.toContain('export default');
  });

  it('should require the SDK in CommonJS secret-provider configs', () => {
    const js = secretConfigJs({}, 'cjs');
    expect(js).toContain("} = require('@aws-sdk/client-secrets-manager');");
    expect(js).toContain('module.exports = async () =>');
    expect(js).toContain(
      "const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');",
    );
    expect(js).not.toMatch(/^(import|export) /m);
    expect(() => new Script(js)).not.toThrow();

    const ts = secretConfigTs({}, 'cjs');
    expect(ts).toContain(
      "= require('@aws-sdk/client-secrets-manager') as typeof import('@aws-sdk/client-secrets-manager');",
    );
    expect(ts).toContain('module.exports = async (): Promise<Partial<MmkConfig>> =>');
    expect(ts).not.toMatch(/^export /m);
  });

  it('should pass the module format through configTemplateContent, except for JSON', () => {
    expect(configTemplateContent('js', {}, false, 'cjs')).toContain('module.exports');
    expect(configTemplateContent('ts', {}, false, 'cjs')).toContain('module.exports');
    expect(configTemplateContent('js', {}, true, 'cjs')).toContain('module.exports');
    expect(configTemplateContent('ts', {}, true, 'cjs')).toContain('module.exports');
    expect(configTemplateContent('json', {}, false, 'cjs')).toBe(defaultConfigJson());
  });
});

describe('config templates', () => {
  it('should fill the TS template with provided values and the MmkConfig type', () => {
    const tpl = defaultConfigTs({ uri: 'mongodb://db:1', dbName: 'shop' });
    expect(tpl).toContain("import type { MmkConfig } from 'mongo-migrate-kit'");
    expect(tpl).toContain("uri: 'mongodb://db:1'");
    expect(tpl).toContain("dbName: 'shop'");
    expect(tpl).toContain('export default config');
  });

  it('should fall back to defaults for omitted values', () => {
    const tpl = defaultConfigTs();
    expect(tpl).toContain("uri: 'mongodb://localhost:27017'");
    expect(tpl).toContain("dbName: 'myapp'");
    expect(tpl).toContain("migrationsDir: './migrations'");
  });

  it('should produce valid parseable JSON', () => {
    const parsed = JSON.parse(defaultConfigJson({ dbName: 'shop' }));
    expect(parsed.dbName).toBe('shop');
    expect(parsed.migrationsCollection).toBe('_mmk_migrations');
  });

  it('should dispatch on format', () => {
    expect(configTemplateContent('js')).toContain('const config = {');
    expect(configTemplateContent('json')).toContain('"lockTTLSeconds": 60');
    expect(configTemplateContent('ts')).toContain('Partial<MmkConfig>');
  });

  it('should seed createExtension to match the config file language', () => {
    expect(defaultConfigTs()).toContain("createExtension: 'ts'");
    expect(defaultConfigJs()).toContain("createExtension: 'js'");
  });

  it('should document the full set of options, not just the required ones', () => {
    const tpl = defaultConfigTs();
    for (const key of [
      'fileExtensions',
      'createExtension',
      'sequential',
      'templatePath',
      'lockTTLSeconds',
      'strict',
      'useTransaction',
      'hooks',
    ]) {
      expect(tpl).toContain(key);
    }
  });

  it('should document author and requireAuthor in every config template', () => {
    expect(defaultConfigJs()).toContain('requireAuthor: false');
    expect(defaultConfigJs()).toContain("// author: 'Jane Doe <jane@example.com>'");
    expect(defaultConfigTs()).toContain('requireAuthor: false');
    expect(JSON.parse(defaultConfigJson()).requireAuthor).toBe(false);
    expect(secretConfigJs()).toContain('requireAuthor: false');
  });

  it('should include createExtension in the JSON template', () => {
    expect(JSON.parse(defaultConfigJson()).createExtension).toBe('js');
  });
});

describe('secret-provider config templates', () => {
  it('should emit an async factory that fetches from a secret manager (JS)', () => {
    const tpl = secretConfigJs();
    expect(tpl).toContain('async function loadMongoSecret');
    expect(tpl).toContain('export default async () =>');
    expect(tpl).toContain('@aws-sdk/client-secrets-manager');
    expect(tpl).toContain('uri: secret.uri');
    expect(tpl).toContain("createExtension: 'js'");
  });

  it('should be provider-agnostic — document swapping AWS for another provider', () => {
    const tpl = secretConfigJs();
    expect(tpl).toContain('Provider-agnostic');
    expect(tpl).toContain('@google-cloud/secret-manager');
  });

  it('should emit a typed async factory for TS with the MmkConfig type', () => {
    const tpl = secretConfigTs();
    expect(tpl).toContain("import type { MmkConfig } from 'mongo-migrate-kit'");
    expect(tpl).toContain('async function loadMongoSecret(): Promise<{ uri: string');
    expect(tpl).toContain('Promise<Partial<MmkConfig>>');
    expect(tpl).toContain("createExtension: 'ts'");
  });

  it('should seed migrationsDir from provided values', () => {
    expect(secretConfigJs({ migrationsDir: './db/migrations' })).toContain(
      "migrationsDir: './db/migrations'",
    );
  });

  it('should dispatch to the secret template via configTemplateContent', () => {
    expect(configTemplateContent('js', {}, true)).toContain('loadMongoSecret');
    expect(configTemplateContent('ts', {}, true)).toContain('loadMongoSecret');
  });

  it('should throw ConfigInvalidError when secret-provider is requested for json', () => {
    expect(() => configTemplateContent('json', {}, true)).toThrow(ConfigInvalidError);
  });
});

describe('createConfigFile', () => {
  it('should match the export syntax to the package it is written into', () => {
    writeFileSync(path.join(tmp, 'package.json'), '{ "type": "module" }');
    const esm = createConfigFile({ dir: tmp, format: 'js', force: false });
    expect(readFileSync(esm, 'utf8')).toContain('export default config;');

    writeFileSync(path.join(tmp, 'package.json'), '{ "name": "app" }');
    const cjs = createConfigFile({ dir: tmp, format: 'js', force: true });
    expect(readFileSync(cjs, 'utf8')).toContain('module.exports = config;');

    const forced = createConfigFile({ dir: tmp, format: 'js', force: true, moduleFormat: 'esm' });
    expect(readFileSync(forced, 'utf8')).toContain('export default config;');
  });

  it('should write mmk.config.ts by default and return its path', () => {
    const file = createConfigFile({ dir: tmp, format: 'ts', force: false });
    expect(file).toBe(path.join(tmp, 'mmk.config.ts'));
    expect(readFileSync(file, 'utf8')).toContain('Partial<MmkConfig>');
  });

  it('should write mmk.config.json when format is json', () => {
    const file = createConfigFile({ dir: tmp, format: 'json', force: false });
    expect(file).toBe(path.join(tmp, 'mmk.config.json'));
  });

  it('should throw ConfigFileExistsError when the file exists without force', () => {
    createConfigFile({ dir: tmp, format: 'ts', force: false });
    expect(() => createConfigFile({ dir: tmp, format: 'ts', force: false })).toThrow(
      ConfigFileExistsError,
    );
  });

  it('should overwrite an existing file when force is true', () => {
    const file = createConfigFile({ dir: tmp, format: 'ts', force: false });
    writeFileSync(file, '// stale');
    createConfigFile({ dir: tmp, format: 'ts', force: true, values: { dbName: 'fresh' } });
    expect(readFileSync(file, 'utf8')).toContain("dbName: 'fresh'");
  });
});

describe('config templates — namespace', () => {
  it('should show namespace as a commented-out example when none is given', () => {
    for (const tpl of [defaultConfigJs(), defaultConfigTs(), secretConfigJs(), secretConfigTs()]) {
      expect(tpl).toContain("// namespace: 'my-repo',");
      expect(tpl).toContain(
        "Scopes this repo's migration history when several repos share this database",
      );
      expect(tpl).not.toMatch(/^\s*namespace:/m);
    }
  });

  it('should write a real namespace line when one is given', () => {
    for (const tpl of [
      defaultConfigJs({ namespace: 'orders-api' }),
      defaultConfigTs({ namespace: 'orders-api' }),
      secretConfigJs({ namespace: 'orders-api' }),
      secretConfigTs({ namespace: 'orders-api' }),
    ]) {
      expect(tpl).toMatch(/^\s*namespace: 'orders-api',$/m);
      expect(tpl).not.toContain("// namespace: 'my-repo',");
    }
  });

  it('should keep namespace out of a JSON config unless one is given', () => {
    expect(JSON.parse(defaultConfigJson())).not.toHaveProperty('namespace');
    expect(JSON.parse(defaultConfigJson({ namespace: 'orders-api' })).namespace).toBe('orders-api');
  });
});
