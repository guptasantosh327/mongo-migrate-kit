import { createInterface } from 'node:readline/promises';
import ora from 'ora';
import { MigratorKit, type MigratorKitOptions } from '../core/migrator.js';
import { MmkError } from '../errors/index.js';
import type { MmkConfig, ProgressReporter, StatusRow } from '../types/index.js';
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

/** Extra behaviour for {@link withMigrator} */
export interface WithMigratorOptions {
  /**
   * Show an ora spinner during the (silent) MongoDB connection phase AND while
   * each migration's up()/down() executes. Only the DB-touching commands set
   * this — `create`/`init` never connect. The spinner is stopped before any
   * result line is printed so it never garbles the per-file output.
   */
  spinner?: boolean;
}

/**
 * Construct a MigratorKit from CLI options, run `fn`, always disconnect, and
 * translate failures into a non-zero exit code with a readable message.
 */
export async function withMigrator(
  opts: CliOptions,
  fn: (migrator: MigratorKit) => Promise<void>,
  options: WithMigratorOptions = {},
): Promise<void> {
  // One ora instance drives both the connection wait and per-migration progress.
  // ora auto-disables on a non-TTY (pipes/CI), so this is safe everywhere.
  const spinner = options.spinner ? ora() : undefined;
  const migratorOptions: MigratorKitOptions = {
    ...(opts.config ? { configPath: opts.config } : {}),
  };
  if (spinner) {
    const reporter: ProgressReporter = {
      onStart: (name, direction) =>
        spinner.start(`${direction === 'up' ? 'Applying' : 'Reverting'} ${name}…`),
      // Stop (not succeed) — core logs the ✔/↩ result line right after.
      onStop: () => spinner.stop(),
    };
    migratorOptions.progress = reporter;
  }
  const migrator = new MigratorKit(partialFromOpts(opts), migratorOptions);
  const logger = createLogger();
  try {
    if (spinner) {
      spinner.start('Connecting to MongoDB…');
      try {
        await migrator.connect();
        spinner.stop();
      } catch (error) {
        spinner.stop();
        throw error;
      }
    }
    await fn(migrator);
  } catch (error) {
    // Safety net: clear any spinner still spinning before printing the error.
    spinner?.stop();
    if (error instanceof MmkError) {
      logger.error(`✖ ${error.code}: ${error.message}`);
    } else {
      logger.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  } finally {
    spinner?.stop();
    await migrator.disconnect();
  }
}

/**
 * Ask a yes/no question on the terminal. Resolves `true` only when the user
 * answers `y` or `yes` (case-insensitive); any other input is treated as no.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Re-export for command modules that render their own output */
export type { StatusRow };
