import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MigrationFileNotFoundError, MigrationInvalidExportError } from '../../src/errors/index.js';
import { loadMigrationFile } from '../../src/utils/loader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'fixtures', 'migrations');

describe('loadMigrationFile', () => {
  it('should load a TypeScript ESM migration with metadata', async () => {
    const mod = await loadMigrationFile(path.join(fixtures, 'valid-ts.ts'));
    expect(typeof mod.up).toBe('function');
    expect(typeof mod.down).toBe('function');
    expect(mod.useTransaction).toBe(true);
    expect(mod.description).toBe('A valid TypeScript migration');
  });

  it('should load a JavaScript ESM migration with named exports', async () => {
    const mod = await loadMigrationFile(path.join(fixtures, 'valid-esm.js'));
    expect(typeof mod.up).toBe('function');
    expect(typeof mod.down).toBe('function');
    expect(mod.useTransaction).toBeUndefined();
  });

  it('should load a CommonJS default-export migration', async () => {
    const mod = await loadMigrationFile(path.join(fixtures, 'valid-cjs.cjs'));
    expect(typeof mod.up).toBe('function');
    expect(typeof mod.down).toBe('function');
    expect(mod.useTransaction).toBe(false);
    expect(mod.description).toBe('A valid CommonJS migration');
  });

  it('should throw MigrationFileNotFoundError for a missing file', async () => {
    await expect(loadMigrationFile(path.join(fixtures, 'nope.ts'))).rejects.toBeInstanceOf(
      MigrationFileNotFoundError,
    );
  });

  it('should throw MigrationInvalidExportError when down() is missing', async () => {
    await expect(
      loadMigrationFile(path.join(fixtures, 'invalid-no-down.ts')),
    ).rejects.toBeInstanceOf(MigrationInvalidExportError);
  });
});
