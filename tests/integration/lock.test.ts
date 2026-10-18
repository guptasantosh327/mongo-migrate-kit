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

describe('MigrationLock across repos (integration)', () => {
  it("should not let a short-TTL repo take over a long-TTL holder's lock", async () => {
    // billing-api holds the lock with a 10-minute TTL; checkout-api uses 1s.
    // Before 1.5 the acquirer judged staleness by ITS OWN TTL, so after 1s it
    // would take the lock while billing's migration was still running.
    const holder = new MigrationLock(mongo.db, COLLECTION, 600, 'billing-api');
    await holder.acquire();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const shortTtl = new MigrationLock(mongo.db, COLLECTION, 1, 'checkout-api');
    await expect(shortTtl.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);
  });

  it('should reclaim a lock whose expiresAt has passed', async () => {
    await mongo.db.collection<{ _id: string }>(COLLECTION).insertOne({
      _id: LOCK_ID,
      lockedAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
      pid: 1,
      host: 'crashed-host',
      executedBy: 'old-user',
      owner: 'stale',
      namespace: 'billing-api',
    });
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    await expect(lock.acquire()).resolves.toBeUndefined();
    const doc = await mongo.db.collection<{ _id: string }>(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc?.pid).toBe(process.pid);
    // Taken by the default namespace: the previous holder's namespace is gone.
    expect(doc).not.toHaveProperty('namespace');
  });

  it('should keep a fresh lock even when this machine clock runs far ahead', async () => {
    const holder = new MigrationLock(mongo.db, COLLECTION, 60, 'billing-api');
    await holder.acquire();
    // An hour of clock skew on the acquirer. Judged on the local clock, the
    // holder's lock would look an hour old — far past its 60s TTL.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3_600_000);
    try {
      const skewed = new MigrationLock(mongo.db, COLLECTION, 60, 'checkout-api');
      await expect(skewed.acquire()).rejects.toBeInstanceOf(LockAlreadyHeldError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should write server-clock timestamps and the holder TTL deadline', async () => {
    const lock = new MigrationLock(mongo.db, COLLECTION, 90, 'orders-api');
    await lock.acquire();
    const doc = await mongo.db.collection<{ _id: string }>(COLLECTION).findOne({ _id: LOCK_ID });
    expect(doc?.namespace).toBe('orders-api');
    expect(doc?.acquiredAt).toBeInstanceOf(Date);
    expect(doc?.expiresAt.getTime() - doc?.lockedAt.getTime()).toBe(90_000);
  });

  it('should move expiresAt forward on renew', async () => {
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    await lock.acquire();
    const before = await mongo.db.collection<{ _id: string }>(COLLECTION).findOne({ _id: LOCK_ID });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await lock.renew()).toBe(true);
    const after = await mongo.db.collection<{ _id: string }>(COLLECTION).findOne({ _id: LOCK_ID });
    expect(after?.expiresAt.getTime()).toBeGreaterThan(before?.expiresAt.getTime());
    expect(after?.acquiredAt.getTime()).toBe(before?.acquiredAt.getTime());
  });
});

describe('MigrationLock.status (integration)', () => {
  const locks = () => mongo.db.collection<{ _id: string }>(COLLECTION);

  it('should return null when no lock is held, and create nothing', async () => {
    await mongo.db
      .collection(COLLECTION)
      .drop()
      .catch(() => undefined);
    const lock = new MigrationLock(mongo.db, COLLECTION, 60);
    expect(await lock.status()).toBeNull();
    const collections = await mongo.db.listCollections({ name: COLLECTION }).toArray();
    expect(collections).toHaveLength(0);
  });

  it('should report a held lock as not stale, and leave it exactly as it was', async () => {
    const holder = new MigrationLock(mongo.db, COLLECTION, 60, 'billing-api');
    await holder.acquire();
    const before = await locks().findOne({ _id: LOCK_ID });

    const status = await new MigrationLock(mongo.db, COLLECTION, 60).status();

    expect(status?.stale).toBe(false);
    expect(status?.holder).toEqual(before);
    expect(await locks().findOne({ _id: LOCK_ID })).toEqual(before);
  });

  it('should report a lock whose expiresAt has passed as stale', async () => {
    await locks().insertOne({
      _id: LOCK_ID,
      lockedAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
      pid: 1,
      host: 'crashed-host',
      executedBy: 'old-user',
      owner: 'stale',
    });
    const status = await new MigrationLock(mongo.db, COLLECTION, 60).status();
    expect(status?.stale).toBe(true);
    expect(status?.holder.host).toBe('crashed-host');
  });

  it("should judge a lock without expiresAt (a pre-1.5 holder) by this run's TTL", async () => {
    await locks().insertOne({
      _id: LOCK_ID,
      lockedAt: new Date(Date.now() - 10_000),
      pid: 1,
      host: 'old-host',
      executedBy: 'old-user',
    });
    expect((await new MigrationLock(mongo.db, COLLECTION, 1).status())?.stale).toBe(true);
    expect((await new MigrationLock(mongo.db, COLLECTION, 60).status())?.stale).toBe(false);
  });

  it("should keep judging by the holder's TTL: a short-TTL reader sees a fresh lock", async () => {
    const holder = new MigrationLock(mongo.db, COLLECTION, 600, 'billing-api');
    await holder.acquire();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await new MigrationLock(mongo.db, COLLECTION, 1).status())?.stale).toBe(false);
  });
});
