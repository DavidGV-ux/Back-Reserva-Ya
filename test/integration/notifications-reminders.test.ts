import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { TestDb, testDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';
import { NotificationGateway } from '../../src/domain/ports/gateways';
import { NotificationsUseCases } from '../../src/application/usecases/notifications/notifications.usecases';
import { ResendNotificationGateway } from '../../src/infrastructure/integrations/notifications/resend-notifications';
import { rolesRouter } from '../../src/entrypoints/http/routes/roles.routes';
import { errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import { KeycloakVerifier, Principal } from '../../src/infrastructure/auth/keycloak';

class FailingWhatsappGateway implements NotificationGateway {
  readonly channel = 'whatsapp' as const;
  calls = 0;

  async send(): Promise<{ providerMessageId?: string }> {
    this.calls += 1;
    throw new Error('WhatsApp Cloud API timeout / 503 Service Unavailable');
  }
}

describe('notifications & reminders integration (B-01, B-02, B-03)', () => {
  let ctx: TestDb;
  let fixture: SeededShop;

  beforeAll(async () => {
    ctx = await testDb();
    fixture = await seedShop(ctx.repos);
  }, 60_000);

  afterAll(async () => {
    await ctx?.stop();
  });

  it('B-02: emite notificación de confirmación al aprobar el pago y de cancelación al cancelar la cita', async () => {
    const monday = nextMondayBogota(new Date());
    const startTime = bogotaIso(monday, 10);
    const created = await ctx.services.booking.createAppointment({
      tenantId: fixture.tenant.tenantId,
      serviceId: fixture.service.id,
      professionalId: fixture.professional.id,
      startTime,
      clientInfo: {
        name: 'Laura Gómez',
        phone: '+573156667788',
        email: 'laura@ejemplo.com',
        clientId: 'client-whatsapp',
        habeasDataConsent: true,
      },
      source: 'whatsapp',
      actor: 'whatsapp-bot',
    });

    await ctx.services.payments.processWebhook({
      tenantId: fixture.tenant.tenantId,
      rawEvent: {
        type: 'payment.charge.approved',
        data: {
          reference: created.intent.paymentReference,
          amount: created.intent.advanceAmount,
          currency: created.intent.currency,
          tenantId: fixture.tenant.tenantId,
        },
      },
    });

    const afterConfirm = await ctx.repos.notifications.findByAppointment!(
      fixture.tenant.tenantId,
      created.appointment.id,
    );
    expect(afterConfirm.some((n) => n.type === 'confirmation' && n.status === 'sent')).toBe(true);

    await ctx.services.booking.cancelAppointment({
      tenantId: fixture.tenant.tenantId,
      appointmentId: created.appointment.id,
      requestedBy: 'client',
      reason: 'Cambio de horario',
      actor: 'client-whatsapp',
    });

    const afterCancel = await ctx.repos.notifications.findByAppointment!(
      fixture.tenant.tenantId,
      created.appointment.id,
    );
    expect(afterCancel.some((n) => n.type === 'cancellation' && n.status === 'sent')).toBe(true);
  });

  it('B-01 / RNF-17: ejecuta fallback a Resend (email) en < 2 min cuando WhatsApp falla y garantiza 1 envío por evento', async () => {
    const monday = nextMondayBogota(new Date());
    const startTime = bogotaIso(monday, 11);
    const created = await ctx.services.booking.createAppointment({
      tenantId: fixture.tenant.tenantId,
      serviceId: fixture.service.id,
      professionalId: fixture.professional.id,
      startTime,
      clientInfo: {
        name: 'Carlos Fallback',
        phone: '+573109998877',
        email: 'carlos.fallback@ejemplo.com',
        habeasDataConsent: true,
      },
      source: 'whatsapp',
      actor: 'whatsapp-bot',
    });

    const failingWa = new FailingWhatsappGateway();
    const resendEmailsSent: Array<{ to: string; idempotencyKey: string }> = [];
    const resendGw = new ResendNotificationGateway({
      apiKey: 're_live_fallback',
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const headers = (init?.headers ?? {}) as Record<string, string>;
        resendEmailsSent.push({
          to: body.to?.[0] ?? '',
          idempotencyKey: headers['Idempotency-Key'] ?? '',
        });
        return new Response(JSON.stringify({ id: 're_fallback_ok_01' }), { status: 200 });
      }) as typeof fetch,
    });

    const useCasesWithFallback = new NotificationsUseCases(
      ctx.repos.notifications,
      failingWa,
      {
        fallbackEmailGateway: resendGw,
        fallbackDelayMs: 15,
        tenants: ctx.repos.tenants,
        appointments: ctx.repos.appointments,
      },
    );

    const first = await useCasesWithFallback.notifyAppointmentEvent({
      appointment: created.appointment,
      tenant: fixture.tenant,
      type: 'confirmation',
      paidAmount: created.intent.advanceAmount,
    });

    expect(first.status).toBe('fallback_sent');
    expect(first.fallbackUsed).toBe(true);
    expect(first.fallbackElapsedMs).toBeLessThan(120_000); // < 2 min (RNF-17)
    expect(resendEmailsSent).toHaveLength(1);
    expect(resendEmailsSent[0]?.to).toBe('carlos.fallback@ejemplo.com');

    // Segundo intento del mismo evento debe ser deduplicado (idempotencia: 1 envío por evento)
    const replay = await useCasesWithFallback.notifyAppointmentEvent({
      appointment: created.appointment,
      tenant: fixture.tenant,
      type: 'confirmation',
      paidAmount: created.intent.advanceAmount,
    });
    expect(replay.deduplicated).toBe(true);
    expect(resendEmailsSent).toHaveLength(1);
  });

  it('B-03 / RNF-10: dispara recordatorio configurable por tenant (1-72 h) con desviación <= ±5 min', async () => {
    const monday = nextMondayBogota(new Date());
    const startTime = bogotaIso(monday, 14);
    const created = await ctx.services.booking.createAppointment({
      tenantId: fixture.tenant.tenantId,
      serviceId: fixture.service.id,
      professionalId: fixture.professional.id,
      startTime,
      clientInfo: {
        name: 'Ana Recordatorio',
        phone: '+573201112233',
        email: 'ana@ejemplo.com',
        habeasDataConsent: true,
      },
      source: 'whatsapp',
      actor: 'whatsapp-bot',
    });

    await ctx.services.payments.processWebhook({
      tenantId: fixture.tenant.tenantId,
      rawEvent: {
        type: 'payment.charge.approved',
        data: {
          reference: created.intent.paymentReference,
          amount: created.intent.advanceAmount,
          currency: created.intent.currency,
          tenantId: fixture.tenant.tenantId,
        },
      },
    });

    const reminderHours = fixture.tenant.settings.reminderHours ?? 24;
    // Simulamos ejecución del cron exactamente 2 minutos después del instante ideal (startTime - reminderHours)
    const simulatedCronNowMs =
      new Date(startTime).getTime() - reminderHours * 3_600_000 + 2 * 60_000;

    const firstRun = await ctx.services.notifications.dispatchDueReminders({
      now: new Date(simulatedCronNowMs).toISOString(),
      toleranceMinutes: 5,
    });

    const matched = firstRun.dispatches.find((d) => d.appointmentId === created.appointment.id);
    expect(matched).toBeDefined();
    expect(matched!.deviationMinutes).toBeLessThanOrEqual(5);
    expect(matched!.status).toBe('sent');

    // Segunda corrida del cron dentro de la misma ventana no debe reenviar el recordatorio
    const secondRun = await ctx.services.notifications.dispatchDueReminders({
      now: new Date(simulatedCronNowMs + 60_000).toISOString(),
      toleranceMinutes: 5,
    });
    const matchedReplay = secondRun.dispatches.find(
      (d) => d.appointmentId === created.appointment.id,
    );
    expect(matchedReplay).toBeDefined();
    expect(secondRun.deduplicated).toBeGreaterThanOrEqual(1);
  });

  it('B-03 / RF-2.8: PATCH /api/owner/:tenantId/settings valida reminderHours (1..72), canal preferido y persiste en BD', async () => {
    const ownerKc = 'kc-owner-settings';
    const profKc = 'kc-prof-settings';
    await ctx.repos.tenantUsers.createOrUpdate({
      tenantId: fixture.tenant.tenantId,
      keycloakUserId: ownerKc,
      role: 'owner',
      status: 'active',
      syncedAt: new Date().toISOString(),
    });
    await ctx.repos.tenantUsers.createOrUpdate({
      tenantId: fixture.tenant.tenantId,
      keycloakUserId: profKc,
      role: 'professional',
      status: 'active',
      syncedAt: new Date().toISOString(),
    });

    const verifier = {
      verify: async (token: string): Promise<Principal> => ({
        sub: token === 'TOKEN_OWNER' ? ownerKc : profKc,
        roles: [],
        raw: {},
      }),
    } as unknown as KeycloakVerifier;

    const app = express();
    app.use(express.json());
    app.use('/api', rolesRouter(ctx.services, verifier));
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Profesional no autorizado -> 403
    const forbiddenRes = await request(app)
      .patch(`/api/owner/${fixture.tenant.tenantId}/settings`)
      .set('Authorization', 'Bearer TOKEN_PROF')
      .set('x-tenant-id', fixture.tenant.tenantId)
      .send({ reminderHours: 12 });
    expect(forbiddenRes.status).toBe(403);

    // Valores fuera de rango 1..72 -> 422 (ValidationError)
    const tooLow = await request(app)
      .patch(`/api/owner/${fixture.tenant.tenantId}/settings`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', fixture.tenant.tenantId)
      .send({ reminderHours: 0 });
    expect(tooLow.status).toBe(422);

    const tooHigh = await request(app)
      .patch(`/api/owner/${fixture.tenant.tenantId}/settings`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', fixture.tenant.tenantId)
      .send({ reminderHours: 73 });
    expect(tooHigh.status).toBe(422);

    // Actualización válida de reminderHours y preferredNotificationChannel -> 200 y persiste
    const okRes = await request(app)
      .patch(`/api/owner/${fixture.tenant.tenantId}/settings`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', fixture.tenant.tenantId)
      .send({
        reminderHours: 12,
        preferredNotificationChannel: 'email',
        whatsappPhoneNumberId: '109876543210987',
      });
    expect(okRes.status).toBe(200);
    expect(okRes.body.settings.reminderHours).toBe(12);
    expect(okRes.body.settings.preferredNotificationChannel).toBe('email');
    expect(okRes.body.settings.whatsappPhoneNumberId).toBe('109876543210987');

    // Comprobar que la consulta RF-4.4 por phone_number_id resuelve este tenant activo
    const resolved = await ctx.services.whatsapp.resolveTenantByPhoneNumberId('109876543210987');
    expect(resolved).toEqual({
      tenantId: fixture.tenant.tenantId,
      slug: fixture.tenant.slug,
      name: fixture.tenant.name,
      whatsappPhoneNumberId: '109876543210987',
    });
    expect(await ctx.services.whatsapp.resolveTenantByPhoneNumberId('unknown-phone-id')).toBeNull();

    // Restaurar a 24 h / whatsapp para dejar limpio el estado
    const restoreRes = await request(app)
      .patch(`/api/owner/${fixture.tenant.tenantId}/settings`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', fixture.tenant.tenantId)
      .send({ reminderHours: 24, preferredNotificationChannel: 'whatsapp' });
    expect(restoreRes.status).toBe(200);
  });
});
