import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Db } from 'mongodb';
import { LockAlreadyHeldError, LockReleaseFailedError } from '../errors/index.js';
import type { MmkLogger } from '../types/index.js';

/** Fixed `_id` of the singleton lock document */
export const LOCK_ID = 'mmk_lock';

/** Shape of the lock document stored in the lock collection */
export interface LockDocument {
  _id: string;
  lockedAt: Date;
  pid: number;
  host: string;
  executedBy: string;
  /** Random per-acquisition token identifying the current holder instance */
  owner: string;
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
  /** Token proving this instance is the current holder; set on acquire, cleared on release */
  private owner: string | undefined;

  constructor(db: Db, collectionName: string, ttlSeconds: number) {
    this.db = db;
    this.collectionName = collectionName;
    this.ttlSeconds = ttlSeconds;
  }

  /** TTL in milliseconds — used to size the renewal heartbeat */
  get ttlMs(): number {
    return this.ttlSeconds * 1000;
  }

  /**
   * Acquire the lock, reclaiming it if the existing one is stale.
   * @throws {@link LockAlreadyHeldError} when another process holds a fresh lock
   */
  async acquire(): Promise<void> {
    const collection = this.db.collection<LockDocument>(this.collectionName);
    const staleThreshold = new Date(Date.now() - this.ttlSeconds * 1000);
    const owner = randomUUID();
    const lockFields = {
      lockedAt: new Date(),
      pid: process.pid,
      host: os.hostname(),
      executedBy: os.userInfo().username,
      owner,
    };

    try {
      // Matches when no fresh lock exists; upsert inserts (no doc) or updates (stale doc).
      // A fresh lock fails the filter, so the upsert collides on _id → duplicate-key error.
      await collection.updateOne(
        { _id: LOCK_ID, lockedAt: { $lt: staleThreshold } },
        { $set: lockFields },
        { upsert: true },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const holder = await collection.findOne({ _id: LOCK_ID });
        throw new LockAlreadyHeldError('Migration lock is already held', {
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
      throw new LockAlreadyHeldError('Migration lock is already held', {
        holder: current ?? undefined,
      });
    }
    this.owner = owner;
  }

  /**
   * Refresh `lockedAt` so a long-running migration's lock never goes stale and
   * gets reclaimed mid-run. Scoped to our `owner` token, so it is a no-op if the
   * lock was already lost. Returns true while we still hold the lock.
   */
  async renew(): Promise<boolean> {
    if (!this.owner) {
      return false;
    }
    const result = await this.db
      .collection<LockDocument>(this.collectionName)
      .updateOne({ _id: LOCK_ID, owner: this.owner }, { $set: { lockedAt: new Date() } });
    return result.matchedCount === 1;
  }

  /** Read the current lock document, or null when no lock is held */
  async inspect(): Promise<LockDocument | null> {
    return this.db.collection<LockDocument>(this.collectionName).findOne({ _id: LOCK_ID });
  }

  /**
   * Force-delete the lock regardless of who holds it, returning the document
   * that was removed (or null if none). Used by `mmk unlock` to clear a lock
   * left behind by a crashed run — bypasses the owner scoping of {@link release}.
   */
  async forceRelease(): Promise<LockDocument | null> {
    const collection = this.db.collection<LockDocument>(this.collectionName);
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
      await this.db.collection<LockDocument>(this.collectionName).deleteOne(filter);
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
