/**
 * Normalización de teléfonos a formato E.164 (p. ej. +573001234567) para
 * Colombia (código de país por defecto: 57).
 *
 * Reglas:
 * - Conserva el código de país si el número empieza con '+' o si los dígitos
 *   ya incluyen el código de país (>= 11 dígitos).
 * - Un número local de 10 dígitos ("3001234567") se completa con "+57".
 * - Un cero inicial local ("03001234567") se descarta al anteponer +57.
 * - Prefijo internacional "00" ("00573001234567") se convierte a "+57...".
 * - Devuelve null si el resultado no tiene entre 10 y 15 dígitos.
 */
export const DEFAULT_COUNTRY_CODE = '57';

export function normalizePhoneE164(
  input?: string | null,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  let digits = input.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);

  const hasCountryCode = digits.startsWith(countryCode) && digits.length > countryCode.length;
  if (!hasCountryCode) {
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) return `+${countryCode}${digits}`;
  }

  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}