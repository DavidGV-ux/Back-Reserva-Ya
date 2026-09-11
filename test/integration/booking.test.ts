import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, TestDb } from '../helpers/mongo';
import { hexId } from '../../src/shared/id';
import { localDateParts } from '../../src/shared/timezone';
import { Plan, Professional, Service, Tenant } from '../../src/domain/entities';
import { WeeklySchedule } from '../../src/domain/entities/catalog';

const ACTOR = 'test';

const FULL_WEEK: WeeklySchedule = {
  monday: [{ start: '09:00', end: '18:00' }],
  tuesday: [{ start: '09:00', end: '18:00' }],
  wednesday: [{ start: '09:00', end: '18:00' }],
  thursday: [{ start: '09:00', end: '18:00' }],
  friday: [{ start: '09:00', end: '18:00' }],
  saturday: [{ start: '09:00', end: '13:00' }],
  sunday: [],
};

function nextMondayBogota(date: Date): Date {
  const parts = localDateParts('America/Bogota', date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysUntilMonday = (8 - weekday) % 7 || 7;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysUntilMonday));
}

function bogotaIso(date: Date, hour: number): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour + 5)).toISOString();
}

function localDateStamp(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

describe('booking flow (integration)', () => {
  let ctx: TestDb;
  let plan: Plan;
  let tenant: Tenant;
  let service: Service;
  let professional: Professional;
  let monday: Date;

  beforeAll(async () => {
    ctx = await testDb();
    plan = await ctx.repos.plans.create({ id: hexId(), name: 'Pro', code: 'pro', commissionRate: 0.05, fixedFee: 0, active: true }, ACTOR);
    tenant = await ctx.repos.tenants.create(
      {
        id: hexId(),
        tenantId: 't_barber_estilo',
        slug: 'barber-estilo',
        planId: plan.code,
        name: 'Barber Estilo',
        tagline: '',
        description: '',
        timezone: 'America/Bogota',
        currency: 'COP',
        country: 'CO',
        settings: {
          defaultLanguage: 'es',
          activeLanguages: ['es'],
          slotGranularityMinutes: 30,
          cancellationToleranceHours: 48,
          paymentTimeoutMinutes: 15,
          advancePaymentPercentage: 30,
          preferredNotificationChannel: 'whatsapp',
          reminderHours: 24,
        },
        bookingStatus: 'active',
        version: 1,
      },
      ACTOR,
    );
    service = await ctx.repos.services.create(
      { id: hexId(), tenantId: tenant.tenantId, name: 'Corte', description: '', price: 40000, currency: 'COP', durationMinutes: 30, active: true, version: 1 },
      ACTOR,
    );
    professional = await ctx.repos.professionals.create(
      { id: hexId(), tenantId: tenant.tenantId, name: 'Juan', title: 'Barbero', serviceIds: [service.id], active: true, version: 1, schedule: FULL_WEEK },
      ACTOR,
    );
    monday = nextMondayBogota(new Date());
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  const bookingInput = (startIso: string, idempotencyKey: string) => ({
    tenantId: tenant.tenantId,
    serviceId: service.id,
    professionalId: professional.id,
    startTime: startIso,
    clientInfo: {
      name: 'Ana Pérez',
      phone: '+57 300 111 2233',
      habeasDataConsent: true,
    },
    idempotencyKey,
  });

  it('creates a pending appointment with an advance intent', async () => {
    const start = bogotaIso(monday, 9);
    const result = await ctx.services.booking.createAppointment({
      ...bookingInput(start, `key-${hexId()}`),
      actor: 'web-test',
    });
    expect(result.replay).toBe(false);
    expect(result.appointment.status).toBe('pending_payment');
    expect(result.appointment.paymentStatus).toBe('pending');
    expect(result.appointment.startTime).toBe(start);
    expect(result.intent.advanceAmount).toBe(12000);
    expect(result.intent.currency).toBe('COP');
    expect(result.intent.paymentReference).toBeTruthy();
  });

  it('is idempotent for the same booking request', async () => {
    const start = bogotaIso(monday, 10);
    const key = `key-${hexId()}`;
    const first = await ctx.services.booking.createAppointment({ ...bookingInput(start, key), actor: 'web-test' });
    const second = await ctx.services.booking.createAppointment({ ...bookingInput(start, key), actor: 'web-test' });
    expect(second.replay).toBe(true);
    expect(second.appointment.id).toBe(first.appointment.id);
  });

  it('rejects overlapping bookings for the same professional', async () => {
    const start = bogotaIso(monday, 11);
    await ctx.services.booking.createAppointment({ ...bookingInput(start, `key-${hexId()}`), actor: 'web-test' });
    await expect(
      ctx.services.booking.createAppointment({ ...bookingInput(start, `key-${hexId()}`), actor: 'web-test' }),
    ).rejects.toMatchObject({ code: 'AVAILABILITY_CONFLICT' });
  });

  it('confirms the booking after an approved charge webhook and posts ledger', async () => {
    const start = bogotaIso(monday, 14);
    const created = await ctx.services.booking.createAppointment({ ...bookingInput(start, `key-${hexId()}`), actor: 'web-test' });

    const result = await ctx.services.payments.processWebhook({
      tenantId: tenant.tenantId,
      rawEvent: {
        type: 'payment.charge.approved',
        data: {
          reference: created.intent.paymentReference,
          amount: created.intent.advanceAmount,
          currency: created.intent.currency,
          tenantId: tenant.tenantId,
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.transaction?.status).toBe('approved');
    expect(result.appointment?.status).toBe('confirmed');
    expect(result.appointment?.paymentStatus).toBe('approved');

    const ledger = await ctx.repos.ledger.findByAppointment(tenant.tenantId, created.appointment.id);
    expect(ledger).toHaveLength(2);
    const commission = ledger.find((l) => l.type === 'platform_commission');
    const credit = ledger.find((l) => l.type === 'payment_approved');
    expect(commission?.amount).toBe(600);
    expect(credit?.amount).toBe(11400);
  });

  it('lists availability days and slots for a future working day', async () => {
    const mondayStamp = localDateStamp(monday);
    const days = await ctx.services.availability.listAvailableDays({
      tenantId: tenant.tenantId,
      professionalIds: [professional.id],
      windowDays: 14,
      timezone: tenant.timezone,
    });
    expect(days).toContain(mondayStamp);

    const slots = await ctx.services.availability.listSlots({
      tenantId: tenant.tenantId,
      professionalId: professional.id,
      date: mondayStamp,
      durationMinutes: 30,
      timezone: tenant.timezone,
      granularityMinutes: 30,
    });
    const noon = slots.find((s) => s.start.startsWith(`${mondayStamp}T17:00`));
    expect(noon).toBeDefined();
    expect(noon!.available).toBe(true);
  });

  it('owner cancellation inside the window refunds the full advance and frees the slot', async () => {
    const start = bogotaIso(monday, 15);
    const created = await ctx.services.booking.createAppointment({ ...bookingInput(start, `key-${hexId()}`), actor: 'web-test' });
    const cancelled = await ctx.services.booking.cancelAppointment({
      tenantId: tenant.tenantId,
      appointmentId: created.appointment.id,
      requestedBy: 'owner',
      reason: 'Test',
      actor: 'owner-test',
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellation?.policyApplied).toBe('tenant_cancelled');
    expect(cancelled.cancellation?.refundAmount).toBe(12000);

    const slots = await ctx.services.availability.listSlots({
      tenantId: tenant.tenantId,
      professionalId: professional.id,
      date: localDateStamp(monday),
      durationMinutes: 30,
      timezone: tenant.timezone,
      granularityMinutes: 30,
    });
    const fifteen = slots.find((s) => s.start.startsWith(`${localDateStamp(monday)}T20:00`));
    expect(fifteen?.available).toBe(true);
  });
});