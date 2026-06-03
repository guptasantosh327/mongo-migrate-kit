import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, withMigrator } from '../shared.js';
import { renderStatusTable } from '../table.js';

/** Register the `list` command */
export function registerList(program: Command): void {
  program
    .command('list')
    .description('List migrations, optionally filtered by status')
    .option('--pending', 'Show only pending migrations')
    .option('--applied', 'Show only applied migrations')
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
          const logger = createLogger();
          if (rows.length === 0) {
            logger.info('No migrations found');
            return;
          }
          logger.info(renderStatusTable(rows));
        },
        { spinner: true },
      );
    });
}
