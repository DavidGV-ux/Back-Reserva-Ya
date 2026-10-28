import { MongoClient } from 'mongodb';
import { downloadBackup } from '../infrastructure/backup/upload-to-r2';
import { parseBackupBuffer } from '../infrastructure/backup/restore-backup';

const RESTORE_DB_NAME = 'reservaya_restore_test';

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Uso: npx tsx src/scripts/test-restore-locally.ts <nombre-del-archivo-en-r2>');
    process.exit(1);
  }

  console.log(`Descargando backup: ${key}...`);
  const buffer = await downloadBackup(key);
  console.log(`Descargado: ${(buffer.length / 1024).toFixed(2)} KB`);

  console.log('Desempacando...');
  const collections = parseBackupBuffer(buffer);

  console.log(`\nConectando a base de prueba: ${RESTORE_DB_NAME}`);
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db(RESTORE_DB_NAME);

  await db.dropDatabase();

  console.log('\nRestaurando colecciones:');
  for (const { name, documents } of collections) {
    if (documents.length > 0) {
      await db.collection(name).insertMany(documents as any[]);
    }
    console.log(`  - ${name}: ${documents.length} documentos restaurados`);
  }

  console.log('\n✅ Restauración completa. Revisa la base "reservaya_restore_test" para confirmar visualmente.');
  await client.close();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});