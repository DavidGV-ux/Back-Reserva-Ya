import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import type { Readable } from 'node:stream';

function getR2Client(): S3Client {
  if (!env.r2AccountId || !env.r2AccessKeyId || !env.r2SecretAccessKey) {
    throw new Error('Faltan variables de entorno de R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
  });
}

export async function uploadBackup(buffer: Buffer, key: string): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    }),
  );
}

export async function listBackups(): Promise<string[]> {
  const client = getR2Client();
  const result = await client.send(new ListObjectsV2Command({ Bucket: env.r2BucketName }));
  return (result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean);
}

export async function deleteBackup(key: string): Promise<void> {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: key }));
}

export async function downloadBackup(key: string): Promise<Buffer> {
  const client = getR2Client();
  const result = await client.send(new GetObjectCommand({ Bucket: env.r2BucketName, Key: key }));
  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}