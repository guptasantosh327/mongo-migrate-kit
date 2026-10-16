import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MigrationFileNotFoundError, MigrationInvalidExportError } from '../../src/errors/index.js';
import {
  formatMismatchErrorOrNull,
  isTypeScriptLoadFailure,
  loadMigrationFile,
  tsLoadErrorOrNull,
} from '../../src/utils/loader.js';

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

  it('should name the missing export, the file, and the expected shape', async () => {
    const error = await loadMigrationFile(path.join(fixtures, 'invalid-no-down.ts')).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MigrationInvalidExportError);
    const message = (error as Error).message;
    expect(message).toContain('invalid-no-down.ts');
    expect(message).toContain('down() is missing');
    // The exports that ARE there are listed, so the author can see what loaded.
    expect(message).toContain('up');
    expect(message).toContain('export async function down');
  });

  it('should say which export is the wrong type rather than just "missing"', async () => {
    const file = path.join(fixtures, 'invalid-down-not-a-function.cjs');
    writeFileSync(file, "module.exports = { async up() {}, down: 'nope' };\n");
    try {
      const error = await loadMigrationFile(file).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MigrationInvalidExportError);
      expect((error as Error).message).toContain('down is a string, not a function');
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('should read a trimmed author export', async () => {
    const file = path.join(fixtures, 'tmp-with-author.cjs');
    writeFileSync(
      file,
      "module.exports = { author: '  Jane <j@x.io> ', async up() {}, async down() {} };\n",
    );
    try {
      expect((await loadMigrationFile(file)).author).toBe('Jane <j@x.io>');
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('should treat a blank or non-string author as no author', async () => {
    const blank = path.join(fixtures, 'tmp-blank-author.cjs');
    const numeric = path.join(fixtures, 'tmp-numeric-author.cjs');
    writeFileSync(blank, "module.exports = { author: '  ', async up() {}, async down() {} };\n");
    writeFileSync(numeric, 'module.exports = { author: 42, async up() {}, async down() {} };\n');
    try {
      expect((await loadMigrationFile(blank)).author).toBeUndefined();
      expect((await loadMigrationFile(numeric)).author).toBeUndefined();
    } finally {
      rmSync(blank, { force: true });
      rmSync(numeric, { force: true });
    }
  });

  it('should name the path it looked for when the file does not exist', async () => {
    const missing = path.join(fixtures, 'does-not-exist.js');
    const error = await loadMigrationFile(missing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationFileNotFoundError);
    expect((error as Error).message).toContain('does-not-exist.js');
    expect((error as Error).message).toContain(missing);
  });

  it('should throw MigrationInvalidExportError when down() is missing', async () => {
    await expect(
      loadMigrationFile(path.join(fixtures, 'invalid-no-down.ts')),
    ).rejects.toBeInstanceOf(MigrationInvalidExportError);
  });

  it('should rethrow a non-TypeScript import failure unchanged', async () => {
    await expect(loadMigrationFile(path.join(fixtures, 'throws-on-import.cjs'))).rejects.toThrow(
      'boom at import time',
    );
  });
});

describe('tsLoadErrorOrNull', () => {
  const unknownExt = {
    code: 'ERR_UNKNOWN_FILE_EXTENSION',
    message: 'Unknown file extension ".ts"',
  };

  it('should map an unknown-extension failure on a .ts file to a clear error', () => {
    const result = tsLoadErrorOrNull('/migrations/0001-x.ts', unknownExt);
    expect(result).toBeInstanceOf(MigrationInvalidExportError);
    expect(result?.message).toContain('TypeScript');
  });

  it('should also handle .mts and .cts files', () => {
    expect(tsLoadErrorOrNull('/m/0001-x.mts', unknownExt)).toBeInstanceOf(
      MigrationInvalidExportError,
    );
    expect(tsLoadErrorOrNull('/m/0001-x.cts', unknownExt)).toBeInstanceOf(
      MigrationInvalidExportError,
    );
  });

  it('should return null for a .js file (not a TypeScript problem)', () => {
    expect(tsLoadErrorOrNull('/migrations/0001-x.js', unknownExt)).toBeNull();
  });

  it('should return null when the error is unrelated to the file extension', () => {
    expect(tsLoadErrorOrNull('/migrations/0001-x.ts', new Error('boom'))).toBeNull();
  });

  it('should return null when the error is not an object', () => {
    expect(tsLoadErrorOrNull('/migrations/0001-x.ts', 'a string error')).toBeNull();
    expect(tsLoadErrorOrNull('/migrations/0001-x.ts', null)).toBeNull();
  });

  it('should detect the failure via the error message on an Error instance', () => {
    const err = new Error('Unknown file extension ".ts" for /x.ts');
    const result = tsLoadErrorOrNull('/migrations/0001-x.ts', err);
    expect(result).toBeInstanceOf(MigrationInvalidExportError);
    expect(result?.context?.cause).toBe(err.message);
  });
});

describe('isTypeScriptLoadFailure', () => {
  const unknownExt = {
    code: 'ERR_UNKNOWN_FILE_EXTENSION',
    message: 'Unknown file extension ".ts"',
  };

  it('should be true only for a TypeScript file that Node could not load', () => {
    expect(isTypeScriptLoadFailure('/app/mmk.config.ts', unknownExt)).toBe(true);
    expect(isTypeScriptLoadFailure('/app/mmk.config.mts', unknownExt)).toBe(true);
    expect(isTypeScriptLoadFailure('/app/mmk.config.js', unknownExt)).toBe(false);
    expect(isTypeScriptLoadFailure('/app/mmk.config.ts', new Error('boom'))).toBe(false);
  });
});

describe('formatMismatchErrorOrNull', () => {
  // The fixtures live in this repo, whose package.json says "type": "module"
  const cjsInEsm = new ReferenceError('module is not defined in ES module scope');

  it('should explain module.exports in a "type": "module" package', () => {
    const result = formatMismatchErrorOrNull(path.join(fixtures, '0001-old.js'), cjsInEsm);
    expect(result).toBeInstanceOf(MigrationInvalidExportError);
    expect(result?.message).toContain(
      'Migration "0001-old.js" uses CommonJS (module.exports/require), but Node loads it as an ES module',
    );
    expect(result?.message).toContain('"type": "module"');
    expect(result?.context?.cause).toBe(cjsInEsm.message);
  });

  it('should return null for any other failure', () => {
    expect(formatMismatchErrorOrNull(path.join(fixtures, 'a.js'), new Error('boom'))).toBeNull();
  });

  // loadMigrationFile's use of it is covered in tests/integration/runtime-ts.test.ts:
  // vitest's own module loader accepts mismatched files that plain Node rejects.
});
