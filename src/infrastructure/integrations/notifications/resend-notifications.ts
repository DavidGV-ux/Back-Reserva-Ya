import { createHash } from 'node:crypto';
import { NotificationGateway } from '../../../domain/ports/gateways';

export interface ResendGatewayOptions {
  apiKey?: string;
  fromEmail?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * B-01: Adaptador de notificaciones por correo electrónico mediante Resend.
 * Garantiza idempotencia por `notificationId` tanto en memoria como a través
 * del encabezado `Idempotency-Key` de la API de Resend.
 */
export class ResendNotificationGateway implements NotificationGateway {
  readonly channel = 'email' as const;
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly baseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly idempotencyCache = new Map<string, string>();

  constructor(options: ResendGatewayOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? '';
    this.fromEmail =
      options.fromEmail ??
      process.env.RESEND_FROM_EMAIL ??
      'ReservaYa <notificaciones@reservaya.co>';
    this.baseUrl = (options.baseUrl ?? 'https://api.resend.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl;
  }

  async send(input: {
    notificationId?: string;
    tenantId: string;
    appointmentId: string;
    to: string;
    type: 'confirmation' | 'reminder' | 'cancellation';
    message: string;
    subject?: string;
    html?: string;
  }): Promise<{ providerMessageId?: string }> {
    const idempotencyKey =
      input.notificationId ??
      `${input.tenantId}:${input.appointmentId}:${input.type}:email`;

    const cached = this.idempotencyCache.get(idempotencyKey);
    if (cached) {
      return { providerMessageId: cached };
    }

    const recipient = input.to.includes('@')
      ? input.to
      : `cliente.${input.to.replace(/\D/g, '') || 'reservaya'}@reservaya.co`;

    const subject =
      input.subject ??
      (input.type === 'confirmation'
        ? 'Confirmación de tu reserva en ReservaYa'
        : input.type === 'reminder'
          ? 'Recordatorio de tu próxima cita en ReservaYa'
          : 'Cancelación de tu cita en ReservaYa');

    const html =
      input.html ??
      `<div style="font-family: Arial, sans-serif; padding: 16px;"><p>${input.message.replace(/\n/g, '<br/>')}</p></div>`;

    // Si se configuró una API key real o un fetch inyectado, invocar endpoint de Resend
    if (this.fetchImpl || (this.apiKey && !this.apiKey.startsWith('re_sandbox_local'))) {
      const fn = this.fetchImpl ?? fetch;
      const response = await fn(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [recipient],
          subject,
          text: input.message,
          html,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        const reason = body.message ?? body.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`Resend API error: ${reason}`);
      }

      const providerMessageId =
        body.id ?? `resend-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 12)}`;
      this.idempotencyCache.set(idempotencyKey, providerMessageId);
      return { providerMessageId };
    }

    // Modo local/sandbox determinista cuando no se ha inyectado clave externa de Resend
    const deterministicId = `resend-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 12)}`;
    this.idempotencyCache.set(idempotencyKey, deterministicId);
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[resend:${input.type}] to=${recipient} id=${deterministicId} subject="${subject}"`);
    }
    return { providerMessageId: deterministicId };
  }
}
