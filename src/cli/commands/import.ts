import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, withMigrator } from '../shared.js';
import { renderImportTable } from '../table.js';

/** Register the `import` command (adopt a migrate-mongo changelog) */
export function registerImport(program: Command): void {
  program
    .command('import')
    .description('Adopt an existing migrate-mongo changelog into the mmk changelog')
    .option('--from <collection>', 'Source collection to read (default: changelog)')
    .option(
      '--to <collection>',
      'Target collection to write (default: config migrationsCollection)',
    )
    .option('--dry-run', 'Preview the mapping without writing anything')
    .option('--trust-hash', 'Reuse the source fileHash instead of recomputing from disk')
    .option('--force', 'Proceed even when the target changelog already has records')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        from?: string;
        to?: string;
        dryRun?: boolean;
        trustHash?: boolean;
        force?: boolean;
        lock?: boolean;
      };

      await withMigrator(
        opts,
        async (migrator) => {
          const result = await migrator.import({
            noLock: opts.lock === false,
            ...(opts.from ? { from: opts.from } : {}),
            ...(opts.to ? { to: opts.to } : {}),
            ...(opts.dryRun ? { dryRun: true } : {}),
            ...(opts.trustHash ? { trustHash: true } : {}),
            ...(opts.force ? { force: true } : {}),
          });
          if (result.rows.length > 0) {
            createLogger().info(renderImportTable(result.rows));
          }
        },
        { spinner: true },
      );
    });
}
