import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { LOCK_ID, MigrationLock, runWithLock } from '../../src/core/lock.js';
import { LockAlreadyHeldError, LockReleaseFailedError } from '../../src/errors/index.js';
import { silentLogger } from '../../src/utils/logger.js';

interface MockCollection {
  updateOne: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  deleteOne: ReturnType<typeof vi.fn>;
}

function makeDb(): { db: Db; collection: MockCollection } {
  // acquire() upserts with a random `owner` token, then reads it back to confirm
  // ownership. The mock captures the token from the update and echoes it from
  // findOne so a successful acquire resolves.
  let storedOwner: string | undefined;
  const collection: MockCollection = {
    updateOne: vi.fn().mockImplementation((_filter, update) => {
      const owner = (update as { $set?: { owner?: string } })?.$set?.owner;
      if (owner) {
        storedOwner = owner;
      }
      return Promise.resolve({ matchedCount: 1 });
    }),
    findOne: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          storedOwner ? { _id: LOCK_ID, owner: storedOwner, pid: process.pid } : null,
        ),
      ),
    deleteOne: vi.fn().mockResolvedValue({}),
  };
  const db = { collection: () => collection } as unknown as Db;
  return { db, collection };
}

describe('MigrationLock.acquire', () => {
  it('should upsert the lock document with the configured _id', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await lock.acquire();
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    const [filter, , options] = collection.updateOne.mock.calls[0];
    expect(filter._id).toBe(LOCK_ID);
    expect(options).toEqual({ upsert: true });
  });

  it('should throw LockAlreadyHeldError on a duplicate-key error', async () => {
    const { db, collection } = makeDb();
    collection.updateOne.mockRejectedValueOnce({ code: 11000 });
    collection.findOne.mockResolvedValueOnce({ _id: LOCK_ID, pid: 999 });
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await expect(lock.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);
  });

  it('should rethrow non-duplicate-key errors', async () => {
    const { db, collection } = makeDb();
    collection.updateOne.mockRejectedValueOnce(new Error('network down'));
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await expect(lock.acquire()).rejects.toThrow('network down');
  });

  it('should throw when another writer won the stale-reclaim race', async () => {
    const { db, collection } = makeDb();
    // Upsert succeeds, but the read-back shows a different owner token.
    collection.findOne.mockResolvedValueOnce({ _id: LOCK_ID, owner: 'other-writer' });
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await expect(lock.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);
  });

  it('should throw when the lock document is missing after upsert', async () => {
    const { db, collection } = makeDb();
    collection.findOne.mockResolvedValueOnce(null);
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await expect(lock.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);
  });
});

describe('MigrationLock.inspect / forceRelease', () => {
  it('should return the current lock document from inspect', async () => {
    const { db, collection } = makeDb();
    const doc = { _id: LOCK_ID, owner: 'abc', pid: 1 };
    collection.findOne.mockResolvedValueOnce(doc);
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    expect(await lock.inspect()).toBe(doc);
  });

  it('should delete and return the existing doc from forceRelease', async () => {
    const { db, collection } = makeDb();
    const doc = { _id: LOCK_ID, owner: 'abc' };
    collection.findOne.mockResolvedValueOnce(doc);
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    expect(await lock.forceRelease()).toBe(doc);
    expect(collection.deleteOne).toHaveBeenCalledWith({ _id: LOCK_ID });
  });

  it('should return null from forceRelease when no lock exists', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    expect(await lock.forceRelease()).toBeNull();
    expect(collection.deleteOne).toHaveBeenCalledWith({ _id: LOCK_ID });
  });
});

describe('MigrationLock.renew', () => {
  it('should return false before the lock is acquired', async () => {
    const { db } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    expect(await lock.renew()).toBe(false);
  });

  it('should return true while the lock is still held', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await lock.acquire();
    collection.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    expect(await lock.renew()).toBe(true);
  });

  it('should return false when the lock has been lost', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await lock.acquire();
    collection.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    expect(await lock.renew()).toBe(false);
  });
});

describe('MigrationLock.release', () => {
  it('should delete the lock document', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await lock.release();
    expect(collection.deleteOne).toHaveBeenCalledWith({ _id: LOCK_ID });
  });

  it('should throw LockReleaseFailedError when delete fails', async () => {
    const { db, collection } = makeDb();
    collection.deleteOne.mockRejectedValueOnce(new Error('boom'));
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await expect(lock.release()).rejects.toBeInstanceOf(LockReleaseFailedError);
  });
});

describe('runWithLock', () => {
  it('should acquire then release around the function on success', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    const result = await runWithLock(lock, { logger: silentLogger }, async () => 'ok');
    expect(result).toBe('ok');
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('should release the lock even when the function throws', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await expect(
      runWithLock(lock, { logger: silentLogger }, async () => {
        throw new Error('migration failed');
      }),
    ).rejects.toThrow('migration failed');
    expect(collection.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('should skip acquisition and warn when noLock is true', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    const warn = vi.fn();
    await runWithLock(lock, { noLock: true, logger: { ...silentLogger, warn } }, async () => 'ok');
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(collection.deleteOne).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});
