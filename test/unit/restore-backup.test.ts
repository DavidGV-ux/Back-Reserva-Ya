import { describe, expect, it } from 'vitest';
import { MongoClient, Db } from 'mongodb';
import { buildBackupBuffer } from '../../src/infrastructure/backup/create-backup';
import { parseBackupBuffer } from '../../src/infrastructure/backup/restore-backup';

describe('parseBackupBuffer (unit, usando datos reales de Mongo)', () => {
  it('recupera exactamente los mismos documentos que se guardaron', async () => {
    const uri = process.env.MONGODB_URI_TEST ?? 'mongodb://localhost:27017/reservaya_test_restore';
    const client = new MongoClient(uri);
    await client.connect();
    const db: Db = client.db();
    await db.dropDatabase();

    await db.collection('productos').insertMany([
      { nombre: 'Shampoo', precio: 15000 },
      { nombre: 'Cera', precio: 8000 },
    ]);

    const { buffer } = await buildBackupBuffer(db);
    const restored = parseBackupBuffer(buffer);

    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe('productos');
    expect(restored[0].documents).toHaveLength(2);

    const nombres = restored[0].documents.map((d: any) => d.nombre).sort();
    expect(nombres).toEqual(['Cera', 'Shampoo']);

    await client.close();
  });

  it('maneja un buffer vacio sin lanzar error', () => {
    const restored = parseBackupBuffer(Buffer.alloc(0));
    expect(restored).toEqual([]);
  });
});