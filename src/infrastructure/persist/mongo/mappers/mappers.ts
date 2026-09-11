import {
  Appointment,
  AvailabilityBlock,
  LedgerEntry,
  Notification,
  PaymentTransaction,
  Plan,
  Professional,
  Service,
  Tenant,
  TenantRole,
  TimeSlot,
} from '../../../../domain/entities';
import { dateToIso, idToStr, intToNumber, moneyToNumber } from '../bson';

interface Doc {
  _id?: unknown;
  [key: string]: unknown;
}

export function planToDomain(doc: Doc): Plan {
  return {
    id: idToStr(doc._id),
    name: String(doc.name ?? ''),
    code: String(doc.code ?? ''),
    commissionRate: moneyToNumber(doc.commission_rate),
    fixedFee: moneyToNumber(doc.fixed_fee ?? 0),
    active: Boolean(doc.active),
  };
}

function settingsFromDoc(doc: Doc): Tenant['settings'] {
  const s = (doc.settings ?? {}) as Record<string, unknown>;
  return {
    defaultLanguage: (s.default_language as Tenant['settings']['defaultLanguage']) ?? 'es',
    activeLanguages: ((s.active_languages as string[]) ?? ['es', 'en']).map((l) => l as 'es' | 'en'),
    slotGranularityMinutes: intToNumber(s.slot_granularity_minutes ?? 15),
    cancellationToleranceHours: intToNumber(s.cancellation_tolerance_hours ?? 24),
    paymentTimeoutMinutes: intToNumber(s.payment_timeout_minutes ?? 15),
    advancePaymentPercentage: intToNumber(s.advance_payment_percentage ?? 30),
    preferredNotificationChannel: (s.preferred_notification_channel as Tenant['settings']['preferredNotificationChannel']) ?? 'whatsapp',
    reminderHours: intToNumber(s.reminder_hours ?? 24),
    whatsappPhoneNumberId: s.whatsapp_phone_number_id as string | undefined,
  };
}

export function tenantToDomain(doc: Doc): Tenant {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    slug: String(doc.slug ?? ''),
    planId: String(doc.plan_code ?? ''),
    name: String(doc.name ?? ''),
    tagline: String(doc.tagline ?? ''),
    description: String(doc.description ?? ''),
    timezone: String(doc.timezone ?? 'America/Bogota'),
    currency: (doc.currency as Tenant['currency']) ?? 'COP',
    country: doc.country as string | undefined,
    logoUrl: doc.logo_url as string | undefined,
    coverUrl: doc.cover_url as string | undefined,
    address: doc.address as string | undefined,
    phone: doc.phone as string | undefined,
    settings: settingsFromDoc(doc),
    bookingStatus: (doc.booking_status as Tenant['bookingStatus']) ?? 'active',
    version: intToNumber(doc.version ?? 1),
    deletedAt: doc.deleted_at ? dateToIso(doc.deleted_at) : null,
  };
}

export function serviceToDomain(doc: Doc): Service {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    name: String(doc.name ?? ''),
    description: doc.description as string | undefined,
    price: moneyToNumber(doc.price),
    currency: (doc.currency as Service['currency']) ?? 'COP',
    durationMinutes: intToNumber(doc.duration_minutes),
    active: Boolean(doc.active),
    version: intToNumber(doc.version ?? 1),
  };
}

function scheduleToDomain(doc: Doc): Professional['schedule'] {
  const schedule = (doc.schedule ?? {}) as Record<string, unknown>;
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const result: Professional['schedule'] = {
    monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
  };
  for (const day of days) {
    const arr = (schedule[day] ?? []) as Array<Record<string, unknown>>;
    result[day] = arr.map((i) => ({ start: String(i.start), end: String(i.end) }));
  }
  return result;
}

export function professionalToDomain(doc: Doc): Professional {
  const servicesIds = (doc.services_ids ?? []) as unknown[];
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    name: String(doc.name ?? ''),
    title: doc.title as string | undefined,
    avatarUrl: doc.avatar_url as string | undefined,
    serviceIds: servicesIds.map((s) => idToStr(s)),
    schedule: scheduleToDomain(doc),
    active: Boolean(doc.active),
    keycloakUserId: doc.keycloak_user_id as string | undefined,
    version: intToNumber(doc.version ?? 1),
  };
}

