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

/**
 * Thrown when a migration name is not a plain filename — e.g. it contains a
 * path separator or `..`, which would let a target escape the migrations
 * directory (path traversal) when joined into a filesystem path.
 */
export class MigrationInvalidNameError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MIGRATION_INVALID_NAME', message, context);
    this.name = 'MigrationInvalidNameError';
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

/**
 * Thrown when a command argument or flag is missing, malformed, or contradicts
 * another one — e.g. `--steps abc`, `--steps` together with `--batch`, or
 * `mmk create` with a name that slugifies to nothing.
 *
 * Distinct from {@link ConfigInvalidError}, which is about `mmk.config.*` /
 * `MMK_*` settings: this one always points at what the user just typed.
 */
export class InvalidArgumentError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('INVALID_ARGUMENT', message, context);
    this.name = 'InvalidArgumentError';
  }
}

/** Thrown when creating a config file that already exists without `--force` */
export class ConfigFileExistsError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFIG_FILE_EXISTS', message, context);
    this.name = 'ConfigFileExistsError';
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

/** Thrown when `mmk import` targets a non-empty changelog without `--force` */
export class ImportTargetNotEmptyError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('IMPORT_TARGET_NOT_EMPTY', message, context);
    this.name = 'ImportTargetNotEmptyError';
  }
}

/** Thrown when attempting to roll back a migrate-mongo-imported (forward-only) migration */
export class IrreversibleMigrationError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MIGRATION_IRREVERSIBLE', message, context);
    this.name = 'IrreversibleMigrationError';
  }
}

/**
 * Thrown when a migration requests a transaction (`useTransaction`) but the
 * connected deployment is a standalone `mongod`, which cannot run transactions.
 * Surfaced before the migration runs so it fails fast instead of part-way
 * through at commit time.
 */
export class TransactionsUnsupportedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('TRANSACTIONS_UNSUPPORTED', message, context);
    this.name = 'TransactionsUnsupportedError';
  }
}

/**
 * Thrown before anything runs when a migration file to apply is already
 * recorded under a different namespace in the same changelog collection —
 * usually because this repo's `namespace` was changed or mistyped, or because
 * two repos sharing the collection used the same filename.
 */
export class MigrationNameConflictError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MIGRATION_NAME_CONFLICT', message, context);
    this.name = 'MigrationNameConflictError';
  }
}

/**
 * Thrown when this repo has a `namespace` but some of its migrations were
 * applied before it had one, so their records carry no namespace yet. Fixed by
 * `mmk namespace adopt`; refusing until then stops those migrations from
 * looking pending and running a second time.
 */
export class NamespaceUnadoptedError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('NAMESPACE_UNADOPTED', message, context);
    this.name = 'NamespaceUnadoptedError';
  }
}

/**
 * Thrown on connect when the database was last written by a newer
 * mongo-migrate-kit whose storage format this version does not understand.
 */
export class SchemaTooNewError extends MmkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('SCHEMA_TOO_NEW', message, context);
    this.name = 'SchemaTooNewError';
  }
}
