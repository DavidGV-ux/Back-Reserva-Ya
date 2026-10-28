import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, TestDb } from '../helpers/mongo';
import { hexId } from '../../src/shared/id';
import { Plan, Professional, Service, Tenant } from '../../src/domain/entities';
import { bogotaIso, FULL_WEEK, nextMondayBogota } from '../helpers/fixtures';

const ACTOR = 'test';

describe('capacity bookings (integration)', () => {
  let ctx: TestDb;
  let plan: Plan;
  let tenant: Tenant;
  let service: Service;
  let professional: Professional;
  let monday: Date;

  beforeAll(async () => {
    ctx = await testDb();
    plan = await ctx.repos.plans.create(
      { id: hexId(), name: 'Básico', code: 'basico-test-capacity', commissionRate: 0.05, fixedFee: 0, active: true },
      ACTOR,
    );
    tenant = await ctx.repos.tenants.create(
      {
        id: hexId(),
        tenantId: 't_cafe_capacity',
        slug: 'cafe-capacity',
        planId: plan.code,
        name: 'Café Capacidad',
        tagline: '',
        description: '',
        timezone: 'America/Bogota',
        currency: 'COP',
        country: 'CO',
        category: 'bars_cafes',
        settings: {
          defaultLanguage: 'es',
          activeLanguages: ['es'],
          slotGranularityMinutes: 30,
          cancellationToleranceHours: 24,
          paymentTimeoutMinutes: 15,
          advancePaymentPercentage: 0,
          preferredNotificationChannel: 'whatsapp',
          reminderHours: 24,
          bookingMode: 'capacity',
          capacityPerSlot: 2,
        },
        bookingStatus: 'active',
        version: 1,
      },
      ACTOR,
    );
    service = await ctx.repos.services.create(
      {
        id: hexId(),
        tenantId: tenant.tenantId,
        name: 'Café especial',
        description: '',
        price: 12000,
        currency: 'COP',
        durationMinutes: 30,
        active: true,
        version: 1,
      },
      ACTOR,
    );
    professional = await ctx.repos.professionals.create(
      {
        id: hexId(),
        tenantId: tenant.tenantId,
        name: 'Laura',
        title: 'Barista',
        serviceIds: [service.id],
        active: true,
        version: 1,
        schedule: FULL_WEEK,
      },
      ACTOR,
    );
    monday = nextMondayBogota(new Date());
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  const booking = (startIso: string) => ({
    tenantId: tenant.tenantId,
    serviceId: service.id,
    professionalId: professional.id,
    startTime: startIso,
    clientInfo: {
      name: 'Cliente Café',
      phone: '+57 300 000 0000',
      habeasDataConsent: true,
    },
    actor: 'web-test',
  });

  it('acepta dos reservas simultáneas y rechaza la tercera', async () => {
    const start = bogotaIso(monday, 9);
    await ctx.services.booking.createAppointment({
      ...booking(start),
      idempotencyKey: `cap-a-${hexId()}`,
    });
    await ctx.services.booking.createAppointment({
      ...booking(start),
      idempotencyKey: `cap-b-${hexId()}`,
    });

    await expect(
      ctx.services.booking.createAppointment({
        ...booking(start),
        idempotencyKey: `cap-c-${hexId()}`,
      }),
    ).rejects.toMatchObject({ code: 'AVAILABILITY_CONFLICT' });
  });

  it('la disponibilidad refleja el aforo compartido, no el profesional', async () => {
    const start = bogotaIso(monday, 10);
    await ctx.services.booking.createAppointment({
      ...booking(start),
      idempotencyKey: `cap-d-${hexId()}`,
    });
    const afterOne = await ctx.services.availability.listSlots({
      tenantId: tenant.tenantId,
      professionalId: professional.id,
      date: monday.toISOString().slice(0, 10),
      durationMinutes: 30,
      timezone: 'America/Bogota',
      granularityMinutes: 30,
      capacityMode: true,
      capacity: 2,
      now: new Date(bogotaIso(monday, 8)),
    });
    const slotAfterOne = afterOne.find((s) => s.start === start);
    expect(slotAfterOne?.available).toBe(true);

    await ctx.services.booking.createAppointment({
      ...booking(start),
      idempotencyKey: `cap-e-${hexId()}`,
    });
    const afterTwo = await ctx.services.availability.listSlots({
      tenantId: tenant.tenantId,
      professionalId: professional.id,
      date: monday.toISOString().slice(0, 10),
      durationMinutes: 30,
      timezone: 'America/Bogota',
      granularityMinutes: 30,
      capacityMode: true,
      capacity: 2,
      now: new Date(bogotaIso(monday, 8)),
    });
    const slotAfterTwo = afterTwo.find((s) => s.start === start);
    expect(slotAfterTwo?.available).toBe(false);
    expect(slotAfterTwo?.reason).toBe('booked');
  });
});
