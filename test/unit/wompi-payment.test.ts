import { describe, expect, it, vi } from 'vitest';
import { WompiPaymentGateway } from '../../src/infrastructure/integrations/payments/wompi-payment';
import { wompiChecksum, wompiIntegritySignature } from '../../src/infrastructure/integrations/payments/shared';
import { EventSignatureError, UnsupportedPaymentPayloadError, ValidationError } from '../../src/shared/errors';

const SECRET = 'test-events-secret';
const gateway = new WompiPaymentGateway({ eventsSecret: SECRET, environment: 'test' });

const PROPERTIES = [
  'transaction.id',
  'transaction.amount_in_cents',
  'transaction.reference',
  'transaction.currency',
  'transaction.status',
];

function signedEvent(input: {
  id: string;
  amountCents: number;
  reference: string;
  currency: string;
  status: string;
  event?: string;
  timestamp?: number;
  secret?: string;
  dataOverride?: Record<string, unknown>;
}) {
  const timestamp = input.timestamp ?? 1700000000000;
  const data = input.dataOverride ?? {
    transaction: {
      id: input.id,
      amount_in_cents: input.amountCents,
      reference: input.reference,
      currency: input.currency,
      status: input.status,
    },
  };
  const payload: Record<string, unknown> = {
    event: input.event ?? 'transaction.updated',
    data,
    environment: 'test',
    timestamp,
    signature: {
      properties: PROPERTIES,
      checksum: '',
    },
  };
  payload.signature = {
    properties: PROPERTIES,
    checksum: wompiChecksum(payload, input.secret ?? SECRET),
  };
  return payload;
}

describe('WompiPaymentGateway.confirmEvent', () => {
  it('accepts a charge event signed with the events secret', async () => {
    const payload = signedEvent({ id: 'wtx-1', amountCents: 1200000, reference: 'RSV-1', currency: 'COP', status: 'APPROVED' });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.provider).toBe('wompi');
    expect(result.operation).toBe('charge');
    expect(result.status).toBe('approved');
    expect(result.internalReference).toBe('RSV-1');
    expect(result.amount).toBe(12000);
    expect(result.providerTransactionId).toBe('wtx-1');
  });

  it('accepts an envelope with only the raw JSON string', async () => {
    const payload = signedEvent({ id: 'wtx-1', amountCents: 1200000, reference: 'RSV-1', currency: 'COP', status: 'APPROVED' });
    const result = await gateway.confirmEvent({ headers: {}, raw: JSON.stringify(payload) });
    expect(result.status).toBe('approved');
  });

  it('rejects a charge event signed with the wrong secret', async () => {
    const payload = signedEvent({ id: 'wtx-1', amountCents: 1200000, reference: 'RSV-1', currency: 'COP', status: 'APPROVED', secret: 'other-secret' });
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(EventSignatureError);
  });

  it('rejects a tampered amount', async () => {
    const payload = signedEvent({ id: 'wtx-1', amountCents: 1200000, reference: 'RSV-1', currency: 'COP', status: 'APPROVED' });
    (payload.data as Record<string, unknown>).transaction = {
      ...((payload.data as Record<string, unknown>).transaction as Record<string, unknown>),
      amount_in_cents: 999999,
    };
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(EventSignatureError);
  });

  it('rejects when checksum is missing', async () => {
    const payload = signedEvent({ id: 'wtx-1', amountCents: 1200000, reference: 'RSV-1', currency: 'COP', status: 'APPROVED' });
    delete (payload.signature as Record<string, unknown>).checksum;
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(EventSignatureError);
  });

  it('maps a declined charge event', async () => {
    const payload = signedEvent({ id: 'wtx-2', amountCents: 1200000, reference: 'RSV-2', currency: 'COP', status: 'DECLINED' });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.status).toBe('declined');
  });

  it('maps a pending charge event', async () => {
    const payload = signedEvent({ id: 'wtx-3', amountCents: 1200000, reference: 'RSV-3', currency: 'COP', status: 'PENDING' });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.status).toBe('pending');
  });

  it('maps a refund event to operation refund', async () => {
    const dataOverride = {
      refund: {
        id: 'wrf-1',
        amount_in_cents: 1200000,
        reference: 'RSV-4-R',
        currency: 'COP',
        status: 'APPROVED',
      },
    };
    const payload = signedEvent({ id: 'wrf-1', amountCents: 1200000, reference: 'RSV-4-R', currency: 'COP', status: 'APPROVED', event: 'refund.updated', dataOverride });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.operation).toBe('refund');
    expect(result.status).toBe('approved');
    expect(result.internalReference).toBe('RSV-4-R');
  });

  it('fails when data has neither transaction nor refund', async () => {
    const payload = signedEvent({ id: 'wtx-9', amountCents: 1200000, reference: 'RSV-9', currency: 'COP', status: 'APPROVED', dataOverride: { customer: {} } });
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(UnsupportedPaymentPayloadError);
  });
});

