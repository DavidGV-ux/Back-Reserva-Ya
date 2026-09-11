import {
  Currency,
  LedgerAccount,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  PaymentOperation,
  PaymentProviderStatus,
} from './types';

export interface PaymentTransaction {
  id: string;
  tenantId: string;
  appointmentId: string;
  provider: string;
  providerTransactionId?: string;
  providerEventId?: string;
  internalReference: string;
  operation: PaymentOperation;
  amount: number;
  currency: Currency;
  status: PaymentProviderStatus;
  metadata?: Record<string, unknown>;
  version: number;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  transactionId: string;
  appointmentId?: string;
  payoutId?: string;
  paymentTransactionId?: string;
  paymentReference?: string;
  type: LedgerType;
  account: LedgerAccount;
  direction: LedgerDirection;
  amount: number;
  currency: Currency;
  commissionRateSnapshot?: number;
  status: LedgerStatus;
  idempotencyKey?: string;
  source?: string;
  sourceEventId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface LedgerSummary {
  balance: number;
  commissionWithheld: number;
  movements: LedgerEntry[];
}