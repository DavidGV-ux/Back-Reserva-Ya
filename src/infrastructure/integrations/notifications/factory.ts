import { env } from '../../../config/env';
import { NotificationGateway } from '../../../domain/ports/gateways';
import { MockNotificationGateway } from './mock-notifications';
import { ResendNotificationGateway, ResendGatewayOptions } from './resend-notifications';
import { MetaWhatsappNotificationGateway, MetaWhatsappGatewayOptions } from './meta-whatsapp-notifications';

export interface NotificationFactoryOptions {
  provider?: string;
  resend?: ResendGatewayOptions;
  meta?: MetaWhatsappGatewayOptions;
}

/**
 * B-01 / F-05: Resuelve dinámicamente el adaptador de notificaciones según
 * `env.whatsappProvider` ('mock' | 'resend' | 'meta').
 */
export function buildNotificationGateway(options: NotificationFactoryOptions = {}): NotificationGateway {
  const provider = (options.provider ?? env.whatsappProvider).toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockNotificationGateway();
    case 'resend':
      return new ResendNotificationGateway({
        apiKey: env.resendApiKey,
        fromEmail: env.resendFromEmail,
        ...options.resend,
      });
    case 'meta':
      return new MetaWhatsappNotificationGateway({
        phoneNumberId: env.whatsappPhoneNumberId,
        accessToken: env.whatsappAccessToken,
        apiVersion: env.whatsappApiVersion,
        ...options.meta,
      });
    default:
      throw new Error(`Unsupported WHATSAPP_PROVIDER: ${provider}`);
  }
}

export function buildFallbackEmailGateway(options?: ResendGatewayOptions): ResendNotificationGateway {
  return new ResendNotificationGateway({
    apiKey: env.resendApiKey,
    fromEmail: env.resendFromEmail,
    ...options,
  });
}
