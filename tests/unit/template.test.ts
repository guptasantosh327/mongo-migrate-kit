import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationFileNotFoundError } from '../../src/errors/index.js';
import {
  buildPrefix,
  defaultTemplateJs,
  defaultTemplateTs,
  nextSequenceIndex,
  resolveTemplateContent,
  scaffoldMigration,
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

describe('scaffoldMigration', () => {
  it('should create a timestamped .ts file by default', () => {
    const file = scaffoldMigration({ dir: tmp, name: 'Add Index', sequential: false, js: false });
    expect(existsSync(file)).toBe(true);
    expect(file).toMatch(/\d{14}-add-index\.ts$/);
    expect(readFileSync(file, 'utf8')).toContain('export async function up');
  });

  it('should create a sequential .js file when requested', () => {
    const file = scaffoldMigration({ dir: tmp, name: 'First', sequential: true, js: true });
    expect(file).toMatch(/0001-first\.js$/);
  });
});
