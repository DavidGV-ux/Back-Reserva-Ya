import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico para secretos guardados en reposo (contraseñas de registros
 * pendientes). Formato: `<iv hex>:<tag hex>:<ciphertext hex>` (AES-256-GCM).
 */
const DEV_KEY = 'dev-only-registration-encryption-key-change-me';

function key(): Buffer {
  const configured = process.env.REGISTRATION_ENCRYPTION_KEY;
  // La clave fija solo es aceptable en desarrollo; en despliegue FAIL CLOSED.
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('REGISTRATION_ENCRYPTION_KEY is required in production');
  }
  return createHash('sha256').update(configured || DEV_KEY).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const [ivHex, tagHex, cipherHex] = payload.split(':');
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error('invalid encrypted secret payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
