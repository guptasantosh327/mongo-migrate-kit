import type { Command } from 'commander';
import { type CliOptions, withMigrator } from '../shared.js';

/** Register the `up` command */
export function registerUp(program: Command): void {
  program
    .command('up')
    .description('Run all pending migrations, or a single named file')
    .argument('[file]', 'Specific migration file to run')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .option('--strict', 'Abort on checksum mismatch')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { lock?: boolean };
      await withMigrator(opts, async (migrator) => {
        await migrator.up(file, { noLock: opts.lock === false });
      });
    });
}
