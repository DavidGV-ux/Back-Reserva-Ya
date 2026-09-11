import { ClientSession, Db } from 'mongodb';
import { ConflictError, NotFoundError } from '../../../../shared/errors';
import { Appointment } from '../../../../domain/entities';
import { AppointmentRepository } from '../../../../domain/ports/repositories';
import { assertUpdated, auditCreate, coll, occUpdate } from './base';
import { bsonId, bsonInt, bsonMoney, isoToDate } from '../bson';
import { appointmentToDomain } from '../mappers/mappers';

export class AppointmentMongoRepository implements AppointmentRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'appointments');
  }

  async findById(tenantId: string, id: string): Promise<Appointment | null> {
    const doc = await this.collection.findOne({ tenant_id: tenantId, _id: bsonId(id) }, { session: this.session });
    return doc ? appointmentToDomain(doc) : null;
  }

  async findByReference(tenantId: string, reference: string): Promise<Appointment | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, payment_reference: reference },
      { session: this.session },
    );
    return doc ? appointmentToDomain(doc) : null;
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<Appointment | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, idempotency_key: key },
      { session: this.session },
    );
    return doc ? appointmentToDomain(doc) : null;
  }

  async findUpcomingByTenant(tenantId: string, from: string, to?: string): Promise<Appointment[]> {
    const filter: Record<string, unknown> = {
      tenant_id: tenantId,
      start_time: { $gte: new Date(from) },
      status: { $nin: ['cancelled', 'expired'] },
    };
    if (to) (filter.start_time as Record<string, unknown>).$lt = new Date(to);
    const docs = await this.collection
      .find(filter, { session: this.session })
      .sort({ start_time: 1 })
      .toArray();
    return docs.map((d) => appointmentToDomain(d));
  }

  async countByTenant(tenantId: string, since?: string): Promise<number> {
    const filter: Record<string, unknown> = { tenant_id: tenantId };
    if (since) filter.created_at = { $gte: new Date(since) };
    return this.collection.countDocuments(filter, { session: this.session });
  }

  async findByProfessional(tenantId: string, professionalId: string, from: string, to: string): Promise<Appointment[]> {
    const docs = await this.collection
      .find(
        {
          tenant_id: tenantId,
          professional_id: bsonId(professionalId),
          start_time: { $gte: new Date(from), $lt: new Date(to) },
        },
        { session: this.session },
      )
      .sort({ start_time: 1 })
      .toArray();
    return docs.map((d) => appointmentToDomain(d));
  }

  async findHistoryByClient(input: { tenantId?: string; clientId?: string; phone?: string; email?: string }): Promise<Appointment[]> {
    const or: Array<Record<string, unknown>> = [];
    if (input.clientId) or.push({ 'client_info.client_id': input.clientId });
    if (input.phone) or.push({ 'client_info.phone': input.phone });
    if (input.email) or.push({ 'client_info.email': input.email });
    const filter: Record<string, unknown> = { $or: or };
    if (input.tenantId) filter.tenant_id = input.tenantId;
    const docs = await this.collection
      .find(filter, { session: this.session })
      .sort({ start_time: -1 })
      .limit(100)
      .toArray();
    return docs.map((d) => appointmentToDomain(d));
  }

  async create(appointment: Appointment, actor: string): Promise<Appointment> {
    const planDoc = await this.collection.db.collection('plans').findOne(
      { code: appointment.planIdSnapshot },
      { session: this.session },
    );
    if (!planDoc) throw new NotFoundError('Plan', appointment.planIdSnapshot);

    const doc = auditCreate(
      {
        tenant_id: appointment.tenantId,
        professional_id: bsonId(appointment.professionalId),
        service_id: bsonId(appointment.serviceId),
        service_snapshot: {
          service_id: bsonId(appointment.serviceId),
          name: appointment.serviceSnapshot.name,
          price: bsonMoney(appointment.serviceSnapshot.price),
          currency: appointment.serviceSnapshot.currency,
          duration_minutes: bsonInt(appointment.serviceSnapshot.durationMinutes),
        },
        commission_rate_snapshot: bsonMoney(appointment.commissionRateSnapshot),
        plan_id_snapshot: planDoc._id,
        plan_code_snapshot: planDoc.code,
        idempotency_key: appointment.idempotencyKey,
        source: appointment.source,
        payment_reference: appointment.paymentReference,
        client_info: {
          ...(appointment.clientInfo.clientId ? { client_id: appointment.clientInfo.clientId } : {}),
          name: appointment.clientInfo.name,
          ...(appointment.clientInfo.phone ? { phone: appointment.clientInfo.phone } : {}),
          ...(appointment.clientInfo.email ? { email: appointment.clientInfo.email } : {}),
          habeas_data_accepted_at: isoToDate(appointment.clientInfo.habeasDataAcceptedAt),
          ...(appointment.clientInfo.ip ? { ip: appointment.clientInfo.ip } : {}),
          ...(appointment.clientInfo.userAgent ? { user_agent: appointment.clientInfo.userAgent } : {}),
        },
        start_time: new Date(appointment.startTime),
        end_time: new Date(appointment.endTime),
        status: appointment.status,
        payment_status: appointment.paymentStatus,
        needs_reassignment: appointment.needsReassignment,
      },
      actor,
    );
    try {
      const res = await this.collection.insertOne(doc, { session: this.session });
      return appointmentToDomain({ ...doc, _id: res.insertedId });
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictError('APPOINTMENT_CONFLICT', 'idempotency key or payment reference already used');
      }
      throw err;
    }
  }

  async updateStatus(
    tenantId: string,
    id: string,
    expectedVersion: number,
    patch: {
      status: Appointment['status'];
      paymentStatus?: Appointment['paymentStatus'];
      latestPaymentTransactionId?: string;
      paymentReference?: string;
      cancellation?: Appointment['cancellation'];
    },
    actor: string,
  ): Promise<Appointment> {
    const set: Record<string, unknown> = { status: patch.status };
    if (patch.paymentStatus) set.payment_status = patch.paymentStatus;
    if (patch.latestPaymentTransactionId) {
      set.latest_payment_transaction_id = bsonId(patch.latestPaymentTransactionId);
    }
    if (patch.paymentReference) set.payment_reference = patch.paymentReference;
    if (patch.cancellation) {
      set.cancellation = {
        requested_by: patch.cancellation.requestedBy,
        requested_at: new Date(patch.cancellation.requestedAt),
        ...(patch.cancellation.reason ? { reason: patch.cancellation.reason } : {}),
        policy_applied: patch.cancellation.policyApplied,
        processing_fee: bsonMoney(patch.cancellation.processingFee),
        refund_amount: bsonMoney(patch.cancellation.refundAmount),
        refund_status: patch.cancellation.refundStatus,
      };
    }
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(id), tenant_id: tenantId },
      expectedVersion,
      set,
      actor,
      this.session,
    );
    assertUpdated(id, updated);
    return appointmentToDomain(updated!);
  }
}