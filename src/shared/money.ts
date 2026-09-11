export const CENTS = 100;

export function money(amount: number): number {
  return Math.round((amount + Number.EPSILON) * CENTS) / CENTS;
}

export function percentOf(amount: number, rate: number): number {
  return money((amount * rate));
}

export function decimalFromApi(value: number): import('bson').Decimal128 {
  const { Decimal128 } = require('bson') as typeof import('bson');
  return Decimal128.fromString(money(value).toFixed(2));
}

export function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const s = String(value);
  return Number(s);
}