import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestDb, testDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';
import { NotificationGateway } from '../../src/domain/ports/gateways';
import { NotificationsUseCases } from '../../src/application/usecases/notifications/notifications.usecases';
import { ResendNotificationGateway } from '../../src/infrastructure/integrations/notifications/resend-notifications';

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
});
