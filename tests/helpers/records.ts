import type { MigrationRecord } from '../../src/types/index.js';

/** Build a complete MigrationRecord for tests, with sensible defaults */
export function makeRecord(overrides: Partial<MigrationRecord> = {}): MigrationRecord {
  return {
    name: '0001-test.ts',
    batch: 1,
    status: 'applied',
    appliedAt: new Date('2026-01-01T00:00:00.000Z'),
    duration: 12,
    checksum: 'abc123',
    environment: 'test',
    executedBy: 'tester',
    ...overrides,
  };
}
