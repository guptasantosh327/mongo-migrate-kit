import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_ID, MigrationLock, runWithLock } from '../../src/core/lock.js';
import { LockAlreadyHeldError } from '../../src/errors/index.js';
import { silentLogger } from '../../src/utils/logger.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';

let mongo: TestMongo;
const COLLECTION = '_mmk_locks';

beforeAll(async () => {
  mongo = await startTestMongo('mmk_lock_test');
});

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.collection(COLLECTION).deleteMany({});
});

describe('MigrationLock (integration)', () => {
  it('should acquire a lock successfully', async () => {
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    await lock.acquire();
    const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc).not.toBeNull();
    expect(doc?.pid).toBe(process.pid);
  });

  it('should throw LockAlreadyHeldError when a lock is held within TTL', async () => {
    const first = new MigrationLock(mongo.db, COLLECTION, 60);
    await first.acquire();
    const second = new MigrationLock(mongo.db, COLLECTION, 60);
    await expect(second.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);
  });

  it('should allow a new lock once the previous one is stale', async () => {
    // Insert a lock that is already older than the (tiny) TTL.
    await mongo.db.collection(COLLECTION).insertOne({
      _id: LOCK_ID,
      lockedAt: new Date(Date.now() - 10_000),
      pid: 1,
      host: 'old-host',
      executedBy: 'old-user',
    });
    const lock = new MigrationLock(mongo.db, COLLECTION, 1);
    await expect(lock.acquire()).resolves.toBeUndefined();
    const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc?.pid).toBe(process.pid);
  });

  it('should release the lock in finally on success', async () => {
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    await runWithLock(lock, { logger: silentLogger }, async () => undefined);
    const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc).toBeNull();
  });

  it('should release the lock in finally on error', async () => {
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    await expect(
      runWithLock(lock, { logger: silentLogger }, async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
    const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc).toBeNull();
  });

  it('should renew a held lock so it survives past its TTL (heartbeat)', async () => {
    // 1s TTL → heartbeat renews every ~500ms. We hold the lock for longer than
    // the TTL; without renewal the lock would have gone stale and been
    // reclaimable, which is the exact bug this fixes.
    const lock = new MigrationLock(mongo.db, COLLECTION, 1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = runWithLock(lock, { logger: silentLogger }, async () => {
      await gate;
    });

    // Wait well past the 1s TTL while the migration is still "running".
    await new Promise((resolve) => setTimeout(resolve, 1400));

    const competitor = new MigrationLock(mongo.db, COLLECTION, 1);
    await expect(competitor.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);

    release();
    await run;

    // Released cleanly afterwards.
    const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc).toBeNull();
  });

  it('should not release a lock that was reclaimed by another holder', async () => {
    const first = new MigrationLock(mongo.db, COLLECTION, 1);
    await first.acquire();

    // Let the lock go stale, then a second holder reclaims it.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = new MigrationLock(mongo.db, COLLECTION, 1);
    await second.acquire();

    // The first holder's release is owner-scoped, so it must not delete the
    // second holder's lock.
    await first.release();
    const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc).not.toBeNull();
  });

  it('should skip acquisition and warn with --no-lock', async () => {
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    const warn = vi.fn();
    await runWithLock(lock, { noLock: true, logger: { ...silentLogger, warn } }, async () => {
      const doc = await mongo.db.collection(COLLECTION).findOne({ _id: LOCK_ID });
      expect(doc).toBeNull();
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});
