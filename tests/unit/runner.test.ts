import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { runMigration } from '../../src/core/runner.js';
import { MigrationExecutionFailedError } from '../../src/errors/index.js';
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
    await runMigration({
      name: 'a.ts',
      migration,
      direction: 'down',
      context,
      useTransaction: false,
    });
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

  it("should carry the migration's own error into the message, not just the context", async () => {
    const { context } = makeContext();
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue(new Error('E11000 duplicate key error')),
      down: vi.fn().mockResolvedValue(undefined),
    };
    const error = await runMigration({
      name: 'a.ts',
      migration,
      direction: 'up',
      context,
      useTransaction: false,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationExecutionFailedError);
    const message = (error as Error).message;
    expect(message).toContain('"a.ts"');
    expect(message).toContain('running up()');
    expect(message).toContain('Reason: E11000 duplicate key error');
    // Without a transaction, partial writes survive — say so.
    expect(message).toContain('still in the database');
    expect(message).toContain('later migrations were not run');
  });

  it('should say writes were rolled back when the migration ran in a transaction', async () => {
    const { context } = makeContext();
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue(new Error('boom')),
      down: vi.fn().mockResolvedValue(undefined),
    };
    const error = await runMigration({
      name: 'a.ts',
      migration,
      direction: 'up',
      context,
      useTransaction: true,
    }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('rolled back');
  });

  it('should omit the location line when the error carries no usable stack', async () => {
    const { context } = makeContext();
    const bare = new Error('no stack here');
    bare.stack = undefined;
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue(bare),
      down: vi.fn().mockResolvedValue(undefined),
    };
    const error = await runMigration({
      name: 'a.ts',
      migration,
      direction: 'up',
      context,
      useTransaction: false,
    }).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain('Reason: no stack here');
    expect(message).not.toContain('Thrown at:');
    expect((error as MigrationExecutionFailedError).context?.location).toBeUndefined();
  });

  it('should skip mmk-internal frames when reporting where a migration threw', async () => {
    const { context } = makeContext();
    const err = new Error('from deep inside');
    // Only library/internal frames: nothing here belongs to a migration file.
    err.stack = [
      'Error: from deep inside',
      '    at Object.run (/app/node_modules/mongodb/lib/operations.js:12:9)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue(err),
      down: vi.fn().mockResolvedValue(undefined),
    };
    const error = await runMigration({
      name: 'a.ts',
      migration,
      direction: 'up',
      context,
      useTransaction: false,
    }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('Thrown at:');
  });

  it('should strip a file:// prefix from the reported location', async () => {
    const { context } = makeContext();
    const err = new Error('boom');
    err.stack = ['Error: boom', '    at up (file:///app/migrations/0001-a.js:4:11)'].join('\n');
    const migration: MigrationModule = {
      up: vi.fn().mockRejectedValue(err),
      down: vi.fn().mockResolvedValue(undefined),
    };
    const error = await runMigration({
      name: 'a.ts',
      migration,
      direction: 'up',
      context,
      useTransaction: false,
    }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('Thrown at: /app/migrations/0001-a.js:4:11');
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
