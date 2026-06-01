import type { Collection, Db } from 'mongodb';
import type { MigrationRecord } from '../types/index.js';

/**
 * Reads and writes migration records in the changelog collection
 * (`_mmk_migrations` by default).
 *
 * Records are an append-mostly audit trail: reverting a migration updates its
 * status to `'reverted'` and stamps `revertedAt` — it never deletes the record.
 */
export class Changelog {
  private readonly collectionName: string;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  private coll(db: Db): Collection<MigrationRecord> {
    return db.collection<MigrationRecord>(this.collectionName);
  }

  /** Create the unique index on `name`. Safe to call repeatedly */
  async ensureIndexes(db: Db): Promise<void> {
    await this.coll(db).createIndex({ name: 1 }, { unique: true });
  }

  /** Return every changelog record, sorted by name ascending */
  async getAll(db: Db): Promise<MigrationRecord[]> {
    return this.coll(db).find().sort({ name: 1 }).toArray();
  }

  /** Return the names of all currently-applied migrations */
  async getAppliedNames(db: Db): Promise<string[]> {
    const docs = await this.coll(db)
      .find({ status: 'applied' })
      .sort({ name: 1 })
      .project<{ name: string }>({ name: 1, _id: 0 })
      .toArray();
    return docs.map((doc) => doc.name);
  }

  /** Return a single record by migration name, or null */
  async getByName(db: Db, name: string): Promise<MigrationRecord | null> {
    return this.coll(db).findOne({ name });
  }

  /** Return the highest batch number among currently-applied migrations, or null */
  async getLastBatch(db: Db): Promise<number | null> {
    const docs = await this.coll(db)
      .find({ status: 'applied' })
      .sort({ batch: -1 })
      .limit(1)
      .toArray();
    return docs[0]?.batch ?? null;
  }

  /** Return all records belonging to a given batch */
  async getByBatch(db: Db, batch: number): Promise<MigrationRecord[]> {
    return this.coll(db).find({ batch }).sort({ name: 1 }).toArray();
  }

  /**
   * Record a migration as applied. Uses an upsert keyed on `name` so that
   * re-applying a previously-reverted migration (e.g. via `redo`) overwrites
   * its record without violating the unique index.
   */
  async markApplied(db: Db, record: MigrationRecord): Promise<void> {
    await this.coll(db).replaceOne({ name: record.name }, record, { upsert: true });
  }

  /**
   * Mark a migration as reverted. Sets `status='reverted'` and `revertedAt=now`.
   * Never deletes the record — preserves the full audit history.
   */
  async markReverted(db: Db, name: string): Promise<void> {
    await this.coll(db).updateOne(
      { name, status: 'applied' },
      { $set: { status: 'reverted', revertedAt: new Date() } },
    );
  }
}
