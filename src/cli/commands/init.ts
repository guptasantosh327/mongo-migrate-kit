import type { Command } from 'commander';
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
    .option('--force', 'Overwrite an existing config file')
    .action(async (_opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        ts?: boolean;
        json?: boolean;
        js?: boolean;
        force?: boolean;
      };
      const format: ConfigFormat = opts.json ? 'json' : opts.ts ? 'ts' : 'js';
      await withMigrator(opts, async (migrator) => {
        await migrator.init({ format, force: opts.force ?? false });
      });
    });
}
