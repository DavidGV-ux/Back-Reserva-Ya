import { Db, MongoClient } from 'mongodb';

let client: MongoClient | undefined;
let db: Db | undefined;

export async function connectMongo(uri: string): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) return { client, db };
  const c = new MongoClient(uri, { appName: 'reserwaya-back' });
  await c.connect();
  const d = c.db();
  client = c;
  db = d;
  return { client: c, db: d };
}

export async function disconnectMongo(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}

export function getDb(): Db {
  if (!db) throw new Error('Mongo not connected');
  return db;
}