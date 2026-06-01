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
    expect(collection.replaceOne).toHaveBeenCalledWith({ name: 'a.ts' }, record, { upsert: true });
  });

  it('markReverted should set status and revertedAt without deleting', async () => {
    const { db, collection } = makeDb();
    await new Changelog('_mmk_migrations').markReverted(db, 'a.ts');
    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ name: 'a.ts', status: 'applied' });
    expect(update.$set.status).toBe('reverted');
    expect(update.$set.revertedAt).toBeInstanceOf(Date);
  });

  it('getByName should query findOne by name', async () => {
    const { db, collection } = makeDb();
    collection.findOne.mockResolvedValueOnce(makeRecord({ name: 'a.ts' }));
    const found = await new Changelog('_mmk_migrations').getByName(db, 'a.ts');
    expect(collection.findOne).toHaveBeenCalledWith({ name: 'a.ts' });
    expect(found?.name).toBe('a.ts');
  });
});
