import type { MigrationContext } from '../../../src/types/index.js';

// Intentionally missing a `down` export to exercise validation
export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('broken').insertOne({});
}
