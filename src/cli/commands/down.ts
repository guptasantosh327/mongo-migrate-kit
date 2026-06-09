import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, confirm, emitJson, withMigrator } from '../shared.js';

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

      // Pre-flight validation errors honour --json so scripted callers get structured output.
      const failPreflight = (message: string): void => {
        if (opts.json) {
          emitJson({ error: { message } });
        } else {
          createLogger().error(`✖ ${message}`);
        }
        process.exitCode = 1;
      };

      if (opts.force && !opts.yes) {
        // --json is non-interactive: refuse rather than hanging on a prompt.
        if (opts.json) {
          failPreflight('--force needs confirmation — pass --yes to confirm in --json mode');
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
            ...(opts.batch ? { batch: Number(opts.batch) } : {}),
            ...(opts.steps !== undefined ? { steps: Number(opts.steps) } : {}),
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
