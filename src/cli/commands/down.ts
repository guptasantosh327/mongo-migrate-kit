import type { Command } from 'commander';
import { type CliOptions, withMigrator } from '../shared.js';

/** Register the `down` command */
export function registerDown(program: Command): void {
  program
    .command('down')
    .description(
      'Rollback the last batch, a specific batch, the last N steps, or a single named file',
    )
    .argument('[file]', 'Specific migration file to revert')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .option('--batch <n>', 'Revert a specific batch number')
    .option('--steps <n>', 'Revert the last N migrations, regardless of batch')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        lock?: boolean;
        batch?: string;
        steps?: string;
      };
      await withMigrator(
        opts,
        async (migrator) => {
          await migrator.down(file, {
            noLock: opts.lock === false,
            ...(opts.batch ? { batch: Number(opts.batch) } : {}),
            ...(opts.steps !== undefined ? { steps: Number(opts.steps) } : {}),
          });
        },
        { spinner: true },
      );
    });
}
