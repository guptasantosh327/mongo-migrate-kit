import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigFileExistsError, MigrationFileNotFoundError } from '../../src/errors/index.js';
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
  slugify,
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
    const file = createMigrationFile({ dir: tmp, name: 'Add Index', sequential: false, js: false });
    expect(existsSync(file)).toBe(true);
    expect(file).toMatch(/\d{14}-add-index\.ts$/);
    expect(readFileSync(file, 'utf8')).toContain('export async function up');
  });

  it('should create a sequential .js file when requested', () => {
    const file = createMigrationFile({ dir: tmp, name: 'First', sequential: true, js: true });
    expect(file).toMatch(/0001-first\.js$/);
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

  it('should include createExtension in the JSON template', () => {
    expect(JSON.parse(defaultConfigJson()).createExtension).toBe('js');
  });
});

describe('createConfigFile', () => {
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
