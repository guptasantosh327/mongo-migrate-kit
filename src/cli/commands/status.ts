import type { Command } from 'commander';
import { InvalidArgumentError } from '../../errors/index.js';
import type { StatusRow } from '../../types/index.js';
import { explain, quote } from '../../utils/explain.js';
import { createLogger } from '../../utils/logger.js';
import { type CliOptions, emitJson, failPreflight, withMigrator } from '../shared.js';
import { renderNamespaceTable, renderStatusTable } from '../table.js';

/**
 * Safety check 3, shown only by `status` (never by `up`): applied records in
 * this namespace whose files are not on disk. Teams often delete old migration
 * files on purpose, so this is one informational line, never a warning on every
 * deploy — but it is also how a changelog shared by mistake gets noticed.
 */
function filesMissingNote(rows: StatusRow[]): string | undefined {
  const missing = rows.filter((row) => row.fileMissing && row.status === 'applied');
  if (missing.length === 0) {
    return undefined;
  }
  const one = missing.length === 1;
  const count = `${missing.length} applied migration${one ? '' : 's'}`;
  const have = one ? 'has' : 'have';
  const namespace = missing[0]?.namespace;
  return namespace === undefined
    ? `ℹ ${count} ${have} no file here (deleted files, or a changelog shared with another repo — see "namespace")`
    : `ℹ ${count} in namespace ${quote(namespace)} ${have} no file here (deleted files, or another repo using the same namespace, e.g. a copied config)`;
}

/** Register the `status` command */
export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show the full migration status table')
    .option('--json', 'Output machine-readable JSON instead of a table')
    .option('--check', 'Exit with code 1 if any migrations are pending (CI gate)')
    .option(
      '--all-namespaces',
      'Show every namespace in the changelog collection (read-only overview)',
    )
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        check?: boolean;
        allNamespaces?: boolean;
      };

      if (opts.allNamespaces && opts.check) {
        failPreflight(
          opts,
          new InvalidArgumentError(
            explain('--check cannot be combined with --all-namespaces', [
              "--check gates on this repo's pending migrations; --all-namespaces lists every repo's records",
              'Try: mmk status --check   (in each repo)',
            ]),
            { flags: ['--check', '--all-namespaces'] },
          ),
        );
        return;
      }

      await withMigrator(
        opts,
        async (migrator) => {
          if (opts.allNamespaces) {
            const records = await migrator.statusAllNamespaces();
            if (opts.json) {
              emitJson(records);
            } else if (records.length === 0) {
              createLogger().info('No migrations recorded in this collection');
            } else {
              createLogger().info(renderNamespaceTable(records));
            }
            return;
          }

          const rows = await migrator.status();
          if (opts.json) {
            emitJson(rows);
          } else if (rows.length === 0) {
            createLogger().info('No migrations found');
          } else {
            createLogger().info(renderStatusTable(rows));
            const note = filesMissingNote(rows);
            if (note) {
              createLogger().dim(note);
            }
          }
          if (opts.check) {
            // .error writes to stderr, so JSON stdout stays a single clean document.
            const unadopted = rows.filter((row) => row.unadopted).length;
            const pending = rows.filter((row) => row.status === 'pending' && !row.unadopted).length;
            if (unadopted > 0) {
              createLogger().error(
                `✖ ${unadopted} migration(s) need \`mmk namespace adopt\` — they are applied, not pending`,
              );
            }
            if (pending > 0) {
              createLogger().error(`✖ ${pending} pending migration(s)`);
            }
            if (unadopted > 0 || pending > 0) {
              process.exitCode = 1;
            }
          }
        },
        { spinner: true, ...(opts.json ? { json: true } : {}) },
      );
    });
}
