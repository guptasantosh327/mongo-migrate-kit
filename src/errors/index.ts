import type { MmkErrorCode } from '../types/index.js';

/** Base error for all mongo-migrate-kit failures. Carries a typed code and context */
export class MmkError extends Error {
  readonly code: MmkErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(code: MmkErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'MmkError';
    this.code = code;
    if (context !== undefined) {
      this.context = context;
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Thrown when a lock is already held by another process within its TTL */
export class LockAlreadyHeldError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('LOCK_ALREADY_HELD', message, context);
    this.name = 'LockAlreadyHeldError';
  }
}

/** Thrown when releasing a lock fails */
export class LockReleaseFailedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('LOCK_RELEASE_FAILED', message, context);
    this.name = 'LockReleaseFailedError';
  }
}

/** Thrown when a file's checksum differs from the one recorded at apply time */
export class ChecksumMismatchError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CHECKSUM_MISMATCH', message, context);
    this.name = 'ChecksumMismatchError';
  }
}

/** Thrown when a referenced migration file does not exist on disk */
export class MigrationFileNotFoundError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MIGRATION_FILE_NOT_FOUND', message, context);
    this.name = 'MigrationFileNotFoundError';
  }
}

/** Thrown when a migration file does not export valid up()/down() functions */
export class MigrationInvalidExportError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MIGRATION_INVALID_EXPORT', message, context);
    this.name = 'MigrationInvalidExportError';
  }
}

/** Thrown when a migration's up() or down() throws during execution */
export class MigrationExecutionFailedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MIGRATION_EXECUTION_FAILED', message, context);
    this.name = 'MigrationExecutionFailedError';
  }
}

/** Thrown when the merged configuration fails validation */
export class ConfigInvalidError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFIG_INVALID', message, context);
    this.name = 'ConfigInvalidError';
  }
}

/** Thrown when connecting to MongoDB fails */
export class ConnectionFailedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONNECTION_FAILED', message, context);
    this.name = 'ConnectionFailedError';
  }
}

/** Thrown when attempting to apply a migration that is already applied */
export class AlreadyAppliedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('ALREADY_APPLIED', message, context);
    this.name = 'AlreadyAppliedError';
  }
}

/** Thrown when attempting to revert a migration that was never applied */
export class NotAppliedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('NOT_APPLIED', message, context);
    this.name = 'NotAppliedError';
  }
}
