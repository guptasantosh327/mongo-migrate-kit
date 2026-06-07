import os from 'node:os';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pendingMigrations, runMigrations } from '../../src/core/run.js';
import { LockAlreadyHeldError, MigrationExecutionFailedError } from '../../src/errors/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import { failingMigration, insertMigration, makeProject } from '../helpers/project.js';

let mongo: TestMongo;
const DB = 'mmk_run_test';
const LOCK_COLLECTION = '_mmk_locks';

beforeAll(async () => {
  mongo = await startTestMongo(DB);
});

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.dropDatabase();
});

let project: ReturnType<typeof makeProject>;

afterEach(() => {
  project?.cleanup();
});

/** Base config pointed at the test mongo + project dir, output silenced */
function config(): { uri: string; dbName: string; migrationsDir: string; logger: null } {
  return { uri: mongo.uri, dbName: DB, migrationsDir: project.dir, logger: null };
}

/** Insert a fresh (non-stale) lock document so acquisition is blocked */
async function holdLock(): Promise<void> {
  await mongo.db.collection(LOCK_COLLECTION).insertOne({
    _id: 'mmk_lock',
    lockedAt: new Date(),
    pid: 999_999,
    host: os.hostname(),
    executedBy: 'peer',
    owner: 'peer-token',
  });
}

describe('runMigrations (programmatic entry point)', () => {
  it('should apply all pending migrations and report them', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));

    const summary = await runMigrations(config());

    expect(summary.applied.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(summary.upToDate).toBe(false);
    expect(summary.waited).toBe(false);
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should report upToDate when nothing is pending', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runMigrations(config());

    const summary = await runMigrations(config());
    expect(summary.applied).toEqual([]);
    expect(summary.upToDate).toBe(true);
  });

  it('should propagate a migration failure and not leak the connection', async () => {
    project = makeProject();
    project.write('0001-bad.ts', failingMigration());

    await expect(runMigrations(config())).rejects.toBeInstanceOf(MigrationExecutionFailedError);

    // A follow-up connection-managed call still works — the failed run
    // disconnected cleanly in its finally block (no leaked client).
    const pending = await pendingMigrations(config());
    expect(pending.map((row) => row.file)).toEqual(['0001-bad.ts']);
  });

  it('should throw LockAlreadyHeldError by default when the lock is held', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await holdLock();

    await expect(runMigrations(config())).rejects.toBeInstanceOf(LockAlreadyHeldError);
    // Nothing applied while another process holds the lock.
    expect(await mongo.db.collection('things').countDocuments()).toBe(0);
  });

  it('should wait for a held lock to release, then run (onLockHeld: wait)', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await holdLock();

    // Release the peer's lock shortly after we start waiting.
    const release = (async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 150));
      await mongo.db.collection(LOCK_COLLECTION).deleteOne({ _id: 'mmk_lock' });
    })();

    const [summary] = await Promise.all([
      runMigrations(config(), {
        onLockHeld: 'wait',
        lockPollIntervalMs: 40,
        lockWaitTimeoutMs: 5_000,
      }),
      release,
    ]);

    expect(summary.waited).toBe(true);
    expect(summary.applied.map((r) => r.status)).toEqual(['applied']);
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should give up waiting after the timeout and throw', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await holdLock();

    await expect(
      runMigrations(config(), {
        onLockHeld: 'wait',
        lockPollIntervalMs: 40,
        lockWaitTimeoutMs: 120,
      }),
    ).rejects.toBeInstanceOf(LockAlreadyHeldError);
  });
});

describe('pendingMigrations (readiness probe)', () => {
  it('should return only the not-yet-applied migrations', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await runMigrations(config()); // apply both

    project.write('0003-c.ts', insertMigration('things', 'c'));
    const pending = await pendingMigrations(config());

    expect(pending.map((row) => row.file)).toEqual(['0003-c.ts']);
    expect(pending.every((row) => row.status === 'pending')).toBe(true);
  });

  it('should return an empty array when fully migrated', async () => {
    project = makeProject();
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runMigrations(config());

    expect(await pendingMigrations(config())).toEqual([]);
  });
});
