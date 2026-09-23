import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testDb, TestDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';
import { WompiPaymentGateway } from '../../src/infrastructure/integrations/payments/wompi-payment';
import { PayuPaymentGateway } from '../../src/infrastructure/integrations/payments/payu-payment';
import { wompiChecksum, wompiIntegritySignature, payuSign } from '../../src/infrastructure/integrations/payments/shared';

const EVENTS_SECRET = 'wompi-test-secret';
const WOMPI_PUBLIC_KEY = 'pub_test_xyz';
const WOMPI_PRIVATE_KEY = 'prv_test_private';
const WOMPI_INTEGRITY_SECRET = 'test-integrity-secret';

interface WompiCall {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function wompiFetcher() {
  let txSeq = 1;
  let refundSeq = 1;
  const calls: WompiCall[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) headers[key.toLowerCase()] = String(value);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ path, body, headers });
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
    if (path.endsWith('/refunds')) {
      return new Response(JSON.stringify({ data: { id: `wrf-${refundSeq++}`, ...body } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: `wtx-${txSeq++}`, ...body } }), { status: 200 });
  });
  return { fetcher, calls };
}

function payuFetcher() {
  let seq = 1;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const isRefund = (body.transaction as Record<string, unknown> | undefined)?.type === 'REFUND';
    return new Response(
      JSON.stringify({
        transactionResponse: {
          transactionId: `${isRefund ? 'puf' : 'put'}-${seq++}`,
          state: isRefund ? 'APPROVED' : 'PENDING',
        },
      }),
      { status: 200 },
    );
  });
}

const WOMPI_PROPERTIES = [
  'transaction.id',
  'transaction.amount_in_cents',
  'transaction.reference',
  'transaction.currency',
  'transaction.status',
];

function buildWompiChargeEvent(input: {
  id: string;
  reference: string;
  amountCents: number;
  currency: string;
  status: string;
  event?: string;
  timestamp?: number;
}) {
  const timestamp = input.timestamp ?? 1_700_000_000_000;
  const data = {
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
    signature: { properties: WOMPI_PROPERTIES, checksum: '' },
  };
  (payload.signature as Record<string, unknown>).checksum = wompiChecksum(payload, EVENTS_SECRET);
  return payload;
}

function buildWompiRefundEvent(input: {
  id: string;
  reference: string;
  amountCents: number;
  currency: string;
  status: string;
  timestamp?: number;
}) {
  const timestamp = input.timestamp ?? 1_700_000_000_500;
  const data = {
    refund: {
      id: input.id,
      amount_in_cents: input.amountCents,
      reference: input.reference,
      currency: input.currency,
      status: input.status,
    },
  };
  const payload: Record<string, unknown> = {
    event: 'refund.updated',
    data,
    environment: 'test',
    timestamp,
    signature: { properties: ['refund.id', 'refund.amount_in_cents', 'refund.reference', 'refund.currency', 'refund.status'], checksum: '' },
  };
  (payload.signature as Record<string, unknown>).checksum = wompiChecksum(payload, EVENTS_SECRET);
  return payload;
}

function buildPayuChargeEvent(input: { apiKey: string; merchantId: string; reference: string; value: string; statePol: string }) {
  const payload: Record<string, string> = {
    merchant_id: input.merchantId,
    state_pol: input.statePol,
    reference_sale: input.reference,
    reference_pol: 'pol-1',
    transaction_id: 'put-1',
    value: input.value,
    currency: 'COP',
  };
  payload.sign = payuSign({
    apiKey: input.apiKey,
    merchantId: input.merchantId,
    referenceSale: input.reference,
    value: input.value,
    currency: 'COP',
    statePol: input.statePol,
  });
  return payload;
}

