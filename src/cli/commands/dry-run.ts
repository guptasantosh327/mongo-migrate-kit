import type { Command } from 'commander';
import { InvalidArgumentError } from '../../errors/index.js';
import { didYouMean, explain, quote } from '../../utils/explain.js';
import { createLogger } from '../../utils/logger.js';
import {
  type CliOptions,
  emitJson,
  failPreflight,
  parseCountOption,
  withMigrator,
} from '../shared.js';
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

      // Checked before connecting: a bad direction or --steps should cost nothing.
      let steps: number | undefined;
      try {
        if (direction !== 'up' && direction !== 'down') {
          throw new InvalidArgumentError(
            explain("dry-run direction must be 'up' or 'down'", [
              `Received: ${quote(direction)}`,
              didYouMean(direction, ['up', 'down']),
              'Try: mmk dry-run up      (preview what would be applied)',
              'Try: mmk dry-run down    (preview what would be rolled back)',
            ]),
            { direction },
          );
        }
        steps = parseCountOption(opts.steps, '--steps', 'mmk dry-run down --steps 3');
      } catch (error) {
        failPreflight(opts, error);
        return;
      }
      const chosen = direction;

      await withMigrator(
        opts,
        async (migrator) => {
          const rows = await migrator.dryRun(chosen, file, {
            ...(steps !== undefined ? { steps } : {}),
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
