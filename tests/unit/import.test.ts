import { describe, expect, it } from 'vitest';
import { isMigrateMongoDoc, mapMigrateMongoDocs } from '../../src/core/import.js';
import type { MigrateMongoDoc } from '../../src/types/index.js';

/** A checksum resolver that echoes a deterministic value, marking it recomputed */
const echoResolver = (fileName: string): { checksum: string; source: 'recomputed' } => ({
  checksum: `sum-${fileName}`,
  source: 'recomputed',
});

const baseOptions = {
  environment: 'imported',
  executedBy: 'mmk-import',
  resolveChecksum: echoResolver,
};

describe('isMigrateMongoDoc', () => {
  it('should accept a doc with a non-empty fileName', () => {
    expect(isMigrateMongoDoc({ fileName: 'a.js', appliedAt: new Date() })).toBe(true);
  });

  it('should reject docs without a usable fileName', () => {
    expect(isMigrateMongoDoc({ appliedAt: new Date() })).toBe(false);
    expect(isMigrateMongoDoc({ fileName: '' })).toBe(false);
    expect(isMigrateMongoDoc(null)).toBe(false);
    expect(isMigrateMongoDoc('a.js')).toBe(false);
  });
});

describe('mapMigrateMongoDocs', () => {
  it('should map fields and synthesize the missing ones', () => {
    const docs: MigrateMongoDoc[] = [
      { fileName: 'a.js', appliedAt: new Date('2026-01-01T00:00:00Z'), migrationBlock: 100 },
    ];
    const [record] = mapMigrateMongoDocs(docs, baseOptions);
    expect(record).toMatchObject({
      name: 'a.js',
      batch: 1,
      status: 'applied',
      duration: 0,
      checksum: 'sum-a.js',
      environment: 'imported',
      executedBy: 'mmk-import',
      origin: 'migrate-mongo',
    });
    expect(record?.appliedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('should assign a unique sequential batch to each migration in apply order', () => {
    // All three share one migrationBlock (one migrate-mongo run) — they must still
    // get distinct batch numbers, not a single shared (duplicate) batch.
    const docs: MigrateMongoDoc[] = [
      { fileName: 'b.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'c.js', appliedAt: new Date(), migrationBlock: 100 },
    ];
    const records = mapMigrateMongoDocs(docs, baseOptions);
    expect(records.map((r) => [r.name, r.batch])).toEqual([
      ['a.js', 1],
      ['b.js', 2],
      ['c.js', 3],
    ]);
  });

  it('should pass the source fileHash to the resolver', () => {
    const seen: (string | undefined)[] = [];
    mapMigrateMongoDocs([{ fileName: 'a.js', appliedAt: new Date(), fileHash: 'h1' }], {
      ...baseOptions,
      resolveChecksum: (_name, hash) => {
        seen.push(hash);
        return { checksum: 'x', source: 'reused' };
      },
    });
    expect(seen).toEqual(['h1']);
  });

  it('should offset every batch by batchOffset so imports continue after existing records', () => {
    const docs: MigrateMongoDoc[] = [
      { fileName: 'a.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'b.js', appliedAt: new Date(), migrationBlock: 100 },
      { fileName: 'c.js', appliedAt: new Date(), migrationBlock: 200 },
    ];
    const records = mapMigrateMongoDocs(docs, { ...baseOptions, batchOffset: 4 });
    const byName = new Map(records.map((r) => [r.name, r.batch]));
    expect(byName.get('a.js')).toBe(5);
    expect(byName.get('b.js')).toBe(6);
    expect(byName.get('c.js')).toBe(7);
  });

  it('should return an empty array for no docs', () => {
    expect(mapMigrateMongoDocs([], baseOptions)).toEqual([]);
  });
});
