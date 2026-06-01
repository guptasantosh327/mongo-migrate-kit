import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { type Db, MongoClient } from 'mongodb';

/** A running in-memory MongoDB plus a connected client and database handle */
export interface TestMongo {
  replSet: MongoMemoryReplSet;
  client: MongoClient;
  db: Db;
  uri: string;
  dbName: string;
  stop: () => Promise<void>;
}

/**
 * Start an in-memory MongoDB replica set and connect a client.
 * A replica set (not a standalone) is required so transactions work in tests.
 */
export async function startTestMongo(dbName = 'mmk_test'): Promise<TestMongo> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  return {
    replSet,
    client,
    db,
    uri,
    dbName,
    stop: async (): Promise<void> => {
      await client.close();
      await replSet.stop();
    },
  };
}
