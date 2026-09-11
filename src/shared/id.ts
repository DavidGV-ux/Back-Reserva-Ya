import { randomBytes, randomUUID } from 'node:crypto';
import { ObjectId } from 'bson';

export function hexId(): string {
  return new ObjectId().toHexString();
}

export function uuid(): string {
  return randomUUID();
}

export function reference(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${time}${rand}`;
}

export function eventId(): string {
  return `evt_${randomBytes(12).toString('hex')}`;
}