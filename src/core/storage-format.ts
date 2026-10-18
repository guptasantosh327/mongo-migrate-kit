import type { Collection, Db } from 'mongodb';
import { SchemaTooNewError } from '../errors/index.js';
import { explain } from '../utils/explain.js';

/**
 * Version of the data layout mmk stores. Bump it whenever a release writes data
 * that older versions would misread; they then refuse to run instead of
 * misbehaving.
 *
 * - 1: everything before 1.5 (implied when no marker exists)
 * - 2: 1.5 — changelog records may carry `namespace`
 */
export const STORAGE_FORMAT_VERSION = 2;

/**
 * Collection holding the marker. Fixed rather than configurable: it describes
 * the whole database, so every repo on it must find it in the same place.
 */
export const META_COLLECTION = '_mmk_meta';

/** `_id` of the marker document */
export const META_ID = 'storage_format';

/** The package version, injected at build time (see tsup.config.ts) */
const MMK_VERSION = process.env.MMK_VERSION ?? '0.0.0-dev';

/** Shape of the marker document */
interface MetaDocument {
  _id: string;
  /** Highest storage format any mmk has written to this database */
  schemaVersion: number;
  /** The mmk version that last recorded the marker */
  writtenBy: string;
  updatedAt: Date;
}

/** The marker collection, with the majority write concern every mmk metadata write uses */
function metaCollection(db: Db): Collection<MetaDocument> {
  return db.collection<MetaDocument>(META_COLLECTION, { writeConcern: { w: 'majority' } });
}

/**
 * Refuse to run against a database written in a newer storage format. Called on
 * every connect, including read-only ones: it only reads.
 *
 * Reading a collection that does not exist creates nothing, so repos that never
 * record a marker never see `_mmk_meta`. Pre-1.5 versions do not know the
 * collection exists.
 *
 * @throws {@link SchemaTooNewError} when the stored format is newer than this build understands
 */
export async function checkStorageFormat(db: Db): Promise<void> {
  const meta = await metaCollection(db).findOne({ _id: META_ID });
  if (meta && meta.schemaVersion > STORAGE_FORMAT_VERSION) {
    throw new SchemaTooNewError(
      explain(
        `This database was last used by mongo-migrate-kit ${meta.writtenBy}, which stores data in a newer format`,
        [
          `Storage format in the database: ${meta.schemaVersion}; this version (${MMK_VERSION}) understands up to ${STORAGE_FORMAT_VERSION}`,
          'Running an older version could misread migration history, so nothing was run',
          "Upgrade this repo's mongo-migrate-kit to the same or a newer version: npm install mongo-migrate-kit@latest",
        ],
      ),
      { stored: meta.schemaVersion, supported: STORAGE_FORMAT_VERSION, writtenBy: meta.writtenBy },
    );
  }
}

/**
 * Record this version's storage format. Call it only after
 * {@link checkStorageFormat}, and only when the run writes data in that format
 * (for 1.5: records with a `namespace`), so a database that only holds data
 * every version can read never gets a marker — or a `_mmk_meta` collection.
 *
 * The marker is written with `$max`, so it never moves backwards; if someone
 * deletes it, the next recording run writes it again.
 */
export async function recordStorageFormat(db: Db): Promise<void> {
  await metaCollection(db).updateOne(
    { _id: META_ID },
    {
      $max: { schemaVersion: STORAGE_FORMAT_VERSION },
      $set: { writtenBy: MMK_VERSION, updatedAt: new Date() },
    },
    { upsert: true },
  );
}
