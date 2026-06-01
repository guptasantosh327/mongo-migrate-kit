import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Changelog } from '../../src/core/changelog.js';
import { makeRecord } from '../helpers/records.js';
import { startTestMongo, type TestMongo } from '../helpers/mongo.js';

let mongo: TestMongo;
const COLLECTION = '_mmk_migrations';
const changelog = new Changelog(COLLECTION);

beforeAll(async () => {
  mongo = await startTestMongo('mmk_changelog_test');
});

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.collection(COLLECTION).deleteMany({});
});

describe('Changelog (integration)', () => {
  it('markApplied should insert a full record', async () => {
    const record = makeRecord({ name: '0001-a.ts', batch: 1 });
    await changelog.markApplied(mongo.db, record);
    const stored = await changelog.getByName(mongo.db, '0001-a.ts');
    expect(stored).toMatchObject({
      name: '0001-a.ts',
      batch: 1,
      status: 'applied',
      checksum: 'abc123',
      environment: 'test',
      executedBy: 'tester',
    });
  });

  it('markReverted should flip status and set revertedAt, never deleting', async () => {
    await changelog.markApplied(mongo.db, makeRecord({ name: '0001-a.ts' }));
    await changelog.markReverted(mongo.db, '0001-a.ts');
    const stored = await changelog.getByName(mongo.db, '0001-a.ts');
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('reverted');
    expect(stored?.revertedAt).toBeInstanceOf(Date);
    const count = await mongo.db.collection(COLLECTION).countDocuments();
    expect(count).toBe(1);
  });

  it('getAppliedNames should return only applied records', async () => {
    await changelog.markApplied(mongo.db, makeRecord({ name: '0001-a.ts' }));
    await changelog.markApplied(mongo.db, makeRecord({ name: '0002-b.ts' }));
    await changelog.markReverted(mongo.db, '0002-b.ts');
    const names = await changelog.getAppliedNames(mongo.db);
    expect(names).toEqual(['0001-a.ts']);
  });

  it('getLastBatch should return the highest applied batch', async () => {
    await changelog.markApplied(mongo.db, makeRecord({ name: '0001-a.ts', batch: 1 }));
    await changelog.markApplied(mongo.db, makeRecord({ name: '0002-b.ts', batch: 1 }));
    await changelog.markApplied(mongo.db, makeRecord({ name: '0003-c.ts', batch: 2 }));
    expect(await changelog.getLastBatch(mongo.db)).toBe(2);
  });

  it('getLastBatch should return null when nothing is applied', async () => {
    expect(await changelog.getLastBatch(mongo.db)).toBeNull();
  });

  it('getByBatch should return all records for a batch', async () => {
    await changelog.markApplied(mongo.db, makeRecord({ name: '0001-a.ts', batch: 1 }));
    await changelog.markApplied(mongo.db, makeRecord({ name: '0002-b.ts', batch: 1 }));
    await changelog.markApplied(mongo.db, makeRecord({ name: '0003-c.ts', batch: 2 }));
    const batch1 = await changelog.getByBatch(mongo.db, 1);
    expect(batch1.map((r) => r.name)).toEqual(['0001-a.ts', '0002-b.ts']);
  });

  it('getAll should return every record sorted by name', async () => {
    await changelog.markApplied(mongo.db, makeRecord({ name: '0002-b.ts' }));
    await changelog.markApplied(mongo.db, makeRecord({ name: '0001-a.ts' }));
    const all = await changelog.getAll(mongo.db);
    expect(all.map((r) => r.name)).toEqual(['0001-a.ts', '0002-b.ts']);
  });

  it('ensureIndexes should enforce uniqueness on name', async () => {
    await changelog.ensureIndexes(mongo.db);
    await mongo.db.collection(COLLECTION).insertOne(makeRecord({ name: 'dup.ts' }));
    await expect(
      mongo.db.collection(COLLECTION).insertOne(makeRecord({ name: 'dup.ts' })),
    ).rejects.toThrow();
  });
});
