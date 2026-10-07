import { uploadBackup, listBackups } from '../infrastructure/backup/upload-to-r2';
import { applyRetention } from '../infrastructure/backup/apply-retention';

async function main() {
  console.log('Creando un backup de prueba con fecha vieja (hace 40 días)...');
  const fakeOldKey = 'backup-2026-08-15-old-test.bin';
  await uploadBackup(Buffer.from('contenido de prueba'), fakeOldKey);
  console.log(`Subido: ${fakeOldKey}`);

  console.log('\nArchivos ANTES de aplicar retención:');
  const before = await listBackups();
  for (const f of before) console.log(`  - ${f}`);

  console.log('\nAplicando retención de 30 días...');
  const { deleted, kept } = await applyRetention(30);

  console.log('\nBorrados:');
  for (const f of deleted) console.log(`  - ${f}`);

  console.log('\nConservados:');
  for (const f of kept) console.log(`  - ${f}`);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});