export function appointmentToDomain(doc: Doc): Appointment {
  const snapshot = (doc.service_snapshot ?? {}) as Record<string, unknown>;
  const client = (doc.client_info ?? {}) as Record<string, unknown>;
  const cancellation = doc.cancellation as Record<string, unknown> | undefined;
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    professionalId: idToStr(doc.professional_id),
    serviceId: idToStr(doc.service_id),
    serviceSnapshot: {
      serviceId: idToStr(snapshot.service_id ?? doc.service_id ?? ''),
      name: String(snapshot.name ?? ''),
      price: moneyToNumber(snapshot.price),
      currency: String(snapshot.currency ?? 'COP'),
      durationMinutes: intToNumber(snapshot.duration_minutes),
    },
    commissionRateSnapshot: moneyToNumber(doc.commission_rate_snapshot ?? 0),
    planIdSnapshot: String(doc.plan_code_snapshot ?? ''),
    idempotencyKey: doc.idempotency_key as string | undefined,
    source: (doc.source as Appointment['source']) ?? 'web',
    paymentReference: doc.payment_reference as string | undefined,
    latestPaymentTransactionId: doc.latest_payment_transaction_id
      ? idToStr(doc.latest_payment_transaction_id)
      : undefined,
    clientInfo: {
      clientId: client.client_id as string | undefined,
      name: String(client.name ?? ''),
      phone: client.phone as string | undefined,
      email: client.email as string | undefined,
      habeasDataAcceptedAt: client.habeas_data_accepted_at ? dateToIso(client.habeas_data_accepted_at) : '',
      ip: client.ip as string | undefined,
      userAgent: client.user_agent as string | undefined,
    },
    startTime: dateToIso(doc.start_time),
    endTime: dateToIso(doc.end_time),
    status: (doc.status as Appointment['status']) ?? 'pending_payment',
    paymentStatus: (doc.payment_status as Appointment['paymentStatus']) ?? 'pending',
    cancellation: cancellation
      ? {
        requestedBy: (cancellation.requested_by as NonNullable<Appointment['cancellation']>['requestedBy']),
        requestedAt: dateToIso(cancellation.requested_at),
        reason: cancellation.reason as string | undefined,
        policyApplied: (cancellation.policy_applied as NonNullable<Appointment['cancellation']>['policyApplied']),
        processingFee: moneyToNumber(cancellation.processing_fee),
        refundAmount: moneyToNumber(cancellation.refund_amount),
        refundStatus: (cancellation.refund_status as NonNullable<Appointment['cancellation']>['refundStatus']),
      }
      : undefined,
    needsReassignment: Boolean(doc.needs_reassignment),
    version: intToNumber(doc.version ?? 1),
  };
}

export function blockToDomain(doc: Doc): AvailabilityBlock {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    professionalId: idToStr(doc.professional_id),
    startTime: dateToIso(doc.start_time),
    endTime: dateToIso(doc.end_time),
    reason: doc.reason as string | undefined,
    status: (doc.status as AvailabilityBlock['status']) ?? 'active',
    version: intToNumber(doc.version ?? 1),
  };
}

export function timeSlotToDomain(doc: Doc): TimeSlot {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    professionalId: idToStr(doc.professional_id),
    slotStart: dateToIso(doc.slot_start),
    occupationType: (doc.occupation_type as TimeSlot['occupationType']) ?? 'appointment',
    appointmentId: doc.appointment_id ? idToStr(doc.appointment_id) : undefined,
    blockId: doc.block_id ? idToStr(doc.block_id) : undefined,
    createdAt: dateToIso(doc.created_at),
  };
}

export function paymentToDomain(doc: Doc): PaymentTransaction {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    appointmentId: idToStr(doc.appointment_id),
    provider: String(doc.provider ?? ''),
    providerTransactionId: doc.provider_transaction_id as string | undefined,
    providerEventId: doc.provider_event_id as string | undefined,
    internalReference: String(doc.internal_reference ?? ''),
    operation: (doc.operation as PaymentTransaction['operation']) ?? 'charge',
    amount: moneyToNumber(doc.amount),
    currency: (doc.currency as PaymentTransaction['currency']) ?? 'COP',
    status: (doc.status as PaymentTransaction['status']) ?? 'pending',
    metadata: doc.metadata as Record<string, unknown> | undefined,
    version: intToNumber(doc.version ?? 1),
  };
}

export function ledgerToDomain(doc: Doc): LedgerEntry {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    transactionId: String(doc.transaction_id ?? ''),
    appointmentId: doc.appointment_id ? idToStr(doc.appointment_id) : undefined,
    payoutId: doc.payout_id ? idToStr(doc.payout_id) : undefined,
    paymentTransactionId: doc.payment_transaction_id ? idToStr(doc.payment_transaction_id) : undefined,
    paymentReference: doc.payment_reference as string | undefined,
    type: (doc.type as LedgerEntry['type']) ?? 'payment_approved',
    account: (doc.account as LedgerEntry['account']) ?? 'tenant_balance',
    direction: (doc.direction as LedgerEntry['direction']) ?? 'credit',
    amount: moneyToNumber(doc.amount),
    currency: (doc.currency as LedgerEntry['currency']) ?? 'COP',
    commissionRateSnapshot: doc.commission_rate_snapshot ? moneyToNumber(doc.commission_rate_snapshot) : undefined,
    status: (doc.status as LedgerEntry['status']) ?? 'posted',
    idempotencyKey: doc.idempotency_key as string | undefined,
    source: doc.source as string | undefined,
    sourceEventId: doc.source_event_id as string | undefined,
    metadata: doc.metadata as Record<string, unknown> | undefined,
    timestamp: dateToIso(doc.timestamp),
  };
}

export function notificationToDomain(doc: Doc): Notification {
  return {
    id: idToStr(doc._id),
    tenantId: String(doc.tenant_id ?? ''),
    appointmentId: idToStr(doc.appointment_id),
    channel: (doc.channel as Notification['channel']) ?? 'whatsapp',
    type: (doc.type as Notification['type']) ?? 'confirmation',
    status: (doc.status as Notification['status']) ?? 'pending',
    providerMessageId: doc.provider_message_id as string | undefined,
    attempts: intToNumber(doc.attempts),
    lastError: doc.last_error as string | undefined,
    archived: Boolean(doc.archived),
  };
}

export function tenantUserToDomain(doc: Doc, role: TenantRole): { tenantId: string; keycloakUserId: string; role: TenantRole; status: 'active' | 'revoked'; syncedAt: string } {
  return {
    tenantId: String(doc.tenant_id ?? ''),
    keycloakUserId: String(doc.keycloak_user_id ?? ''),
    role: role,
    status: (doc.status as 'active' | 'revoked') ?? 'active',
    syncedAt: dateToIso(doc.synced_at),
  };
}