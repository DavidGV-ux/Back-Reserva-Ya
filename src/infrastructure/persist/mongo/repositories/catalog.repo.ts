import { ClientSession, Db, ObjectId } from 'mongodb';
import { ConflictError, NotFoundError } from '../../../../shared/errors';
import { Professional, Service } from '../../../../domain/entities';
import { ProfessionalRepository, ServiceRepository } from '../../../../domain/ports/repositories';
import { assertUpdated, auditCreate, coll, occUpdate } from './base';
import { bsonId, bsonInt, bsonMoney } from '../bson';
import { professionalToDomain, serviceToDomain } from '../mappers/mappers';

export class ServiceMongoRepository implements ServiceRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'services');
  }

  async findByTenant(tenantId: string, includeInactive = false): Promise<Service[]> {
    const filter: Record<string, unknown> = { tenant_id: tenantId, deleted_at: null };
    if (!includeInactive) filter.active = true;
    const docs = await this.collection.find(filter, { session: this.session }).sort({ name: 1 }).toArray();
    return docs.map((d) => serviceToDomain(d));
  }

  async findById(tenantId: string, id: string): Promise<Service | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, _id: bsonId(id), deleted_at: null },
      { session: this.session },
    );
    return doc ? serviceToDomain(doc) : null;
  }

  async create(service: Service, actor: string): Promise<Service> {
    const doc = auditCreate(
      {
        tenant_id: service.tenantId,
        name: service.name,
        description: service.description ?? '',
        price: bsonMoney(service.price),
        currency: service.currency,
        duration_minutes: bsonInt(service.durationMinutes),
        active: true,
        deleted_at: null,
      },
      actor,
    );
    const res = await this.collection.insertOne(doc, { session: this.session });
    return serviceToDomain({ ...doc, _id: res.insertedId });
  }

  async update(service: Service, expectedVersion: number, actor: string): Promise<Service> {
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(service.id) },
      expectedVersion,
      {
        name: service.name,
        description: service.description ?? '',
        price: bsonMoney(service.price),
        currency: service.currency,
        duration_minutes: bsonInt(service.durationMinutes),
        active: service.active,
      },
      actor,
      this.session,
    );
    assertUpdated(service.id, updated);
    return serviceToDomain(updated!);
  }

  async softDelete(tenantId: string, id: string, expectedVersion: number, actor: string): Promise<void> {
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(id), tenant_id: tenantId },
      expectedVersion,
      { deleted_at: new Date() },
      actor,
      this.session,
    );
    assertUpdated(id, updated);
  }
}

export class ProfessionalMongoRepository implements ProfessionalRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'professionals');
  }

  async findByTenant(tenantId: string, includeInactive = false): Promise<Professional[]> {
    const filter: Record<string, unknown> = { tenant_id: tenantId, deleted_at: null };
    if (!includeInactive) filter.active = true;
    const docs = await this.collection.find(filter, { session: this.session }).sort({ name: 1 }).toArray();
    return docs.map((d) => professionalToDomain(d));
  }

  async findById(tenantId: string, id: string): Promise<Professional | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, _id: bsonId(id), deleted_at: null },
      { session: this.session },
    );
    return doc ? professionalToDomain(doc) : null;
  }

  async findByKeycloakUserId(tenantId: string, keycloakUserId: string): Promise<Professional | null> {
    const doc = await this.collection.findOne(
      { tenant_id: tenantId, keycloak_user_id: keycloakUserId, deleted_at: null },
      { session: this.session },
    );
    return doc ? professionalToDomain(doc) : null;
  }

  async create(professional: Professional, actor: string): Promise<Professional> {
    const doc = auditCreate(
      {
        tenant_id: professional.tenantId,
        name: professional.name,
        title: professional.title ?? '',
        avatar_url: professional.avatarUrl,
        services_ids: professional.serviceIds.map((s) => bsonId(s)),
        schedule: scheduleToDoc(professional.schedule),
        active: true,
        keycloak_user_id: professional.keycloakUserId ?? null,
        deleted_at: null,
      },
      actor,
    );
    try {
      const res = await this.collection.insertOne(doc, { session: this.session });
      return professionalToDomain({ ...doc, _id: res.insertedId });
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictError('KEYCLOAK_USER_LINKED', 'keycloak_user_id already linked in this tenant');
      }
      throw err;
    }
  }

  async update(professional: Professional, expectedVersion: number, actor: string): Promise<Professional> {
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(professional.id) },
      expectedVersion,
      {
        name: professional.name,
        title: professional.title ?? '',
        avatar_url: professional.avatarUrl,
        services_ids: professional.serviceIds.map((s) => bsonId(s)),
        schedule: scheduleToDoc(professional.schedule),
        active: professional.active,
        keycloak_user_id: professional.keycloakUserId ?? null,
      },
      actor,
      this.session,
    );
    assertUpdated(professional.id, updated);
    return professionalToDomain(updated!);
  }

  async softDelete(tenantId: string, id: string, expectedVersion: number, actor: string): Promise<void> {
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(id), tenant_id: tenantId },
      expectedVersion,
      { deleted_at: new Date() },
      actor,
      this.session,
    );
    assertUpdated(id, updated);
  }
}

function scheduleToDoc(schedule: Professional['schedule']): Record<string, Array<{ start: string; end: string }>> {
  return {
    monday: schedule.monday,
    tuesday: schedule.tuesday,
    wednesday: schedule.wednesday,
    thursday: schedule.thursday,
    friday: schedule.friday,
    saturday: schedule.saturday,
    sunday: schedule.sunday,
  };
}

export { ObjectId };