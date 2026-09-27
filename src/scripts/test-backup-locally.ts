import { connectMongo, disconnectMongo } from '../infrastructure/persist/mongo/connection';
import { buildBackupBuffer } from '../infrastructure/backup/create-backup';
import { uploadBackup, listBackups } from '../infrastructure/backup/upload-to-r2';
import { env } from '../config/env';

async function main() {
  console.log('Conectando a Mongo:', env.mongodbUri);
  const { db } = await connectMongo(env.mongodbUri);

  console.log('Generando backup...');
  const { buffer, collections } = await buildBackupBuffer(db);

  console.log('Colecciones encontradas:');
  for (const c of collections) {
    console.log(`  - ${c.name}: ${c.documentCount} documentos`);
  }

  const key = `backup-${new Date().toISOString().slice(0, 10)}-test.bin`;
  console.log(`\nSubiendo a R2 como: ${key} (${(buffer.length / 1024).toFixed(2)} KB)...`);
  await uploadBackup(buffer, key);
  console.log('✅ Subida exitosa');

  console.log('\nArchivos actuales en el bucket:');
  const files = await listBackups();
  for (const f of files) {
    console.log(`  - ${f}`);
  }

  await disconnectMongo();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});