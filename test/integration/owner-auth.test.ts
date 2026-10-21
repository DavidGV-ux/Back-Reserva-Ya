import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { TestDb, testDb } from '../helpers/mongo';
import { rolesRouter } from '../../src/entrypoints/http/routes/roles.routes';
import { errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import { KeycloakVerifier, Principal } from '../../src/infrastructure/auth/keycloak';
import { hexId } from '../../src/shared/id';
import { Plan, Tenant } from '../../src/domain/entities';

const ACTOR = 'test';
const OWNER_KC = 'kc-owner-http';
const PROF_KC = 'kc-professional-http';

function makeVerifier(): KeycloakVerifier {
  return {
    verify: async (token: string): Promise<Principal> => {
      const map: Record<string, string> = {
        TOKEN_OWNER: OWNER_KC,
        TOKEN_PROF: PROF_KC,
      };
      return {
        sub: map[token] ?? token,
        roles: [],
        raw: {},
      };
    },
  } as unknown as KeycloakVerifier;
}

async function createTenant(ctx: TestDb, tenantId: string, slug: string, name: string, plan: Plan): Promise<Tenant> {
  return ctx.repos.tenants.create(
    {
      id: hexId(),
      tenantId,
      slug,
      planId: plan.code,
      name,
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
}

describe('owner HTTP auth: path vs header, myTenants sort, single owner (integration)', () => {
  let ctx: TestDb;
  let plan: Plan;
  let t1: Tenant;
  let t2: Tenant;
  let app: express.Express;

  beforeAll(async () => {
    ctx = await testDb();
    plan = await ctx.repos.plans.create({ id: hexId(), name: 'Pro', code: 'pro', commissionRate: 0.05, fixedFee: 0, active: true }, ACTOR);
    t1 = await createTenant(ctx, 't_barber_estilo', 'barber-estilo', 'Barber Estilo', plan);
    t2 = await createTenant(ctx, 'cafe-beta-prod', 'cafe-beta-prod', 'Café Beta', plan);

    await ctx.repos.tenantUsers.createOrUpdate({
      tenantId: t1.tenantId,
      keycloakUserId: OWNER_KC,
      role: 'owner',
      status: 'active',
      syncedAt: new Date().toISOString(),
    });
    await ctx.repos.tenantUsers.createOrUpdate({
      tenantId: t2.tenantId,
      keycloakUserId: OWNER_KC,
      role: 'owner',
      status: 'active',
      syncedAt: new Date().toISOString(),
    });
    // El escenario de Laura: profesional de t1, pero NO owner de t1.
    await ctx.repos.tenantUsers.createOrUpdate({
      tenantId: t1.tenantId,
      keycloakUserId: PROF_KC,
      role: 'professional',
      status: 'active',
      syncedAt: new Date().toISOString(),
    });

    app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api', rolesRouter(ctx.services, makeVerifier()));
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  it('returns myTenants sorted (owners first, then by name)', async () => {
    const res = await request(app).get('/api/me/tenants').set('Authorization', 'Bearer TOKEN_OWNER');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { tenantId: t1.tenantId, slug: 'barber-estilo', name: 'Barber Estilo', role: 'owner' },
      { tenantId: t2.tenantId, slug: 'cafe-beta-prod', name: 'Café Beta', role: 'owner' },
    ]);
  });

  it('accepts owner access when header and path tenant match', async () => {
    const res = await request(app)
      .get(`/api/owner/${t2.tenantId}/overview`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', t2.tenantId);
    expect(res.status).toBe(200);
  });

  it('rejects a header/path tenant mismatch (403)', async () => {
    const res = await request(app)
      .get(`/api/owner/${t2.tenantId}/overview`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', t1.tenantId);
    expect(res.status).toBe(403);
  });

  it('rejects an owner endpoint for a user that is only professional there (Laura case)', async () => {
    const res = await request(app)
      .get(`/api/owner/${t1.tenantId}/overview`)
      .set('Authorization', 'Bearer TOKEN_PROF')
      .set('x-tenant-id', t1.tenantId);
    expect(res.status).toBe(403);
  });

  it('creates a service for the selected tenant (201)', async () => {
    const res = await request(app)
      .post(`/api/owner/${t2.tenantId}/services`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', t2.tenantId)
      .send({ name: 'Corte clásico', price: 15000, durationMinutes: 30, currency: 'COP' });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(t2.tenantId);
  });

  it('enforces a single owner per tenant (409 on second owner, allowed refresh for same owner)', async () => {
    const users = ctx.repos.tenantUsers;
    await expect(
      users.createOrUpdate({
        tenantId: t1.tenantId,
        keycloakUserId: PROF_KC,
        role: 'owner',
        status: 'active',
        syncedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'TENANT_ALREADY_HAS_OWNER' });

    await expect(
      users.createOrUpdate({
        tenantId: t1.tenantId,
        keycloakUserId: OWNER_KC,
        role: 'owner',
        status: 'active',
        syncedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});