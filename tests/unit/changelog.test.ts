import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { Changelog } from '../../src/core/changelog.js';
import { makeRecord } from '../helpers/records.js';

interface MockCollection {
  createIndex: ReturnType<typeof vi.fn>;
  replaceOne: ReturnType<typeof vi.fn>;
  updateOne: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
}

function makeDb(): { db: Db; collection: MockCollection } {
  const collection: MockCollection = {
    createIndex: vi.fn().mockResolvedValue('name_1'),
    replaceOne: vi.fn().mockResolvedValue({}),
    updateOne: vi.fn().mockResolvedValue({}),
    findOne: vi.fn().mockResolvedValue(null),
  };
  const db = { collection: () => collection } as unknown as Db;
  return { db, collection };
}

describe('Changelog (mocked DB)', () => {
  it('ensureIndexes should create a unique index on name', async () => {
    const { db, collection } = makeDb();
    await new Changelog('_mmk_migrations').ensureIndexes(db);
    expect(collection.createIndex).toHaveBeenCalledWith({ name: 1 }, { unique: true });
  });

  it('markApplied should upsert keyed on name', async () => {
    const { db, collection } = makeDb();
    const record = makeRecord({ name: 'a.ts' });
    await new Changelog('_mmk_migrations').markApplied(db, record);
    expect(collection.replaceOne).toHaveBeenCalledWith(
      { namespace: { $exists: false }, name: 'a.ts' },
      record,
      { upsert: true },
    );
  });

  it('markReverted should set status and revertedAt without deleting', async () => {
    const { db, collection } = makeDb();
    await new Changelog('_mmk_migrations').markReverted(db, 'a.ts');
    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ namespace: { $exists: false }, name: 'a.ts', status: 'applied' });
    expect(update.$set.status).toBe('reverted');
    expect(update.$set.revertedAt).toBeInstanceOf(Date);
  });

  it('getByName should query findOne by name', async () => {
    const { db, collection } = makeDb();
    collection.findOne.mockResolvedValueOnce(makeRecord({ name: 'a.ts' }));
    const found = await new Changelog('_mmk_migrations').getByName(db, 'a.ts');
    expect(collection.findOne).toHaveBeenCalledWith({
      namespace: { $exists: false },
      name: 'a.ts',
    });
    expect(found?.name).toBe('a.ts');
  });
});

describe('Changelog namespace scoping (mocked DB)', () => {
  it('should scope every filter to a named namespace', async () => {
    const { db, collection } = makeDb();
    const changelog = new Changelog('_mmk_migrations', 'orders-api');
    await changelog.getByName(db, 'a.ts');
    await changelog.markReverted(db, 'a.ts');
    expect(collection.findOne).toHaveBeenCalledWith({ namespace: 'orders-api', name: 'a.ts' });
    expect(collection.updateOne.mock.calls[0]?.[0]).toEqual({
      namespace: 'orders-api',
      name: 'a.ts',
      status: 'applied',
    });
  });

  it('should stamp the namespace onto a record it writes', async () => {
    const { db, collection } = makeDb();
    const record = makeRecord({ name: 'a.ts' });
    await new Changelog('_mmk_migrations', 'orders-api').markApplied(db, record);
    const [filter, written] = collection.replaceOne.mock.calls[0] ?? [];
    expect(filter).toEqual({ namespace: 'orders-api', name: 'a.ts' });
    expect(written).toEqual({ ...record, namespace: 'orders-api' });
  });

  it('should strip a stray namespace from a record written to the default namespace', async () => {
    const { db, collection } = makeDb();
    const record = makeRecord({ name: 'a.ts', namespace: 'someone-else' });
    await new Changelog('_mmk_migrations').markApplied(db, record);
    const [, written] = collection.replaceOne.mock.calls[0] ?? [];
    expect(written).not.toHaveProperty('namespace');
  });

  it('should expose the namespace it is bound to', () => {
    expect(new Changelog('_mmk_migrations', 'orders-api').namespace).toBe('orders-api');
    expect(new Changelog('_mmk_migrations').namespace).toBeUndefined();
  });

  it('should not query other namespaces for an empty name list', async () => {
    const find = vi.fn();
    const db = { collection: () => ({ find }) } as unknown as Db;
    expect(await new Changelog('_mmk_migrations', 'a').getInOtherNamespaces(db, [])).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('should adopt nothing for the default namespace or an empty list', async () => {
    const updateMany = vi.fn();
    const db = { collection: () => ({ updateMany }) } as unknown as Db;
    expect(await new Changelog('_mmk_migrations').adoptUnnamespaced(db, ['a.ts'])).toBe(0);
    expect(await new Changelog('_mmk_migrations', 'x').adoptUnnamespaced(db, [])).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
