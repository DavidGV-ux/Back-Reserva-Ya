import { randomBytes } from 'node:crypto';
import { NotificationGateway } from '../../../domain/ports/gateways';

export class MockNotificationGateway implements NotificationGateway {
  readonly channel = 'whatsapp' as const;

  async send(input: {
    tenantId: string;
    appointmentId: string;
    to: string;
    type: 'confirmation' | 'reminder' | 'cancellation';
    message: string;
  }): Promise<{ providerMessageId?: string }> {
    const providerMessageId = `mock-notif-${randomBytes(6).toString('hex')}`;
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[notification:${input.type}] ${input.to}: ${input.message}`);
    }
    return { providerMessageId };
  }
}