import { Appointment, LedgerEntry, PaymentTransaction } from '../entities';
import { money } from '../../shared/money';

export interface LedgerBuildInput {
  transaction: PaymentTransaction;
  appointment: Appointment;
}

export function buildLedgerForApprovedCharge(input: LedgerBuildInput): LedgerEntry[] {
  const { transaction, appointment } = input;
  const now = new Date().toISOString();
  const commissionRate = appointment.commissionRateSnapshot;
  const gross = transaction.amount;
  const commission = money(gross * commissionRate);
  const credit = money(gross - commission);

  const platformCommission: LedgerEntry = {
    id: '',
    tenantId: appointment.tenantId,
    transactionId: `led-${transaction.internalReference}-commission`,
    appointmentId: appointment.id,
    paymentTransactionId: transaction.id,
    paymentReference: transaction.internalReference,
    type: 'platform_commission',
    account: 'platform_revenue',
    direction: 'credit',
    amount: commission,
    currency: transaction.currency,
    commissionRateSnapshot: commissionRate,
    status: 'posted',
    idempotencyKey: `${transaction.internalReference}-commission`,
    source: 'payment',
    sourceEventId: transaction.providerEventId,
    timestamp: now,
  };

  const tenantCredit: LedgerEntry = {
    id: '',
    tenantId: appointment.tenantId,
    transactionId: `led-${transaction.internalReference}-credit`,
    appointmentId: appointment.id,
    paymentTransactionId: transaction.id,
    paymentReference: transaction.internalReference,
    type: 'payment_approved',
    account: 'tenant_balance',
    direction: 'credit',
    amount: credit,
    currency: transaction.currency,
    commissionRateSnapshot: commissionRate,
    status: 'posted',
    idempotencyKey: `${transaction.internalReference}-credit`,
    source: 'payment',
    sourceEventId: transaction.providerEventId,
    timestamp: now,
  };

  return [platformCommission, tenantCredit];
}

export function buildLedgerForRefund(input: LedgerBuildInput): LedgerEntry[] {
  const { transaction, appointment } = input;
  const now = new Date().toISOString();
  const refundEntry: LedgerEntry = {
    id: '',
    tenantId: appointment.tenantId,
    transactionId: `led-${transaction.internalReference}-refund`,
    appointmentId: appointment.id,
    paymentTransactionId: transaction.id,
    paymentReference: transaction.internalReference,
    type: 'refund',
    account: 'customer_refund_liability',
    direction: 'debit',
    amount: transaction.amount,
    currency: transaction.currency,
    status: 'posted',
    idempotencyKey: `${transaction.internalReference}-refund`,
    source: 'payment',
    sourceEventId: transaction.providerEventId,
    timestamp: now,
  };
  return [refundEntry];
}