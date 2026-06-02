// Main class
export { MigratorKit } from './core/migrator.js';
export type {
  CreateOptions,
  DownOptions,
  InitOptions,
  MigratorKitOptions,
  UpOptions,
} from './core/migrator.js';
export type { ConfigFormat } from './utils/template.js';

// Types
export type {
  MigrationContext,
  MigrationExtension,
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
  ConfigFileExistsError,
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
