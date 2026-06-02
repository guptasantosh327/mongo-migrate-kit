import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, confirm, withMigrator } from '../shared.js';

/** Register the `up` command */
export function registerUp(program: Command): void {
  program
    .command('up')
    .description('Run all pending migrations, or a single named file')
    .argument('[file]', 'Specific migration file to run')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .option('--strict', 'Abort on checksum mismatch')
    .option('-f, --force', 'Re-run an already-applied migration (requires a file)')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { lock?: boolean; force?: boolean };

      if (opts.force && !file) {
        createLogger().error('✖ --force requires a specific migration file');
        process.exitCode = 1;
        return;
      }

      if (opts.force && file) {
        const proceed = await confirm(`are you sure you want to re-run "${file}"? [y/N] `);
        if (!proceed) {
          createLogger().info('Aborted');
          return;
        }
      }

      await withMigrator(opts, async (migrator) => {
        await migrator.up(file, {
          noLock: opts.lock === false,
          ...(opts.force ? { force: true } : {}),
        });
      });
    });
}
