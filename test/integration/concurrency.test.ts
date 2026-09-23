import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, TestDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';

describe('concurrency guard on overlapping bookings (RNF-02)', () => {
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

  it('lets exactly one of N simultaneous bookings win the same slot', async () => {
    const startIso = bogotaIso(monday, 9);
    const attempts = Array.from({ length: 8 }, (_, i) =>
      ctx.services.booking.createAppointment({
        tenantId: shop.tenant.tenantId,
        serviceId: shop.service.id,
        professionalId: shop.professional.id,
        startTime: startIso,
        clientInfo: { name: `Cliente ${i}`, phone: `+57 300 111 22${i}`, habeasDataConsent: true },
        idempotencyKey: `concurrency-${shop.tenant.tenantId}-${i}`,
        actor: 'web-test',
      }),
    );

    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'AVAILABILITY_CONFLICT' });
    }

    const appointmentCount = await ctx.db.collection('appointments').countDocuments({
      tenant_id: shop.tenant.tenantId,
      professional_id: (await import('bson')).ObjectId.createFromHexString(shop.professional.id),
      start_time: new Date(startIso),
      status: 'pending_payment',
    });
    expect(appointmentCount).toBe(1);

    const slotCount = await ctx.db.collection('time_slots').countDocuments({
      tenant_id: shop.tenant.tenantId,
      slot_start: new Date(startIso),
    });
    expect(slotCount).toBe(1);
  });
});