describe('Wompi payment gateway (integration)', () => {
  let ctx: TestDb;
  let shop: SeededShop;
  let fetcher: ReturnType<typeof wompiFetcher>['fetcher'];
  let wompiCalls: WompiCall[];
  let monday: Date;

  beforeAll(async () => {
    const stub = wompiFetcher();
    fetcher = stub.fetcher;
    wompiCalls = stub.calls;
    const gateway = new WompiPaymentGateway({
      eventsSecret: EVENTS_SECRET,
      environment: 'test',
      publicKey: WOMPI_PUBLIC_KEY,
      privateKey: WOMPI_PRIVATE_KEY,
      integritySecret: WOMPI_INTEGRITY_SECRET,
      fetcher: stub.fetcher as unknown as typeof fetch,
    });
    ctx = await testDb({ paymentGateway: gateway });
    shop = await seedShop(ctx.repos);
    monday = nextMondayBogota(new Date());
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  const bookingInput = (startIso: string, key: string) => ({
    tenantId: shop.tenant.tenantId,
    serviceId: shop.service.id,
    professionalId: shop.professional.id,
    startTime: startIso,
    clientInfo: { name: 'Ana Pérez', phone: '+57 300 111 2233', email: 'ana.perez@example.com', habeasDataConsent: true },
    payment: { type: 'CARD', token: 'tok_test_card' },
    idempotencyKey: key,
    actor: 'web-test',
  });

  it('confirms a booking after an approved Wompi charge webhook and posts ledger', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 9), `key-${shop.tenant.tenantId}-1`));
    const providerTransactionId = created.intent.providerTransactionId ?? '';
    const event = buildWompiChargeEvent({
      id: providerTransactionId,
      reference: created.intent.paymentReference,
      amountCents: Math.round(created.intent.advanceAmount * 100),
      currency: created.intent.currency,
      status: 'APPROVED',
    });

    const result = await ctx.services.payments.processWebhook({
      tenantId: shop.tenant.tenantId,
      rawEvent: { headers: {}, body: event },
    });

    expect(result.handled).toBe(true);
    expect(result.transaction?.status).toBe('approved');
    expect(result.appointment?.status).toBe('confirmed');
    expect(result.appointment?.paymentStatus).toBe('approved');

    const ledger = await ctx.repos.ledger.findByAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(ledger).toHaveLength(2);
    const commission = ledger.find((l) => l.type === 'platform_commission');
    expect(commission?.amount).toBe(600);
    expect(ledger.find((l) => l.type === 'payment_approved')?.amount).toBe(11400);
  });

  it('ignores a replayed approved charge event (dedupe)', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 10), `key-${shop.tenant.tenantId}-2`));
    const event = buildWompiChargeEvent({
      id: created.intent.providerTransactionId ?? '',
      reference: created.intent.paymentReference,
      amountCents: Math.round(created.intent.advanceAmount * 100),
      currency: created.intent.currency,
      status: 'APPROVED',
      timestamp: 1_700_000_100_000,
    });
    const envelope = { headers: {}, body: event };

    const first = await ctx.services.payments.processWebhook({ tenantId: shop.tenant.tenantId, rawEvent: envelope });
    expect(first.handled).toBe(true);
    const second = await ctx.services.payments.processWebhook({ tenantId: shop.tenant.tenantId, rawEvent: envelope });
    expect(second.handled).toBe(false);
    expect(second.reason).toBe('duplicate');

    const ledger = await ctx.repos.ledger.findByAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(ledger).toHaveLength(2);
  });

  it('does not mutate state on a pending charge event', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 11), `key-${shop.tenant.tenantId}-3`));
    const event = buildWompiChargeEvent({
      id: created.intent.providerTransactionId ?? '',
      reference: created.intent.paymentReference,
      amountCents: Math.round(created.intent.advanceAmount * 100),
      currency: created.intent.currency,
      status: 'PENDING',
    });

    const result = await ctx.services.payments.processWebhook({ tenantId: shop.tenant.tenantId, rawEvent: { headers: {}, body: event } });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('pending');

    const fresh = await ctx.services.booking.getAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(fresh.status).toBe('pending_payment');
    expect(fresh.paymentStatus).toBe('pending');
  });

  it('returns a hosted charge intent (no token) and confirms via webhook without calling /transactions', async () => {
    const before = wompiCalls.filter((c) => c.path.endsWith('/transactions')).length;
    const created = await ctx.services.booking.createAppointment({
      tenantId: shop.tenant.tenantId,
      serviceId: shop.service.id,
      professionalId: shop.professional.id,
      startTime: bogotaIso(monday, 13),
      clientInfo: { name: 'Ana Pérez', phone: '+57 300 111 2233', email: 'ana.perez@example.com', habeasDataConsent: true },
      idempotencyKey: `key-${shop.tenant.tenantId}-hosted`,
      actor: 'web-test',
    });

    expect(created.intent.chargeMode).toBe('hosted');
    expect(created.intent.providerTransactionId).toBeUndefined();
    expect(created.intent.publicKey).toBe(WOMPI_PUBLIC_KEY);
    expect(created.intent.amountInCents).toBe(Math.round(created.intent.advanceAmount * 100));
    expect(created.intent.signatureIntegrity).toBe(
      wompiIntegritySignature({
        reference: created.intent.paymentReference,
        amountInCents: created.intent.amountInCents ?? 0,
        currency: created.intent.currency,
        integritySecret: WOMPI_INTEGRITY_SECRET,
      }),
    );

    const txCalls = wompiCalls.filter((c) => c.path.endsWith('/transactions'));
    expect(txCalls).toHaveLength(before);

    const pendingTx = await ctx.repos.paymentTransactions.findByInternalReference(shop.tenant.tenantId, created.intent.paymentReference);
    expect(pendingTx?.providerTransactionId).toBeUndefined();

    const event = buildWompiChargeEvent({
      id: 'wtx-hosted-1',
      reference: created.intent.paymentReference,
      amountCents: created.intent.amountInCents ?? 0,
      currency: created.intent.currency,
      status: 'APPROVED',
    });
    const result = await ctx.services.payments.processWebhook({
      tenantId: shop.tenant.tenantId,
      rawEvent: { headers: {}, body: event },
    });
    expect(result.handled).toBe(true);
    expect(result.appointment?.status).toBe('confirmed');
    expect(result.appointment?.paymentStatus).toBe('approved');
  });

  it('builds a spec-compliant Wompi charge (private key, signature, acceptance tokens)', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 12), `key-${shop.tenant.tenantId}-spec`));
    const txCalls = wompiCalls.filter((c) => c.path.endsWith('/transactions'));
    const charge = txCalls.at(-1);
    expect(charge?.headers.authorization).toBe(`Bearer ${WOMPI_PRIVATE_KEY}`);
    expect(charge?.body.signature).toBe(
      wompiIntegritySignature({
        reference: created.intent.paymentReference,
        amountInCents: Math.round(created.intent.advanceAmount * 100),
        currency: created.intent.currency,
        integritySecret: WOMPI_INTEGRITY_SECRET,
      }),
    );
    expect(charge?.body.acceptance_token).toBe('t_acceptance_1');
    expect(charge?.body.accept_personal_auth).toBe('t_personal_1');
    expect(charge?.body.customer_email).toBe('ana.perez@example.com');
    expect(charge?.body.payment_method_type).toBe('CARD');
    expect(charge?.body.payment_method).toEqual({ type: 'CARD', token: 'tok_test_card' });
    expect(charge?.body.amount_in_cents).toBe(Math.round(created.intent.advanceAmount * 100));
  });

  it('rejects an event for an unknown reference', async () => {
    const event = buildWompiChargeEvent({
      id: 'wtx-999',
      reference: 'RSV-DOES-NOT-EXIST',
      amountCents: 1200000,
      currency: 'COP',
      status: 'APPROVED',
    });
    const result = await ctx.services.payments.processWebhook({ tenantId: shop.tenant.tenantId, rawEvent: { headers: {}, body: event } });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('unknown_reference');
  });

  it('approves a refund after an owner cancellation and posts refund ledger', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 14), `key-${shop.tenant.tenantId}-4`));
    await ctx.services.payments.processWebhook({
      tenantId: shop.tenant.tenantId,
      rawEvent: {
        headers: {},
        body: buildWompiChargeEvent({
          id: created.intent.providerTransactionId ?? '',
          reference: created.intent.paymentReference,
          amountCents: Math.round(created.intent.advanceAmount * 100),
          currency: created.intent.currency,
          status: 'APPROVED',
        }),
      },
    });

    const cancelled = await ctx.services.booking.cancelAppointment({
      tenantId: shop.tenant.tenantId,
      appointmentId: created.appointment.id,
      requestedBy: 'owner',
      reason: 'Test',
      actor: 'owner-test',
    });
    expect(cancelled.cancellation?.refundAmount).toBe(12000);
    expect(cancelled.paymentStatus).toBe('pending');

    const refundTx = await ctx.repos.paymentTransactions.findByInternalReference(shop.tenant.tenantId, `${created.intent.paymentReference}-R`);
    expect(refundTx?.operation).toBe('refund');

    const refundCall = wompiCalls.filter((c) => c.path.endsWith('/refunds')).at(-1);
    expect(refundCall?.headers.authorization).toBe(`Bearer ${WOMPI_PRIVATE_KEY}`);
    expect(refundCall?.body.transaction_id).toBe(created.intent.providerTransactionId);
    expect(refundCall?.body.amount_in_cents).toBe(Math.round(cancelled.cancellation!.refundAmount * 100));

    const refundEvent = buildWompiRefundEvent({
      id: 'wrf-1',
      reference: `${created.intent.paymentReference}-R`,
      amountCents: Math.round(cancelled.cancellation!.refundAmount * 100),
      currency: created.intent.currency,
      status: 'APPROVED',
    });
    const result = await ctx.services.payments.processWebhook({ tenantId: shop.tenant.tenantId, rawEvent: { headers: {}, body: refundEvent } });

    expect(result.handled).toBe(true);
    expect(result.transaction?.operation).toBe('refund');
    expect(result.appointment?.paymentStatus).toBe('refunded');

    const ledger = await ctx.repos.ledger.findByAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(ledger.some((l) => l.type === 'refund')).toBe(true);
  });
});

