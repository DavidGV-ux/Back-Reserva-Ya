import { ClientSession, Db } from 'mongodb';
import { ConflictError } from '../../../../shared/errors';
import {
  AuditLogRepository,
  PlatformUserRepository,
  TenantUserRepository,
  UserProfileRepository,
} from '../../../../domain/ports/repositories';
import { PlatformUser, TenantUser, UserProfile } from '../../../../domain/entities';
import { coll } from './base';
import { bsonId } from '../bson';
import { tenantUserToDomain } from '../mappers/mappers';

export class TenantUserMongoRepository implements TenantUserRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'tenant_users');
  }

  async findByKeycloakAndTenant(tenantId: string, keycloakUserId: string): Promise<TenantUser[]> {
    const docs = await this.collection
      .find({ tenant_id: tenantId, keycloak_user_id: keycloakUserId }, { session: this.session })
      .toArray();
    return docs.map((d) => tenantUserToDomain(d, d.role as TenantUser['role']));
  }

  async findByIdentity(keycloakUserId: string): Promise<TenantUser[]> {
    const docs = await this.collection
      .find({ keycloak_user_id: keycloakUserId }, { session: this.session })
      .toArray();
    return docs.map((d) => tenantUserToDomain(d, d.role as TenantUser['role']));
  }

  async createOrUpdate(user: TenantUser): Promise<void> {
    // Regla de negocio: un negocio tiene un único dueño. Si se intenta dar de
    // alta un segundo `owner` activo, se rechaza (el mismo dueño sí se refresca).
    if (user.role === 'owner') {
      const existing = await this.collection
        .find(
          {
            tenant_id: user.tenantId,
            role: 'owner',
            status: 'active',
            keycloak_user_id: { $ne: user.keycloakUserId },
          },
          { session: this.session },
        )
        .limit(1)
        .toArray();
      if (existing.length > 0) {
        throw new ConflictError(
          'TENANT_ALREADY_HAS_OWNER',
          `tenant ${user.tenantId} already has an active owner; a business can only have one owner`,
        );
      }
    }
    await this.collection.updateOne(
      {
        tenant_id: user.tenantId,
        keycloak_user_id: user.keycloakUserId,
        role: user.role,
      },
      {
        $set: {
          status: user.status,
          synced_at: new Date(user.syncedAt),
        },
        $setOnInsert: {
          tenant_id: user.tenantId,
          keycloak_user_id: user.keycloakUserId,
          role: user.role,
        },
      },
      { upsert: true, session: this.session },
    );
  }
}

export class PlatformUserMongoRepository implements PlatformUserRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'platform_users');
  }

  async findByKeycloakUserId(keycloakUserId: string): Promise<PlatformUser | null> {
    const doc = await this.collection.findOne({ keycloak_user_id: keycloakUserId }, { session: this.session });
    if (!doc) return null;
    return {
      keycloakUserId: String(doc.keycloak_user_id),
      role: 'admin',
      status: (doc.status as PlatformUser['status']) ?? 'active',
      syncedAt: new Date(doc.synced_at).toISOString(),
    };
  }

  async create(user: PlatformUser): Promise<void> {
    await this.collection.updateOne(
      { keycloak_user_id: user.keycloakUserId },
      {
        $setOnInsert: {
          keycloak_user_id: user.keycloakUserId,
          role: user.role,
          status: user.status,
          synced_at: new Date(user.syncedAt),
        },
      },
      { upsert: true, session: this.session },
    );
  }
}

export class UserProfileMongoRepository implements UserProfileRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'user_profiles');
  }

  async findByKeycloakUserId(keycloakUserId: string): Promise<UserProfile | null> {
    const doc = await this.collection.findOne({ keycloak_user_id: keycloakUserId }, { session: this.session });
    return doc ? this.#toDomain(doc) : null;
  }

  async findByPhone(phoneDigits: string): Promise<UserProfile | null> {
    const doc = await this.collection.findOne({ phone_digits: phoneDigits }, { session: this.session });
    return doc ? this.#toDomain(doc) : null;
  }

  async upsert(profile: UserProfile): Promise<UserProfile> {
    const now = new Date();
    await this.collection.updateOne(
      { keycloak_user_id: profile.keycloakUserId },
      {
        $set: {
          phone: profile.phone,
          phone_digits: profile.phoneDigits,
          city: profile.city ?? '',
          ...(profile.name ? { name: profile.name } : {}),
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.inviteSentAt ? { invite_sent_at: new Date(profile.inviteSentAt) } : {}),
          updated_at: now,
        },
        $setOnInsert: {
          keycloak_user_id: profile.keycloakUserId,
          created_at: now,
        },
      },
      { upsert: true, session: this.session },
    );
    return profile;
  }

  async deleteByKeycloakUserId(keycloakUserId: string): Promise<boolean> {
    const res = await this.collection.deleteOne(
      { keycloak_user_id: keycloakUserId },
      { session: this.session },
    );
    return res.deletedCount > 0;
  }

  #toDomain(doc: Record<string, unknown>): UserProfile {
    return {
      keycloakUserId: String(doc.keycloak_user_id),
      phone: String(doc.phone),
      phoneDigits: String(doc.phone_digits),
      city: doc.city ? String(doc.city) : undefined,
      name: typeof doc.name === 'string' ? doc.name : undefined,
      email: typeof doc.email === 'string' ? doc.email : undefined,
      inviteSentAt: doc.invite_sent_at ? new Date(doc.invite_sent_at as Date).toISOString() : undefined,
      updatedAt: new Date(doc.updated_at as Date).toISOString(),
      createdAt: new Date(doc.created_at as Date).toISOString(),
    };
  }
}

export class AuditLogMongoRepository implements AuditLogRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'audit_logs');
  }

  async record(input: {
    eventId: string;
    tenantId?: string | null;
    collection: string;
    documentId: string;
    operation: 'insert' | 'update' | 'replace' | 'delete';
    actor: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    await this.collection.insertOne(
      {
        event_id: input.eventId,
        ...(input.tenantId ? { tenant_id: input.tenantId } : { tenant_id: null }),
        collection: input.collection,
        document_id: bsonId(input.documentId),
        operation: input.operation,
        actor: input.actor,
        ...(input.before ? { before: input.before } : { before: null }),
        ...(input.after ? { after: input.after } : { after: null }),
        archived: false,
        timestamp: new Date(),
      },
      { session: this.session },
    );
  }
}