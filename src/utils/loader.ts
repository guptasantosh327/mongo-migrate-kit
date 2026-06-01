import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MigrationFileNotFoundError, MigrationInvalidExportError } from '../errors/index.js';
import type { MigrationModule } from '../types/index.js';

/** Narrow an unknown value to a function */
function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
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

  const imported = (await import(pathToFileURL(filepath).href)) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
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
