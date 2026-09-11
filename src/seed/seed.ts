import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { connectMongo } from '../infrastructure/persist/mongo/connection';
import { createRepos } from '../infrastructure/persist/mongo/repositories/repo-factory';
import { ensureExtraIndexes } from '../infrastructure/persist/mongo/repositories/base';
import { hexId, reference } from '../shared/id';
import { env } from '../config/env';
import { Plan, Professional, Service, Tenant } from '../domain/entities';
import { WeeklySchedule } from '../domain/entities/catalog';
import { Appointment } from '../domain/entities/appointment';
import { PaymentTransaction } from '../domain/entities/payments';
import { LedgerEntry } from '../domain/entities/payments';

const ACTOR = 'seed';

const WEEK_SCHEDULE = {
  monday: [{ start: '09:00', end: '18:00' }],
  tuesday: [{ start: '09:00', end: '18:00' }],
  wednesday: [{ start: '09:00', end: '18:00' }],
  thursday: [{ start: '09:00', end: '18:00' }],
  friday: [{ start: '09:00', end: '20:00' }],
  saturday: [{ start: '09:00', end: '20:00' }],
  sunday: [],
} as WeeklySchedule;

const SERVICE_SEED = [
  { name: 'Corte clásico', description: 'Corte de cabello con tijera y máquina, lavado incluido.', price: 35000, durationMinutes: 45 },
  { name: 'Corte + barba', description: 'Corte de cabello y arreglo de barba con toalla caliente.', price: 55000, durationMinutes: 75 },
  { name: 'Ritual de barba', description: 'Arreglo de barba, perfilado y afeitado clásico.', price: 30000, durationMinutes: 45 },
  { name: 'Corte infantil', description: 'Corte de cabello para niños hasta 12 años.', price: 28000, durationMinutes: 30 },
] as const;

const PROFESSIONAL_SEED: Array<{ name: string; title: string; serviceIndexes: number[] }> = [
  { name: 'Carlos Mendoza', title: 'Barbero senior', serviceIndexes: [0, 1, 2] },
  { name: 'Andrea Torres', title: 'Estilista', serviceIndexes: [0, 1, 3] },
  { name: 'Julián Prada', title: 'Barbero', serviceIndexes: [0, 1, 2] },
];

// America/Bogota = UTC-5
function bogotaIso(dayOffset: number, hour: number, minute = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hour + 5, minute)).toISOString();
}

async function upsertPlan(
  repos: ReturnType<typeof createRepos>,
  input: { name: string; code: string; commissionRate: number; fixedFee: number },
): Promise<Plan> {
  const existing = await repos.plans.findByCode(input.code);
  if (existing) return existing;
  return repos.plans.create(
    {
      id: hexId(),
      name: input.name,
      code: input.code,
      commissionRate: input.commissionRate,
      fixedFee: input.fixedFee,
      active: true,
    },
    ACTOR,
  );
}

function barberTenant(proPlan: Plan): Tenant {
  return {
    id: hexId(),
    tenantId: 't_barber_estilo',
    slug: 'barber-estilo',
    planId: proPlan.code,
    name: 'Barber Estilo',
    tagline: 'Cortes de cabello y barbería con cita previa',
    description:
      'Barbería con profesionales certificados. Agenda tu cita en línea, paga tu anticipo y llega al local sin esperas.',
    timezone: 'America/Bogota',
    currency: 'COP',
    country: 'CO',
    phone: '+57 320 123 4567',
    address: 'Calle 23 # 45-12, Bogotá',
    settings: {
      defaultLanguage: 'es',
      activeLanguages: ['es', 'en'],
      slotGranularityMinutes: 30,
      cancellationToleranceHours: 24,
      paymentTimeoutMinutes: 15,
      advancePaymentPercentage: 30,
      preferredNotificationChannel: 'whatsapp',
      reminderHours: 24,
    },
    bookingStatus: 'active',
    version: 1,
  };
}

function clinicaTenant(basicoPlan: Plan): Tenant {
  return {
    id: hexId(),
    tenantId: 't_clinica_vida',
    slug: 'clinica-vida',
    planId: basicoPlan.code,
    name: 'Clínica Vida',
    tagline: 'Bienestar y salud con cita previa',
    description: 'Consultas médicas generales y especializadas, agenda tu cita en línea.',
    timezone: 'America/Bogota',
    currency: 'COP',
    country: 'CO',
    phone: '+57 310 200 3344',
    address: 'Cra 15 # 82-10, Bogotá',
    settings: {
      defaultLanguage: 'es',
      activeLanguages: ['es'],
      slotGranularityMinutes: 30,
      cancellationToleranceHours: 12,
      paymentTimeoutMinutes: 15,
      advancePaymentPercentage: 0,
      preferredNotificationChannel: 'whatsapp',
      reminderHours: 24,
    },
    bookingStatus: 'active',
    version: 1,
  };
}

