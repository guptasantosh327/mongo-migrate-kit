import type { Command } from 'commander';
import { type CliOptions, withMigrator } from '../shared.js';

/** Register the `redo` command */
export function registerRedo(program: Command): void {
  program
    .command('redo')
    .description('Rollback then re-apply the last applied migration, or a specific file')
    .argument('[file]', 'Specific migration file to redo')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions;
      await withMigrator(
        opts,
        async (migrator) => {
          await migrator.redo(file);
        },
        { spinner: true },
      );
    });
}
