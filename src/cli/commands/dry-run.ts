import type { Command } from 'commander';
import { ConfigInvalidError } from '../../errors/index.js';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, withMigrator } from '../shared.js';
import { renderStatusTable } from '../table.js';

/** Register the `dry-run` command */
export function registerDryRun(program: Command): void {
  program
    .command('dry-run')
    .description('Preview what an up or down would do, without touching the database')
    .argument('<direction>', "Either 'up' or 'down'")
    .argument('[file]', 'Specific migration file')
    .action(async (direction: string, file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions;
      await withMigrator(
        opts,
        async (migrator) => {
          if (direction !== 'up' && direction !== 'down') {
            throw new ConfigInvalidError("Direction must be 'up' or 'down'", { direction });
          }
          const rows = await migrator.dryRun(direction, file);
          const logger = createLogger();
          if (rows.length > 0) {
            logger.info(renderStatusTable(rows));
          }
        },
        { spinner: true },
      );
    });
}
