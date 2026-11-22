import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { rolesRouter } from '../../src/entrypoints/http/routes/roles.routes';
import { errorHandler } from '../../src/entrypoints/http/middleware/errors';
import { OnboardingUseCases } from '../../src/application/usecases/onboarding/onboarding.usecases';
import { CatalogUseCases } from '../../src/application/usecases/catalog/catalog.usecases';
import { buildSlots } from '../../src/domain/rules/availability-rules';
import { NotFoundError } from '../../src/shared/errors';
import { AppServices } from '../../src/application/container';
import { KeycloakVerifier } from '../../src/infrastructure/auth/keycloak';
import { Professional, Service, Tenant } from '../../src/domain/entities';
import * as onboardingRoutes from '../../src/entrypoints/http/routes/onboarding.routes';
import * as adminRoutes from '../../src/entrypoints/http/routes/admin.routes';
import * as rolesRoutes from '../../src/entrypoints/http/routes/roles.routes';
import * as onboardingModule from '../../src/application/usecases/onboarding/onboarding.usecases';

// Esquemas/función exportados por el código de producción bajo reparación.
const onboardingSchema = (onboardingRoutes as any).onboardingSchema as { safeParse(v: unknown): { success: boolean } };
const createTenantSchema = (adminRoutes as any).createTenantSchema as { safeParse(v: unknown): { success: boolean } };
const versionedPatch = (rolesRoutes as any).versionedPatch as { safeParse(v: unknown): { success: boolean } };
const tempPassword = (onboardingModule as any).tempPassword as () => string;

const ACTOR = { keycloakUserId: 'kc-owner' };
const BASE = { slug: 'salon-test', name: 'Salón Test', currency: 'COP' as const };

function makeService(id: string, tenantId: string): Service {
  return {
    id,
    tenantId,
    name: 'Corte',
    price: 100,
    currency: 'COP',
    durationMinutes: 30,
    active: true,
    version: 1,
  };
}

function makeProfessional(id: string, tenantId: string, serviceIds: string[]): Professional {
  return { id, tenantId, name: 'Pro', serviceIds, active: true, version: 1 };
}

function makeOnboardingDeps(services: Service[] = []) {
  const createdTenants: Tenant[] = [];
  const createdProfessionals: Professional[] = [];
  const deps = {
    tenants: {
      findBySlug: vi.fn(async () => undefined),
      create: vi.fn(async (t: Tenant) => {
        createdTenants.push(t);
        return t;
      }),
    },
    plans: { findByCode: vi.fn(async () => ({ id: 'p', name: 'B', code: 'basico', commissionRate: 0.05, fixedFee: 0, active: true })) },
    services: {
      findById: vi.fn(async (tenantId: string, id: string) => services.find((s) => s.tenantId === tenantId && s.id === id) ?? null),
      findByTenant: vi.fn(async () => []),
    },
    professionals: {
      findByKeycloakUserId: vi.fn(async () => null),
      findByTenant: vi.fn(async () => []),
      create: vi.fn(async (p: Professional) => {
        createdProfessionals.push(p);
        return p;
      }),
    },
    tenantUsers: { createOrUpdate: vi.fn(async () => {}) },
    identity: {
      provider: 'noop',
      ensureRealmRole: vi.fn(async () => {}),
      createUser: vi.fn(async () => ({ sub: 'kc-new' })),
      findByEmail: vi.fn(async (email: string) => ({ sub: 'kc-existing', email })),
    },
  };
  return { deps: deps as unknown as ConstructorParameters<typeof OnboardingUseCases>[0]['deps'], createdTenants, createdProfessionals };
}

