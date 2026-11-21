import { describe, expect, it, vi } from 'vitest';
import { buildNotificationGateway } from '../../src/infrastructure/integrations/notifications/factory';
import { ResendNotificationGateway } from '../../src/infrastructure/integrations/notifications/resend-notifications';
import { MetaWhatsappNotificationGateway } from '../../src/infrastructure/integrations/notifications/meta-whatsapp-notifications';
import {
  buildConfirmationReceiptTemplate,
  buildWelcomeTemplate,
} from '../../src/infrastructure/integrations/notifications/templates';
import { NotificationsUseCases } from '../../src/application/usecases/notifications/notifications.usecases';
import { PaymentsUseCases } from '../../src/application/usecases/payments/payments.usecases';
import { Appointment, Notification, PaymentTransaction, Tenant } from '../../src/domain/entities';
import { NotificationRepository } from '../../src/domain/ports/repositories';
import { PaymentGatewayProvider } from '../../src/domain/ports/gateways';
import { TransactionRepositories, UnitOfWork } from '../../src/domain/ports/unit-of-work';

function buildInMemoryNotificationRepo(): NotificationRepository & { items: Notification[] } {
  const items: Notification[] = [];
  return {
    items,
    async create(n) {
      items.push({ ...n });
      return { ...n };
    },
    async findByAppointment(tenantId, appointmentId) {
      return items.filter((i) => i.tenantId === tenantId && i.appointmentId === appointmentId);
    },
    async findByAppointmentTypeChannel(tenantId, appointmentId, type, channel) {
      return (
        items.find(
          (i) =>
            i.tenantId === tenantId &&
            i.appointmentId === appointmentId &&
            i.type === type &&
            i.channel === channel,
        ) ?? null
      );
    },
    async markSent(id, providerMessageId) {
      const found = items.find((i) => i.id === id);
      if (found) {
        found.status = 'sent';
        found.providerMessageId = providerMessageId;
        found.attempts += 1;
      }
    },
    async markFailed(id, errorMessage) {
      const found = items.find((i) => i.id === id);
      if (found) {
        found.status = 'failed';
        found.errorMessage = errorMessage;
        found.attempts += 1;
      }
    },
    async markFallbackSent(id, providerMessageId, originalError) {
      const found = items.find((i) => i.id === id);
      if (found) {
        found.status = 'fallback_sent';
        found.providerMessageId = providerMessageId;
        found.errorMessage = originalError;
      }
    },
  };
}

function makeSampleAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: '65f000000000000000000099',
    tenantId: 't_barber_estilo',
    professionalId: '65f000000000000000000088',
    serviceId: '65f000000000000000000077',
    serviceSnapshot: {
      serviceId: '65f000000000000000000077',
      name: 'Corte + barba',
      price: 55000,
      currency: 'COP',
      durationMinutes: 60,
    },
    commissionRateSnapshot: 0.05,
    planIdSnapshot: 'pro',
    idempotencyKey: 'idem-01',
    source: 'whatsapp',
    paymentReference: 'RSV-TEST-001',
    clientInfo: {
      name: 'Fernando Rojas',
      phone: '+573101234567',
      email: 'fernando@uptc.edu.co',
      habeasDataAcceptedAt: new Date().toISOString(),
    },
    startTime: '2026-10-25T15:00:00.000Z',
    endTime: '2026-10-25T16:00:00.000Z',
    status: 'confirmed',
    paymentStatus: 'approved',
    paidAmount: 16500,
    needsReassignment: false,
    version: 2,
    ...overrides,
  };
}

