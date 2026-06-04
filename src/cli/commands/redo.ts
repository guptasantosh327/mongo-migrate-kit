import type { Command } from 'commander';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';

/** Register the `redo` command */
export function registerRedo(program: Command): void {
  program
    .command('redo')
    .description('Rollback then re-apply the last applied migration, or a specific file')
    .argument('[file]', 'Specific migration file to redo')
    .option('--json', 'Output machine-readable JSON of the run results')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions;
      await withMigrator(
        opts,
        async (migrator) => {
          const results = await migrator.redo(file);
          if (opts.json) {
            emitJson(results);
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
