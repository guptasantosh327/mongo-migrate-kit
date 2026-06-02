import type { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import type { ConfigFormat } from '../../utils/template.js';
import { type CliOptions, withMigrator } from '../shared.js';

/** Register the `init` command */
export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create an mmk config file in the current directory (mmk.config.js by default)')
    .option('--ts', 'Generate mmk.config.ts instead of mmk.config.js')
    .option('--json', 'Generate mmk.config.json instead of mmk.config.js')
    .option('--js', 'Generate mmk.config.js (the default)')
    .option(
      '--secret-provider',
      'Generate a config that loads the connection from a secret manager (js/ts only)',
    )
    .option('--force', 'Overwrite an existing config file')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        ts?: boolean;
        json?: boolean;
        js?: boolean;
        secretProvider?: boolean;
        force?: boolean;
      };
      const format: ConfigFormat = opts.json ? 'json' : opts.ts ? 'ts' : 'js';

      if (opts.secretProvider && format === 'json') {
        createLogger().error(
          '✖ --secret-provider is only available for js/ts configs (not --json)',
        );
        process.exitCode = 1;
        return;
      }

      await withMigrator(opts, async (migrator) => {
        await migrator.init({
          format,
          force: opts.force ?? false,
          ...(opts.secretProvider ? { secretProvider: true } : {}),
        });
      });
    });
}
