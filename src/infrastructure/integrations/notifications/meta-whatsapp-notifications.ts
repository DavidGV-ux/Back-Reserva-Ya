import { createHash } from 'node:crypto';
import { NotificationGateway } from '../../../domain/ports/gateways';
import { normalizePhoneE164 } from '../../../shared/phone';

export interface MetaWhatsappGatewayOptions {
  phoneNumberId?: string;
  accessToken?: string;
  apiVersion?: string;
  useTemplatesForBusinessInitiated?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * B-04 / B-06: Adaptador oficial para Meta WhatsApp Cloud API (Graph API).
 * Soporta tanto envíos por plantilla aprobada (business-initiated) como
 * mensajes de texto con idempotencia por `notificationId`.
 */
export class MetaWhatsappNotificationGateway implements NotificationGateway {
  readonly channel = 'whatsapp' as const;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly useTemplates: boolean;
  private readonly fetchImpl?: typeof fetch;
  private readonly idempotencyCache = new Map<string, string>();

  constructor(options: MetaWhatsappGatewayOptions = {}) {
    this.phoneNumberId = options.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
    this.accessToken = options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? '';
    this.apiVersion = options.apiVersion ?? process.env.WHATSAPP_API_VERSION ?? 'v22.0';
    this.useTemplates = options.useTemplatesForBusinessInitiated ?? true;
    this.fetchImpl = options.fetchImpl;
  }

  async send(input: {
    notificationId?: string;
    tenantId: string;
    appointmentId: string;
    to: string;
    type: 'confirmation' | 'reminder' | 'cancellation';
    message: string;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
  }): Promise<{ providerMessageId?: string }> {
    const idempotencyKey =
      input.notificationId ??
      `${input.tenantId}:${input.appointmentId}:${input.type}:whatsapp`;

    const cached = this.idempotencyCache.get(idempotencyKey);
    if (cached) {
      return { providerMessageId: cached };
    }

    const cleanPhone = (normalizePhoneE164(input.to) ?? input.to).replace(/\D/g, '');
    if (!cleanPhone) {
      throw new Error('Meta WhatsApp error: recipient phone is empty or invalid');
    }

    const payload =
      this.useTemplates && input.templateName
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'template',
            template: {
              name: input.templateName,
              language: { code: input.templateLanguage ?? 'es' },
              components:
                input.templateParams && input.templateParams.length > 0
                  ? [
                      {
                        type: 'body',
                        parameters: input.templateParams.map((text) => ({
                          type: 'text',
                          text,
                        })),
                      },
                    ]
                  : [],
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'text',
            text: {
              preview_url: true,
              body: input.message,
            },
          };

    if (this.fetchImpl || (this.phoneNumberId && this.accessToken)) {
      const fn = this.fetchImpl ?? fetch;
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId || '000000'}/messages`;
      const response = await fn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number };
      };

      if (!response.ok) {
        throw new Error(
          `Meta WhatsApp API error (${response.status}): ${body.error?.message ?? 'Unknown error'}`,
        );
      }

      const providerMessageId =
        body.messages?.[0]?.id ??
        `wamid.${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)}`;
      this.idempotencyCache.set(idempotencyKey, providerMessageId);
      return { providerMessageId };
    }

    const providerMessageId = `wamid.${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)}`;
    this.idempotencyCache.set(idempotencyKey, providerMessageId);
    return { providerMessageId };
  }
}
