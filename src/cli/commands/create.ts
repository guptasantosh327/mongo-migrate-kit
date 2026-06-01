import type { Command } from 'commander';
import { type CliOptions, withMigrator } from '../shared.js';

/** Register the `create` command */
export function registerCreate(program: Command): void {
  program
    .command('create')
    .description('Scaffold a new migration file')
    .argument('<name>', 'Migration name (will be slugified)')
    .option('--js', 'Generate a .js file instead of .ts')
    .option('--template <path>', 'Use a custom template file')
    .action(async (name: string, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & { js?: boolean; template?: string };
      await withMigrator(opts, async (migrator) => {
        await migrator.create(name, {
          js: opts.js ?? false,
          ...(opts.template ? { template: opts.template } : {}),
        });
      });
    });
}
