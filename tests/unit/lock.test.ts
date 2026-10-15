import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { LOCK_ID, MigrationLock, lockHeldMessage, runWithLock } from '../../src/core/lock.js';
import { LockAlreadyHeldError, LockReleaseFailedError } from '../../src/errors/index.js';
import { silentLogger } from '../../src/utils/logger.js';

interface MockCollection {
  updateOne: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  deleteOne: ReturnType<typeof vi.fn>;
}

/** The literal `owner` an acquire() pipeline update writes, if this update is one */
function ownerFrom(update: unknown): string | undefined {
  if (!Array.isArray(update)) return undefined;
  for (const stage of update as Array<{ $set?: { owner?: { $literal?: string } } }>) {
    const owner = stage.$set?.owner?.$literal;
    if (owner) return owner;
  }
  return undefined;
}

function makeDb(): { db: Db; collection: MockCollection; command: ReturnType<typeof vi.fn> } {
  // acquire() reads the server clock (hello.localTime), upserts with a random
  // `owner` token, then reads it back to confirm ownership. The mock captures
  // the token from the pipeline update and echoes it from findOne so a
  // successful acquire resolves.
  let storedOwner: string | undefined;
  const collection: MockCollection = {
    updateOne: vi.fn().mockImplementation((_filter, update) => {
      const owner = ownerFrom(update);
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
  const command = vi.fn().mockResolvedValue({ localTime: SERVER_NOW });
  const db = { collection: () => collection, command } as unknown as Db;
  return { db, collection, command };
}

/** The server time the mocked `hello` reports — deliberately not this machine's clock */
const SERVER_NOW = new Date('2030-01-01T00:00:00.000Z');

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

describe('MigrationLock server clock and namespace', () => {
  it('should judge staleness against the server clock, not this machine', async () => {
    const { db, collection, command } = makeDb();
    await new MigrationLock(db, '_mmk_locks', 60).acquire();
    expect(command).toHaveBeenCalledWith({ hello: 1 });
    const [filter] = collection.updateOne.mock.calls[0] ?? [];
    expect(filter.$or).toEqual([
      { expiresAt: { $lt: SERVER_NOW } },
      { expiresAt: { $exists: false }, lockedAt: { $lt: new Date(SERVER_NOW.getTime() - 60_000) } },
    ]);
  });

  it('should fall back to the local clock when the server reports no localTime', async () => {
    const { db, collection, command } = makeDb();
    command.mockResolvedValueOnce({});
    await new MigrationLock(db, '_mmk_locks', 60).acquire();
    const [filter] = collection.updateOne.mock.calls[0] ?? [];
    expect(filter.$or[0].expiresAt.$lt).toBeInstanceOf(Date);
  });

  it('should write timestamps from the server clock with the holder TTL', async () => {
    const { db, collection } = makeDb();
    await new MigrationLock(db, '_mmk_locks', 90).acquire();
    const [, update] = collection.updateOne.mock.calls[0] ?? [];
    expect(update[0].$set.lockedAt).toBe('$$NOW');
    expect(update[0].$set.acquiredAt).toBe('$$NOW');
    expect(update[0].$set.expiresAt).toEqual({ $add: ['$$NOW', 90_000] });
  });

  it('should record a named namespace on the lock document', async () => {
    const { db, collection } = makeDb();
    await new MigrationLock(db, '_mmk_locks', 60, 'orders-api').acquire();
    const [, update] = collection.updateOne.mock.calls[0] ?? [];
    expect(update[0].$set.namespace).toEqual({ $literal: 'orders-api' });
    expect(update).toHaveLength(1);
  });

  it('should unset a stale holder namespace when taken by the default namespace', async () => {
    const { db, collection } = makeDb();
    await new MigrationLock(db, '_mmk_locks', 60).acquire();
    const [, update] = collection.updateOne.mock.calls[0] ?? [];
    expect(update[0].$set).not.toHaveProperty('namespace');
    expect(update[1]).toEqual({ $unset: 'namespace' });
  });

  it('should push lockedAt and expiresAt forward on renew', async () => {
    const { db, collection } = makeDb();
    const lock = new MigrationLock(db, '_mmk_locks', 60);
    await lock.acquire();
    await lock.renew();
    const [, update] = collection.updateOne.mock.calls[1] ?? [];
    expect(update).toEqual([
      { $set: { lockedAt: '$$NOW', expiresAt: { $add: ['$$NOW', 60_000] } } },
    ]);
  });
});

describe('lockHeldMessage', () => {
  const now = new Date('2026-10-14T12:00:11Z');
  const holder = {
    _id: LOCK_ID,
    lockedAt: new Date('2026-10-14T12:00:10Z'),
    acquiredAt: new Date('2026-10-14T12:00:03Z'),
    expiresAt: new Date('2026-10-14T12:01:10Z'),
    pid: 41,
    host: 'worker-7c9f',
    executedBy: 'deploy',
    owner: 'x',
    namespace: 'orders-worker',
  };

  it('should name the holder namespace, host, pid, user and age', () => {
    const message = lockHeldMessage(holder, now);
    expect(message).toContain('The migration lock is held by namespace "orders-worker"');
    expect(message).toContain('host worker-7c9f, pid 41, user deploy');
    expect(message).toContain('(8s ago)');
    expect(message).toContain('all repos on this database take turns');
    expect(message).toContain('mmk unlock');
  });

  it('should say when the lock frees itself if the holder crashed', () => {
    expect(lockHeldMessage(holder, now)).toMatch(/frees itself at \d{4}-\d{2}-\d{2}/);
  });

  it('should name the default namespace when the holder has none', () => {
    const { namespace: _n, ...unnamed } = holder;
    expect(lockHeldMessage(unnamed, now)).toContain('held by the default namespace');
  });

  it('should describe a pre-1.5 holder without acquiredAt or expiresAt', () => {
    const legacy = {
      _id: LOCK_ID,
      lockedAt: holder.lockedAt,
      pid: 7,
      host: 'h',
      executedBy: 'u',
      owner: 'o',
    };
    const message = lockHeldMessage(legacy, now);
    expect(message).toContain('(1s ago)');
    expect(message).toContain('once it goes stale');
  });

  it('should not crash on a hand-written lock missing fields', () => {
    const partial = { _id: LOCK_ID, pid: 999 } as unknown as Parameters<typeof lockHeldMessage>[0];
    const message = lockHeldMessage(partial, now);
    expect(message).toContain('host unknown, pid 999, user unknown');
    expect(message).not.toContain('ago');
  });

  it('should still explain what to do when the holder vanished', () => {
    expect(lockHeldMessage(null)).toContain('held by another run');
  });

  it('should be the message of a LockAlreadyHeldError on a duplicate key', async () => {
    const { db, collection } = makeDb();
    collection.updateOne.mockRejectedValueOnce({ code: 11000 });
    collection.findOne.mockResolvedValueOnce(holder);
    const error = await new MigrationLock(db, '_mmk_locks', 60).acquire().catch((e) => e);
    expect(error).toBeInstanceOf(LockAlreadyHeldError);
    expect(error.message).toContain('namespace "orders-worker"');
    expect(error.context.holder).toBe(holder);
  });
});
