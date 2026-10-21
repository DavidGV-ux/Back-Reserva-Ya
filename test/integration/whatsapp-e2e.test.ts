import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { TestDb, testDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';
import { buildApp } from '../../src/entrypoints/http/server';
import { KeycloakVerifier } from '../../src/infrastructure/auth/keycloak';
import { signMetaPayload } from '../../../ReservaYa-Whatsapp/src/security/meta-signature';
import { SqsMessageQueue } from '../../../ReservaYa-Whatsapp/src/queue/sqs-queue';
import { GroqAiIntentExtractor } from '../../../ReservaYa-Whatsapp/src/ai/intent-extractor';
import { WhatsappBotService } from '../../../ReservaYa-Whatsapp/src/pipeline/whatsapp-bot.service';
import { buildBotApp } from '../../../ReservaYa-Whatsapp/src/server';

describe('E2E WhatsApp -> Reserva -> Link de Pago -> Confirmación -> Recordatorio (B-04, B-07)', () => {
  let ctx: TestDb;
  let fixture: SeededShop;
  let backServer: Server;
  let botServer: Server;
  let backBaseUrl: string;
  let botBaseUrl: string;
  let botService: WhatsappBotService;
  const metaSecret = 'e2e-meta-app-secret-2026';
  const botSecret = 'e2e-whatsapp-bot-secret-2026';
  let targetSlotIso: string;

  beforeAll(async () => {
    process.env.WHATSAPP_BOT_SECRET = botSecret;
    ctx = await testDb();
    fixture = await seedShop(ctx.repos);

    const monday = nextMondayBogota(new Date());
    targetSlotIso = bogotaIso(monday, 15); // Lunes 3:00 PM hora Bogotá

    const app = await buildApp({
      services: ctx.services,
      verifier: new KeycloakVerifier('http://localhost:8080/realms/reserwaya', 'reserwaya-web'),
      shutdown: async () => {},
    });

    await new Promise<void>((resolve) => {
      backServer = app.listen(0, '127.0.0.1', () => resolve());
    });
    const backPort = (backServer.address() as AddressInfo).port;
    backBaseUrl = `http://127.0.0.1:${backPort}`;

    botService = new WhatsappBotService({
      backApiBaseUrl: backBaseUrl,
      whatsappBotSecret: botSecret,
      defaultTenantSlug: fixture.tenant.slug,
      defaultStartTimeIso: targetSlotIso,
      queue: new SqsMessageQueue(),
      extractor: new GroqAiIntentExtractor(),
    });

    const botApp = buildBotApp({
      metaVerifyToken: 'e2e-verify-token',
      metaAppSecret: metaSecret,
      whatsappBotSecret: botSecret,
      botService,
    });

    await new Promise<void>((resolve) => {
      botServer = botApp.listen(0, '127.0.0.1', () => resolve());
    });
    const botPort = (botServer.address() as AddressInfo).port;
    botBaseUrl = `http://127.0.0.1:${botPort}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (botServer ? botServer.close(() => resolve()) : resolve()));
    await new Promise<void>((resolve) => (backServer ? backServer.close(() => resolve()) : resolve()));
    await ctx?.stop();
  });

  it('ejecuta el flujo E2E completo desde el webhook de Meta hasta la confirmación y el recordatorio programado', async () => {
    // 1. Mensaje entrante de WhatsApp firmado con HMAC-SHA256 (X-Hub-Signature-256)
    const metaWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-01',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [
                  {
                    wa_id: '573105556677',
                    profile: { name: 'Fernando Rojas' },
                  },
                ],
                messages: [
                  {
                    from: '573105556677',
                    id: 'wamid.E2E_BOOKING_001',
                    timestamp: '1760990000',
                    type: 'text',
                    text: {
                      body: 'Hola, quiero agendar un Corte con Juan a las 3pm, mi correo es fernando@uptc.edu.co',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawJson = JSON.stringify(metaWebhookPayload);
    const signature = signMetaPayload(rawJson, metaSecret);

    const webhookRes = await fetch(`${botBaseUrl}/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body: rawJson,
    });

    expect(webhookRes.status).toBe(200);
    const webhookData = (await webhookRes.json()) as {
      status: string;
      enqueued: boolean;
      deduplicated: boolean;
      result: {
        appointmentId: string;
        paymentReference: string;
        paymentLink: string;
        advanceAmount: number;
      };
    };

    expect(webhookData.status).toBe('accepted');
    expect(webhookData.enqueued).toBe(true);
    expect(webhookData.deduplicated).toBe(false);
    expect(webhookData.result.appointmentId).toBeTruthy();
    expect(webhookData.result.paymentReference).toMatch(/^RSV-/);
    expect(webhookData.result.paymentLink).toContain('session=');

    const appointmentId = webhookData.result.appointmentId;
    const paymentReference = webhookData.result.paymentReference;
    const advanceAmount = webhookData.result.advanceAmount;

    // 2. Verificar en BD que la cita nació con source='whatsapp' y status='pending_payment'
    const pendingAppt = await ctx.repos.appointments.findById(
      fixture.tenant.tenantId,
      appointmentId,
    );
    expect(pendingAppt).not.toBeNull();
    expect(pendingAppt!.source).toBe('whatsapp');
    expect(pendingAppt!.status).toBe('pending_payment');

    // 3. Simular pago del anticipo vía webhook de pasarela -> Confirmación de cita y disparo de notificación
    const payWebhookRes = await fetch(`${backBaseUrl}/api/webhooks/demo/payments/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reference: paymentReference,
        amount: advanceAmount,
        currency: 'COP',
        tenantId: fixture.tenant.tenantId,
      }),
    });
    expect(payWebhookRes.status).toBe(200);

    const confirmedAppt = await ctx.repos.appointments.findById(
      fixture.tenant.tenantId,
      appointmentId,
    );
    expect(confirmedAppt!.status).toBe('confirmed');
    expect(confirmedAppt!.paymentStatus).toBe('approved');

    const notificationsAfterConfirm = await ctx.repos.notifications.findByAppointment!(
      fixture.tenant.tenantId,
      appointmentId,
    );
    expect(
      notificationsAfterConfirm.some((n) => n.type === 'confirmation' && n.status === 'sent'),
    ).toBe(true);

    // 4. Disparar el cron de recordatorio programado dentro de la ventana de ±5 min (B-03 / B-07)
    const reminderHours = fixture.tenant.settings.reminderHours ?? 24;
    const cronNowIso = new Date(
      new Date(targetSlotIso).getTime() - reminderHours * 3_600_000 + 3 * 60_000,
    ).toISOString();

    const reminderSummary = await ctx.services.notifications.dispatchDueReminders({
      now: cronNowIso,
      toleranceMinutes: 5,
    });

    const reminderDispatch = reminderSummary.dispatches.find(
      (d) => d.appointmentId === appointmentId,
    );
    expect(reminderDispatch).toBeDefined();
    expect(reminderDispatch!.deviationMinutes).toBeLessThanOrEqual(5);
    expect(reminderDispatch!.status).toBe('sent');

    const allNotifications = await ctx.repos.notifications.findByAppointment!(
      fixture.tenant.tenantId,
      appointmentId,
    );
    expect(allNotifications.map((n) => n.type)).toEqual(
      expect.arrayContaining(['confirmation', 'reminder']),
    );
  });
});
