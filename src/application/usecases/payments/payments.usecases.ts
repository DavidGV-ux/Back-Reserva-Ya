import { NotFoundError } from '../../../shared/errors';
import { Appointment, PaymentTransaction } from '../../../domain/entities';
import { PaymentGatewayProvider } from '../../../domain/ports/gateways';
import { UnitOfWork } from '../../../domain/ports/unit-of-work';
import { buildLedgerForApprovedCharge, buildLedgerForRefund } from '../../../domain/rules/payments-rules';

export interface PaymentEventResult {
  handled: boolean;
  reason?: 'duplicate' | 'unknown_reference';
  transaction?: PaymentTransaction;
  appointment?: Appointment;
}

export class PaymentsUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: PaymentGatewayProvider,
  ) {}

  async processWebhook(input: { rawEvent: unknown; tenantId?: string }): Promise<PaymentEventResult> {
    const event = await this.gateway.confirmEvent(input.rawEvent);
    const tenantId = (event.metadata?.tenantId as string | undefined) ?? input.tenantId;
    if (!tenantId) {
      return { handled: false, reason: 'unknown_reference' };
    }

    return this.uow.withTransaction(async (tx) => {
      const alreadyProcessed = await tx.paymentTransactions.findByProviderEvent(
        event.provider,
        event.providerEventId,
      );
      if (alreadyProcessed) return { handled: false, reason: 'duplicate', transaction: alreadyProcessed };

      const existing = await tx.paymentTransactions.findByInternalReference(tenantId, event.internalReference);
      if (!existing) return { handled: false, reason: 'unknown_reference' };

      const appointment = await tx.appointments.findById(tenantId, existing.appointmentId);
      if (!appointment) throw new NotFoundError('Appointment', existing.appointmentId);

      if (existing.status === 'approved') {
        return { handled: false, reason: 'duplicate', transaction: existing, appointment };
      }

      if (event.operation === 'charge') {
        if (event.status === 'approved') {
          const approved = await tx.paymentTransactions.updateStatus(
            tenantId,
            existing.id,
            existing.version,
            'approved',
            {
              providerTransactionId: event.providerTransactionId,
              providerEventId: event.providerEventId,
              actor: 'payment-gateway',
            },
          );
          const updated = await tx.appointments.updateStatus(
            tenantId,
            appointment.id,
            appointment.version,
            {
              status: appointment.status === 'pending_payment' ? 'confirmed' : appointment.status,
              paymentStatus: 'approved',
              latestPaymentTransactionId: approved.id,
            },
            'payment-gateway',
          );
          const entries = buildLedgerForApprovedCharge({ transaction: approved, appointment: updated });
          for (const entry of entries) {
            await tx.ledger.create(entry);
          }
          return { handled: true, transaction: approved, appointment: updated };
        }

        const declined = await tx.paymentTransactions.updateStatus(
          tenantId,
          existing.id,
          existing.version,
          'declined',
          { providerEventId: event.providerEventId, actor: 'payment-gateway' },
        );
        const updated = await tx.appointments.updateStatus(
          tenantId,
          appointment.id,
          appointment.version,
          { status: 'expired', paymentStatus: 'rejected' },
          'payment-gateway',
        );
        return { handled: true, transaction: declined, appointment: updated };
      }

      if (event.operation === 'refund') {
        const approved = await tx.paymentTransactions.updateStatus(
          tenantId,
          existing.id,
          existing.version,
          'approved',
          {
            providerTransactionId: event.providerTransactionId,
            providerEventId: event.providerEventId,
            actor: 'payment-gateway',
          },
        );
        const updated = await tx.appointments.updateStatus(
          tenantId,
          appointment.id,
          appointment.version,
          {
            status: appointment.status,
            paymentStatus: 'refunded',
            cancellation: appointment.cancellation
              ? { ...appointment.cancellation, refundStatus: 'approved' as const }
              : appointment.cancellation,
          },
          'payment-gateway',
        );
        const entries = buildLedgerForRefund({ transaction: approved, appointment: updated });
        for (const entry of entries) {
          await tx.ledger.create(entry);
        }
        return { handled: true, transaction: approved, appointment: updated };
      }

      return { handled: false, reason: 'unknown_reference' as const };
    });
  }
}