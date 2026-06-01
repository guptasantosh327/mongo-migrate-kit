import type { MigrationContext } from '../../../src/types/index.js';

export const useTransaction = true;
export const description = 'A valid TypeScript migration';

export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('ts_things').insertOne({ created: true });
}

export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('ts_things').deleteMany({});
}
