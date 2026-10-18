import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';
import { renderConfigTable } from '../table.js';

/** Register the `config` command (show the resolved configuration) */
export function registerConfig(program: Command): void {
  program
    .command('config')
    .description('Show the resolved configuration and where each value came from (never connects)')
    .option('--json', 'Output machine-readable JSON instead of a table')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions;
      await withMigrator(
        opts,
        async (migrator) => {
          const summary = await migrator.describeConfig();
          if (opts.json) {
            emitJson(summary);
          } else {
            createLogger().info(renderConfigTable(summary));
          }
        },
        { ...(opts.json ? { json: true } : {}) },
      );
    });
}
