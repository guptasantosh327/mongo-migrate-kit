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

  constructor(db: Db, collectionName: string, ttlSeconds: number) {
    this.db = db;
    this.collectionName = collectionName;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Acquire the lock, reclaiming it if the existing one is stale.
   * @throws {@link LockAlreadyHeldError} when another process holds a fresh lock
   */
  async acquire(): Promise<void> {
    const collection = this.db.collection<LockDocument>(this.collectionName);
    const staleThreshold = new Date(Date.now() - this.ttlSeconds * 1000);
    const lockFields = {
      lockedAt: new Date(),
      pid: process.pid,
      host: os.hostname(),
      executedBy: os.userInfo().username,
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
  }

  /**
   * Release the lock by deleting the lock document.
   * @throws {@link LockReleaseFailedError} when the delete operation fails
   */
  async release(): Promise<void> {
    try {
      await this.db.collection<LockDocument>(this.collectionName).deleteOne({ _id: LOCK_ID });
    } catch (error) {
      throw new LockReleaseFailedError('Failed to release migration lock', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Run `fn` while holding the migration lock. The lock is always released in a
 * `finally` block. When `noLock` is true, acquisition is skipped and a loud
 * warning is emitted — intended for local development only.
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
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
