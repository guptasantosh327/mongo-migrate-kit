import type { Command } from 'commander';
import { ConfigInvalidError } from '../../errors/index.js';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';
import { renderStatusTable } from '../table.js';

/** Register the `dry-run` command */
export function registerDryRun(program: Command): void {
  program
    .command('dry-run')
    .description('Preview what an up or down would do, without touching the database')
    .argument('<direction>', "Either 'up' or 'down'")
    .argument('[file]', 'Specific migration file')
    .option('--steps <n>', 'Preview reverting the last N migrations (down only)')
    .option('--json', 'Output machine-readable JSON instead of a table')
    .action(async (direction: string, file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { steps?: string };
      await withMigrator(
        opts,
        async (migrator) => {
          if (direction !== 'up' && direction !== 'down') {
            throw new ConfigInvalidError("Direction must be 'up' or 'down'", { direction });
          }
          const rows = await migrator.dryRun(direction, file, {
            ...(opts.steps !== undefined ? { steps: Number(opts.steps) } : {}),
          });
          if (opts.json) {
            emitJson(rows);
          } else if (rows.length > 0) {
            createLogger().info(renderStatusTable(rows));
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
