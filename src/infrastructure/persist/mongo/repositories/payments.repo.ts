import { ClientSession, Db } from 'mongodb';
import { ConflictError, NotFoundError } from '../../../../shared/errors';
import { LedgerEntry, PaymentTransaction } from '../../../../domain/entities';
import { LedgerRepository, PaymentTransactionRepository } from '../../../../domain/ports/repositories';
import { assertUpdated, auditCreate, coll, occUpdate } from './base';
import { bsonId, bsonMoney, isDuplicateKeyError } from '../bson';
import { ledgerToDomain, paymentToDomain } from '../mappers/mappers';

export class PaymentTransactionMongoRepository implements PaymentTransactionRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'payment_transactions');
  }

  async findByProviderEvent(provider: string, eventId: string): Promise<PaymentTransaction | null> {
    const doc = await this.collection.findOne(
      { provider, provider_event_id: eventId },
      { session: this.session },
    );
    return doc ? paymentToDomain(doc) : null;
  }

  async findByInternalReference(tenantId: string, reference: string): Promise<PaymentTransaction | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, internal_reference: reference },
      { session: this.session },
    );
    return doc ? paymentToDomain(doc) : null;
  }

  async create(transaction: PaymentTransaction, actor: string): Promise<PaymentTransaction> {
    const doc = auditCreate(
      {
        tenant_id: transaction.tenantId,
        appointment_id: bsonId(transaction.appointmentId),
        provider: transaction.provider,
        ...(transaction.providerTransactionId ? { provider_transaction_id: transaction.providerTransactionId } : {}),
        ...(transaction.providerEventId ? { provider_event_id: transaction.providerEventId } : {}),
        internal_reference: transaction.internalReference,
        operation: transaction.operation,
        amount: bsonMoney(transaction.amount),
        currency: transaction.currency,
        status: transaction.status,
        ...(transaction.metadata ? { metadata: transaction.metadata } : {}),
      },
      actor,
    );
    try {
      const res = await this.collection.insertOne(doc, { session: this.session });
      return paymentToDomain({ ...doc, _id: res.insertedId });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('PAYMENT_DUPLICATE', 'payment transaction already recorded');
      }
      throw err;
    }
  }

  async updateStatus(
    tenantId: string,
    id: string,
    expectedVersion: number,
    status: PaymentTransaction['status'],
    options?: {
      providerTransactionId?: string;
      providerEventId?: string;
      actor?: string;
    },
  ): Promise<PaymentTransaction> {
    const set: Record<string, unknown> = { status };
    if (options?.providerTransactionId) set.provider_transaction_id = options.providerTransactionId;
    if (options?.providerEventId) set.provider_event_id = options.providerEventId;
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(id), tenant_id: tenantId },
      expectedVersion,
      set,
      options?.actor ?? 'payment-gateway',
      this.session,
    );
    assertUpdated(id, updated);
    return paymentToDomain(updated!);
  }
}

export class LedgerMongoRepository implements LedgerRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'ledger');
  }

  async create(entry: LedgerEntry): Promise<LedgerEntry> {
    const doc: Record<string, unknown> = {
      tenant_id: entry.tenantId,
      transaction_id: entry.transactionId,
      ...(entry.appointmentId ? { appointment_id: bsonId(entry.appointmentId) } : {}),
      ...(entry.payoutId ? { payout_id: bsonId(entry.payoutId) } : {}),
      ...(entry.paymentTransactionId ? { payment_transaction_id: bsonId(entry.paymentTransactionId) } : {}),
      ...(entry.paymentReference ? { payment_reference: entry.paymentReference } : {}),
      type: entry.type,
      account: entry.account,
      direction: entry.direction,
      amount: bsonMoney(entry.amount),
      currency: entry.currency,
      ...(entry.commissionRateSnapshot !== undefined
        ? { commission_rate_snapshot: bsonMoney(entry.commissionRateSnapshot) }
        : {}),
      status: entry.status,
      ...(entry.idempotencyKey ? { idempotency_key: entry.idempotencyKey } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.sourceEventId ? { source_event_id: entry.sourceEventId } : {}),
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
      timestamp: new Date(entry.timestamp),
    };
    try {
      const res = await this.collection.insertOne(doc, { session: this.session });
      return ledgerToDomain({ ...doc, _id: res.insertedId });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const existing = await this.collection.findOne(
          { idempotency_key: entry.idempotencyKey ?? entry.transactionId },
          { session: this.session },
        );
        if (existing) return ledgerToDomain(existing);
      }
      throw err;
    }
  }

  async findByTenant(tenantId: string, limit = 100): Promise<LedgerEntry[]> {
    const docs = await this.collection
      .find({ tenant_id: tenantId }, { session: this.session })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => ledgerToDomain(d));
  }

  async findByAppointment(tenantId: string, appointmentId: string): Promise<LedgerEntry[]> {
    const docs = await this.collection
      .find({ tenant_id: tenantId, appointment_id: bsonId(appointmentId) }, { session: this.session })
      .sort({ timestamp: 1 })
      .toArray();
    return docs.map((d) => ledgerToDomain(d));
  }
}

export class NotificationMongoRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'notifications');
  }

  async create(notification: import('../../../../domain/entities').Notification): Promise<import('../../../../domain/entities').Notification> {
    const doc = {
      tenant_id: notification.tenantId,
      appointment_id: bsonId(notification.appointmentId),
      channel: notification.channel,
      type: notification.type,
      status: notification.status,
      attempts: 0,
      archived: false,
      created_at: new Date(),
    };
    const res = await this.collection.insertOne(doc, { session: this.session });
    return {
      ...notification,
      id: String(res.insertedId),
      attempts: 0,
      archived: false,
    };
  }

  async markSent(id: string, providerMessageId?: string): Promise<void> {
    const set: Record<string, unknown> = {
      status: 'sent',
      sent_at: new Date(),
      ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
    };
    await this.collection.updateOne(
      { _id: bsonId(id) },
      { $set: set, $inc: { attempts: 1 } },
      { session: this.session },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.collection.updateOne(
      { _id: bsonId(id) },
      { $set: { status: 'failed', last_error: error }, $inc: { attempts: 1 } },
      { session: this.session },
    );
  }
}