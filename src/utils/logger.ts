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

/** Write a line to stdout */
function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** Write a line to stderr */
function err(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** Create the default chalk-based structured logger */
export function createLogger(): MmkLogger {
  return {
    info: (msg: string): void => out(msg),
    success: (msg: string): void => out(chalk.green(msg)),
    warn: (msg: string): void => err(chalk.yellow(msg)),
    error: (msg: string): void => err(chalk.red(msg)),
    dim: (msg: string): void => out(chalk.dim(msg)),
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