describe('fixes de seguridad — onboarding, roles, disponibilidad', () => {
  it('RY-ONBOARD-UNBOUNDED-SETTINGS: esquemas acotados, usecase clampea y buildSlots termina con granularity 0', async () => {
    expect(onboardingSchema.safeParse({ ...BASE, settings: { slotGranularityMinutes: 0 } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...BASE, settings: { slotGranularityMinutes: 99999 } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...BASE, settings: { cancellationToleranceHours: 721 } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...BASE, settings: { paymentTimeoutMinutes: 0 } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...BASE, settings: { upfrontPercent: 101 } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...BASE, settings: { reminderHours: 721 } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...BASE, settings: { slotGranularityMinutes: 30, cancellationToleranceHours: 24, paymentTimeoutMinutes: 15, upfrontPercent: 30, reminderHours: 24 } }).success).toBe(true);
    expect(createTenantSchema.safeParse({ ...BASE, tenantId: 'tenant-test', planCode: 'basico', settings: { slotGranularityMinutes: 0 } }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...BASE, tenantId: 'tenant-test', planCode: 'basico', settings: { slotGranularityMinutes: 30 } }).success).toBe(true);

    const { deps, createdTenants } = makeOnboardingDeps();
    await new OnboardingUseCases(deps).onboardTenant({
      ...BASE,
      actor: ACTOR,
      settings: {
        slotGranularityMinutes: 0,
        cancellationToleranceHours: 9999,
        paymentTimeoutMinutes: -5,
        advancePaymentPercentage: 500,
        reminderHours: 9999,
        isAdmin: true,
      } as unknown as Partial<Tenant['settings']>,
    });
    const settings = createdTenants[0]!.settings as unknown as Record<string, unknown>;
    expect(settings.slotGranularityMinutes).toBe(1);
    expect(settings.cancellationToleranceHours).toBe(720);
    expect(settings.paymentTimeoutMinutes).toBe(1);
    expect(settings.advancePaymentPercentage).toBe(100);
    expect(settings.reminderHours).toBe(720);
    expect(settings.isAdmin).toBeUndefined();

    const slots = buildSlots({
      shiftIntervals: [{ start: 0, end: 60 * 60_000 }],
      granularityMinutes: 0,
      occupied: [],
      blocked: [],
      now: 0,
    });
    expect(slots).toHaveLength(60);
  });

  it('RY-INVITE-SERVICEIDS: inviteProfessional rechaza serviceIds ajenos al tenant', async () => {
    const { deps, createdProfessionals } = makeOnboardingDeps([makeService('svc-own', 'tenant-a')]);
    const uc = new OnboardingUseCases(deps);
    await expect(
      uc.inviteProfessional({
        actor: ACTOR,
        tenantId: 'tenant-a',
        professional: { name: 'Ana', email: 'ana@example.com', serviceIds: ['svc-foreign'] },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(createdProfessionals).toHaveLength(0);

    const ok = makeOnboardingDeps([makeService('svc-own', 'tenant-a')]);
    await expect(
      new OnboardingUseCases(ok.deps).inviteProfessional({
        actor: ACTOR,
        tenantId: 'tenant-a',
        professional: { name: 'Ana', email: 'ana@example.com', serviceIds: ['svc-own'] },
      }),
    ).resolves.toMatchObject({ linkedExistingAccount: true });
    expect(ok.createdProfessionals).toHaveLength(1);
  });

  it('RY-PATCH-UNVALIDATED-VALUES: versionedPatch valida tipos y catalog revalida serviceIds', async () => {
    expect(versionedPatch.safeParse({ version: 1, patch: { price: 'abc' } }).success).toBe(false);
    expect(versionedPatch.safeParse({ version: 1, patch: { durationMinutes: -1 } }).success).toBe(false);
    expect(versionedPatch.safeParse({ version: 1, patch: { isAdmin: true } }).success).toBe(false);
    expect(versionedPatch.safeParse({ version: 1, patch: { name: 'Corte', price: 100, durationMinutes: 30, serviceIds: ['svc-own'], currency: 'COP' } }).success).toBe(true);

    const professional = makeProfessional('prof-1', 'tenant-a', ['svc-own']);
    const updated = vi.fn(async (p: Professional) => p);
    const catalog = new CatalogUseCases({
      services: {
        findById: vi.fn(async (tenantId: string, id: string) =>
          id === 'svc-own' && tenantId === 'tenant-a' ? makeService(id, tenantId) : null),
      },
      professionals: { findById: vi.fn(async () => professional), update: updated },
      audit: { record: vi.fn(async () => {}) },
    } as unknown as ConstructorParameters<typeof CatalogUseCases>[0]['repos']);

    await expect(
      catalog.updateProfessional({
        tenantId: 'tenant-a', id: 'prof-1', actor: 'kc-owner', expectedVersion: 1,
        patch: { serviceIds: ['svc-foreign'] },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(updated).not.toHaveBeenCalled();
    await expect(
      catalog.updateProfessional({
        tenantId: 'tenant-a', id: 'prof-1', actor: 'kc-owner', expectedVersion: 1,
        patch: { serviceIds: ['svc-own'] },
      }),
    ).resolves.toMatchObject({ id: 'prof-1' });
  });

  it('RY-PROF-IDOR: agenda y bloques rechazan professionalId ajeno con 403', async () => {
    const professionalAgenda = vi.fn(async () => ({ professionalId: 'prof-me', appointments: [], blocks: [] }));
    const createAvailabilityBlock = vi.fn(async () => ({ id: 'block-1' }));
    const services = {
      tenants: { assertTenantMembership: vi.fn(async () => {}) },
      catalog: { findProfessionalByKeycloakUserId: vi.fn(async (_t: string, kc: string) => kc === 'kc-me' ? { id: 'prof-me' } : null) },
      dashboard: { professionalAgenda },
      booking: { createAvailabilityBlock },
    } as unknown as AppServices;
    const verifier = { verify: async () => ({ sub: 'kc-me', roles: [], raw: {} }) } as unknown as KeycloakVerifier;
    const app = express();
    app.use(express.json());
    app.use('/api', rolesRouter(services, verifier));
    app.use(errorHandler);

    const auth = { Authorization: 'Bearer TOKEN', 'x-tenant-id': 'tenant-a' };
    const agenda = await request(app)
      .get('/api/professional/tenant-a/agenda?from=2026-11-17&to=2026-11-18&professionalId=prof-otro')
      .set(auth);
    expect(agenda.status).toBe(403);
    expect(professionalAgenda).not.toHaveBeenCalled();

    const block = await request(app)
      .post('/api/professional/tenant-a/availability/blocks')
      .set(auth)
      .send({ professionalId: 'prof-otro', startTime: '2026-11-17T09:00:00Z', endTime: '2026-11-17T10:00:00Z' });
    expect(block.status).toBe(403);
    expect(createAvailabilityBlock).not.toHaveBeenCalled();

    const own = await request(app)
      .get('/api/professional/tenant-a/agenda?from=2026-11-17&to=2026-11-18')
      .set(auth);
    expect(own.status).toBe(200);
    expect(professionalAgenda).toHaveBeenCalledWith(expect.objectContaining({ professionalId: 'prof-me' }));
  });

  it('RY-TEMP-PASSWORD-MATHRANDOM: tempPassword es aleatoria y no depende de Date.now/Math.random', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    let a = '';
    let b = '';
    try {
      a = tempPassword();
      b = tempPassword();
    } finally {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    }
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(/[a-z]/.test(a) && /[A-Z]/.test(a) && /\d/.test(a) && /[^A-Za-z0-9]/.test(a)).toBe(true);
    expect(a).not.toContain((1_700_000_000_000).toString(36));
  });
});
