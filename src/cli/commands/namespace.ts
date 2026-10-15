import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';
import { renderAdoptTable } from '../table.js';

/** Register the `namespace` command group (`mmk namespace adopt`) */
export function registerNamespace(program: Command): void {
  const namespace = program
    .command('namespace')
    .description("Manage this repo's namespace in a changelog shared by several repos");

  namespace
    .command('adopt')
    .description(
      "Move this repo's records from before it had a namespace into its namespace (one-time)",
    )
    .option('--dry-run', 'Preview which records would move, without writing anything')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .option('--json', 'Output machine-readable JSON instead of a table')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { dryRun?: boolean; lock?: boolean };
      await withMigrator(
        opts,
        async (migrator) => {
          const result = await migrator.adopt({
            noLock: opts.lock === false,
            ...(opts.dryRun ? { dryRun: true } : {}),
          });
          if (opts.json) {
            emitJson(result);
          } else if (result.rows.length > 0) {
            createLogger().info(renderAdoptTable(result.rows));
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
