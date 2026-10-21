import { describe, expect, it, vi } from 'vitest';
import { buildNotificationGateway } from '../../src/infrastructure/integrations/notifications/factory';
import { ResendNotificationGateway } from '../../src/infrastructure/integrations/notifications/resend-notifications';
import { MetaWhatsappNotificationGateway } from '../../src/infrastructure/integrations/notifications/meta-whatsapp-notifications';
import {
  buildConfirmationReceiptTemplate,
  buildWelcomeTemplate,
} from '../../src/infrastructure/integrations/notifications/templates';
import { Appointment } from '../../src/domain/entities';

describe('notifications adapters & templates (B-01, B-06, F-05)', () => {
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

    const sampleAppt: Appointment = {
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
    };

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
