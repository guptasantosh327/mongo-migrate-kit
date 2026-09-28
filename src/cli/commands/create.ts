import type { Command } from 'commander';
import { InvalidArgumentError } from '../../errors/index.js';
import { explain } from '../../utils/explain.js';
import { type CliOptions, emitJson, failPreflight, withMigrator } from '../shared.js';

/** Register the `create` command */
export function registerCreate(program: Command): void {
  program
    .command('create')
    .description('Create a new migration file')
    .argument('<name>', 'Migration name (will be slugified)')
    .option('--js', 'Force a .js file (overrides config createExtension)')
    .option('--ts', 'Force a .ts file (overrides config createExtension)')
    .option('--template <path>', 'Use a custom template file')
    .option('--json', 'Output machine-readable JSON ({ path })')
    .action(async (name: string, _opts, command) => {
      const opts = command.optsWithGlobals() as CliOptions & {
        js?: boolean;
        ts?: boolean;
        template?: string;
      };
      if (opts.js && opts.ts) {
        failPreflight(
          opts,
          new InvalidArgumentError(
            explain('--js and --ts cannot be used together', [
              'Received: both --js and --ts',
              "Pass exactly one, or neither to use the config's createExtension setting",
            ]),
          ),
        );
        return;
      }
      // Tri-state: explicit flag wins; otherwise leave undefined so config decides.
      const js = opts.ts ? false : opts.js ? true : undefined;
      await withMigrator(
        opts,
        async (migrator) => {
          const path = await migrator.create(name, {
            ...(js !== undefined ? { js } : {}),
            ...(opts.template ? { template: opts.template } : {}),
          });
          if (opts.json) {
            emitJson({ path });
          }
        },
        { ...(opts.json ? { json: true } : {}) },
      );
    });
}
