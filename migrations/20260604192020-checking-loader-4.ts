import type { MigrationContext } from 'mongo-migrate-kit';

export const description = '';

export async function up({ db }: MigrationContext): Promise<void> {
  db.collection('checking-loader').insertOne({
    name: 'checking-loader-4',
    createdAt: new Date(),
  });
  // TODO: implement migration
}

export async function down({ db }: MigrationContext): Promise<void> {
  // TODO: implement rollback
  await db.collection('checking-loader').deleteOne({ name: 'checking-loader-4' });
}