async function seedBarber(
  repos: ReturnType<typeof createRepos>,
  tenant: Tenant,
  proPlan: Plan,
  services: Service[],
  professionals: Professional[],
): Promise<{ services: Service[]; professionals: Professional[] }> {
  let createdServices = services;
  if (services.length === 0) {
    createdServices = [];
    for (const s of SERVICE_SEED) {
      createdServices.push(
        await repos.services.create(
          {
            id: hexId(),
            tenantId: tenant.tenantId,
            name: s.name,
            description: s.description,
            price: s.price,
            currency: tenant.currency,
            durationMinutes: s.durationMinutes,
            active: true,
            version: 1,
          },
          ACTOR,
        ),
      );
    }
  }

  let createdProfessionals = professionals;
  if (professionals.length === 0) {
    createdProfessionals = [];
    for (const p of PROFESSIONAL_SEED) {
      createdProfessionals.push(
        await repos.professionals.create(
          {
            id: hexId(),
            tenantId: tenant.tenantId,
            name: p.name,
            title: p.title,
            serviceIds: p.serviceIndexes.map((i) => createdServices[i]!.id),
            active: true,
            version: 1,
            schedule: WEEK_SCHEDULE,
          },
          ACTOR,
        ),
      );
    }
  }
  return { services: createdServices, professionals: createdProfessionals };
}

async function seedSampleAppointments(
  repos: ReturnType<typeof createRepos>,
  tenant: Tenant,
  services: Service[],
  professionals: Professional[],
  plan: Plan,
): Promise<void> {
  const existingCount = await repos.appointments.countByTenant(tenant.tenantId);
  if (existingCount > 0) return;

  const sample: Array<{
    dayOffset: number;
    hour: number;
    durationIdx: number;
    professionalIdx: number;
    status: Appointment['status'];
    paymentStatus: Appointment['paymentStatus'];
    client: { name: string; phone: string };
  }> = [
    { dayOffset: -6, hour: 9, durationIdx: 0, professionalIdx: 0, status: 'completed', paymentStatus: 'approved', client: { name: 'Daniel Espinosa', phone: '+57 310 111 2233' } },
    { dayOffset: -5, hour: 11, durationIdx: 1, professionalIdx: 1, status: 'completed', paymentStatus: 'approved', client: { name: 'Carolina Ríos', phone: '+57 311 222 3344' } },
    { dayOffset: -4, hour: 10, durationIdx: 2, professionalIdx: 0, status: 'no_show', paymentStatus: 'approved', client: { name: 'Felipe Vargas', phone: '+57 312 333 4455' } },
    { dayOffset: -3, hour: 13, durationIdx: 0, professionalIdx: 2, status: 'completed', paymentStatus: 'approved', client: { name: 'Mariana Duarte', phone: '+57 313 444 5566' } },
    { dayOffset: -1, hour: 11, durationIdx: 1, professionalIdx: 0, status: 'completed', paymentStatus: 'approved', client: { name: 'Laura Gómez', phone: '+57 315 666 7788' } },
    { dayOffset: 0, hour: 9, durationIdx: 0, professionalIdx: 2, status: 'confirmed', paymentStatus: 'approved', client: { name: 'Andrés Silva', phone: '+57 316 777 8899' } },
    { dayOffset: 0, hour: 11, durationIdx: 1, professionalIdx: 0, status: 'confirmed', paymentStatus: 'approved', client: { name: 'Valentina Mora', phone: '+57 317 888 9900' } },
    { dayOffset: 1, hour: 10, durationIdx: 2, professionalIdx: 1, status: 'pending_payment', paymentStatus: 'pending', client: { name: 'Camilo Restrepo', phone: '+57 318 999 0011' } },
    { dayOffset: 2, hour: 9, durationIdx: 0, professionalIdx: 2, status: 'confirmed', paymentStatus: 'approved', client: { name: 'Sara López', phone: '+57 319 000 1122' } },
    { dayOffset: 3, hour: 13, durationIdx: 0, professionalIdx: 1, status: 'confirmed', paymentStatus: 'approved', client: { name: 'Isabella Cruz', phone: '+57 321 222 3344' } },
  ];

  for (const s of sample) {
    const service = services[s.durationIdx]!;
    const professional = professionals[s.professionalIdx]!;
    const startIso = bogotaIso(s.dayOffset, s.hour);
    const endIso = new Date(new Date(startIso).getTime() + service.durationMinutes * 60_000).toISOString();
    const clientId = hexId();
    const appointment: Appointment = {
      id: hexId(),
      tenantId: tenant.tenantId,
      professionalId: professional.id,
      serviceId: service.id,
      serviceSnapshot: {
        serviceId: service.id,
        name: service.name,
        price: service.price,
        currency: service.currency,
        durationMinutes: service.durationMinutes,
      },
      commissionRateSnapshot: plan.commissionRate,
      planIdSnapshot: plan.code,
      idempotencyKey: `seed-${s.dayOffset}-${s.hour}-${clientId}`,
      source: 'web',
      paymentReference: `seed-ref-${clientId}`,
      clientInfo: {
        clientId,
        name: s.client.name,
        phone: s.client.phone,
        habeasDataAcceptedAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
      },
      startTime: startIso,
      endTime: endIso,
      status: s.paymentStatus === 'pending' ? 'pending_payment' : s.status === 'no_show' ? 'no_show' : s.status,
      paymentStatus: s.paymentStatus,
      needsReassignment: false,
      version: 1,
    };

    const created = await repos.appointments.create(appointment, ACTOR);

    const advance = Math.round((service.price * tenant.settings.advancePaymentPercentage) / 100 * 100) / 100;
    if (s.paymentStatus === 'approved') {
      const txId = hexId();
      const transaction: PaymentTransaction = {
        id: txId,
        tenantId: tenant.tenantId,
        appointmentId: created.id,
        provider: 'mock',
        operation: 'charge',
        internalReference: created.paymentReference ?? `seed-${clientId}`,
        amount: advance,
        currency: service.currency,
        status: 'approved',
        providerTransactionId: `mock-charge-${clientId}`,
        providerEventId: `mock-event-${clientId}`,
        version: 1,
      };
      await repos.paymentTransactions.create(transaction, ACTOR);
      await repos.appointments.updateStatus(
        tenant.tenantId,
        created.id,
        1,
        { status: s.status === 'no_show' ? 'no_show' : s.status, paymentStatus: 'approved', latestPaymentTransactionId: txId },
        ACTOR,
      );

      const gross = advance;
      const commission = Math.round(gross * plan.commissionRate * 100) / 100;
      const credit = Math.round((gross - commission) * 100) / 100;
      const ledger: LedgerEntry = {
        id: hexId(),
        tenantId: tenant.tenantId,
        transactionId: txId,
        appointmentId: created.id,
        type: 'payment_approved',
        account: 'tenant_balance',
        direction: 'credit',
        amount: credit,
        currency: service.currency,
        commissionRateSnapshot: plan.commissionRate,
        status: 'posted',
        timestamp: startIso,
      };
      await repos.ledger.create(ledger);

      await insertOccupiedSlots(repos, tenant.tenantId, professional.id, startIso, endIso, created.id);
    }
  }
}

