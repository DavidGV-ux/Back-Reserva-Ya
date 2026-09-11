import { describe, expect, it } from 'vitest';
import {
  buildLedgerForApprovedCharge,
  buildLedgerForRefund,
} from '../../src/domain/rules/payments-rules';
import { Appointment, PaymentTransaction } from '../../src/domain/entities';

const tx: PaymentTransaction = {
  id: 'tx1',
  tenantId: 't1',
  appointmentId: 'a1',
  provider: 'mock',
  internalReference: 'REF-1',
  operation: 'charge',
  amount: 10000,
  currency: 'COP',
  status: 'approved',
  providerEventId: 'evt-1',
  version: 1,
};

const appointment = {
  id: 'a1',
  tenantId: 't1',
  serviceSnapshot: { serviceId: 's1', name: 'S', price: 30000, currency: 'COP', durationMinutes: 30 },
  commissionRateSnapshot: 0.05,
} as Appointment;

describe('buildLedgerForApprovedCharge', () => {
  it('splits commission and tenant credit', () => {
    const [commission, credit] = buildLedgerForApprovedCharge({ transaction: tx, appointment });
    expect(commission.type).toBe('platform_commission');
    expect(commission.amount).toBe(500);
    expect(commission.account).toBe('platform_revenue');
    expect(credit.type).toBe('payment_approved');
    expect(credit.amount).toBe(9500);
    expect(credit.account).toBe('tenant_balance');
    expect(credit.status).toBe('posted');
  });
});

describe('buildLedgerForRefund', () => {
  it('creates a single debit entry', () => {
    const [entry] = buildLedgerForRefund({
      transaction: { ...tx, operation: 'refund', internalReference: 'REF-1-R' },
      appointment,
    });
    expect(entry.type).toBe('refund');
    expect(entry.direction).toBe('debit');
    expect(entry.amount).toBe(10000);
    expect(entry.account).toBe('customer_refund_liability');
  });
});