import { env } from '../../../config/env';
import { NotificationGateway } from '../../../domain/ports/gateways';
import { MockNotificationGateway } from './mock-notifications';

export function buildNotificationGateway(): NotificationGateway {
  switch (env.whatsappProvider) {
    case 'mock':
      return new MockNotificationGateway();
    default:
      throw new Error(`Unsupported WHATSAPP_PROVIDER: ${env.whatsappProvider}`);
  }
}