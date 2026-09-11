import { randomUUID } from 'node:crypto';
import { PaymentGatewayProvider } from '../../../domain/ports/gateways';
import { PaymentTransaction } from '../../../domain/entities';

export interface MockPaymentEvent {
  type: 'payment.charge.approved' | 'payment.charge.declined' | 'payment.refund.approved';
  data: {
    reference: string;
    amount: number;
    currency: 'COP' | 'USD';
    transactionId?: string;
    tenantId?: string;
  };
}

export class MockPaymentGateway implements PaymentGatewayProvider {
  readonly name = 'mock';

  async createCharge(input: {
    tenantId: string;
    appointmentId: string;
    internalReference: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }> {
    return {
      providerTransactionId: `mock-charge-${input.internalReference}`,
      status: 'pending',
    };
  }

  async createRefund(input: {
    tenantId: string;
    appointmentId: string;
    internalReference: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }> {
    return {
      providerTransactionId: `mock-refund-${input.internalReference}`,
      status: 'pending',
    };
  }

  async confirmEvent(event: unknown): Promise<{
    provider: string;
    providerEventId: string;
    providerTransactionId?: string;
    operation: PaymentTransaction['operation'];
    internalReference: string;
    amount: number;
    currency: string;
    status: PaymentTransaction['status'];
    metadata?: Record<string, unknown>;
  }> {
    const evt = event as MockPaymentEvent;
    if (!evt?.type || !evt.data) {
      throw new Error('Unsupported payment event payload');
    }
    const approved = evt.type === 'payment.charge.approved' || evt.type === 'payment.refund.approved';
    const operation: PaymentTransaction['operation'] =
      evt.type === 'payment.refund.approved' ? 'refund' : 'charge';
    const status: PaymentTransaction['status'] = approved
      ? 'approved'
      : 'declined';

    return {
      provider: this.name,
      providerEventId: randomUUID(),
      providerTransactionId:
        evt.data.transactionId ?? `${operation === 'refund' ? 'mock-refund' : 'mock-charge'}-${evt.data.reference}`,
      operation,
      internalReference: evt.data.reference,
      amount: evt.data.amount,
      currency: evt.data.currency,
      status,
      metadata: evt.data.tenantId ? { tenantId: evt.data.tenantId } : undefined,
    };
  }
}