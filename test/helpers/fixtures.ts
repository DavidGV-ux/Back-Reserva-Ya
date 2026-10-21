import { Plan, Professional, Service, Tenant } from '../../src/domain/entities';
import { WeeklySchedule } from '../../src/domain/entities/catalog';
import { hexId } from '../../src/shared/id';
import { localDateParts } from '../../src/shared/timezone';

export const ACTOR = 'test';

export const FULL_WEEK: WeeklySchedule = {
  monday: [{ start: '09:00', end: '18:00' }],
  tuesday: [{ start: '09:00', end: '18:00' }],
  wednesday: [{ start: '09:00', end: '18:00' }],
  thursday: [{ start: '09:00', end: '18:00' }],
  friday: [{ start: '09:00', end: '18:00' }],
  saturday: [{ start: '09:00', end: '13:00' }],
  sunday: [],
};

export function nextMondayBogota(date: Date): Date {
  const parts = localDateParts('America/Bogota', date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysUntilMonday = (8 - weekday) % 7 || 7;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysUntilMonday));
}

export function bogotaIso(date: Date, hour: number): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour + 5)).toISOString();
}

export function localDateStamp(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export interface SeededShop {
  plan: Plan;
  tenant: Tenant;
  service: Service;
  professional: Professional;
}

export async function seedShop(repos: {
  plans: { create(plan: Plan, actor: string): Promise<Plan> };
  tenants: { create(tenant: Tenant, actor: string): Promise<Tenant> };
  services: { create(service: Service, actor: string): Promise<Service> };
  professionals: { create(professional: Professional, actor: string): Promise<Professional> };
}): Promise<SeededShop> {
  const plan = await repos.plans.create({ id: hexId(), name: 'Pro', code: 'pro', commissionRate: 0.05, fixedFee: 0, active: true }, ACTOR);
  const tenant = await repos.tenants.create(
    {
      id: hexId(),
      tenantId: `t_${hexId().slice(0, 8)}`,
      slug: `barber-${hexId().slice(0, 6)}`,
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
  const service = await repos.services.create(
    { id: hexId(), tenantId: tenant.tenantId, name: 'Corte', description: '', price: 40000, currency: 'COP', durationMinutes: 30, active: true, version: 1 },
    ACTOR,
  );
  const professional = await repos.professionals.create(
    { id: hexId(), tenantId: tenant.tenantId, name: 'Juan', title: 'Barbero', serviceIds: [service.id], active: true, version: 1, schedule: FULL_WEEK },
    ACTOR,
  );
  return { plan, tenant, service, professional };
}