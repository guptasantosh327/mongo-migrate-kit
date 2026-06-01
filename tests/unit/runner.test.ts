import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { MigrationExecutionFailedError } from '../../src/errors/index.js';
import { runMigration } from '../../src/core/runner.js';
import type { MigrationContext, MigrationModule } from '../../src/types/index.js';

function makeContext(): {
  context: MigrationContext;
  session: {
    startTransaction: ReturnType<typeof vi.fn>;
    commitTransaction: ReturnType<typeof vi.fn>;
    abortTransaction: ReturnType<typeof vi.fn>;
    endSession: ReturnType<typeof vi.fn>;
  };
} {
  const session = {
    startTransaction: vi.fn(),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    abortTransaction: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  const client = { startSession: vi.fn(() => session) } as unknown as MongoClient;
  const context: MigrationContext = { client, db: {} as Db };
  return { context, session };
}

describe('runMigration', () => {
  it('should run up without a transaction when useTransaction is false', async () => {
    const { context, session } = makeContext();
    const migration: MigrationModule = {
      up: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
    };
    const result = await runMigration({
      name: 'a.ts',
      migration,
      direction: 'up',
      context,
      useTransaction: false,
    });
    expect(migration.up).toHaveBeenCalledOnce();
    expect(session.startTransaction).not.toHaveBeenCalled();
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should run the down function when direction is down', async () => {
    const { context } = makeContext();
    const migration: MigrationModule = {
      up: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
    };
    await runMigration({ name: 'a.ts', migration, direction: 'down', context, useTransaction: false });
    expect(migration.down).toHaveBeenCalledOnce();
    expect(migration.up).not.toHaveBeenCalled();
  });

  it('should commit the transaction on success when useTransaction is true', async () => {
    const { context, session } = makeContext();
    const migration: MigrationModule = {
      up: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
    };
    await runMigration({ name: 'a.ts', migration, direction: 'up', context, useTransaction: true });
    expect(session.startTransaction).toHaveBeenCalledOnce();
    expect(session.commitTransaction).toHaveBeenCalledOnce();
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('should abort the transaction and call onError before throwing', async () => {
    const { context, session } = makeContext();
    const onError = vi.fn().mockResolvedValue(undefined);
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue(new Error('boom')),
      down: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      runMigration({
        name: 'a.ts',
        migration,
        direction: 'up',
        context,
        useTransaction: true,
        hooks: { onError },
      }),
    ).rejects.toBeInstanceOf(MigrationExecutionFailedError);
    expect(session.abortTransaction).toHaveBeenCalledOnce();
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBe('a.ts');
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('should wrap a non-Error throw in MigrationExecutionFailedError', async () => {
    const { context } = makeContext();
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue('string failure'),
      down: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      runMigration({ name: 'a.ts', migration, direction: 'up', context, useTransaction: false }),
    ).rejects.toBeInstanceOf(MigrationExecutionFailedError);
  });
});