describe('notifications adapters & templates (B-01, B-02, B-06, F-05)', () => {
  it('resuelve dinámicamente mock, resend y meta en buildNotificationGateway()', () => {
    const mockGw = buildNotificationGateway({ provider: 'mock' });
    expect(mockGw.channel).toBe('whatsapp');

    const resendGw = buildNotificationGateway({ provider: 'resend' });
    expect(resendGw.channel).toBe('email');

    const metaGw = buildNotificationGateway({ provider: 'meta' });
    expect(metaGw.channel).toBe('whatsapp');

    expect(() => buildNotificationGateway({ provider: 'invalido' })).toThrow(
      /Unsupported WHATSAPP_PROVIDER/,
    );
  });

  it('ResendNotificationGateway envía Idempotency-Key por notificationId y deduplica llamadas repetidas (B-01)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 're_msg_123456' }),
    });

    const gateway = new ResendNotificationGateway({
      apiKey: 're_live_key_test',
      fromEmail: 'ReservaYa <no-reply@reservaya.co>',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const first = await gateway.send({
      notificationId: 'notif-unique-001',
      tenantId: 't_barber_estilo',
      appointmentId: '65f000000000000000000001',
      to: 'cliente@correo.com',
      type: 'confirmation',
      message: 'Cita confirmada',
      subject: 'Confirmación ReservaYa',
      html: '<p>Cita confirmada</p>',
    });

    const second = await gateway.send({
      notificationId: 'notif-unique-001',
      tenantId: 't_barber_estilo',
      appointmentId: '65f000000000000000000001',
      to: 'cliente@correo.com',
      type: 'confirmation',
      message: 'Cita confirmada',
      subject: 'Confirmación ReservaYa',
      html: '<p>Cita confirmada</p>',
    });

    expect(first.providerMessageId).toBe('re_msg_123456');
    expect(second.providerMessageId).toBe('re_msg_123456');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, reqInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = reqInit.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('notif-unique-001');
    expect(headers.Authorization).toBe('Bearer re_live_key_test');
  });

  it('B-01 / F-05: falla de forma estricta (fail-closed) en producción cuando faltan credenciales de Resend o Meta y dispara fallback a email', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const resendWithoutKey = new ResendNotificationGateway({ apiKey: '' });
      await expect(
        resendWithoutKey.send({
          notificationId: 'notif-prod-resend-01',
          tenantId: 't_barber_estilo',
          appointmentId: '65f000000000000000000001',
          to: 'cliente@correo.com',
          type: 'confirmation',
          message: 'Confirmación',
        }),
      ).rejects.toThrow(/RESEND_API_KEY is required in production/);

      const metaWithoutCreds = new MetaWhatsappNotificationGateway({
        phoneNumberId: '',
        accessToken: '',
      });
      await expect(
        metaWithoutCreds.send({
          notificationId: 'notif-prod-meta-01',
          tenantId: 't_barber_estilo',
          appointmentId: '65f000000000000000000001',
          to: '+573101234567',
          type: 'confirmation',
          message: 'Confirmación',
        }),
      ).rejects.toThrow(/WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are required in production/);

      // Al fallar Meta por falta de credenciales en producción, NotificationsUseCases dispara fallback a Resend
      const resendFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 're_prod_fallback_01' }),
      });
      const fallbackResend = new ResendNotificationGateway({
        apiKey: 're_live_prod_key',
        fetchImpl: resendFetch as unknown as typeof fetch,
      });
      const repo = buildInMemoryNotificationRepo();
      const useCases = new NotificationsUseCases(repo, metaWithoutCreds, {
        fallbackEmailGateway: fallbackResend,
        fallbackDelayMs: 5,
      });

      const res = await useCases.notifyAppointmentEvent({
        appointment: makeSampleAppointment(),
        type: 'confirmation',
        paidAmount: 16500,
      });

      expect(res.status).toBe('fallback_sent');
      expect(res.fallbackUsed).toBe(true);
      expect(res.fallbackElapsedMs).toBeLessThan(120_000);
      expect(resendFetch).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it('B-06 / RF-4.7: ante rechazo de plantilla de Meta (400/132001) registra fallo y activa fallback a email (RNF-17)', async () => {
    const metaFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 132001,
          message: 'Template name does not exist in the translation',
        },
      }),
    });
    const resendFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 're_template_fallback_132001' }),
    });

    const metaGw = new MetaWhatsappNotificationGateway({
      phoneNumberId: '10987654321',
      accessToken: 'EAAG_TEST_TOKEN',
      useTemplatesForBusinessInitiated: true,
      fetchImpl: metaFetch as unknown as typeof fetch,
    });
    const resendGw = new ResendNotificationGateway({
      apiKey: 're_live_key',
      fetchImpl: resendFetch as unknown as typeof fetch,
    });

    const repo = buildInMemoryNotificationRepo();
    const useCases = new NotificationsUseCases(repo, metaGw, {
      fallbackEmailGateway: resendGw,
      fallbackDelayMs: 5,
    });

    const result = await useCases.notifyAppointmentEvent({
      appointment: makeSampleAppointment(),
      type: 'confirmation',
      paidAmount: 16500,
    });

    expect(metaFetch).toHaveBeenCalledTimes(1);
    expect(resendFetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('fallback_sent');
    expect(result.fallbackUsed).toBe(true);
    expect(result.providerMessageId).toBe('re_template_fallback_132001');
    expect(result.fallbackElapsedMs).toBeLessThan(120_000);

    const waRecord = repo.items.find((i) => i.channel === 'whatsapp');
    const emailRecord = repo.items.find((i) => i.channel === 'email');
    expect(waRecord?.status).toBe('fallback_sent');
    expect(waRecord?.errorMessage).toContain('400/132001');
    expect(emailRecord?.status).toBe('sent');
    expect(emailRecord?.providerMessageId).toBe('re_template_fallback_132001');
  });

  it('B-02: expirePendingPayments dispara notificación de confirmación cuando reconcilia un pago aprobado en pasarela', async () => {
    const pendingAppt = makeSampleAppointment({
      status: 'pending_payment',
      paymentStatus: 'pending',
      paidAmount: 0,
      createdAt: '2026-10-20T10:00:00.000Z',
      version: 1,
    });
    const pendingTx: PaymentTransaction = {
      id: '65f000000000000000000055',
      tenantId: pendingAppt.tenantId,
      appointmentId: pendingAppt.id,
      provider: 'wompi',
      internalReference: pendingAppt.paymentReference!,
      operation: 'charge',
      amount: 16500,
      currency: 'COP',
      status: 'pending',
      version: 1,
    };
    const tenant: Tenant = {
      id: '65f000000000000000000011',
      tenantId: pendingAppt.tenantId,
      slug: 'barber-estilo',
      planId: 'pro',
      name: 'Barber Estilo',
      tagline: '',
      description: '',
      timezone: 'America/Bogota',
      currency: 'COP',
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
    };

    const txRepos = {
      appointments: {
        findById: vi.fn(async () => pendingAppt),
        updateStatus: vi.fn(async (_t, _id, _v, patch) => ({
          ...pendingAppt,
          ...patch,
          version: 2,
        })),
      },
      paymentTransactions: {
        findByInternalReference: vi.fn(async () => pendingTx),
        updateStatus: vi.fn(async (_t, _id, _v, status, meta) => ({
          ...pendingTx,
          status,
          providerTransactionId: meta.providerTransactionId,
          providerEventId: meta.providerEventId,
          version: 2,
        })),
      },
      ledger: { create: vi.fn(async (entry) => entry) },
      timeSlots: { removeForAppointment: vi.fn(async () => undefined) },
    } as unknown as TransactionRepositories;

    const uow: UnitOfWork = {
      withTransaction: async (fn) => fn(txRepos),
    };

    const gateway = {
      name: 'wompi',
      fetchChargeStatus: vi.fn(async () => ({
        status: 'approved' as const,
        providerTransactionId: 'wompi-tx-reconciled-01',
      })),
    } as unknown as PaymentGatewayProvider;

    const notifyAppointmentEvent = vi.fn(async () => ({
      notificationId: 'notif-reconcile-01',
      status: 'sent' as const,
      channel: 'whatsapp' as const,
      deduplicated: false,
      fallbackUsed: false,
    }));
    const notifications = { notifyAppointmentEvent } as unknown as NotificationsUseCases;

    const paymentsUseCases = new PaymentsUseCases(
      uow,
      gateway,
      {
        appointments: {
          findPendingOlderThan: vi.fn(async () => [pendingAppt]),
        } as unknown as ConstructorParameters<typeof PaymentsUseCases>[2]['appointments'],
        tenants: {
          findById: vi.fn(async () => tenant),
        } as unknown as ConstructorParameters<typeof PaymentsUseCases>[2]['tenants'],
        paymentTransactions: {} as ConstructorParameters<typeof PaymentsUseCases>[2]['paymentTransactions'],
        availabilityBlocks: {} as ConstructorParameters<typeof PaymentsUseCases>[2]['availabilityBlocks'],
        timeSlots: {} as ConstructorParameters<typeof PaymentsUseCases>[2]['timeSlots'],
      },
      notifications,
    );

    const summary = await paymentsUseCases.expirePendingPayments({
      now: '2026-10-20T10:30:00.000Z',
    });

    expect(summary.reconciled).toBe(1);
    expect(summary.expired).toBe(0);
    expect(notifyAppointmentEvent).toHaveBeenCalledTimes(1);
    expect(notifyAppointmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        paidAmount: 16500,
        tenant,
        appointment: expect.objectContaining({
          id: pendingAppt.id,
          status: 'confirmed',
          paymentStatus: 'approved',
        }),
      }),
    );
  });

  it('genera plantillas aprobadas de bienvenida y recibo de pago en español (texto + HTML + Meta WABA) (B-06)', async () => {
    const welcome = buildWelcomeTemplate({
      clientName: 'Fernando Rojas',
      city: 'Tunja',
      tenantName: 'Barber Estilo',
    });

    expect(welcome.metaTemplateName).toBe('reservaya_bienvenida_es');
    expect(welcome.metaTemplateLanguage).toBe('es');
    expect(welcome.text).toContain('Fernando Rojas');
    expect(welcome.html).toContain('<!DOCTYPE html>');

    const sampleAppt = makeSampleAppointment();
    const receipt = buildConfirmationReceiptTemplate({
      appointment: sampleAppt,
      paidAmount: 16500,
    });

    expect(receipt.metaTemplateName).toBe('reservaya_recibo_pago_es');
    expect(receipt.text).toContain('RSV-TEST-001');
    expect(receipt.html).toContain('Cita Confirmada y Recibo de Pago');

    const metaFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.HBgMNTczMTAxMjM0NTY3' }] }),
    });

    const metaGw = new MetaWhatsappNotificationGateway({
      phoneNumberId: '10987654321',
      accessToken: 'EAAG_TEST_TOKEN',
      useTemplatesForBusinessInitiated: true,
      fetchImpl: metaFetch as unknown as typeof fetch,
    });

    const sent = await metaGw.send({
      notificationId: 'notif-meta-001',
      tenantId: sampleAppt.tenantId,
      appointmentId: sampleAppt.id,
      to: sampleAppt.clientInfo.phone!,
      type: 'confirmation',
      message: receipt.text,
      templateName: receipt.metaTemplateName,
      templateLanguage: receipt.metaTemplateLanguage,
      templateParams: receipt.metaTemplateParams,
    });

    expect(sent.providerMessageId).toBe('wamid.HBgMNTczMTAxMjM0NTY3');
    const [, init] = metaFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('reservaya_recibo_pago_es');
    expect(body.template.language.code).toBe('es');
  });
});
