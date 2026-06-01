import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, resolveLogger, silentLogger } from '../../src/utils/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('silentLogger', () => {
  it('should expose all logger methods as no-ops', () => {
    expect(() => {
      silentLogger.info('x');
      silentLogger.success('x');
      silentLogger.warn('x');
      silentLogger.error('x');
      silentLogger.dim('x');
    }).not.toThrow();
  });
});

describe('createLogger', () => {
  it('should write info/success/dim to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger();
    logger.info('hello');
    logger.success('done');
    logger.dim('faded');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should write warn/error to stderr', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const logger = createLogger();
    logger.warn('careful');
    logger.error('boom');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('resolveLogger', () => {
  it('should return the silent logger when given null', () => {
    expect(resolveLogger(null)).toBe(silentLogger);
  });

  it('should return a default logger when given undefined', () => {
    const logger = resolveLogger(undefined);
    expect(typeof logger.info).toBe('function');
    expect(logger).not.toBe(silentLogger);
  });

  it('should return the provided custom logger unchanged', () => {
    expect(resolveLogger(silentLogger)).toBe(silentLogger);
  });
});
