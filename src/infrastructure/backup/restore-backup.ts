import { gunzipSync } from 'node:zlib';
import { deserialize } from 'bson';

export interface RestoredCollection {
  name: string;
  documents: Record<string, unknown>[];
}

function splitBsonDocuments(buffer: Buffer): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const docLength = buffer.readInt32LE(offset);
    const docBuffer = buffer.subarray(offset, offset + docLength);
    docs.push(deserialize(docBuffer));
    offset += docLength;
  }
  return docs;
}

export function parseBackupBuffer(buffer: Buffer): RestoredCollection[] {
  const collections: RestoredCollection[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const nameLength = buffer.readUInt32LE(offset);
    const dataLength = buffer.readUInt32LE(offset + 4);
    offset += 8;

    const name = buffer.subarray(offset, offset + nameLength).toString('utf-8');
    offset += nameLength;

    const gzipped = buffer.subarray(offset, offset + dataLength);
    offset += dataLength;

    const documents = splitBsonDocuments(gunzipSync(gzipped));
    collections.push({ name, documents });
  }

  return collections;
}