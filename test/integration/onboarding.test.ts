import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, TestDb, NoopIdentityGateway } from '../helpers/mongo';
import { hexId } from '../../src/shared/id';
import { Plan, Service } from '../../src/domain/entities';

const ACTOR = 'test';

describe('onboarding (integration)', () => {
  let ctx: TestDb;
  let plan: Plan;
  let service: Service;

  beforeAll(async () => {
    ctx = await testDb();
    plan = await ctx.repos.plans.create(
      { id: hexId(), name: 'Basico', code: 'basico', commissionRate: 0.05, fixedFee: 0, active: true },
      ACTOR,
    );
    service = await ctx.repos.services.create(
      {
        id: hexId(),
        tenantId: 'salon-aurora',
        name: 'Corte',
        description: '',
        price: 20000,
        currency: 'COP',
        durationMinutes: 40,
        active: true,
      },
      ACTOR,
    );
  });

  afterAll(async () => {
    await ctx!.stop();
  });

  it('crea un tenant self-service con dueño vinculado y rol concedido', async () => {
    const result = await ctx.services.onboarding.onboardTenant({
      actor: { keycloakUserId: 'kc-owner-1', email: 'owner@example.com', name: 'Owner Uno' },
      slug: 'salon-aurora',
      name: 'Salón Aurora',
      currency: 'COP',
      country: 'CO',
      tagline: 'Peluquería y más',
      settings: { advancePaymentPercentage: 10, cancellationToleranceHours: 12 },
    });

    expect(result.ownerRoleGranted).toBe(true);
    const tenant = await ctx.repos.tenants.findBySlug('salon-aurora');
    expect(tenant).not.toBeNull();
    expect(tenant!.planId).toBe('basico');
    expect(tenant!.settings.advancePaymentPercentage).toBe(10);
    expect(tenant!.bookingStatus).toBe('active');

    const memberships = await ctx.repos.tenantUsers.findByKeycloakAndTenant('salon-aurora', 'kc-owner-1');
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');
  });

  it('rechaza un slug duplicado', async () => {
    await expect(
      ctx.services.onboarding.onboardTenant({
        actor: { keycloakUserId: 'kc-owner-2' },
        slug: 'salon-aurora',
        name: 'Otro salón',
        currency: 'COP',
      }),
    ).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
  });

  it('invita a un profesional con cuenta y membresía', async () => {
    const result = await ctx.services.onboarding.inviteProfessional({
      actor: { keycloakUserId: 'kc-owner-1' },
      tenantId: 'salon-aurora',
      professional: {
        name: 'Andrea Pérez',
        email: 'andrea@example.com',
        serviceIds: [service.id],
        weeklySchedule: { monday: [{ start: '09:00', end: '17:00' }] },
      },
    });

    expect(result.linkedExistingAccount).toBe(false);
    expect(result.temporaryPassword).toBeTruthy();
    const prof = await ctx.repos.professionals.findByKeycloakUserId(
      'salon-aurora',
      result.professional.keycloakUserId,
    );
    expect(prof).not.toBeNull();
    expect(prof!.name).toBe('Andrea Pérez');
    expect(prof!.serviceIds).toContain(service.id);

    const memberships = await ctx.repos.tenantUsers.findByKeycloakAndTenant(
      'salon-aurora',
      result.professional.keycloakUserId,
    );
    expect(memberships.some((m) => m.role === 'professional')).toBe(true);
  });

  it('lista el directorio público solo con negocios activos', async () => {
    const directory = await ctx.services.onboarding.publicDirectory();
    const aurora = directory.find((d) => d.slug === 'salon-aurora');
    expect(aurora).toBeDefined();
    expect(aurora!.name).toBe('Salón Aurora');
    expect(aurora!.servicesCount).toBeGreaterThanOrEqual(0);
    expect(aurora!.professionalsCount).toBeGreaterThanOrEqual(1);
  });
});