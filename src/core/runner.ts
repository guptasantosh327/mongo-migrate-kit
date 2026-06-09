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
  /**
   * Persist the changelog record for this migration. Invoked after `up`/`down`
   * succeeds but **before the transaction commits**, with the active `session`
   * (when transactional), so the changelog write joins the same transaction as
   * the migration's own writes — they commit, or roll back, atomically. This
   * closes the "committed the data but crashed before recording it → re-applied
   * next run" window. Outside a transaction it simply runs immediately after.
   */
  persist?: (duration: number, session?: ClientSession) => Promise<void>;
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
  const { name, migration, direction, context, useTransaction, hooks, persist } = params;
  const fn = direction === 'up' ? migration.up : migration.down;

  const start = Date.now();
  let session: ClientSession | undefined;
  let runtimeContext = context;

  try {
    if (useTransaction) {
      session = context.client.startSession();
      // Commit the transaction with majority durability so the migration's
      // writes (and the changelog record persisted within it) survive failover.
      session.startTransaction({ writeConcern: { w: 'majority' } });
      runtimeContext = { ...context, session };
    }

    await fn(runtimeContext);

    // Duration measures the migration body only (not commit time).
    const duration = Date.now() - start;

    // Record the migration inside the transaction, before commit, so the data
    // and its changelog entry are atomic.
    await persist?.(duration, session);

    if (session) {
      await session.commitTransaction();
    }

    return { duration };
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
