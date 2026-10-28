import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { TestDb, testDb } from '../helpers/mongo';
import { seedShop, nextMondayBogota, bogotaIso, SeededShop } from '../helpers/fixtures';
import { buildApp } from '../../src/entrypoints/http/server';
import { KeycloakVerifier } from '../../src/infrastructure/auth/keycloak';

interface RawBodyReq extends Request {
  rawBody?: Buffer;
}

function signMetaPayload(rawBody: string, appSecret: string): string {
  const digest = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const receivedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (receivedBuf.length === 0 || receivedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Simulador autónomo del receptor Webhook de WhatsApp para validar el contrato E2E
 * de `Back-Reserva-Ya` en CI/CD sin acoplar rutas físicas entre repositorios.
 */
function buildStandaloneWhatsappWebhookSimulator(deps: {
  metaAppSecret: string;
  whatsappBotSecret: string;
  backBaseUrl: string;
  defaultTenantSlug: string;
  defaultStartTimeIso: string;
}) {
  const app = express();
  const processedWamids = new Set<string>();

  app.use(
    express.json({
      verify: (req: RawBodyReq, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );

  app.post('/webhook/whatsapp', async (req: RawBodyReq, res: Response) => {
    const signature = req.header('x-hub-signature-256');
    if (!verifyMetaSignature(req.rawBody, signature, deps.metaAppSecret)) {
      res.status(401).json({ error: 'invalid_meta_signature' });
      return;
    }

    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    if (!message?.id || !message?.from) {
      res.status(200).json({ status: 'ignored', enqueued: false, deduplicated: false });
      return;
    }

    if (processedWamids.has(message.id)) {
      res.status(200).json({ status: 'accepted', enqueued: false, deduplicated: true });
      return;
    }
    processedWamids.add(message.id);

    const fromPhone = `+${String(message.from).replace(/^\+/, '')}`;
    const textBody = String(message.text?.body ?? '');
    const clientName = String(contact?.profile?.name ?? 'Cliente WhatsApp');
    const emailMatch = textBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // 1. Consultar identidad por teléfono y resolver tenant/catálogo en Back-Reserva-Ya
    await fetch(
      `${deps.backBaseUrl}/api/public/whatsapp/lookup?phone=${encodeURIComponent(fromPhone)}`,
      { headers: { 'x-whatsapp-secret': deps.whatsappBotSecret } },
    );

    const tenantRes = await fetch(
      `${deps.backBaseUrl}/api/public/tenants/${encodeURIComponent(deps.defaultTenantSlug)}`,
    );
    const tenant = (await tenantRes.json()) as { tenantId: string; slug: string; name: string };

    const [servicesRes, profsRes] = await Promise.all([
      fetch(`${deps.backBaseUrl}/api/public/${encodeURIComponent(tenant.tenantId)}/services`),
      fetch(`${deps.backBaseUrl}/api/public/${encodeURIComponent(tenant.tenantId)}/professionals`),
    ]);
    const services = (await servicesRes.json()) as Array<{ id: string; name: string }>;
    const professionals = (await profsRes.json()) as Array<{ id: string; name: string }>;

    const matchedService =
      services.find((s) => textBody.toLowerCase().includes(s.name.toLowerCase())) ?? services[0];
    const matchedProfessional =
      professionals.find((p) => textBody.toLowerCase().includes(p.name.toLowerCase())) ??
      professionals[0];

    // 2. Crear la reserva en Back-Reserva-Ya con source: 'whatsapp'
    const bookingRes = await fetch(
      `${deps.backBaseUrl}/api/public/${encodeURIComponent(tenant.tenantId)}/appointments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: matchedService!.id,
          professionalId: matchedProfessional!.id,
          startTime: deps.defaultStartTimeIso,
          clientInfo: {
            name: clientName,
            phone: fromPhone,
            email: emailMatch ? emailMatch[0] : 'cliente.whatsapp@reservaya.co',
            habeasDataConsent: true,
          },
          source: 'whatsapp',
          idempotencyKey: `wa-${message.id}`,
        }),
      },
    );

    if (!bookingRes.ok) {
      const errorText = await bookingRes.text();
      res.status(bookingRes.status).json({ error: errorText });
      return;
    }

    const bookingData = (await bookingRes.json()) as {
      appointment: { id: string };
      intent: { advanceAmount: number; paymentReference: string };
    };

    // 3. Generar sesión / enlace de pago del anticipo en Back-Reserva-Ya
    const sessionRes = await fetch(
      `${deps.backBaseUrl}/api/public/${encodeURIComponent(tenant.tenantId)}/appointments/${encodeURIComponent(bookingData.appointment.id)}/payment-session`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'advance' }),
      },
    );

    let paymentLink = `http://localhost:4200/t/${tenant.slug}/pay/${bookingData.appointment.id}`;
    if (sessionRes.ok) {
      const sessionData = (await sessionRes.json()) as { checkoutUrl?: string; token?: string };
      if (sessionData.checkoutUrl) {
        paymentLink = sessionData.checkoutUrl;
      } else if (sessionData.token) {
        paymentLink = `${paymentLink}?session=${encodeURIComponent(sessionData.token)}`;
      }
    }

    res.status(200).json({
      status: 'accepted',
      enqueued: true,
      deduplicated: false,
      result: {
        appointmentId: bookingData.appointment.id,
        paymentReference: bookingData.intent.paymentReference,
        paymentLink,
        advanceAmount: bookingData.intent.advanceAmount,
      },
    });
  });

  return app;
}

describe('E2E WhatsApp -> Reserva -> Link de Pago -> Confirmación -> Recordatorio (B-04, B-07)', () => {
  let ctx: TestDb;
  let fixture: SeededShop;
  let backServer: Server;
  let botServer: Server;
  let backBaseUrl: string;
  let botBaseUrl: string;
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

    const botApp = buildStandaloneWhatsappWebhookSimulator({
      metaAppSecret: metaSecret,
      whatsappBotSecret: botSecret,
      backBaseUrl,
      defaultTenantSlug: fixture.tenant.slug,
      defaultStartTimeIso: targetSlotIso,
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
