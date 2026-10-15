import type { ClientSession, Collection, Db, Filter } from 'mongodb';
import type { MigrationRecord } from '../types/index.js';

/**
 * Reads and writes migration records in the changelog collection
 * (`_mmk_migrations` by default).
 *
 * Records are an append-mostly audit trail: reverting a migration updates its
 * status to `'reverted'` and stamps `revertedAt` — it never deletes the record.
 *
 * A changelog is bound to one **namespace** (usually one per repo), so several
 * repos can share a collection without seeing each other's history. Every
 * per-namespace query is built from {@link Changelog.scope} — no method writes
 * its own namespace filter, so a new query cannot forget it. The default
 * namespace (no `namespace` configured) is the *absence* of the field, which is
 * why records written before namespaces existed belong to it unchanged. The few
 * reads that deliberately look across namespaces are named `…OtherNamespaces`,
 * `…Unnamespaced` or `…AllNamespaces`.
 */
export class Changelog {
  private readonly collectionName: string;
  /** The namespace this changelog reads and writes; undefined = the default one */
  readonly namespace: string | undefined;

  constructor(collectionName: string, namespace?: string) {
    this.collectionName = collectionName;
    this.namespace = namespace;
  }

  private coll(db: Db): Collection<MigrationRecord> {
    // The changelog is the durable audit trail and the source of truth for what
    // has run. Force `w: 'majority'` so a record survives a primary failover —
    // a record that is lost on failover would let an already-applied migration
    // re-run. (Inside a transaction the transaction's own write concern governs;
    // see the runner, which commits with majority.)
    return db.collection<MigrationRecord>(this.collectionName, {
      writeConcern: { w: 'majority' },
    });
  }

  /** The filter selecting this changelog's namespace — the only place it is built */
  private scope(): Filter<MigrationRecord> {
    return this.namespace === undefined
      ? { namespace: { $exists: false } }
      : { namespace: this.namespace };
  }

  /**
   * The record as stored for this namespace: stamped with it, or without the
   * field for the default namespace — whatever the caller passed.
   */
  private stamp(record: MigrationRecord): MigrationRecord {
    const { namespace: _ignored, ...rest } = record;
    return this.namespace === undefined ? rest : { ...rest, namespace: this.namespace };
  }

  /**
   * Create the unique index on `name`. Safe to call repeatedly.
   *
   * Deliberately unique across the whole collection, not per namespace: it is
   * stricter than `(namespace, name)`, every pre-namespace version recreates it
   * on connect anyway, and dropping it would need index privileges.
   */
  async ensureIndexes(db: Db): Promise<void> {
    await this.coll(db).createIndex({ name: 1 }, { unique: true });
  }

  /** Count this namespace's records */
  async count(db: Db): Promise<number> {
    return this.coll(db).countDocuments(this.scope());
  }

  /**
   * Read every raw document from a foreign collection (e.g. a migrate-mongo
   * `changelog`). Returns untyped docs since the source schema differs from
   * ours — the caller is responsible for validating and mapping them.
   */
  async getForeignDocs(db: Db, collectionName: string): Promise<Record<string, unknown>[]> {
    return db.collection(collectionName).find().toArray();
  }

  /** Return every record in this namespace, sorted by name ascending */
  async getAll(db: Db): Promise<MigrationRecord[]> {
    return this.coll(db).find(this.scope()).sort({ name: 1 }).toArray();
  }

  /** Return the names of this namespace's currently-applied migrations */
  async getAppliedNames(db: Db): Promise<string[]> {
    const docs = await this.coll(db)
      .find({ ...this.scope(), status: 'applied' })
      .sort({ name: 1 })
      .project<{ name: string }>({ name: 1, _id: 0 })
      .toArray();
    return docs.map((doc) => doc.name);
  }

  /** Return this namespace's record for a migration name, or null */
  async getByName(db: Db, name: string): Promise<MigrationRecord | null> {
    return this.coll(db).findOne({ ...this.scope(), name });
  }

