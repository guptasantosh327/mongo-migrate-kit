import type { Command } from 'commander';
import { formatDateTime } from '../../utils/date.js';
import { quote } from '../../utils/explain.js';
import { createLogger } from '../../utils/logger.js';
import { namespaceLabel } from '../../utils/namespace.js';
import { type CliOptions, emitJson, withMigrator } from '../shared.js';

/** Register the `lock` command (show who holds the migration lock; changes nothing) */
export function registerLock(program: Command): void {
  program
    .command('lock')
    .description('Show who holds the migration lock, without releasing it')
    .option('--json', 'Output machine-readable JSON ({ holder, stale })')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions;
      await withMigrator(
        opts,
        async (migrator) => {
          const status = await migrator.lockStatus();
          if (opts.json) {
            emitJson(status);
            return;
          }

          const logger = createLogger();
          const { holder } = status;
          if (!holder) {
            logger.info('No migration lock is currently held');
            return;
          }
          const since = formatDateTime(holder.acquiredAt ?? holder.lockedAt);
          const who = `namespace ${quote(namespaceLabel(holder.namespace))}: pid ${holder.pid} on ${holder.host} (${holder.executedBy}) since ${since}`;
          if (status.stale) {
            logger.info(`Lock left by ${who}`);
            logger.dim(
              'It has gone stale (the holder stopped renewing it), so the next run takes it over',
            );
            return;
          }

          logger.info(`Lock held by ${who}`);
          // Every repo on a database shares one lock, so the holder may be another repo.
          const own = await migrator.getNamespace();
          if (holder.namespace !== own) {
            logger.warn(
              `This lock belongs to ${quote(namespaceLabel(holder.namespace))}, not this repo (${quote(namespaceLabel(own))})`,
            );
          }
          logger.dim(
            holder.expiresAt
              ? `If the holder crashed, the lock frees itself at ${formatDateTime(holder.expiresAt)}; \`mmk unlock\` releases it now (check the holder first)`
              : 'If the holder crashed, the lock frees itself once it goes stale; `mmk unlock` releases it now (check the holder first)',
          );
        },
        { spinner: true, readOnly: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
