// Main class
export { MigratorKit } from './core/migrator.js';
export type {
  CreateOptions,
  DownOptions,
  ImportOptions,
  InitOptions,
  MigratorKitOptions,
  UpOptions,
} from './core/migrator.js';
export type { ConfigFormat } from './utils/template.js';

// Types
export type {
  ImportChecksumSource,
  ImportResult,
  ImportRow,
  LockInfo,
  MigrateMongoDoc,
  MigrationContext,
  MigrationExtension,
  MigrationHooks,
  MigrationModule,
  MigrationOrigin,
  MigrationRecord,
  MigrationStatus,
  MmkConfig,
  MmkConfigInput,
  MmkErrorCode,
  MmkLogger,
  ProgressReporter,
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
  ImportTargetNotEmptyError,
  IrreversibleMigrationError,
  LockAlreadyHeldError,
  LockReleaseFailedError,
  MigrationExecutionFailedError,
  MigrationFileNotFoundError,
  MigrationInvalidExportError,
  MigrationInvalidNameError,
  MmkError,
  NotAppliedError,
} from './errors/index.js';
