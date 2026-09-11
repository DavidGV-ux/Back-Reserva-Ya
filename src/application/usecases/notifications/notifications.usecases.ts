import { uuid } from '../../../shared/id';
import { NotificationChannel, NotificationType } from '../../../domain/entities/types';
import { NotificationGateway } from '../../../domain/ports/gateways';
import { NotificationRepository } from '../../../domain/ports/repositories';

export class NotificationsUseCases {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly gateway: NotificationGateway,
  ) {}

  async notify(input: {
    tenantId: string;
    appointmentId: string;
    channel: NotificationChannel;
    type: NotificationType;
    to: string;
    message: string;
  }): Promise<void> {
    const id = uuid();
    try {
      const created = await this.repo.create({
        id,
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        channel: input.channel,
        type: input.type,
        status: 'pending',
        attempts: 0,
        archived: false,
      });
      const result = await this.gateway.send({
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        to: input.to,
        type: input.type,
        message: input.message,
      });
      await this.repo.markSent(id, result.providerMessageId);
    } catch (err) {
      await this.repo.markFailed(id, err instanceof Error ? err.message : String(err));
    }
  }
}