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
    expect(outcome.duration).toBeGreaterThanOrEqual(5);
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