describe('PayU payment gateway (integration)', () => {
  let ctx: TestDb;
  let shop: SeededShop;
  let monday: Date;

  beforeAll(async () => {
    const gateway = new PayuPaymentGateway({
      apiKey: 'payu-test-key',
      apiSecret: 'payu-test-secret',
      merchantId: 'payu-test-merchant',
      accountId: 'payu-test-account',
      fetcher: payuFetcher() as unknown as typeof fetch,
    });
    ctx = await testDb({ paymentGateway: gateway });
    shop = await seedShop(ctx.repos);
    monday = nextMondayBogota(new Date());
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  it('confirms a booking after an approved PayU confirmation (signed)', async () => {
    const created = await ctx.services.booking.createAppointment({
      tenantId: shop.tenant.tenantId,
      serviceId: shop.service.id,
      professionalId: shop.professional.id,
      startTime: bogotaIso(monday, 15),
      clientInfo: { name: 'Ana Pérez', phone: '+57 300 111 2233', habeasDataConsent: true },
      idempotencyKey: `payu-${shop.tenant.tenantId}-1`,
      actor: 'web-test',
    });
    const payload = buildPayuChargeEvent({
      apiKey: 'payu-test-key',
      merchantId: 'payu-test-merchant',
      reference: created.intent.paymentReference,
      value: created.intent.advanceAmount.toFixed(2),
      statePol: '4',
    });

    const result = await ctx.services.payments.processWebhook({ tenantId: shop.tenant.tenantId, rawEvent: { headers: {}, body: payload } });

    expect(result.handled).toBe(true);
    expect(result.appointment?.status).toBe('confirmed');
    expect(result.appointment?.paymentStatus).toBe('approved');
  });
});