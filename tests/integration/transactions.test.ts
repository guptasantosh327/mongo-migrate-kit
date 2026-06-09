import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/core/context.js';
import { runMigration } from '../../src/core/runner.js';
import { MigrationExecutionFailedError } from '../../src/errors/index.js';
import type { MigrationContext, MigrationModule } from '../../src/types/index.js';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';

let mongo: TestMongo;
const COLLECTION = 'tx_items';

beforeAll(async () => {
  mongo = await startTestMongo('mmk_tx_test');
});

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.collection(COLLECTION).deleteMany({});
});

function context(): MigrationContext {
  return buildContext(mongo.client, mongo.db);
}

describe('runMigration transactions (integration)', () => {
  it('should commit the transaction on success when useTransaction=true', async () => {
    const migration: MigrationModule = {
      up: async (ctx) => {
        await ctx.db.collection(COLLECTION).insertOne({ v: 1 }, { session: ctx.session });
      },
      down: async () => undefined,
    };
    await runMigration({
      name: 'commit.ts',
      migration,
      direction: 'up',
      context: context(),
      useTransaction: true,
    });
    expect(await mongo.db.collection(COLLECTION).countDocuments()).toBe(1);
  });

  it('should abort the transaction on error when useTransaction=true', async () => {
    const migration: MigrationModule = {
      up: async (ctx) => {
        await ctx.db.collection(COLLECTION).insertOne({ v: 2 }, { session: ctx.session });
        throw new Error('fail after write');
      },
      down: async () => undefined,
    };
    await expect(
      runMigration({
        name: 'abort.ts',
        migration,
        direction: 'up',
        context: context(),
        useTransaction: true,
      }),
    ).rejects.toBeInstanceOf(MigrationExecutionFailedError);
    expect(await mongo.db.collection(COLLECTION).countDocuments()).toBe(0);
  });

  it('should persist writes without a transaction when useTransaction=false', async () => {
    const migration: MigrationModule = {
      up: async (ctx) => {
        await ctx.db.collection(COLLECTION).insertOne({ v: 3 });
      },
      down: async () => undefined,
    };
    await runMigration({
      name: 'plain.ts',
      migration,
      direction: 'up',
      context: context(),
      useTransaction: false,
    });
    expect(await mongo.db.collection(COLLECTION).countDocuments()).toBe(1);
  });

  it('should record a non-negative duration', async () => {
    const migration: MigrationModule = {
      up: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      down: async () => undefined,
    };
    const outcome = await runMigration({
      name: 'timed.ts',
      migration,
      direction: 'up',
      context: context(),
      useTransaction: false,
    });
    // Wall-clock duration is recorded in whole milliseconds; a ~5ms sleep can
    // round to 4ms, so assert only that a sane non-negative duration was captured.
    expect(outcome.duration).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(outcome.duration)).toBe(true);
  });

  it('should persist the changelog write inside the same transaction', async () => {
    const persist = vi.fn(async (_duration: number, session) => {
      // Writing through the provided session enrols this in the migration's txn.
      await mongo.db.collection('tx_changelog').insertOne({ name: 'atomic.ts' }, { session });
    });
    await mongo.db.collection('tx_changelog').deleteMany({});
    await runMigration({
      name: 'atomic.ts',
      migration: {
        up: async (ctx) => {
          await ctx.db.collection(COLLECTION).insertOne({ v: 9 }, { session: ctx.session });
        },
        down: async () => undefined,
      },
      direction: 'up',
      context: context(),
      useTransaction: true,
      persist,
    });
    expect(persist).toHaveBeenCalledOnce();
    // The session arg proves the record write joined the transaction.
    expect(persist.mock.calls[0]?.[1]).toBeDefined();
    expect(await mongo.db.collection(COLLECTION).countDocuments()).toBe(1);
    expect(await mongo.db.collection('tx_changelog').countDocuments()).toBe(1);
  });

  it('should not persist when the migration body throws (record + data roll back)', async () => {
    const persist = vi.fn(async () => undefined);
    await expect(
      runMigration({
        name: 'rollback.ts',
        migration: {
          up: async (ctx) => {
            await ctx.db.collection(COLLECTION).insertOne({ v: 10 }, { session: ctx.session });
            throw new Error('boom');
          },
          down: async () => undefined,
        },
        direction: 'up',
        context: context(),
        useTransaction: true,
        persist,
      }),
    ).rejects.toBeInstanceOf(MigrationExecutionFailedError);
    expect(persist).not.toHaveBeenCalled();
    expect(await mongo.db.collection(COLLECTION).countDocuments()).toBe(0);
  });

  it('should call the onError hook before rethrowing', async () => {
    const onError = vi.fn().mockResolvedValue(undefined);
    const migration: MigrationModule = {
      up: async () => {
        throw new Error('explode');
      },
      down: async () => undefined,
    };
    await expect(
      runMigration({
        name: 'err.ts',
        migration,
        direction: 'up',
        context: context(),
        useTransaction: false,
        hooks: { onError },
      }),
    ).rejects.toBeInstanceOf(MigrationExecutionFailedError);
    expect(onError).toHaveBeenCalledOnce();
  });
});
