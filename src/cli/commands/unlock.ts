import type { Command } from 'commander';
import { quote } from '../../utils/explain.js';
import { createLogger } from '../../utils/logger.js';
import { namespaceLabel } from '../../utils/namespace.js';
import { type CliOptions, confirm, emitJson, withMigrator } from '../shared.js';

/** Register the `unlock` command (force-release a stuck migration lock) */
export function registerUnlock(program: Command): void {
  program
    .command('unlock')
    .description('Force-release a stuck migration lock left behind by a crashed run')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Output machine-readable JSON ({ released, holder })')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { yes?: boolean };
      await withMigrator(
        opts,
        async (migrator) => {
          const holder = await migrator.lockInfo();

          if (!holder) {
            if (opts.json) {
              emitJson({ released: false, holder: null });
            } else {
              createLogger().info('No migration lock is currently held');
            }
            return;
          }

          // Every repo on a database shares one lock, so the holder may be a
          // different repo that is migrating right now — say so loudly.
          const own = await migrator.getNamespace();
          const foreign =
            holder.namespace !== own
              ? `⚠ This lock belongs to ${quote(namespaceLabel(holder.namespace))}, not this repo (${quote(namespaceLabel(own))}) — releasing it may let two migrations run at once`
              : undefined;

          // Confirm before clearing — unless --yes, or --json (non-interactive).
          if (!opts.json && !opts.yes) {
            const logger = createLogger();
            const since = (holder.acquiredAt ?? holder.lockedAt).toISOString();
            logger.warn(
              `⚠ Lock held by namespace ${quote(namespaceLabel(holder.namespace))}: pid ${holder.pid} on ${holder.host} (${holder.executedBy}) since ${since}`,
            );
            if (foreign) {
              logger.warn(foreign);
            }
            const proceed = await confirm('Force-release this lock? [y/N] ');
            if (!proceed) {
              logger.info('Aborted');
              return;
            }
          } else if (foreign) {
            // Non-interactive: still leave a trace (stderr in --json mode).
            createLogger(opts.json ? process.stderr : process.stdout).warn(foreign);
          }

          const released = await migrator.forceUnlock();
          if (opts.json) {
            emitJson({ released: released !== null, holder: released });
          } else {
            createLogger().success('✔ Lock released');
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
