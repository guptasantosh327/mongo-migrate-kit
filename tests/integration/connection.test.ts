import { describe, expect, it } from 'vitest';
import { MigratorKit } from '../../src/core/migrator.js';
import { ConnectionFailedError } from '../../src/errors/index.js';

/**
 * A connection failure is the most common production error, and its only useful
 * detail is the driver's reason — which must reach the message without leaking
 * the credentials embedded in the URI.
 */
describe('connection failures (integration)', () => {
  it('should put the reason in the message and redact the password', async () => {
    const migrator = new MigratorKit({
      uri: 'mongodb://admin:sup3rs3cret@db.invalid.test:27017',
      dbName: 'shop',
      migrationsDir: './migrations',
      logger: null,
      mongoClientOptions: { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500 },
    });
    const error = await migrator.connect().catch((e: unknown) => e);
    await migrator.disconnect();

    expect(error).toBeInstanceOf(ConnectionFailedError);
    const message = (error as Error).message;
    expect(message).toContain('Failed to connect to MongoDB at');
    expect(message).toContain('Reason:');
    expect(message).toContain('Database: "shop"');
    // The host survives so the user can see what was dialled…
    expect(message).toContain('db.invalid.test:27017');
    // …but the credentials never do, in the message or the context.
    expect(message).not.toContain('sup3rs3cret');
    expect(message).not.toContain('admin');
    expect(JSON.stringify((error as ConnectionFailedError).context)).not.toContain('sup3rs3cret');
  }, 30_000);
});
