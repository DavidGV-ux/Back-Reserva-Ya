import { gzipSync } from 'node:zlib';
import { serialize } from 'bson';
import { Db } from 'mongodb';

export interface CollectionBackup {
  name: string;
  documentCount: number;
}

export async function buildBackupBuffer(
  db: Db,
): Promise<{ buffer: Buffer; collections: CollectionBackup[] }> {
  const collections = await db.listCollections().toArray();
  const parts: Buffer[] = [];
  const summary: CollectionBackup[] = [];

  for (const { name } of collections) {
    const docs = await db.collection(name).find({}).toArray();
    const bsonParts = docs.map((doc) => serialize(doc));
    const collectionBuffer = Buffer.concat(bsonParts);
    const gzipped = gzipSync(collectionBuffer);

    const nameBuffer = Buffer.from(name, 'utf-8');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(nameBuffer.length, 0);
    header.writeUInt32LE(gzipped.length, 4);

    parts.push(header, nameBuffer, gzipped);
    summary.push({ name, documentCount: docs.length });
  }

  return { buffer: Buffer.concat(parts), collections: summary };
}