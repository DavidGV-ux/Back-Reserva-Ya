import { connectMongo } from '../persist/mongo/connection';
import { buildBackupBuffer } from './create-backup';
import { uploadBackup } from './upload-to-r2';
import { applyRetention } from './apply-retention';
import { env } from '../../config/env';

export async function runBackupJob(): Promise<{
  key: string;
  sizeKB: number;
  collections: number;
  deletedOldBackups: string[];
}> {
  const { db } = await connectMongo(env.mongodbUri);

  const { buffer, collections } = await buildBackupBuffer(db);
  const key = `backup-${new Date().toISOString().slice(0, 10)}.bin`;

  await uploadBackup(buffer, key);

  const { deleted } = await applyRetention(env.backupRetentionDays);

  return {
    key,
    sizeKB: Number((buffer.length / 1024).toFixed(2)),
    collections: collections.length,
    deletedOldBackups: deleted,
  };
}