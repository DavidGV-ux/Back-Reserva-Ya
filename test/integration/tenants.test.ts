import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, TestDb } from '../helpers/mongo';
import { hexId } from '../../src/shared/id';
import { Plan, Tenant } from '../../src/domain/entities';

const ACTOR = 'test';

describe('myTenants + ensureClientMembership (integration)', () => {
  let ctx: TestDb;
  let plan: Plan;
  let tenant: Tenant;

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
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  it('returns an empty membership list for a user without tenants', async () => {
    const rows = await ctx.services.tenants.myTenants({ keycloakUserId: 'kc-unknown-user' });
    expect(rows).toEqual([]);
  });

  it('ensures a client membership and exposes it through myTenants', async () => {
    const kc = 'kc-client-1';
    await ctx.services.tenants.ensureClientMembership(tenant.tenantId, kc);

    const rows = await ctx.services.tenants.myTenants({ keycloakUserId: kc });
    expect(rows).toEqual([
      { tenantId: tenant.tenantId, slug: 'barber-estilo', name: 'Barber Estilo', role: 'client' },
    ]);
  });

  it('is idempotent when the membership already exists', async () => {
    const kc = 'kc-client-2';
    await ctx.services.tenants.ensureClientMembership(tenant.tenantId, kc);
    await ctx.services.tenants.ensureClientMembership(tenant.tenantId, kc);
    const rows = await ctx.services.tenants.myTenants({ keycloakUserId: kc });
    expect(rows).toHaveLength(1);
  });
});