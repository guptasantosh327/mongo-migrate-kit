import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Collection, Db, Document, Filter } from 'mongodb';
import { LockAlreadyHeldError, LockReleaseFailedError } from '../errors/index.js';
import type { MmkLogger } from '../types/index.js';
import { formatDateTime } from '../utils/date.js';
import { explain, quote } from '../utils/explain.js';

/**
 * Fixed `_id` of the singleton lock document. Every repo on a database — any
 * namespace, any `migrationsCollection` — takes this same lock, so all
 * migration runs on a database take turns (and pre-namespace versions, which
 * use the same id, coordinate with newer ones).
 */
export const LOCK_ID = 'mmk_lock';

/** Shape of the lock document stored in the lock collection */
export interface LockDocument {
  _id: string;
  /**
   * When the holder last took or renewed the lock. Kept refreshed by the
   * heartbeat because pre-1.5 versions judge staleness from it.
   */
  lockedAt: Date;
  pid: number;
  host: string;
  executedBy: string;
  /** Random per-acquisition token identifying the current holder instance */
  owner: string;
  /** Namespace of the holder. Absent for the default namespace (or a pre-1.5 holder) */
  namespace?: string;
  /** When the holder first took the lock, by the server clock. Absent for a pre-1.5 holder */
  acquiredAt?: Date;
  /**
   * When the lock goes stale unless renewed: the server clock plus the
   * **holder's** TTL. Absent for a pre-1.5 holder, which is judged by the
   * acquirer's TTL against `lockedAt` instead.
   */
  expiresAt?: Date;
}

/** Wrap a value so an aggregation-pipeline update stores it verbatim (never as a `$field` path) */
function literal(value: unknown): Document {
  return { $literal: value };
}

/**
 * Build the self-explanatory `LOCK_ALREADY_HELD` message: who holds the lock,
 * since when, why repos take turns, when it frees itself, and what to do.
 */
export function lockHeldMessage(holder: LockDocument | null, now = new Date()): string {
  if (!holder) {
    return explain('The migration lock is held by another run', [
      'Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))',
    ]);
  }
  const who =
    holder.namespace === undefined
      ? 'the default namespace'
      : `namespace ${quote(holder.namespace)}`;
  // The document may come from another version, or be written by hand, so
  // describe only the fields that are actually there.
  const since = holder.acquiredAt ?? holder.lockedAt;
  const sinceText =
    since instanceof Date
      ? `, since ${formatDateTime(since)} (${Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000))}s ago)`
      : '';
  const field = (value: unknown): string => (value === undefined ? 'unknown' : String(value));
  return explain(`The migration lock is held by ${who}`, [
    `Holder: host ${field(holder.host)}, pid ${field(holder.pid)}, user ${field(holder.executedBy)}${sinceText}`,
    'Why: all repos on this database take turns — one migration run at a time',
    holder.expiresAt instanceof Date
      ? `If the holder crashed, the lock frees itself at ${formatDateTime(holder.expiresAt)}; \`mmk unlock\` releases it now (check the holder first)`
      : 'If the holder crashed, the lock frees itself once it goes stale; `mmk unlock` releases it now (check the holder first)',
    'Try: run again when it finishes (app start: runMigrations({ onLockHeld: "wait" }))',
  ]);
}

/** Returns true when an error is a MongoDB duplicate-key error (code 11000) */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 11000
  );
}

/**
 * MongoDB-native distributed lock backed by a single document, using an atomic
 * upsert as a test-and-set. A lock older than `ttlSeconds` is considered stale
 * and may be reclaimed.
 */
export class MigrationLock {
  private readonly db: Db;
  private readonly collectionName: string;
  private readonly ttlSeconds: number;
  /** Namespace recorded on the lock document so other repos can see who holds it */
  private readonly namespace: string | undefined;
  /** Token proving this instance is the current holder; set on acquire, cleared on release */
  private owner: string | undefined;

  constructor(db: Db, collectionName: string, ttlSeconds: number, namespace?: string) {
    this.db = db;
    this.collectionName = collectionName;
    this.ttlSeconds = ttlSeconds;
    this.namespace = namespace;
  }

  /** TTL in milliseconds — used to size the renewal heartbeat */
  get ttlMs(): number {
    return this.ttlSeconds * 1000;
  }

  /**
   * The lock collection, pinned to `w: 'majority'` / `readConcern: 'majority'`.
   * Mutual exclusion is only as strong as the lock's durability: a lock write
   * that is rolled back on a primary failover (or a read that sees a stale,
   * not-yet-committed state) would let two runs proceed at once. Majority on
   * both sides closes that window. (Harmless on a standalone, where "majority"
   * is a single node.)
   */
  private coll(): Collection<LockDocument> {
    return this.db.collection<LockDocument>(this.collectionName, {
      writeConcern: { w: 'majority' },
      readConcern: { level: 'majority' },
    });
  }

  /**
   * The database server's current time, from `hello.localTime`. Staleness is
   * judged on the server's clock, never this machine's, so a CI runner or pod
   * whose clock is off cannot mistake a fresh lock for a stale one. (MongoDB
   * does not allow `$expr`/`$$NOW` in an upsert's filter, hence the round trip.)
   */
  private async serverNow(): Promise<Date> {
    const hello = (await this.db.command({ hello: 1 })) as { localTime?: unknown };
    return hello.localTime instanceof Date ? hello.localTime : new Date();
  }

