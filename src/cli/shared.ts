import { MigratorKit } from '../core/migrator.js';
import { MmkError } from '../errors/index.js';
import type { MmkConfig, StatusRow } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

/** Shape of the merged global + command options provided by commander */
export interface CliOptions {
  uri?: string;
  db?: string;
  dir?: string;
  config?: string;
  strict?: boolean;
}

/** Build the partial config passed to MigratorKit from CLI flags */
export function partialFromOpts(opts: CliOptions): Partial<MmkConfig> {
  const partial: Partial<MmkConfig> = {};
  if (opts.uri) partial.uri = opts.uri;
  if (opts.db) partial.dbName = opts.db;
  if (opts.dir) partial.migrationsDir = opts.dir;
  if (opts.strict) partial.strict = true;
  return partial;
}

/**
 * Construct a MigratorKit from CLI options, run `fn`, always disconnect, and
 * translate failures into a non-zero exit code with a readable message.
 */
export async function withMigrator(
  opts: CliOptions,
  fn: (migrator: MigratorKit) => Promise<void>,
): Promise<void> {
  const migrator = new MigratorKit(partialFromOpts(opts), {
    ...(opts.config ? { configPath: opts.config } : {}),
  });
  const logger = createLogger();
  try {
    await fn(migrator);
  } catch (error) {
    if (error instanceof MmkError) {
      logger.error(`✖ ${error.code}: ${error.message}`);
    } else {
      logger.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  } finally {
    await migrator.disconnect();
  }
}

/** Re-export for command modules that render their own output */
export type { StatusRow };
