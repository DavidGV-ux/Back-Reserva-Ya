import {
  AppointmentSource,
  AppointmentStatus,
  CancellationPolicy,
  CancellationRequestedBy,
  PaymentStatus,
  RefundStatus,
} from './types';

export interface ServiceSnapshot {
  serviceId: string;
  name: string;
  price: number;
  currency: string;
  durationMinutes: number;
}

export interface ClientInfo {
  clientId?: string;
  name: string;
  phone?: string;
  email?: string;
  habeasDataAcceptedAt: string;
  ip?: string;
  userAgent?: string;
}

export interface Cancellation {
  requestedBy: CancellationRequestedBy;
  requestedAt: string;
  reason?: string;
  policyApplied: CancellationPolicy;
  processingFee: number;
  refundAmount: number;
  refundStatus: RefundStatus;
  refundReference?: string;
  resolvedAt?: string;
}

export interface Appointment {
  id: string;
  tenantId: string;
  professionalId: string;
  serviceId: string;
  serviceSnapshot: ServiceSnapshot;
  commissionRateSnapshot: number;
  planIdSnapshot: string;
  idempotencyKey?: string;
  source: AppointmentSource;
  paymentReference?: string;
  latestPaymentTransactionId?: string;
  clientInfo: ClientInfo;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  cancellation?: Cancellation;
  needsReassignment: boolean;
  version: number;
}

export interface BookingIntent {
  advanceAmount: number;
  currency: string;
  paymentReference: string;
  providerTransactionId?: string;
}