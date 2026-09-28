import type { Command } from 'commander';
import { InvalidArgumentError } from '../../errors/index.js';
import { explain } from '../../utils/explain.js';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, confirm, emitJson, failPreflight, withMigrator } from '../shared.js';

/** Register the `up` command */
export function registerUp(program: Command): void {
  program
    .command('up')
    .description('Run all pending migrations, or a single named file')
    .argument('[file]', 'Specific migration file to run')
    .option('--no-lock', 'Skip the concurrency lock (dev only)')
    .option('--strict', 'Abort on checksum mismatch')
    .option('-f, --force', 'Re-run an already-applied migration (requires a file)')
    .option('-y, --yes', 'Confirm --force non-interactively (required with --json)')
    .option('--step', 'Apply each migration as its own batch (revert individually later)')
    .option('--json', 'Output machine-readable JSON of the run results')
    .action(async (file: string | undefined, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        lock?: boolean;
        force?: boolean;
        yes?: boolean;
        step?: boolean;
      };

      if (opts.force && !file) {
        failPreflight(
          opts,
          new InvalidArgumentError(
            explain('--force requires a specific migration file', [
              '--force re-runs an already-applied migration, so it needs to know which one',
              'A plain `mmk up` only has pending migrations to run, so there is nothing to force',
              'Try: mmk up 20240526143021-add-users-index.js --force',
            ]),
          ),
        );
        return;
      }

      if (opts.force && file && !opts.yes) {
        // --json is non-interactive: refuse rather than silently re-running or hanging
        // on a prompt that can't be answered. --yes is the explicit opt-in.
        if (opts.json) {
          failPreflight(
            opts,
            new InvalidArgumentError(
              '--force needs confirmation — pass --yes to confirm in --json mode',
            ),
          );
          return;
        }
        const proceed = await confirm(`are you sure you want to re-run "${file}"? [y/N] `);
        if (!proceed) {
          createLogger().info('Aborted');
          return;
        }
      }

      await withMigrator(
        opts,
        async (migrator) => {
          const results = await migrator.up(file, {
            noLock: opts.lock === false,
            ...(opts.force ? { force: true } : {}),
            ...(opts.step ? { step: true } : {}),
          });
          if (opts.json) {
            emitJson(results);
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
