import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';
import { renderStatusTable } from '../table.js';

/** Register the `status` command */
export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show the full migration status table')
    .option('--json', 'Output machine-readable JSON instead of a table')
    .option('--check', 'Exit with code 1 if any migrations are pending (CI gate)')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { check?: boolean };
      await withMigrator(
        opts,
        async (migrator) => {
          const rows = await migrator.status();
          if (opts.json) {
            emitJson(rows);
          } else if (rows.length === 0) {
            createLogger().info('No migrations found');
          } else {
            createLogger().info(renderStatusTable(rows));
          }
          if (opts.check) {
            const pending = rows.filter((row) => row.status === 'pending').length;
            if (pending > 0) {
              // .error writes to stderr, so JSON stdout stays a single clean document.
              createLogger().error(`✖ ${pending} pending migration(s)`);
              process.exitCode = 1;
            }
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
