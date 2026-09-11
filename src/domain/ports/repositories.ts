import { Appointment, Cancellation } from '../entities/appointment';
import { AvailabilityBlock, TimeSlot } from '../entities/availability';
import { Professional, Service } from '../entities/catalog';
import { LedgerEntry, PaymentTransaction } from '../entities/payments';
import { Notification } from '../entities/notifications';
import { Plan, Tenant } from '../entities/tenant';
import { PlatformUser, TenantUser } from '../entities/notifications';
import { AppointmentStatus, SlotOccupation } from '../entities/types';

export interface Page<T> {
  items: T[];
}

export interface PlanRepository {
  findById(id: string): Promise<Plan | null>;
  findByCode(code: string): Promise<Plan | null>;
  listActive(): Promise<Plan[]>;
  create(plan: Plan, actor: string): Promise<Plan>;
}

export interface TenantRepository {
  findBySlug(slug: string): Promise<Tenant | null>;
  findById(tenantId: string): Promise<Tenant | null>;
  list(includeDeleted?: boolean): Promise<Tenant[]>;
  create(tenant: Tenant, actor: string): Promise<Tenant>;
  update(tenant: Tenant, actor: string): Promise<Tenant>;
  softDelete(tenantId: string, actor: string): Promise<void>;
}

export interface ServiceRepository {
  findByTenant(tenantId: string, includeInactive?: boolean): Promise<Service[]>;
  findById(tenantId: string, id: string): Promise<Service | null>;
  create(service: Service, actor: string): Promise<Service>;
  update(service: Service, expectedVersion: number, actor: string): Promise<Service>;
  softDelete(tenantId: string, id: string, expectedVersion: number, actor: string): Promise<void>;
}

export interface ProfessionalRepository {
  findByTenant(tenantId: string, includeInactive?: boolean): Promise<Professional[]>;
  findById(tenantId: string, id: string): Promise<Professional | null>;
  findByKeycloakUserId(tenantId: string, keycloakUserId: string): Promise<Professional | null>;
  create(professional: Professional, actor: string): Promise<Professional>;
  update(
    professional: Professional,
    expectedVersion: number,
    actor: string,
  ): Promise<Professional>;
  softDelete(
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor: string,
  ): Promise<void>;
}

export interface AppointmentRepository {
  findById(tenantId: string, id: string): Promise<Appointment | null>;
  findByReference(tenantId: string, reference: string): Promise<Appointment | null>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<Appointment | null>;
  findUpcomingByTenant(tenantId: string, from: string, to?: string): Promise<Appointment[]>;
  countByTenant(tenantId: string, since?: string): Promise<number>;
  findByProfessional(tenantId: string, professionalId: string, from: string, to: string): Promise<Appointment[]>;
  findHistoryByClient(
    input: { tenantId: string; clientId?: string; phone?: string; email?: string },
  ): Promise<Appointment[]>;
  create(appointment: Appointment, actor: string): Promise<Appointment>;
  updateStatus(
    tenantId: string,
    id: string,
    expectedVersion: number,
    patch: {
      status: AppointmentStatus;
      paymentStatus?: import('../entities/types').PaymentStatus;
      latestPaymentTransactionId?: string;
      paymentReference?: string;
      cancellation?: Cancellation;
    },
    actor: string,
  ): Promise<Appointment>;
}

export interface AvailabilityBlockRepository {
  findActiveByProfessional(
    tenantId: string,
    professionalId: string,
    from: string,
    to: string,
  ): Promise<AvailabilityBlock[]>;
  create(block: AvailabilityBlock, actor: string): Promise<AvailabilityBlock>;
  updateStatus(tenantId: string, id: string, expectedVersion: number, status: 'active' | 'cancelled', actor: string): Promise<AvailabilityBlock>;
}

export interface TimeSlotRepository {
  findOccupiedWithinRange(
    tenantId: string,
    professionalId: string,
    from: string,
    to: string,
  ): Promise<TimeSlot[]>;
  insertMany(slots: TimeSlot[]): Promise<void>;
  removeForBlock(tenantId: string, blockId: string): Promise<void>;
  removeForAppointment(tenantId: string, appointmentId: string): Promise<void>;
  insertSlotIfFree(slot: TimeSlot): Promise<boolean>;
  occupationByRange(
    tenantId: string,
    professionalIds: string[],
    from: string,
    to: string,
  ): Promise<Map<string, { occupationType: SlotOccupation; start: number; end: number }[]>>;
}

export interface PaymentTransactionRepository {
  findByProviderEvent(provider: string, eventId: string): Promise<PaymentTransaction | null>;
  findByInternalReference(tenantId: string, reference: string): Promise<PaymentTransaction | null>;
  create(transaction: PaymentTransaction, actor: string): Promise<PaymentTransaction>;
  updateStatus(
    tenantId: string,
    id: string,
    expectedVersion: number,
    status: PaymentTransaction['status'],
    options?: {
      providerTransactionId?: string;
      providerEventId?: string;
      actor?: string;
    },
  ): Promise<PaymentTransaction>;
}

export interface LedgerRepository {
  create(entry: LedgerEntry): Promise<LedgerEntry>;
  findByTenant(tenantId: string, limit?: number): Promise<LedgerEntry[]>;
  findByAppointment(tenantId: string, appointmentId: string): Promise<LedgerEntry[]>;
}

export interface NotificationRepository {
  create(notification: Notification): Promise<Notification>;
  markSent(id: string, providerMessageId?: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export interface TenantUserRepository {
  findByKeycloakAndTenant(tenantId: string, keycloakUserId: string): Promise<TenantUser[]>;
  findByIdentity(keycloakUserId: string): Promise<TenantUser[]>;
  createOrUpdate(user: TenantUser): Promise<void>;
}

export interface PlatformUserRepository {
  findByKeycloakUserId(keycloakUserId: string): Promise<PlatformUser | null>;
  create(user: PlatformUser): Promise<void>;
}

export interface AuditLogRepository {
  record(entry: {
    eventId: string;
    tenantId?: string | null;
    collection: string;
    documentId: string;
    operation: 'insert' | 'update' | 'replace' | 'delete';
    actor: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void>;
}