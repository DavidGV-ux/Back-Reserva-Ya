export type Currency = 'COP' | 'USD';
export type LanguageCode = 'es' | 'en';
export type BookingStatus = 'active' | 'suspended' | 'migration';

export type AppointmentStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'expired'
  | 'needs_reassignment';

export type PaymentStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'refunded'
  | 'partially_refunded';

export type AppointmentSource = 'web' | 'whatsapp' | 'admin';

export type CancellationRequestedBy = 'client' | 'owner' | 'professional' | 'system';

export type CancellationPolicy =
  | 'client_within_window'
  | 'client_outside_window'
  | 'tenant_cancelled'
  | 'no_show'
  | 'system_cancelled';

export type RefundStatus = 'not_applicable' | 'pending' | 'approved' | 'failed';

export type SlotOccupation = 'appointment' | 'block';

export type PaymentOperation = 'charge' | 'refund' | 'chargeback' | 'payout';

export type PaymentProviderStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type LedgerType =
  | 'payment_approved'
  | 'payment_rejected'
  | 'platform_commission'
  | 'tenant_credit'
  | 'refund'
  | 'processing_fee'
  | 'payout_weekly'
  | 'balance_adjustment';

export type LedgerAccount =
  | 'tenant_balance'
  | 'platform_revenue'
  | 'customer_refund_liability'
  | 'payout_liability'
  | 'payment_event';

export type LedgerDirection = 'credit' | 'debit' | 'neutral';
export type LedgerStatus = 'pending' | 'posted' | 'reversed' | 'failed';

export type TenantRole = 'owner' | 'professional' | 'client';
export type PlatformRole = 'admin';
export type MembershipStatus = 'active' | 'revoked';

export type NotificationChannel = 'whatsapp' | 'email' | 'sms';
export type NotificationType = 'confirmation' | 'reminder' | 'cancellation';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'fallback_sent';