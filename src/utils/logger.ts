import chalk from 'chalk';
import type { MmkLogger } from '../types/index.js';

/** A logger whose methods are all no-ops — used to silence all output */
export const silentLogger: MmkLogger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
};

/**
 * Create the default chalk-based structured logger.
 *
 * `info`/`success`/`dim` write to `stream` (stdout by default); `warn`/`error`
 * always write to stderr. Pass `process.stderr` as `stream` to keep stdout clean
 * for machine-readable output (e.g. `--json` mode routes all human lines here).
 */
export function createLogger(stream: NodeJS.WritableStream = process.stdout): MmkLogger {
  const writeOut = (msg: string): void => {
    stream.write(`${msg}\n`);
  };
  const writeErr = (msg: string): void => {
    process.stderr.write(`${msg}\n`);
  };
  return {
    info: (msg: string): void => writeOut(msg),
    success: (msg: string): void => writeOut(chalk.green(msg)),
    warn: (msg: string): void => writeErr(chalk.yellow(msg)),
    error: (msg: string): void => writeErr(chalk.red(msg)),
    dim: (msg: string): void => writeOut(chalk.dim(msg)),
  };
}

/**
 * Resolve the effective logger from a config value:
 * `null` → silent, `undefined` → default chalk logger, otherwise the custom logger.
 */
export function resolveLogger(logger: MmkLogger | null | undefined): MmkLogger {
  if (logger === null) {
    return silentLogger;
  }
  return logger ?? createLogger();
}
