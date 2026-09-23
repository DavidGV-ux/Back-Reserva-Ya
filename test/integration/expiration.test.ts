import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'bson';
import { testDb, TestDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';
import { buildMockPaymentEvent } from '../../src/infrastructure/integrations/payments/mock-payment';

async function backdateAppointment(ctx: TestDb, appointmentId: string, minutesAgo: number): Promise<void> {
  await ctx.db.collection('appointments').updateOne(
    { _id: new ObjectId(appointmentId) },
    { $set: { created_at: new Date(Date.now() - minutesAgo * 60_000) } },
  );
}

describe('pending payment expiration (RNF-21)', () => {
  let ctx: TestDb;
  let shop: SeededShop;
  let monday: Date;

  beforeAll(async () => {
    ctx = await testDb();
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
    clientInfo: { name: 'Ana Pérez', phone: '+57 300 111 2233', habeasDataConsent: true },
    idempotencyKey: key,
    actor: 'web-test',
  });

  it('expires a pending appointment past its payment timeout and frees the slot', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 9), `exp-key-${shop.tenant.tenantId}-1`));
    await backdateAppointment(ctx, created.appointment.id, 30);

    const result = await ctx.services.payments.expirePendingPayments();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const fresh = await ctx.services.booking.getAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(fresh.status).toBe('expired');
    expect(fresh.paymentStatus).toBe('rejected');

    const tx = await ctx.repos.paymentTransactions.findByInternalReference(shop.tenant.tenantId, created.intent.paymentReference);
    expect(tx?.status).toBe('declined');

    const ledger = await ctx.repos.ledger.findByAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(ledger.some((l) => l.type === 'payment_rejected')).toBe(true);

    const slots = await ctx.db.collection('time_slots').countDocuments({ appointment_id: new ObjectId(created.appointment.id) });
    expect(slots).toBe(0);
  });

  it('skips appointments younger than the tenant timeout', async () => {
    const created = await ctx.services.booking.createAppointment(bookingInput(bogotaIso(monday, 10), `exp-key-${shop.tenant.tenantId}-2`));
    await backdateAppointment(ctx, created.appointment.id, 5);

    const result = await ctx.services.payments.expirePendingPayments();
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const fresh = await ctx.services.booking.getAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(fresh.status).toBe('pending_payment');
  });

  it('does not double-expire an already expired appointment', async () => {
    const result = await ctx.services.payments.expirePendingPayments();

    const expiredDocs = await ctx.db.collection('appointments').countDocuments({ status: 'expired' });
    expect(expiredDocs).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });

  it('auto-refunds a real advance when a pending appointment has an approved charge and expires', async () => {
    const created = await ctx.services.booking.createAppointment(
      bookingInput(bogotaIso(monday, 11), `exp-refund-key-${shop.tenant.tenantId}-1`),
    );

    await ctx.db.collection('payment_transactions').updateOne(
      { internal_reference: created.intent.paymentReference },
      { $set: { status: 'approved', provider_transaction_id: `mock-charge-${created.intent.paymentReference}` } },
    );
    await backdateAppointment(ctx, created.appointment.id, 30);

    const result = await ctx.services.payments.expirePendingPayments();
    expect(result.refundRequested).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const fresh = await ctx.services.booking.getAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(fresh.status).toBe('expired');
    expect(fresh.paymentStatus).toBe('pending');

    const refundTx = await ctx.repos.paymentTransactions.findByInternalReference(
      shop.tenant.tenantId,
      `${created.intent.paymentReference}-R`,
    );
    expect(refundTx?.operation).toBe('refund');
    expect(refundTx?.status).toBe('pending');

    const slots = await ctx.db
      .collection('time_slots')
      .countDocuments({ appointment_id: new ObjectId(created.appointment.id) });
    expect(slots).toBe(0);

    const approval = await ctx.services.payments.processWebhook({
      tenantId: shop.tenant.tenantId,
      rawEvent: buildMockPaymentEvent('refund', {
        reference: `${created.intent.paymentReference}-R`,
        amount: created.intent.advanceAmount,
        currency: created.intent.currency,
        tenantId: shop.tenant.tenantId,
      }),
    });
    expect(approval.handled).toBe(true);
    expect(approval.transaction?.status).toBe('approved');

    const ledger = await ctx.repos.ledger.findByAppointment(shop.tenant.tenantId, created.appointment.id);
    expect(ledger.some((l) => l.type === 'refund')).toBe(true);
  });
});