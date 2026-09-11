import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../../shared/errors';
import { Appointment, AvailabilityBlock, BookingIntent } from '../../../domain/entities';
import { AppointmentRepository, AvailabilityBlockRepository, ProfessionalRepository, ServiceRepository, TenantRepository, PlanRepository, TimeSlotRepository } from '../../../domain/ports/repositories';
import { PaymentGatewayProvider } from '../../../domain/ports/gateways';
import { UnitOfWork } from '../../../domain/ports/unit-of-work';
import {
  buildServiceSnapshot,
  clientInfoFrom,
  computeAdvance,
  defaultSource,
} from '../../../domain/rules/booking-rules';
import { applyCancellationPolicy, buildCancellation } from '../../../domain/rules/cancellation-rules';
import { weeklyScheduleForDay } from '../../../domain/rules/availability-rules';
import { utcLocalStartMs } from '../../../shared/timezone';
import { hexId, reference, uuid } from '../../../shared/id';
import { CancellationRequestedBy, AppointmentStatus } from '../../../domain/entities/types';

const OCCUPIED_STATUSES: AppointmentStatus[] = ['confirmed', 'pending_payment'];

export interface BookingResult {
  appointment: Appointment;
  intent: BookingIntent;
  replay: boolean;
}

export class BookingUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      plans: PlanRepository;
      services: ServiceRepository;
      professionals: ProfessionalRepository;
      appointments: AppointmentRepository;
      timeSlots: TimeSlotRepository;
      availabilityBlocks: AvailabilityBlockRepository;
    },
    private readonly uow: UnitOfWork,
    private readonly gateway: PaymentGatewayProvider,
  ) {}

  async createAppointment(input: {
    tenantId: string;
    serviceId: string;
    professionalId: string;
    startTime: string;
    clientInfo: {
      name: string;
      phone?: string;
      email?: string;
      habeasDataConsent: boolean;
      habeasDataConsentAt?: string;
      clientId?: string;
      ip?: string;
      userAgent?: string;
    };
    source?: 'web' | 'whatsapp' | 'admin';
    idempotencyKey?: string;
    actor: string;
  }): Promise<BookingResult> {
    const tenant = await this.repos.tenants.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant', input.tenantId);
    if (tenant.bookingStatus !== 'active') {
      throw new ConflictError('TENANT_NOT_ACTIVE', 'tenant is not accepting bookings');
    }

    const plan = await this.repos.plans.findByCode(tenant.planId);
    if (!plan) throw new NotFoundError('Plan', tenant.planId);

    const service = await this.repos.services.findById(input.tenantId, input.serviceId);
    if (!service || !service.active) throw new NotFoundError('Service', input.serviceId);

    const professional = await this.repos.professionals.findById(input.tenantId, input.professionalId);
    if (!professional || !professional.active || !professional.serviceIds.includes(service.id)) {
      throw new ValidationError('professional does not offer this service', { professionalId: input.professionalId });
    }

    const startMs = new Date(input.startTime).getTime();
    if (!Number.isFinite(startMs)) throw new ValidationError('startTime is invalid');
    if (startMs <= Date.now()) throw new ValidationError('startTime must be in the future');

    const granularity = tenant.settings.slotGranularityMinutes;
    const durationMs = service.durationMinutes * 60_000;
    const endMs = startMs + durationMs;

    const date = new Date(startMs);
    const dayStart = utcLocalStartMs(
      tenant.timezone,
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
    );
    const weekday = new Date(dayStart).getUTCDay();
    const intervals = weeklyScheduleForDay(professional.schedule, weekday);
    if (intervals.length === 0) throw new ValidationError('professional does not work that weekday');
    const withinShift = intervals.some((w) => {
      const [sh = 0, sm = 0] = w.start.split(':').map(Number);
      const [eh = 0, em = 0] = w.end.split(':').map(Number);
      const s = dayStart + ((sh * 60 + sm) / granularity) * granularity * 60_000;
      const e = dayStart + ((eh * 60 + em) / granularity) * granularity * 60_000;
      return startMs >= s && endMs <= e;
    });
    if (!withinShift) throw new ValidationError('requested slot is outside the professional working hours');

    if (startMs % (granularity * 60_000) !== 0) {
      throw new ValidationError(`startTime must be aligned to ${granularity} minute slots`);
    }

    const idempotencyKey = input.idempotencyKey ?? `${input.actor}-${uuid()}`;
    const existing = await this.repos.appointments.findByIdempotencyKey(input.tenantId, idempotencyKey);
    if (existing) {
      return {
        appointment: existing,
        intent: { advanceAmount: computeAdvance({ service, plan, tenantSettings: tenant.settings }), currency: tenant.currency, paymentReference: existing.paymentReference ?? '' },
        replay: true,
      };
    }

    const clientInfo = clientInfoFrom(input.clientInfo);
    const advanceAmount = computeAdvance({ service, plan, tenantSettings: tenant.settings });
    const paymentReference = reference('RSV');

    // Double-check vs blocks and existing appointments before transaction (race is guarded by unique index on time_slots).
    const conflicts = await this.repos.timeSlots.findOccupiedWithinRange(
      input.tenantId,
      professional.id,
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
    );
    if (conflicts.length > 0) {
      throw new ConflictError('AVAILABILITY_CONFLICT', 'slot is no longer available');
    }

    const charge = await this.gateway.createCharge({
      tenantId: input.tenantId,
      appointmentId: '',
      internalReference: paymentReference,
      amount: advanceAmount,
      currency: tenant.currency,
      idempotencyKey,
      metadata: { serviceId: service.id, professionalId: professional.id },
    });

    const now = new Date().toISOString();
    const appointment: Appointment = {
      id: hexId(),
      tenantId: input.tenantId,
      professionalId: professional.id,
      serviceId: service.id,
      serviceSnapshot: buildServiceSnapshot(service),
      commissionRateSnapshot: plan.commissionRate,
      planIdSnapshot: plan.code,
      idempotencyKey,
      source: defaultSource(input.source),
      paymentReference,
      clientInfo,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      status: 'pending_payment',
      paymentStatus: 'pending',
      needsReassignment: false,
      version: 1,
    };

    const result = await this.uow.withTransaction(async (tx) => {
      const created = await tx.appointments.create(appointment, input.actor);
      await tx.paymentTransactions.create(
        {
          id: hexId(),
          tenantId: input.tenantId,
          appointmentId: created.id,
          provider: this.gateway.name,
          providerTransactionId: charge.providerTransactionId,
          internalReference: paymentReference,
          operation: 'charge',
          amount: advanceAmount,
          currency: tenant.currency,
          status: 'pending',
          version: 1,
        },
        input.actor,
      );
      const slotStarts: number[] = [];
      for (let t = startMs; t < endMs; t += granularity * 60_000) slotStarts.push(t);
      await tx.timeSlots.insertMany(
        slotStarts.map((t, i) => ({
          id: hexId(),
          tenantId: input.tenantId,
          professionalId: professional.id,
          slotStart: new Date(t).toISOString(),
          occupationType: 'appointment' as const,
          appointmentId: created.id,
          createdAt: now,
          ...(i === 0 ? {} : { blockId: undefined }),
        })),
      );
      return created;
    }).catch((err: unknown) => {
      if (isDuplicateKey(err)) {
        throw new ConflictError('AVAILABILITY_CONFLICT', 'slot was just booked by another user');
      }
      throw err;
    });

    return {
      appointment: result,
      intent: { advanceAmount, currency: tenant.currency, paymentReference, providerTransactionId: charge.providerTransactionId },
      replay: false,
    };
  }

  async cancelAppointment(input: {
    tenantId: string;
    appointmentId: string;
    requestedBy: CancellationRequestedBy;
    reason?: string;
    actor: string;
  }): Promise<Appointment> {
    const appointment = await this.repos.appointments.findById(input.tenantId, input.appointmentId);
    if (!appointment) throw new NotFoundError('Appointment', input.appointmentId);
    if (['cancelled', 'completed', 'no_show', 'expired'].includes(appointment.status)) {
      throw new ConflictError('APPOINTMENT_TERMINAL', `appointment is already ${appointment.status}`);
    }

    const tenant = await this.repos.tenants.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant', input.tenantId);

    const advanceAmount = appointment.clientInfo ? computeAdvanceFromAppointment(appointment, tenant.settings.advancePaymentPercentage) : 0;
    const decision = applyCancellationPolicy({
      startTime: appointment.startTime,
      cancelledAt: new Date().toISOString(),
      cancellationToleranceHours: tenant.settings.cancellationToleranceHours,
      advanceAmount,
      requestedBy: input.requestedBy,
      processingFeeRate: 0,
      refundRateWithinWindow: 1,
    });

    let refundTransactionId: string | undefined;
    if (decision.refundAmount > 0) {
      const refund = await this.gateway.createRefund({
        tenantId: input.tenantId,
        appointmentId: appointment.id,
        internalReference: `${appointment.paymentReference}-R`,
        amount: decision.refundAmount,
        currency: tenant.currency,
        idempotencyKey: `refund-${appointment.id}`,
      });
      refundTransactionId = refund.providerTransactionId;
    }

    const cancelled = await this.uow.withTransaction(async (tx) => {
      await tx.timeSlots.removeForAppointment(input.tenantId, appointment.id);
      return tx.appointments.updateStatus(input.tenantId, appointment.id, appointment.version, {
        status: 'cancelled',
        paymentStatus: decision.refundAmount > 0 ? 'pending' : appointment.paymentStatus,
        cancellation: buildCancellation(decision, input.requestedBy, input.reason, new Date().toISOString()),
      }, input.actor);
    });

    if (refundTransactionId && decision.refundAmount > 0) {
      await this.uow.withTransaction(async (tx) => {
        return tx.paymentTransactions.create({
          id: hexId(),
          tenantId: input.tenantId,
          appointmentId: appointment.id,
          provider: this.gateway.name,
          providerTransactionId: refundTransactionId,
          internalReference: `${appointment.paymentReference}-R`,
          operation: 'refund',
          amount: decision.refundAmount,
          currency: tenant.currency,
          status: 'pending',
          version: 1,
        }, input.actor);
      });
    }

    return cancelled;
  }

  async getAppointment(tenantId: string, appointmentId: string): Promise<Appointment> {
    const appointment = await this.repos.appointments.findById(tenantId, appointmentId);
    if (!appointment) throw new NotFoundError('Appointment', appointmentId);
    return appointment;
  }

  async createAvailabilityBlock(input: {
    tenantId: string;
    professionalId: string;
    startTime: string;
    endTime: string;
    reason?: string;
    actor: string;
  }): Promise<AvailabilityBlock> {
    const tenant = await this.repos.tenants.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant', input.tenantId);
    const professional = await this.repos.professionals.findById(input.tenantId, input.professionalId);
    if (!professional || !professional.active) {
      throw new NotFoundError('Professional', input.professionalId);
    }
    const startMs = new Date(input.startTime).getTime();
    const endMs = new Date(input.endTime).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new ValidationError('startTime/endTime are invalid');
    }
    if (endMs <= startMs) throw new ValidationError('endTime must be after startTime');
    if (startMs <= Date.now()) throw new ValidationError('startTime must be in the future');
    const granularity = tenant.settings.slotGranularityMinutes;
    if (startMs % (granularity * 60_000) !== 0) {
      throw new ValidationError(`startTime must be aligned to ${granularity} minute slots`);
    }

    const block: AvailabilityBlock = {
      id: hexId(),
      tenantId: input.tenantId,
      professionalId: professional.id,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      reason: input.reason,
      status: 'active',
      version: 1,
    };

    return this.uow.withTransaction(async (tx) => {
      const created = await tx.availabilityBlocks.create(block, input.actor);
      const now = new Date().toISOString();
      const slotStarts: number[] = [];
      for (let t = startMs; t < endMs; t += granularity * 60_000) slotStarts.push(t);
      await tx.timeSlots.insertMany(
        slotStarts.map((t) => ({
          id: hexId(),
          tenantId: input.tenantId,
          professionalId: professional.id,
          slotStart: new Date(t).toISOString(),
          occupationType: 'block' as const,
          blockId: created.id,
          createdAt: now,
        })),
      );
      return created;
    }).catch((err: unknown) => {
      if (isDuplicateKey(err)) {
        throw new ConflictError('AVAILABILITY_CONFLICT', 'block overlaps an existing booking');
      }
      throw err;
    });
  }
}

function computeAdvanceFromAppointment(appointment: Appointment, advancePct: number): number {
  return Math.round((appointment.serviceSnapshot.price * advancePct) / 100 * 100) / 100;
}

function isDuplicateKey(err: unknown): boolean {
  return (
    err instanceof DomainError === false &&
    (err as { code?: number | string })?.code === 11000
  );
}