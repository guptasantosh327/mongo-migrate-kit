import { describe, expect, it } from 'vitest';
import {
  AlreadyAppliedError,
  ChecksumMismatchError,
  ConfigInvalidError,
  ConnectionFailedError,
  LockAlreadyHeldError,
  LockReleaseFailedError,
  MigrationExecutionFailedError,
  MigrationFileNotFoundError,
  MigrationInvalidExportError,
  MmkError,
  NotAppliedError,
} from '../../src/errors/index.js';
import type { MmkErrorCode } from '../../src/types/index.js';

describe('MmkError', () => {
  it('should set code, message and context', () => {
    const err = new MmkError('CONFIG_INVALID', 'Bad config', { field: 'uri' });
    expect(err.code).toBe('CONFIG_INVALID');
    expect(err.message).toBe('Bad config');
    expect(err.context).toEqual({ field: 'uri' });
    expect(err.name).toBe('MmkError');
  });

  it('should be an instance of Error', () => {
    const err = new MmkError('CONFIG_INVALID', 'Bad config');
    expect(err).toBeInstanceOf(Error);
  });

  it('should leave context undefined when not provided', () => {
    const err = new MmkError('CONFIG_INVALID', 'Bad config');
    expect(err.context).toBeUndefined();
  });

  it('should capture a stack trace', () => {
    const err = new MmkError('CONFIG_INVALID', 'Bad config');
    expect(err.stack).toBeDefined();
  });
});

describe('domain error classes', () => {
  const cases: Array<{
    Ctor: new (msg: string, ctx?: Record<string, unknown>) => MmkError;
    code: MmkErrorCode;
    name: string;
  }> = [
    { Ctor: LockAlreadyHeldError, code: 'LOCK_ALREADY_HELD', name: 'LockAlreadyHeldError' },
    { Ctor: LockReleaseFailedError, code: 'LOCK_RELEASE_FAILED', name: 'LockReleaseFailedError' },
    { Ctor: ChecksumMismatchError, code: 'CHECKSUM_MISMATCH', name: 'ChecksumMismatchError' },
    {
      Ctor: MigrationFileNotFoundError,
      code: 'MIGRATION_FILE_NOT_FOUND',
      name: 'MigrationFileNotFoundError',
    },
    {
      Ctor: MigrationInvalidExportError,
      code: 'MIGRATION_INVALID_EXPORT',
      name: 'MigrationInvalidExportError',
    },
    {
      Ctor: MigrationExecutionFailedError,
      code: 'MIGRATION_EXECUTION_FAILED',
      name: 'MigrationExecutionFailedError',
    },
    { Ctor: ConfigInvalidError, code: 'CONFIG_INVALID', name: 'ConfigInvalidError' },
    { Ctor: ConnectionFailedError, code: 'CONNECTION_FAILED', name: 'ConnectionFailedError' },
    { Ctor: AlreadyAppliedError, code: 'ALREADY_APPLIED', name: 'AlreadyAppliedError' },
    { Ctor: NotAppliedError, code: 'NOT_APPLIED', name: 'NotAppliedError' },
  ];

  for (const { Ctor, code, name } of cases) {
    it(`${name} should carry code ${code} and extend MmkError`, () => {
      const err = new Ctor('Something happened', { detail: 1 });
      expect(err).toBeInstanceOf(MmkError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.name).toBe(name);
      expect(err.message).toBe('Something happened');
      expect(err.context).toEqual({ detail: 1 });
    });

    it(`${name} should be catchable as MmkError with its code`, () => {
      try {
        throw new Ctor('boom');
      } catch (e) {
        expect(e).toBeInstanceOf(MmkError);
        expect((e as MmkError).code).toBe(code);
      }
    });
  }
});
