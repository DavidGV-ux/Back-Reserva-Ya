import { listBackups, deleteBackup } from './upload-to-r2';

const KEY_DATE_PATTERN = /^backup-(\d{4}-\d{2}-\d{2})/;

export async function applyRetention(retentionDays: number): Promise<{ deleted: string[]; kept: string[] }> {
  const keys = await listBackups();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const deleted: string[] = [];
  const kept: string[] = [];

  for (const key of keys) {
    const match = key.match(KEY_DATE_PATTERN);
    if (!match) {
      kept.push(key);
      continue;
    }

        const dateString = match[1];
    if (!dateString) {
      kept.push(key);
      continue;
    }
    const backupDate = new Date(dateString);
    if (backupDate < cutoff) {
      await deleteBackup(key);
      deleted.push(key);
    } else {
      kept.push(key);
    }
  }

  return { deleted, kept };
}