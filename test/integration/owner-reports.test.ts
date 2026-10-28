import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { TestDb, testDb } from '../helpers/mongo';
import { rolesRouter } from '../../src/entrypoints/http/routes/roles.routes';
import { errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import { KeycloakVerifier, Principal } from '../../src/infrastructure/auth/keycloak';
import { hexId } from '../../src/shared/id';
import { LedgerEntry, Tenant } from '../../src/domain/entities';
import { ACTOR } from '../helpers/fixtures';

const OWNER_KC = 'kc-owner-reports';
const CLIENT_KC = 'kc-client-reports';

function makeVerifier(): KeycloakVerifier {
  return {
    verify: async (token: string): Promise<Principal> => ({
      sub: { TOKEN_OWNER: OWNER_KC, TOKEN_CLIENT: CLIENT_KC }[token] ?? token,
      roles: [],
      raw: {},
    }),
  } as unknown as KeycloakVerifier;
}

function ledger(tenantId: string, overrides: Partial<LedgerEntry>): LedgerEntry {
  const id = hexId();
  return {
    id: '',
    tenantId,
    transactionId: `led-${id}`,
    idempotencyKey: `idem-${id}`,
    type: 'payment_approved',
    account: 'tenant_balance',
    direction: 'credit',
    amount: 0,
    currency: 'COP',
    status: 'posted',
    timestamp: '2026-10-10T15:00:00.000Z',
    ...overrides,
  };
}

describe('GET /owner/:tenantId/reports (integration)', () => {
  let ctx: TestDb;
  let tenant: Tenant;
  let app: express.Express;

  const get = (query: string, token = 'TOKEN_OWNER') =>
    request(app)
      .get(`/api/owner/${tenant.tenantId}/reports${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenant.tenantId);

  beforeAll(async () => {
    ctx = await testDb();
    const plan = await ctx.repos.plans.create(
      { id: hexId(), name: 'Pro', code: `pro-${hexId().slice(0, 6)}`, commissionRate: 0.05, fixedFee: 0, active: true },
      ACTOR,
    );
    tenant = await ctx.repos.tenants.create(
      {
        id: hexId(),
        tenantId: `t_reports_${hexId().slice(0, 6)}`,
        slug: `reports-${hexId().slice(0, 6)}`,
        planId: plan.code,
        name: 'Reportes Test',
        tagline: '',
        description: '',
        timezone: 'America/Bogota',
        currency: 'COP',
        country: 'CO',
        settings: {
          defaultLanguage: 'es',
          activeLanguages: ['es'],
          slotGranularityMinutes: 30,
          cancellationToleranceHours: 24,
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
    for (const [kc, role] of [[OWNER_KC, 'owner'], [CLIENT_KC, 'client']] as const) {
      await ctx.repos.tenantUsers.createOrUpdate({
        tenantId: tenant.tenantId,
        keycloakUserId: kc,
        role,
        status: 'active',
        syncedAt: new Date().toISOString(),
      });
    }

    const t = tenant.tenantId;
    await ctx.repos.ledger.create(ledger(t, { amount: 28_500 }));
    await ctx.repos.ledger.create(
      ledger(t, { type: 'platform_commission', account: 'platform_revenue', amount: 1_500 }),
    );
    await ctx.repos.ledger.create(
      ledger(t, {
        type: 'refund',
        account: 'customer_refund_liability',
        direction: 'debit',
        amount: 10_000,
        timestamp: '2026-10-11T14:00:00.000Z',
      }),
    );
    // Fuera del rango (13-oct en Bogotá): no debe contar.
    await ctx.repos.ledger.create(ledger(t, { amount: 99_999, timestamp: '2026-10-13T15:00:00.000Z' }));
    // De otro negocio: no debe filtrarse.
    await ctx.repos.ledger.create(ledger('t_otro_negocio', { amount: 77_777 }));

    app = express();
    app.use(express.json());
    app.use('/api', rolesRouter(ctx.services, makeVerifier()));
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  it('devuelve el reporte del rango con todos los movimientos', async () => {
    const res = await get('?from=2026-10-10&to=2026-10-12');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from: '2026-10-10',
      to: '2026-10-12',
      currency: 'COP',
      income: 28_500,
      commission: 1_500,
      refunds: 10_000,
      net: 18_500,
      paymentsCount: 1,
      partial: false,
    });
    expect(res.body.daily).toHaveLength(3);
    expect(res.body.movements).toHaveLength(3);
  });

  it('incluye el último día completo del rango', async () => {
    const res = await get('?from=2026-10-13&to=2026-10-13');
    expect(res.status).toBe(200);
    expect(res.body.income).toBe(99_999);
  });

  it('rechaza a un cliente del negocio (403)', async () => {
    const res = await get('?from=2026-10-10&to=2026-10-12', 'TOKEN_CLIENT');
    expect(res.status).toBe(403);
  });

  // ValidationError se traduce a 422 en el errorHandler del proyecto.
  it('valida las fechas (422)', async () => {
    expect((await get('')).status).toBe(422);
    expect((await get('?from=2026-10-12&to=2026-10-10')).status).toBe(422);
    expect((await get('?from=2026-13-01&to=2026-12-01')).status).toBe(422);
    expect((await get('?from=10/10/2026&to=2026-10-12')).status).toBe(422);
    expect((await get('?from=2025-01-01&to=2026-10-12')).status).toBe(422);
  });
});
