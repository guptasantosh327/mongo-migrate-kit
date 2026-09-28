import type { Command } from 'commander';
import { InvalidArgumentError } from '../../errors/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  type CliOptions,
  confirm,
  emitJson,
  failPreflight,
  parseCountOption,
  withMigrator,
} from '../shared.js';

/** Register the `down` command */
export function registerDown(program: Command): void {
  program
    .command('down')
    .description(
      'Rollback the last batch, a specific batch, the last N steps, or a single named file',
    )
    .argument('[file]', 'Specific migration file to revert')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .option('--batch <n>', 'Revert a specific batch number')
    .option('--steps <n>', 'Revert the last N migrations, regardless of batch')
    .option('-f, --force', 'Roll back even if a file drifted from its applied checksum')
    .option('-y, --yes', 'Confirm --force non-interactively (required with --json)')
    .option('--json', 'Output machine-readable JSON of the run results')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        lock?: boolean;
        batch?: string;
        steps?: string;
        force?: boolean;
        yes?: boolean;
      };

      // Parsed before connecting, so a typo'd flag never costs a connection.
      let batch: number | undefined;
      let steps: number | undefined;
      try {
        batch = parseCountOption(opts.batch, '--batch', 'mmk down --batch 3');
        steps = parseCountOption(opts.steps, '--steps', 'mmk down --steps 3');
      } catch (error) {
        failPreflight(opts, error);
        return;
      }

      if (opts.force && !opts.yes) {
        // --json is non-interactive: refuse rather than hanging on a prompt.
        if (opts.json) {
          failPreflight(
            opts,
            new InvalidArgumentError(
              '--force needs confirmation — pass --yes to confirm in --json mode',
            ),
          );
          return;
        }
        const what = file ?? 'the selected migration(s)';
        const proceed = await confirm(
          `⚠ Forcing rollback ignores checksum drift — the current down() runs against your DB.\n  Roll back ${what} anyway? [y/N] `,
        );
        if (!proceed) {
          createLogger().info('Aborted');
          return;
        }
      }

      await withMigrator(
        opts,
        async (migrator) => {
          const results = await migrator.down(file, {
            noLock: opts.lock === false,
            ...(batch !== undefined ? { batch } : {}),
            ...(steps !== undefined ? { steps } : {}),
            ...(opts.force ? { force: true } : {}),
          });
          if (opts.json) {
            emitJson(results);
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
