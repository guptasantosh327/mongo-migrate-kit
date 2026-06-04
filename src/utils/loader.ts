import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MigrationFileNotFoundError, MigrationInvalidExportError } from '../errors/index.js';
import type { MigrationModule } from '../types/index.js';

/** TypeScript source extensions that require a TS-capable runtime to import */
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);

/** Narrow an unknown value to a function */
function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

/** True when an import failed because Node cannot load the file's extension */
function isUnknownExtensionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 'ERR_UNKNOWN_FILE_EXTENSION' ||
    (typeof message === 'string' && message.includes('Unknown file extension'))
  );
}

/**
 * Translate a dynamic-import failure into a clear {@link MigrationInvalidExportError}
 * when the cause is a `.ts`/`.mts`/`.cts` file that the current Node runtime cannot
 * load, or return null to let the original error propagate.
 *
 * The shipped CLI runs as plain Node, where importing TypeScript only works on a
 * runtime with type stripping (Node >= 22.18) or under a loader such as `tsx`. On
 * older runtimes `import('foo.ts')` throws a cryptic `ERR_UNKNOWN_FILE_EXTENSION`;
 * this surfaces an actionable message instead.
 */
export function tsLoadErrorOrNull(
  filepath: string,
  error: unknown,
): MigrationInvalidExportError | null {
  const ext = path.extname(filepath).toLowerCase();
  if (!TS_EXTENSIONS.has(ext) || !isUnknownExtensionError(error)) {
    return null;
  }
  const name = path.basename(filepath);
  return new MigrationInvalidExportError(
    `Cannot load TypeScript migration "${name}" — this Node runtime cannot import .ts files. Use Node >= 22.18, run mmk under a TypeScript loader (e.g. tsx), or author the migration as .js.`,
    { filepath, cause: error instanceof Error ? error.message : String(error) },
  );
}

/**
 * Dynamically load a migration file and validate its exports.
 *
 * Handles all three supported formats:
 * - TypeScript / JavaScript ESM named exports (`export async function up/down`)
 * - CommonJS default export (`module.exports = { up, down }`)
 *
 * @throws {@link MigrationFileNotFoundError} when the file does not exist
 * @throws {@link MigrationInvalidExportError} when up/down are not both functions
 */
export async function loadMigrationFile(filepath: string): Promise<MigrationModule> {
  if (!existsSync(filepath)) {
    throw new MigrationFileNotFoundError('Migration file not found', { filepath });
  }

  let imported: Record<string, unknown> & { default?: Record<string, unknown> };
  try {
    imported = (await import(pathToFileURL(filepath).href)) as Record<string, unknown> & {
      default?: Record<string, unknown>;
    };
  } catch (error) {
    const tsError = tsLoadErrorOrNull(filepath, error);
    if (tsError) {
      throw tsError;
    }
    throw error;
  }
  // `mod.default ?? mod` handles the CommonJS default-export case
  const resolved = (imported.default ?? imported) as Record<string, unknown>;

  if (!isFunction(resolved.up) || !isFunction(resolved.down)) {
    throw new MigrationInvalidExportError('Migration must export async up() and down() functions', {
      filepath,
    });
  }

  const migration: MigrationModule = {
    up: resolved.up as MigrationModule['up'],
    down: resolved.down as MigrationModule['down'],
  };

  if (typeof resolved.useTransaction === 'boolean') {
    migration.useTransaction = resolved.useTransaction;
  }
  if (typeof resolved.description === 'string') {
    migration.description = resolved.description;
  }

  return migration;
}
