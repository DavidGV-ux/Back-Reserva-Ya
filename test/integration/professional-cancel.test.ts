import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { TestDb, testDb } from '../helpers/mongo';
import { ACTOR, bogotaIso, FULL_WEEK, nextMondayBogota, seedShop, SeededShop } from '../helpers/fixtures';
import { rolesRouter } from '../../src/entrypoints/http/routes/roles.routes';
import { errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import { KeycloakVerifier, Principal } from '../../src/infrastructure/auth/keycloak';
import { hexId } from '../../src/shared/id';
import { Professional } from '../../src/domain/entities';

const PRO_A_KC = 'kc-pro-a-cancel';
const PRO_B_KC = 'kc-pro-b-cancel';
const CLIENT_KC = 'kc-client-cancel';

function makeVerifier(): KeycloakVerifier {
  return {
    verify: async (token: string): Promise<Principal> => ({
      sub: { TOKEN_PRO_A: PRO_A_KC, TOKEN_PRO_B: PRO_B_KC, TOKEN_CLIENT: CLIENT_KC }[token] ?? token,
      roles: [],
      raw: {},
    }),
  } as unknown as KeycloakVerifier;
}

describe('POST /professional/:tenantId/appointments/:id/cancel (integration)', () => {
  let ctx: TestDb;
  let shop: SeededShop;
  let proA: Professional;
  let app: express.Express;
  const monday = nextMondayBogota(new Date(Date.now() + 7 * 86_400_000));

  const book = async (professionalId: string, hour: number) => {
    const result = await ctx.services.booking.createAppointment({
      tenantId: shop.tenant.tenantId,
      serviceId: shop.service.id,
      professionalId,
      startTime: bogotaIso(monday, hour),
      clientInfo: { name: 'Cliente Test', phone: '+57 300 111 2233', habeasDataConsent: true },
      idempotencyKey: `key-${hexId()}`,
      actor: 'web-test',
    });
    return result.appointment;
  };

  const cancel = (appointmentId: string, token: string) =>
    request(app)
      .post(`/api/professional/${shop.tenant.tenantId}/appointments/${appointmentId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', shop.tenant.tenantId)
      .send({ reason: 'Incapacidad médica' });

  beforeAll(async () => {
    ctx = await testDb();
    shop = await seedShop(ctx.repos);
    const t = shop.tenant.tenantId;
    proA = await ctx.repos.professionals.create(
      { id: hexId(), tenantId: t, name: 'Ana', serviceIds: [shop.service.id], active: true, version: 1, schedule: FULL_WEEK, keycloakUserId: PRO_A_KC },
      ACTOR,
    );
    await ctx.repos.professionals.create(
      { id: hexId(), tenantId: t, name: 'Beto', serviceIds: [shop.service.id], active: true, version: 1, schedule: FULL_WEEK, keycloakUserId: PRO_B_KC },
      ACTOR,
    );
    for (const [kc, role] of [[PRO_A_KC, 'professional'], [PRO_B_KC, 'professional'], [CLIENT_KC, 'client']] as const) {
      await ctx.repos.tenantUsers.createOrUpdate({
        tenantId: t,
        keycloakUserId: kc,
        role,
        status: 'active',
        syncedAt: new Date().toISOString(),
      });
    }

    app = express();
    app.use(express.json());
    app.use('/api', rolesRouter(ctx.services, makeVerifier()));
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  it('el profesional cancela su propia cita con la política de cancelación del negocio', async () => {
    const appt = await book(proA.id, 9);
    const res = await cancel(appt.id, 'TOKEN_PRO_A');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancellation).toMatchObject({
      requestedBy: 'professional',
      policyApplied: 'tenant_cancelled',
      reason: 'Incapacidad médica',
    });
  });

  it('libera el horario: se puede volver a reservar el mismo slot', async () => {
    const appt = await book(proA.id, 10);
    expect((await cancel(appt.id, 'TOKEN_PRO_A')).status).toBe(200);
    const again = await book(proA.id, 10);
    expect(again.status).toBe('pending_payment');
  });

  it('no puede cancelar la cita de otro profesional (403) y la cita no cambia', async () => {
    const appt = await book(proA.id, 11);
    const res = await cancel(appt.id, 'TOKEN_PRO_B');
    expect(res.status).toBe(403);
    const stored = await ctx.repos.appointments.findById(shop.tenant.tenantId, appt.id);
    expect(stored?.status).toBe('pending_payment');
  });

  it('un cliente del negocio no puede usar la ruta del profesional (403)', async () => {
    const appt = await book(proA.id, 12);
    expect((await cancel(appt.id, 'TOKEN_CLIENT')).status).toBe(403);
  });

  it('no permite cancelar dos veces (409)', async () => {
    const appt = await book(proA.id, 14);
    expect((await cancel(appt.id, 'TOKEN_PRO_A')).status).toBe(200);
    expect((await cancel(appt.id, 'TOKEN_PRO_A')).status).toBe(409);
  });

  it('cita inexistente (404)', async () => {
    expect((await cancel(hexId(), 'TOKEN_PRO_A')).status).toBe(404);
  });
});