async function insertOccupiedSlots(
  repos: ReturnType<typeof createRepos>,
  tenantId: string,
  professionalId: string,
  startIso: string,
  endIso: string,
  appointmentId: string,
): Promise<void> {
  const granularity = 30 * 60_000;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = new Date().toISOString();
  for (let t = start; t < end; t += granularity) {
    await repos.timeSlots.insertSlotIfFree({
      id: hexId(),
      tenantId,
      professionalId,
      slotStart: new Date(t).toISOString(),
      occupationType: 'appointment',
      appointmentId,
      createdAt: now,
    });
  }
}

async function linkOwner(
  repos: ReturnType<typeof createRepos>,
  tenantId: string,
  keycloakUserId: string,
  role: 'owner' | 'professional',
): Promise<void> {
  await repos.tenantUsers.createOrUpdate({
    keycloakUserId,
    tenantId,
    role,
    status: 'active',
    syncedAt: new Date().toISOString(),
  });
}

export async function seed(): Promise<void> {
  const { client, db } = await connectMongo(env.mongodbUri);
  try {
    await ensureExtraIndexes(db);
    const repos = createRepos(db);

    const basicoPlan = await upsertPlan(repos, {
      name: 'Básico',
      code: 'basico',
      commissionRate: 0.08,
      fixedFee: 0,
    });
    const proPlan = await upsertPlan(repos, {
      name: 'Pro',
      code: 'pro',
      commissionRate: 0.05,
      fixedFee: 0,
    });

    let barber = await repos.tenants.findBySlug('barber-estilo');
    if (!barber) {
      barber = await repos.tenants.create(barberTenant(proPlan), ACTOR);
    }
    const barberServices = await repos.services.findByTenant(barber.tenantId, true);
    const barberProfessionals = await repos.professionals.findByTenant(barber.tenantId, true);
    const { services, professionals } = await seedBarber(
      repos,
      barber,
      proPlan,
      barberServices,
      barberProfessionals,
    );
    await seedSampleAppointments(repos, barber, services, professionals, proPlan);

    const clinica = await repos.tenants.findBySlug('clinica-vida');
    if (!clinica) {
      await repos.tenants.create(clinicaTenant(basicoPlan), ACTOR);
    }

    if (env.seedOwnerKeycloakId) {
      await linkOwner(repos, barber.tenantId, env.seedOwnerKeycloakId, 'owner');
    }
    if (env.seedProfessionalKeycloakId) {
      const carlos = professionals.find((p) => p.name === 'Carlos Mendoza');
      if (carlos) {
        await repos.professionals.update({ ...carlos, keycloakUserId: env.seedProfessionalKeycloakId }, carlos.version, ACTOR);
        await linkOwner(repos, barber.tenantId, env.seedProfessionalKeycloakId, 'professional');
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[seed] OK. tenant=barber-estilo plans=basico,pro appointments=${await repos.appointments.countByTenant(barber.tenantId)}`);

    const r = reference('seed');
    // eslint-disable-next-line no-console
    console.log(`[seed] done (reference check: ${r.length > 0 ? 'ok' : 'nok'})`);
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  seed().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed', err);
    process.exit(1);
  });
}