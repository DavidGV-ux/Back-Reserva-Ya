import { runBackupJob } from '../../infrastructure/backup/run-backup-job';

export async function lambdaHandler(): Promise<{ statusCode: number; body: string }> {
  try {
    const result = await runBackupJob();
    console.log('Backup completado:', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Error en backup:', err);
    throw err;
  }
}