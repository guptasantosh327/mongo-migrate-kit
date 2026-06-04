import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';
import { renderStatusTable } from '../table.js';

/** Register the `list` command */
export function registerList(program: Command): void {
  program
    .command('list')
    .description('List migrations, optionally filtered by status')
    .option('--pending', 'Show only pending migrations')
    .option('--applied', 'Show only applied migrations')
    .option('--json', 'Output machine-readable JSON instead of a table')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        pending?: boolean;
        applied?: boolean;
      };
      await withMigrator(
        opts,
        async (migrator) => {
          const filter = opts.pending ? 'pending' : opts.applied ? 'applied' : 'all';
          const rows = await migrator.list(filter);
          if (opts.json) {
            emitJson(rows);
          } else if (rows.length === 0) {
            createLogger().info('No migrations found');
          } else {
            createLogger().info(renderStatusTable(rows));
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
