import type { ImportChecksumSource, MigrateMongoDoc, MigrationRecord } from '../types/index.js';

/**
 * Resolves the checksum to store for an imported migration, plus how it was
 * obtained. Injected by the caller so the mapping stays pure and testable —
 * the real implementation reads the file from disk (see migrator).
 */
export type ChecksumResolver = (
  fileName: string,
  fileHash: string | undefined,
) => { checksum: string; source: ImportChecksumSource };

/** Inputs needed to synthesize fields migrate-mongo never stored */
export interface MapOptions {
  resolveChecksum: ChecksumResolver;
  /** Value to record as `environment` (these records were not run here) */
  environment: string;
  /** Value to record as `executedBy` */
  executedBy: string;
  /**
   * Added to every derived batch so imported batches continue *after* the
   * batches already present in the target collection, instead of restarting at
   * 1 (which would collide with existing records). Default: 0.
   */
  batchOffset?: number;
}

/** Returns true when a value looks like a usable migrate-mongo changelog doc */
export function isMigrateMongoDoc(value: unknown): value is MigrateMongoDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { fileName?: unknown }).fileName === 'string' &&
    (value as { fileName: string }).fileName.length > 0
  );
}

/** Apply-order sort key for a doc — its run timestamp, falling back to apply time */
function orderKey(doc: MigrateMongoDoc): number {
  return doc.migrationBlock ?? new Date(doc.appliedAt).getTime();
}

/**
 * Map migrate-mongo changelog docs into mongo-migrate-kit {@link MigrationRecord}s.
 * Pure: all impure inputs (disk checksums, env identity) arrive via `options`.
 *
 * Each migration gets a **unique** batch number, assigned sequentially in apply
 * order (`migrationBlock`, then `appliedAt`, then filename) starting at
 * `batchOffset + 1`. Run-grouping is deliberately not preserved: imported records
 * are forward-only (mmk refuses to `down` them), so a shared batch would only
 * produce confusing duplicate batch ids with no rollback benefit.
 */
export function mapMigrateMongoDocs(
  docs: MigrateMongoDoc[],
  options: MapOptions,
): MigrationRecord[] {
  const offset = options.batchOffset ?? 0;
  const sorted = [...docs].sort((a, b) => {
    const delta = orderKey(a) - orderKey(b);
    return delta !== 0 ? delta : a.fileName.localeCompare(b.fileName);
  });

  return sorted.map((doc, index) => {
    const { checksum } = options.resolveChecksum(doc.fileName, doc.fileHash);
    return {
      name: doc.fileName,
      batch: offset + index + 1,
      status: 'applied',
      appliedAt: new Date(doc.appliedAt),
      duration: 0,
      checksum,
      environment: options.environment,
      executedBy: options.executedBy,
      // Marks the record forward-only: mmk down/redo will refuse it.
      origin: 'migrate-mongo',
    };
  });
}
