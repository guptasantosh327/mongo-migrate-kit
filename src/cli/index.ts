import { Command } from 'commander';
import { registerCreate } from './commands/create.js';
import { registerDown } from './commands/down.js';
import { registerDryRun } from './commands/dry-run.js';
import { registerImport } from './commands/import.js';
import { registerInit } from './commands/init.js';
import { registerList } from './commands/list.js';
import { registerRedo } from './commands/redo.js';
import { registerStatus } from './commands/status.js';
import { registerUnlock } from './commands/unlock.js';
import { registerUp } from './commands/up.js';

/** Build the root commander program with all commands and global flags */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('mmk')
    .description('Elegant, fast, TypeScript-first MongoDB migrations for Node.js')
    .option('--uri <uri>', 'MongoDB connection URI (overrides MMK_URI)')
    .option('--db <name>', 'Database name (overrides MMK_DB)')
    .option('--dir <path>', 'Migrations directory (overrides MMK_MIGRATIONS_DIR)')
    .option('--config <path>', 'Path to a config file (overrides auto-discovery)')
    // Injected from package.json at build time (see tsup.config.ts); falls back
    // to a dev sentinel when run unbundled (e.g. via tsx).
    .version(process.env.MMK_VERSION ?? '0.0.0-dev');

  registerInit(program);
  registerImport(program);
  registerUp(program);
  registerDown(program);
  registerRedo(program);
  registerStatus(program);
  registerList(program);
  registerDryRun(program);
  registerCreate(program);
  registerUnlock(program);

  return program;
}

/** Parse argv and execute the matching command */
export async function run(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}