describe('wompiIntegritySignature', () => {
  it('signs reference + amount + currency + secret deterministically', () => {
    const sig = wompiIntegritySignature({
      reference: 'RSV-100',
      amountInCents: 1200000,
      currency: 'COP',
      integritySecret: 'prod_integrity_abc',
    });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(
      wompiIntegritySignature({ reference: 'RSV-100', amountInCents: 1200000, currency: 'COP', integritySecret: 'prod_integrity_abc' }),
    );
    expect(sig).not.toBe(
      wompiIntegritySignature({ reference: 'RSV-100', amountInCents: 1200000, currency: 'COP', integritySecret: 'prod_integrity_xyz' }),
    );
  });
});

describe('WompiPaymentGateway.buildChargeIntent', () => {
  it('returns a hosted intent with server-side integrity signature', async () => {
    const g = new WompiPaymentGateway({
      eventsSecret: 's',
      environment: 'test',
      publicKey: 'pub_test_k',
      integritySecret: 'inte_sec',
    });
    const intent = await g.buildChargeIntent({ tenantId: 't1', internalReference: 'RSV-1', amount: 12000, currency: 'COP' });
    expect(intent.mode).toBe('hosted');
    expect(intent.publicKey).toBe('pub_test_k');
    expect(intent.amountInCents).toBe(1200000);
    expect(intent.reference).toBe('RSV-1');
    expect(intent.signatureIntegrity).toBe(
      wompiIntegritySignature({ reference: 'RSV-1', amountInCents: 1200000, currency: 'COP', integritySecret: 'inte_sec' }),
    );
  });

  it('fails clearly when public key or integrity secret is not configured', async () => {
    const noKeys = new WompiPaymentGateway({ eventsSecret: 's', environment: 'test' });
    await expect(noKeys.buildChargeIntent({ tenantId: 't1', internalReference: 'RSV-1', amount: 12000, currency: 'COP' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('WompiPaymentGateway.fetchChargeStatus', () => {
  function statusGateway(data: Record<string, unknown>[]) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }));
    const g = new WompiPaymentGateway({
      eventsSecret: 's',
      environment: 'test',
      privateKey: 'prv_test_k',
      integritySecret: 'inte_sec',
      fetcher: fetcher as unknown as typeof fetch,
    });
    return { g, fetcher };
  }

  it('maps an APPROVED transaction by reference', async () => {
    const { g, fetcher } = statusGateway([
      { id: 'wtx-1', reference: 'RSV-1', status: 'APPROVED', amount_in_cents: 1200000, currency: 'COP' },
    ]);
    const result = await g.fetchChargeStatus({ internalReference: 'RSV-1' });
    expect(result).toEqual({ providerTransactionId: 'wtx-1', status: 'approved', amount: 12000, currency: 'COP' });
    expect(String((fetcher.mock.calls[0] as [string])[0])).toContain('/transactions?reference=RSV-1');
  });

  it('maps a DECLINED transaction and returns null when absent', async () => {
    const { g } = statusGateway([{ id: 'wtx-2', reference: 'RSV-2', status: 'DECLINED', amount_in_cents: 500000, currency: 'COP' }]);
    expect(await g.fetchChargeStatus({ internalReference: 'RSV-2' })).toMatchObject({ status: 'declined' });
    expect(await g.fetchChargeStatus({ internalReference: 'RSV-MISSING' })).toBeNull();
  });

  it('treats unknown statuses as pending (no optimistic decline)', async () => {
    const { g } = statusGateway([{ id: 'wtx-3', reference: 'RSV-3', status: 'SOFT', amount_in_cents: 100000, currency: 'COP' }]);
    expect(await g.fetchChargeStatus({ internalReference: 'RSV-3' })).toMatchObject({ status: 'pending' });
  });
});

describe('WompiPaymentGateway.createCharge', () => {
  function networkGateway() {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith('/merchants/info')) {
        return new Response(
          JSON.stringify({
            data: {
              presigned_acceptance: { acceptance_token: 't_acceptance_1', type: 'END_USER_POLICY', permalink: '' },
              presigned_personal_data_auth: { acceptance_token: 't_personal_1', type: 'PERSONAL_DATA_AUTH', permalink: '' },
            },
          }),
          { status: 200 },
        );
      }
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return new Response(JSON.stringify({ data: { id: 'wtx-created', ...body } }), { status: 200 });
    });
    const g = new WompiPaymentGateway({
      eventsSecret: 's',
      environment: 'test',
      publicKey: 'pub_test_k',
      privateKey: 'prv_test_k',
      integritySecret: 'inte_sec',
      fetcher: fetcher as unknown as typeof fetch,
    });
    return { g, fetcher };
  }

  const baseInput = {
    tenantId: 't1',
    appointmentId: 'a1',
    internalReference: 'RSV-1',
    amount: 12000,
    currency: 'COP',
    idempotencyKey: 'idem-1',
    metadata: { customerEmail: 'ana@example.com', token: 'tok_test_1', customerIp: '1.2.3.4' },
  };

  it('sends private key, signature and acceptance tokens', async () => {
    const { g, fetcher } = networkGateway();
    const result = await g.createCharge(baseInput);
    expect(result.providerTransactionId).toBe('wtx-created');

    const [, init] = (fetcher.mock.calls as [string, RequestInit | undefined][]).find(([u]) => String(u).endsWith('/transactions')) ?? [];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(headers.Authorization).toBe('Bearer prv_test_k');
    expect(body.signature).toBe(
      wompiIntegritySignature({ reference: 'RSV-1', amountInCents: 1200000, currency: 'COP', integritySecret: 'inte_sec' }),
    );
    expect(body.acceptance_token).toBe('t_acceptance_1');
    expect(body.accept_personal_auth).toBe('t_personal_1');
    expect(body.customer_email).toBe('ana@example.com');
    expect(body.ip).toBe('1.2.3.4');
  });

  it('requires customer_email', async () => {
    const { g } = networkGateway();
    await expect(g.createCharge({ ...baseInput, metadata: { token: 'tok' } })).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires a payment token for CARD', async () => {
    const { g } = networkGateway();
    await expect(g.createCharge({ ...baseInput, metadata: { customerEmail: 'ana@example.com' } })).rejects.toBeInstanceOf(ValidationError);
  });

  it('fails clearly when the private key is not configured', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const g = new WompiPaymentGateway({
      eventsSecret: 's',
      environment: 'test',
      integritySecret: 'inte_sec',
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(g.createCharge(baseInput)).rejects.toBeInstanceOf(ValidationError);
  });

  it('reuses resolution of acceptance tokens across charges', async () => {
    const { g, fetcher } = networkGateway();
    await g.createCharge(baseInput);
    await g.createCharge(baseInput);
    const infoCalls = (fetcher.mock.calls as [string, RequestInit | undefined][]).filter(([u]) => String(u).endsWith('/merchants/info'));
    expect(infoCalls).toHaveLength(1);
  });
});