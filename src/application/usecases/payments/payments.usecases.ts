import { NotFoundError } from '../../../shared/errors';
import { Appointment, PaymentTransaction } from '../../../domain/entities';
import { PaymentGatewayProvider } from '../../../domain/ports/gateways';
import { AppointmentRepository, PaymentTransactionRepository, TenantRepository } from '../../../domain/ports/repositories';
import { UnitOfWork } from '../../../domain/ports/unit-of-work';
import {
  buildLedgerForApprovedCharge,
  buildLedgerForRejectedPayment,
  buildLedgerForRefund,
} from '../../../domain/rules/payments-rules';
import { hexId } from '../../../shared/id';

export interface PaymentEventResult {
  handled: boolean;
  reason?: 'duplicate' | 'unknown_reference' | 'pending';
  transaction?: PaymentTransaction;
  appointment?: Appointment;
}

export interface ExpiryResult {
  scanned: number;
  expired: number;
  refundRequested: number;
  skipped: number;
  failed: number;
}

export class PaymentsUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: PaymentGatewayProvider,
    private readonly repos: {
      appointments: AppointmentRepository;
      tenants: TenantRepository;
      paymentTransactions: PaymentTransactionRepository;
    },
  ) {}

  get provider(): string {
    return this.gateway.name;
  }

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

      if (event.status === 'pending') {
        return { handled: false, reason: 'pending', transaction: existing, appointment };
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
        const entries = buildLedgerForRejectedPayment({ transaction: declined, appointment: updated });
        for (const entry of entries) {
          await tx.ledger.create(entry);
        }
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

  async expirePendingPayments(input?: { now?: string; maxToProcess?: number }): Promise<ExpiryResult> {
    const nowIso = input?.now ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const cutoffIso = new Date(nowMs - 120_000).toISOString();
    const candidates = await this.repos.appointments.findPendingOlderThan(cutoffIso, input?.maxToProcess ?? 500);

    let expired = 0;
    let refundRequested = 0;
    let skipped = 0;
    let failed = 0;

    for (const appt of candidates) {
      const tenant = await this.repos.tenants.findById(appt.tenantId);
      if (!tenant) {
        failed += 1;
        continue;
      }
      const timeoutMs = tenant.settings.paymentTimeoutMinutes * 60_000;
      const createdMs = new Date(appt.createdAt ?? appt.startTime).getTime();
      if (!Number.isFinite(createdMs) || nowMs - createdMs < timeoutMs) {
        skipped += 1;
        continue;
      }

      try {
        await this.uow.withTransaction(async (tx) => {
          const fresh = await tx.appointments.findById(appt.tenantId, appt.id);
          if (!fresh || fresh.status !== 'pending_payment') return 'skipped' as const;

          const payment = fresh.paymentReference
            ? await tx.paymentTransactions.findByInternalReference(appt.tenantId, fresh.paymentReference)
            : null;

          if (payment && payment.status === 'approved') {
            await tx.timeSlots.removeForAppointment(appt.tenantId, fresh.id);
            const refund = await this.gateway.createRefund({
              tenantId: appt.tenantId,
              appointmentId: fresh.id,
              internalReference: `${fresh.paymentReference}-R`,
              amount: payment.amount,
              currency: fresh.serviceSnapshot.currency,
              idempotencyKey: `scheduler-refund-${fresh.id}`,
              metadata: { providerTransactionId: payment.providerTransactionId },
            });
            await tx.paymentTransactions.create(
              {
                id: hexId(),
                tenantId: appt.tenantId,
                appointmentId: fresh.id,
                provider: this.gateway.name,
                providerTransactionId: refund.providerTransactionId,
                internalReference: `${fresh.paymentReference}-R`,
                operation: 'refund',
                amount: payment.amount,
                currency: fresh.serviceSnapshot.currency as import('../../../domain/entities/types').Currency,
                status: 'pending',
                version: 1,
              },
              'scheduler',
            );
            await tx.appointments.updateStatus(
              appt.tenantId,
              fresh.id,
              fresh.version,
              { status: 'expired', paymentStatus: 'pending' },
              'scheduler',
            );
            refundRequested += 1;
            return 'refunded' as const;
          }

          await tx.timeSlots.removeForAppointment(appt.tenantId, fresh.id);
          const updated = await tx.appointments.updateStatus(
            appt.tenantId,
            fresh.id,
            fresh.version,
            { status: 'expired', paymentStatus: 'rejected' },
            'scheduler',
          );
          if (payment) {
            await tx.paymentTransactions.updateStatus(
              appt.tenantId,
              payment.id,
              payment.version,
              'declined',
              { actor: 'scheduler' },
            );
          }
          const rejected = await tx.appointments.findById(appt.tenantId, fresh.id);
          const entries = buildLedgerForRejectedPayment({
            transaction: payment ?? undefined,
            appointment: rejected ?? updated,
            actor: 'scheduler',
          });
          for (const entry of entries) {
            await tx.ledger.create(entry);
          }
          expired += 1;
          return 'rejected' as const;
        });
      } catch {
        failed += 1;
      }
    }

    return { scanned: candidates.length, expired, refundRequested, skipped, failed };
  }
}