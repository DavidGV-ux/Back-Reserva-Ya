import { randomUUID } from 'node:crypto';
import { PaymentGatewayProvider, ProviderWebhookEnvelope, ChargeIntent } from '../../../domain/ports/gateways';
import { PaymentTransaction } from '../../../domain/entities';
import { unwrapEnvelope } from './shared';
import { money } from '../../../shared/money';
import { z } from 'zod';

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

export const demoEventSchema = z.object({
  reference: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['COP', 'USD']),
  tenantId: z.string().optional(),
});

export type DemoPaymentAction = 'approve' | 'decline' | 'refund';

export function buildMockPaymentEvent(action: DemoPaymentAction, body: z.infer<typeof demoEventSchema>): MockPaymentEvent {
  if (action === 'approve') {
    return { type: 'payment.charge.approved', data: { ...body } };
  }
  if (action === 'decline') {
    return { type: 'payment.charge.declined', data: { ...body } };
  }
  return { type: 'payment.refund.approved', data: { ...body } };
}

export class MockPaymentGateway implements PaymentGatewayProvider {
  readonly name = 'mock';

  async buildChargeIntent(input: {
    tenantId: string;
    internalReference: string;
    amount: number;
    currency: string;
  }): Promise<ChargeIntent> {
    return {
      mode: 'demo',
      amountInCents: Math.round(money(input.amount) * 100),
      currency: input.currency,
      reference: input.internalReference,
    };
  }

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
    metadata?: Record<string, unknown>;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }> {
    return {
      providerTransactionId: `mock-refund-${input.internalReference}`,
      status: 'pending',
    };
  }

  async confirmEvent(event: ProviderWebhookEnvelope | unknown): Promise<{
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
    const envelope = unwrapEnvelope(event);
    const evt = envelope?.body as MockPaymentEvent | undefined;
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