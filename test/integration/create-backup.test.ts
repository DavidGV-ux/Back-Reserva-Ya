import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { MongoClient, Db } from 'mongodb';
import { buildBackupBuffer } from '../../src/infrastructure/backup/create-backup';

describe('buildBackupBuffer (integration)', () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI_TEST ?? 'mongodb://localhost:27017/reservaya_test_backup';
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
    await db.dropDatabase();

    await db.collection('clientes').insertMany([
      { nombre: 'Ana', edad: 30 },
      { nombre: 'Luis', edad: 25 },
    ]);
    await db.collection('citas').insertMany([{ servicio: 'corte', precio: 20000 }]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('genera un buffer que contiene todas las colecciones con sus documentos', async () => {
    const { buffer, collections } = await buildBackupBuffer(db);

    expect(buffer.length).toBeGreaterThan(0);
    expect(collections).toHaveLength(2);

    const clientesInfo = collections.find((c) => c.name === 'clientes');
    const citasInfo = collections.find((c) => c.name === 'citas');

    expect(clientesInfo?.documentCount).toBe(2);
    expect(citasInfo?.documentCount).toBe(1);
  });

  it('devuelve un buffer vacio (sin colecciones) si la base esta vacia', async () => {
    const emptyUri = process.env.MONGODB_URI_TEST_EMPTY ?? 'mongodb://localhost:27017/reservaya_test_empty';
    const emptyClient = new MongoClient(emptyUri);
    await emptyClient.connect();
    const emptyDb = emptyClient.db();
    await emptyDb.dropDatabase();

    const { collections } = await buildBackupBuffer(emptyDb);
    expect(collections).toHaveLength(0);

    await emptyClient.close();
  });
});