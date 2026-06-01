// Main class
export { MigratorKit } from './core/migrator.js';
export type {
  CreateOptions,
  DownOptions,
  MigratorKitOptions,
  UpOptions,
} from './core/migrator.js';

// Types
export type {
  MigrationContext,
  MigrationHooks,
  MigrationModule,
  MigrationRecord,
  MigrationStatus,
  MmkConfig,
  MmkErrorCode,
  MmkLogger,
  RunResult,
  RunResultStatus,
  StatusRow,
} from './types/index.js';

// Error classes
export {
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
} from './errors/index.js';
