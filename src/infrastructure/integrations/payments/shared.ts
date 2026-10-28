import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderWebhookEnvelope } from '../../../domain/ports/gateways';

export function unwrapEnvelope(event: ProviderWebhookEnvelope | unknown): ProviderWebhookEnvelope {
  if (!event || typeof event !== 'object') return { body: event as unknown };
  const candidate = event as Record<string, unknown>;
  if ('body' in candidate || 'raw' in candidate || 'headers' in candidate) {
    return {
      raw: typeof candidate.raw === 'string' ? candidate.raw : undefined,
      headers: candidate.headers && typeof candidate.headers === 'object'
        ? (candidate.headers as Record<string, unknown>)
        : undefined,
      body: candidate.body,
    };
  }
  return { body: event };
}

export function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

export function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return undefined;
}

function safeEqualHex(computed: string, provided: string): boolean {
  const a = Buffer.from(computed.toLowerCase(), 'hex');
  const b = Buffer.from(provided.toLowerCase(), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function wompiIntegritySignature(input: {
  reference: string;
  amountInCents: number;
  currency: string;
  integritySecret: string;
}): string {
  const source = `${input.reference}${input.amountInCents}${input.currency}${input.integritySecret}`;
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function wompiChecksum(payload: Record<string, unknown>, secret: string): string {
  const signature = (payload.signature ?? {}) as Record<string, unknown>;
  const properties = Array.isArray(signature.properties) ? (signature.properties as string[]) : [];
  const timestamp = signature.timestamp ?? payload.timestamp;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const joined = properties
    .map((p) => {
      const value = getPathValue(data, p);
      return value === null || value === undefined ? '' : String(value);
    })
    .join('');
  const source = `${joined}${timestamp ?? ''}${secret}`;
  return createHash('sha256').update(source, 'utf8').digest('hex').toUpperCase();
}

export function payuSign(input: {
  apiKey: string;
  merchantId: string;
  referenceSale: string;
  value: string;
  currency: string;
  statePol: string;
}): string {
  const value = Number(input.value).toFixed(2);
  const source = [
    input.apiKey,
    input.merchantId,
    input.referenceSale,
    value,
    input.currency,
    input.statePol,
  ].join('~');
  return createHash('md5').update(source, 'utf8').digest('hex');
}

export function verifyPayuSign(
  envelope: ProviderWebhookEnvelope,
  payload: Record<string, unknown>,
  apiKey: string,
  merchantId: string,
): boolean {
  const provided = headerValue(envelope.headers, 'x-payu-sign') ?? String(payload.sign ?? '');
  const statePol = String(payload.state_pol ?? payload.statePol ?? '');
  const referenceSale = String(payload.reference_sale ?? payload.referenceSale ?? '');
  const value = String(payload.value ?? '');
  const currency = String(payload.currency ?? '');
  const computed = payuSign({ apiKey, merchantId, referenceSale, value, currency, statePol });
  return provided.length > 0 && safeEqualHex(computed, provided);
}

export function verifyWompiChecksum(
  envelope: ProviderWebhookEnvelope,
  payload: Record<string, unknown>,
  secret: string,
): boolean {
  const header = headerValue(envelope.headers, 'x-event-checksum');
  const provided =
    header ??
    ((payload.signature as Record<string, unknown> | undefined)?.checksum as string | undefined);
  if (!provided) return false;
  return safeEqualHex(wompiChecksum(payload, secret), provided);
}

export function hmacSha256(source: string, secret: string): string {
  return createHmac('sha256', secret).update(source, 'utf8').digest('hex');
}