  /** Return the highest batch number among this namespace's applied migrations, or null */
  async getLastBatch(db: Db): Promise<number | null> {
    const docs = await this.coll(db)
      .find({ ...this.scope(), status: 'applied' })
      .sort({ batch: -1 })
      .limit(1)
      .toArray();
    return docs[0]?.batch ?? null;
  }

  /** Return this namespace's records belonging to a given batch */
  async getByBatch(db: Db, batch: number): Promise<MigrationRecord[]> {
    return this.coll(db)
      .find({ ...this.scope(), batch })
      .sort({ name: 1 })
      .toArray();
  }

  /**
   * Record a migration as applied in this namespace. Uses an upsert keyed on
   * `name` so that re-applying a previously-reverted migration (e.g. via `redo`)
   * overwrites its record without violating the unique index. The filter is
   * namespace-scoped, so a name owned by another namespace is never overwritten:
   * the upsert collides on the unique index and fails instead.
   *
   * Pass `session` to enrol the write in a migration's transaction, so the
   * record and the migration's own writes commit (or roll back) atomically.
   */
  async markApplied(db: Db, record: MigrationRecord, session?: ClientSession): Promise<void> {
    await this.coll(db).replaceOne({ ...this.scope(), name: record.name }, this.stamp(record), {
      upsert: true,
      ...(session ? { session } : {}),
    });
  }

  /**
   * Mark a migration in this namespace as reverted. Sets `status='reverted'` and
   * `revertedAt=now`. Never deletes the record — preserves the full audit history.
   *
   * Pass `session` to enrol the write in the rollback's transaction.
   */
  async markReverted(db: Db, name: string, session?: ClientSession): Promise<void> {
    await this.coll(db).updateOne(
      { ...this.scope(), name, status: 'applied' },
      { $set: { status: 'reverted', revertedAt: new Date() } },
      session ? { session } : {},
    );
  }

  /**
   * Records with one of `names` that belong to a *named* namespace other than
   * this one, in any status. Unnamespaced records are excluded: from a named
   * namespace they are "not yet adopted" (see {@link getUnnamespaced}), and from
   * the default namespace they are this namespace's own.
   */
  async getInOtherNamespaces(db: Db, names: string[]): Promise<MigrationRecord[]> {
    if (names.length === 0) {
      return [];
    }
    const others =
      this.namespace === undefined ? { $exists: true } : { $exists: true, $ne: this.namespace };
    return this.coll(db)
      .find({ name: { $in: names }, namespace: others })
      .sort({ name: 1 })
      .toArray();
  }

  /**
   * Records with no namespace (written before namespaces existed, or by a repo
   * without one), in any status — optionally only those with one of `names`.
   */
  async getUnnamespaced(db: Db, names?: string[]): Promise<MigrationRecord[]> {
    return this.coll(db)
      .find({
        namespace: { $exists: false },
        ...(names === undefined ? {} : { name: { $in: names } }),
      })
      .sort({ name: 1 })
      .toArray();
  }

  /**
   * Move unnamespaced records with one of `names` into this changelog's
   * namespace. Returns how many moved. A no-op for the default namespace.
   */
  async adoptUnnamespaced(db: Db, names: string[]): Promise<number> {
    if (this.namespace === undefined || names.length === 0) {
      return 0;
    }
    const result = await this.coll(db).updateMany(
      { name: { $in: names }, namespace: { $exists: false } },
      { $set: { namespace: this.namespace } },
    );
    return result.modifiedCount;
  }

  /**
   * Every record in the collection, whatever its namespace — for the read-only
   * `status --all-namespaces` overview. Sorted by namespace (default first),
   * then name.
   */
  async getAllNamespaces(db: Db): Promise<MigrationRecord[]> {
    return this.coll(db).find().sort({ namespace: 1, name: 1 }).toArray();
  }
}
