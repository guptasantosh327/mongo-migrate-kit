import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, withMigrator } from '../shared.js';
import { renderStatusTable } from '../table.js';

/** Register the `status` command */
export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show the full migration status table')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions;
      await withMigrator(
        opts,
        async (migrator) => {
          const rows = await migrator.status();
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
