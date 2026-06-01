import type { ClientSession } from 'mongodb';
import { MigrationExecutionFailedError } from '../errors/index.js';
import type { MigrationContext, MigrationHooks, MigrationModule } from '../types/index.js';

/** Direction in which a migration is run */
export type RunDirection = 'up' | 'down';

/** Parameters for {@link runMigration} */
export interface RunMigrationParams {
  /** Logical migration name (filename) */
  name: string;
  /** Loaded migration module */
  migration: MigrationModule;
  /** Direction to execute */
  direction: RunDirection;
  /** Base context (without a session) */
  context: MigrationContext;
  /** Whether to wrap execution in a transaction (resolved file-level || global) */
  useTransaction: boolean;
  /** Optional lifecycle hooks */
  hooks?: MigrationHooks;
}

/** Result of running a single migration */
export interface RunMigrationOutcome {
  /** Execution time in milliseconds */
  duration: number;
}

/**
 * Execute a single migration's `up` or `down` safely.
 *
 * When `useTransaction` is true the call is wrapped in a MongoDB session +
 * transaction, committed on success and aborted on failure. On any error the
 * `onError` hook is invoked before a {@link MigrationExecutionFailedError} is
 * thrown — the error is never swallowed.
 */
export async function runMigration(params: RunMigrationParams): Promise<RunMigrationOutcome> {
  const { name, migration, direction, context, useTransaction, hooks } = params;
  const fn = direction === 'up' ? migration.up : migration.down;

  const start = Date.now();
  let session: ClientSession | undefined;
  let runtimeContext = context;

  try {
    if (useTransaction) {
      session = context.client.startSession();
      session.startTransaction();
      runtimeContext = { ...context, session };
    }

    await fn(runtimeContext);

    if (session) {
      await session.commitTransaction();
    }

    return { duration: Date.now() - start };
  } catch (error) {
    if (session) {
      // Abort the transaction; do not let an abort failure mask the original error.
      await session.abortTransaction().catch(() => undefined);
    }

    const err = error instanceof Error ? error : new Error(String(error));

    if (hooks?.onError) {
      await hooks.onError(name, err, runtimeContext);
    }

    throw new MigrationExecutionFailedError(`Migration ${direction} failed: ${name}`, {
      name,
      direction,
      cause: err.message,
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}
