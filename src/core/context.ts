import type { Db, MongoClient } from 'mongodb';
import type { Mongoose } from 'mongoose';
import type { MigrationContext } from '../types/index.js';

/** Build the {@link MigrationContext} passed into every migration function */
export function buildContext(client: MongoClient, db: Db, mongoose?: Mongoose): MigrationContext {
  const context: MigrationContext = { client, db };
  if (mongoose) {
    context.mongoose = mongoose;
  }
  return context;
}
