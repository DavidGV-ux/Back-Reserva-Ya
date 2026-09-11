import { ClientSession, Db } from 'mongodb';
import { AuditLogRepository, PlatformUserRepository, TenantUserRepository } from '../../../../domain/ports/repositories';
import { PlatformUser, TenantUser } from '../../../../domain/entities';
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