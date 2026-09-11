import { ClientSession, Db } from 'mongodb';
import { ConflictError, NotFoundError } from '../../../../shared/errors';
import { Plan, Tenant } from '../../../../domain/entities';
import { PlanRepository, TenantRepository } from '../../../../domain/ports/repositories';
import { auditCreate, assertUpdated, coll, occUpdate } from './base';
import { bsonId, bsonInt, bsonMoney } from '../bson';
import { planToDomain, tenantToDomain } from '../mappers/mappers';

export interface PlanDoc {
  _id: import('mongodb').ObjectId;
  name: string;
  code: string;
  commission_rate: import('bson').Decimal128;
  fixed_fee: import('bson').Decimal128;
  active: boolean;
  version: import('bson').Int32;
  [key: string]: unknown;
}

export class PlanMongoRepository implements PlanRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'plans');
  }

  async findById(id: string): Promise<Plan | null> {
    const doc = await this.collection.findOne({ _id: bsonId(id) }, { session: this.session });
    return doc ? planToDomain(doc as unknown as PlanDoc) : null;
  }

  async findByCode(code: string): Promise<Plan | null> {
    const doc = await this.collection.findOne({ code }, { session: this.session });
    return doc ? planToDomain(doc as unknown as PlanDoc) : null;
  }

  async listActive(): Promise<Plan[]> {
    const docs = await this.collection.find({ active: true }, { session: this.session }).sort({ name: 1 }).toArray();
    return docs.map((d) => planToDomain(d as unknown as PlanDoc));
  }

  async create(plan: Plan, actor: string): Promise<Plan> {
    const doc = auditCreate(
      {
        name: plan.name,
        code: plan.code,
        commission_rate: bsonMoney(plan.commissionRate),
        fixed_fee: bsonMoney(plan.fixedFee),
        active: plan.active,
      },
      actor,
    );
    try {
      const res = await this.collection.insertOne(doc, { session: this.session });
      return planToDomain({ ...doc, _id: res.insertedId } as unknown as PlanDoc);
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictError('PLAN_EXISTS', `plan code ${plan.code} already exists`);
      }
      throw err;
    }
  }
}

export interface TenantDoc {
  _id: import('mongodb').ObjectId;
  tenant_id: string;
  slug: string;
  name: string;
  plan_id: import('mongodb').ObjectId;
  plan_code: string;
  timezone: string;
  currency: string;
  settings: Record<string, unknown>;
  booking_status: string;
  version: import('bson').Int32;
  [key: string]: unknown;
}

export class TenantMongoRepository implements TenantRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'tenants');
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const doc = await this.collection.findOne(
      { slug, deleted_at: null },
      { session: this.session },
    );
    return doc ? tenantToDomain(doc as unknown as TenantDoc) : null;
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, deleted_at: null },
      { session: this.session },
    );
    return doc ? tenantToDomain(doc as unknown as TenantDoc) : null;
  }

  async list(): Promise<Tenant[]> {
    const docs = await this.collection
      .find({ deleted_at: null }, { session: this.session })
      .sort({ name: 1 })
      .toArray();
    return docs.map((d) => tenantToDomain(d as unknown as TenantDoc));
  }

  async create(tenant: Tenant, actor: string): Promise<Tenant> {
    const plan = await this.collection.db.collection('plans').findOne({ code: tenant.planId }, { session: this.session });
    if (!plan) throw new NotFoundError('Plan', tenant.planId);
    const settings = {
      default_language: tenant.settings.defaultLanguage,
      active_languages: tenant.settings.activeLanguages,
      slot_granularity_minutes: bsonInt(tenant.settings.slotGranularityMinutes),
      cancellation_tolerance_hours: bsonInt(tenant.settings.cancellationToleranceHours),
      payment_timeout_minutes: bsonInt(tenant.settings.paymentTimeoutMinutes),
      advance_payment_percentage: bsonInt(tenant.settings.advancePaymentPercentage),
      preferred_notification_channel: tenant.settings.preferredNotificationChannel,
      reminder_hours: bsonInt(tenant.settings.reminderHours),
      ...(tenant.settings.whatsappPhoneNumberId
        ? { whatsapp_phone_number_id: tenant.settings.whatsappPhoneNumberId }
        : {}),
    };
    const doc = auditCreate(
      {
        tenant_id: tenant.tenantId,
        slug: tenant.slug,
        name: tenant.name,
        plan_id: plan._id,
        plan_code: plan.code as string,
        timezone: tenant.timezone,
        currency: tenant.currency,
        country: tenant.country,
        tagline: tenant.tagline,
        description: tenant.description,
        logo_url: tenant.logoUrl,
        cover_url: tenant.coverUrl,
        address: tenant.address,
        phone: tenant.phone,
        settings,
        booking_status: tenant.bookingStatus,
        deleted_at: null,
      },
      actor,
    );
    try {
      const res = await this.collection.insertOne(doc, { session: this.session });
      return tenantToDomain({ ...doc, _id: res.insertedId } as unknown as TenantDoc);
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictError('TENANT_CONFLICT', `tenant slug/tenant_id already exists`);
      }
      throw err;
    }
  }

  async update(tenant: Tenant, actor: string): Promise<Tenant> {
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(tenant.id) },
      tenant.version,
      {
        name: tenant.name,
        tagline: tenant.tagline,
        description: tenant.description,
        country: tenant.country,
        address: tenant.address,
        phone: tenant.phone,
        logo_url: tenant.logoUrl,
        cover_url: tenant.coverUrl,
        booking_status: tenant.bookingStatus,
      },
      actor,
      this.session,
    );
    assertUpdated(tenant.id, updated);
    const doc = await this.collection.findOne({ _id: bsonId(tenant.id) }, { session: this.session });
    return tenantToDomain((doc ?? updated) as unknown as TenantDoc);
  }

  async softDelete(tenantId: string, actor: string): Promise<void> {
    const tenant = await this.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant', tenantId);
    await occUpdate(
      this.collection,
      { _id: bsonId(tenant.id) },
      tenant.version,
      { deleted_at: new Date() },
      actor,
      this.session,
    );
  }
}