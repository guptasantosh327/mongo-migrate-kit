import { setTimeout as delay } from 'node:timers/promises';
import { LockAlreadyHeldError } from '../errors/index.js';
import type { MmkConfig, RunResult, StatusRow } from '../types/index.js';
import { resolveLogger } from '../utils/logger.js';
import { MigratorKit, type MigratorKitOptions } from './migrator.js';

/** What to do when another process already holds the migration lock */
export type OnLockHeld = 'throw' | 'wait';

/** Options for {@link runMigrations} */
export interface RunMigrationsOptions extends MigratorKitOptions {
  /** Skip lock acquisition (dev only — never in production) */
  noLock?: boolean;
  /**
   * How to react when another process already holds the migration lock — the
   * typical case when several app instances boot at once.
   * - `'throw'` (default): propagate {@link LockAlreadyHeldError}.
   * - `'wait'`: poll until the lock frees, then run. Because the peer applies
   *   the pending migrations while we wait, this instance ends up confirming
   *   the database is fully migrated before it returns — exactly what you want
   *   before an app starts serving traffic.
   */
  onLockHeld?: OnLockHeld;
  /** Max time (ms) to wait when `onLockHeld: 'wait'`. Default: 30000 */
  lockWaitTimeoutMs?: number;
  /** Poll interval (ms) while waiting for the lock. Default: 500 */
  lockPollIntervalMs?: number;
}

/** Outcome of a {@link runMigrations} call */
export interface MigrationSummary {
  /** Migrations applied during this call (empty when nothing was pending) */
  applied: RunResult[];
  /** True when no migrations were pending — the database was already up to date */
  upToDate: boolean;
  /** True when this instance waited for a peer to release the lock before running */
  waited: boolean;
}

const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 500;

/**
 * Run all pending migrations and return a summary — the blessed one-call entry
 * point for application startup, deploy hooks, serverless cold starts, and test
 * setup.
 *
 * Unlike driving {@link MigratorKit} by hand, this opens its own connection,
 * runs pending `up` migrations, and **always disconnects in a `finally`** so a
 * failure never leaks a MongoDB connection. Migration errors propagate
 * unchanged (as {@link MmkError} subclasses with a typed `code`) so a broken
 * migration aborts your boot sequence instead of starting the app against a
 * half-migrated database.
 *
 * For multi-instance deploys, set `onLockHeld: 'wait'` so instances that lose
 * the race to acquire the lock block until the migrating peer finishes, then
 * confirm there is nothing left to apply.
 *
 * @example
 * ```ts
 * import { runMigrations } from 'mongo-migrate-kit';
 *
 * const { applied, upToDate } = await runMigrations(
 *   { uri: process.env.MONGO_URI!, dbName: 'my_app' },
 *   { onLockHeld: 'wait' },
 * );
 * if (!upToDate) console.log(`Applied ${applied.length} migration(s)`);
 * ```
 */
export async function runMigrations(
  config: Partial<MmkConfig> = {},
  options: RunMigrationsOptions = {},
): Promise<MigrationSummary> {
  const {
    noLock,
    onLockHeld = 'throw',
    lockWaitTimeoutMs = DEFAULT_LOCK_WAIT_TIMEOUT_MS,
    lockPollIntervalMs = DEFAULT_LOCK_POLL_INTERVAL_MS,
    ...kitOptions
  } = options;

  const kit = new MigratorKit(config, kitOptions);
  const logger = resolveLogger(config.logger);
  let waited = false;

  try {
    await kit.connect();
    const deadline = Date.now() + lockWaitTimeoutMs;

    for (;;) {
      try {
        const applied = await kit.up(undefined, noLock ? { noLock: true } : {});
        return { applied, upToDate: applied.length === 0, waited };
      } catch (error) {
        const canWait =
          onLockHeld === 'wait' &&
          error instanceof LockAlreadyHeldError &&
          Date.now() + lockPollIntervalMs <= deadline;
        if (!canWait) {
          throw error;
        }
        if (!waited) {
          logger.info('Migration lock held by another process — waiting for it to release…');
        }
        waited = true;
        await delay(lockPollIntervalMs);
      }
    }
  } finally {
    await kit.disconnect();
  }
}

/**
 * Return the migrations that have not yet been applied — a connection-managed
 * readiness probe. Opens its own connection and always disconnects in a
 * `finally`. Use it to fail a deploy/health check when the database is behind
 * (`(await pendingMigrations(config)).length === 0`) without running anything.
 *
 * @example
 * ```ts
 * import { pendingMigrations } from 'mongo-migrate-kit';
 *
 * const pending = await pendingMigrations({ uri, dbName: 'my_app' });
 * if (pending.length > 0) {
 *   throw new Error(`Database is behind by ${pending.length} migration(s)`);
 * }
 * ```
 */
export async function pendingMigrations(
  config: Partial<MmkConfig> = {},
  options: MigratorKitOptions = {},
): Promise<StatusRow[]> {
  const kit = new MigratorKit(config, options);
  try {
    await kit.connect();
    return await kit.list('pending');
  } finally {
    await kit.disconnect();
  }
}
