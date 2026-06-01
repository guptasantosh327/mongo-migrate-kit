import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { LockAlreadyHeldError, LockReleaseFailedError } from '../../src/errors/index.js';
import { LOCK_ID, MigrationLock, runWithLock } from '../../src/core/lock.js';
import { silentLogger } from '../../src/utils/logger.js';

interface MockCollection {
  updateOne: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  deleteOne: ReturnType<typeof vi.fn>;
}

function makeDb(): { db: Db; collection: MockCollection } {
  const collection: MockCollection = {
    updateOne: vi.fn().mockResolvedValue({}),
    findOne: vi.fn().mockResolvedValue(null),
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
