import { Decimal128, Int32, ObjectId } from 'bson';
import { money } from '../../../shared/money';

export function bsonId(id: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new Error(`Invalid ObjectId: ${id}`);
  }
}

export function bsonInt(value: number): Int32 {
  return new Int32(value);
}

export function bsonMoney(value: number): Decimal128 {
  const cents = Math.round((value + Number.EPSILON) * 100) / 100;
  return Decimal128.fromString(cents.toFixed(2));
}

export function idToStr(id: unknown): string {
  return String(id);
}

export function moneyToNumber(value: unknown): number {
  if (value === null || value === undefined) return money(0);
  return Number(String(value));
}

export function intToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function dateToIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function isoToDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function optionalId(value: string | null | undefined): ObjectId | null {
  if (!value) return null;
  return new ObjectId(value);
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof (err as { code?: unknown })?.code === 'number' &&
    ((err as { code?: number })?.code ?? 0) === 11000
  );
}

export function isTransientMongoError(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  return code === 112 || code === 6 || code === 251 || code === 263;
}