  /**
   * The filter matching a lock that may be taken: none at all (the upsert then
   * inserts), or one that has gone stale by the server's clock.
   *
   * A lock with `expiresAt` is stale once that deadline — set from the
   * *holder's* TTL — has passed, so a repo with a short `lockTTLSeconds` cannot
   * take over from a holder with a long one. A lock without it (written by a
   * pre-1.5 version) falls back to the old rule: `lockedAt` older than this
   * run's TTL.
   */
  private staleFilter(now: Date): Filter<LockDocument> {
    return {
      _id: LOCK_ID,
      $or: [
        { expiresAt: { $lt: now } },
        {
          expiresAt: { $exists: false },
          lockedAt: { $lt: new Date(now.getTime() - this.ttlMs) },
        },
      ],
    };
  }

  /**
   * Acquire the lock, reclaiming it if the existing one is stale.
   * @throws {@link LockAlreadyHeldError} when another process holds a fresh lock
   */
  async acquire(): Promise<void> {
    const collection = this.coll();
    const owner = randomUUID();
    // A pipeline update so the timestamps written come from the server clock
    // too. Values are wrapped in $literal so a string starting with "$" is
    // stored as-is.
    const update: Document[] = [
      {
        $set: {
          lockedAt: '$$NOW',
          acquiredAt: '$$NOW',
          expiresAt: { $add: ['$$NOW', this.ttlMs] },
          pid: literal(process.pid),
          host: literal(os.hostname()),
          executedBy: literal(os.userInfo().username),
          owner: literal(owner),
          ...(this.namespace === undefined ? {} : { namespace: literal(this.namespace) }),
        },
      },
      // Reclaiming a stale lock updates the old document in place, so drop a
      // namespace the previous holder left behind.
      ...(this.namespace === undefined ? [{ $unset: 'namespace' }] : []),
    ];

    try {
      // Matches when no fresh lock exists; upsert inserts (no doc) or updates (stale doc).
      // A fresh lock fails the filter, so the upsert collides on _id → duplicate-key error.
      await collection.updateOne(this.staleFilter(await this.serverNow()), update, {
        upsert: true,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const holder = await collection.findOne({ _id: LOCK_ID });
        throw new LockAlreadyHeldError(lockHeldMessage(holder), {
          holder: holder ?? undefined,
        });
      }
      throw error;
    }

    // Confirm we are the holder. If two processes raced to reclaim the same
    // stale lock, both updates succeed but only the last writer's `owner` wins;
    // the loser reads a different token here and backs off instead of running
    // concurrently.
    const current = await collection.findOne({ _id: LOCK_ID });
    if (!current || current.owner !== owner) {
      throw new LockAlreadyHeldError(lockHeldMessage(current), {
        holder: current ?? undefined,
      });
    }
    this.owner = owner;
  }

  /**
   * Push the lock's deadline forward so a long-running migration's lock never
   * goes stale and gets reclaimed mid-run. Refreshes `lockedAt` too, because
   * pre-1.5 versions judge staleness from it. Scoped to our `owner` token, so it
   * is a no-op if the lock was already lost. Returns true while we still hold it.
   */
  async renew(): Promise<boolean> {
    if (!this.owner) {
      return false;
    }
    const result = await this.coll().updateOne({ _id: LOCK_ID, owner: this.owner }, [
      { $set: { lockedAt: '$$NOW', expiresAt: { $add: ['$$NOW', this.ttlMs] } } },
    ]);
    return result.matchedCount === 1;
  }

  /** Read the current lock document, or null when no lock is held */
  async inspect(): Promise<LockDocument | null> {
    return this.coll().findOne({ _id: LOCK_ID });
  }

  /**
   * Force-delete the lock regardless of who holds it, returning the document
   * that was removed (or null if none). Used by `mmk unlock` to clear a lock
   * left behind by a crashed run — bypasses the owner scoping of {@link release}.
   */
  async forceRelease(): Promise<LockDocument | null> {
    const collection = this.coll();
    const existing = await collection.findOne({ _id: LOCK_ID });
    await collection.deleteOne({ _id: LOCK_ID });
    return existing;
  }

  /**
   * Release the lock by deleting the lock document. Scoped to our `owner` token
   * (when held) so we never delete a lock that has since been reclaimed by
   * another process.
   * @throws {@link LockReleaseFailedError} when the delete operation fails
   */
  async release(): Promise<void> {
    const filter = this.owner ? { _id: LOCK_ID, owner: this.owner } : { _id: LOCK_ID };
    try {
      await this.coll().deleteOne(filter);
      this.owner = undefined;
    } catch (error) {
      throw new LockReleaseFailedError('Failed to release migration lock', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Run `fn` while holding the migration lock. The lock is always released in a
 * `finally` block. While `fn` runs, a heartbeat renews the lock every `ttlMs/2`
 * so a migration that takes longer than the TTL never lets its lock go stale
 * and get reclaimed by another process — the original failure mode that made
 * the lock unsafe for long migrations. When `noLock` is true, acquisition is
 * skipped and a loud warning is emitted — intended for local development only.
 */
export async function runWithLock<T>(
  lock: MigrationLock,
  options: { noLock?: boolean; logger: MmkLogger },
  fn: () => Promise<T>,
): Promise<T> {
  if (options.noLock) {
    options.logger.warn('⚠ Running without a lock (--no-lock) — concurrent runs are unsafe');
    return fn();
  }

  await lock.acquire();

  // Renew at half the TTL so the lock is refreshed comfortably before it would
  // be considered stale. unref() keeps the heartbeat from holding the process
  // open on its own.
  const intervalMs = Math.max(1, Math.floor(lock.ttlMs / 2));
  const heartbeat = setInterval(() => {
    void lock
      .renew()
      .then((held) => {
        if (!held) {
          options.logger.warn(
            '⚠ Lost the migration lock mid-run (renewal failed) — another run may have started',
          );
        }
      })
      .catch(() => undefined);
  }, intervalMs);
  heartbeat.unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await lock.release();
  }
}
