import { ClientSession, Db, ObjectId } from 'mongodb';
import { ConflictError } from '../../../../shared/errors';
import {
  AuditLogRepository,
  PlatformUserRepository,
  PendingRegistrationRepository,
  TenantUserRepository,
  UserProfileRepository,
} from '../../../../domain/ports/repositories';
import { PlatformUser, PendingRegistration, TenantUser, UserProfile } from '../../../../domain/entities';
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

  async findByVerificationToken(token: string): Promise<UserProfile | null> {
    const doc = await this.collection.findOne({ verification_token: token }, { session: this.session });
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
          ...(profile.phoneVerified !== undefined ? { phone_verified: profile.phoneVerified } : {}),
          ...(profile.verificationCodeHash ? { verification_code_hash: profile.verificationCodeHash } : {}),
          ...(profile.codeExpiresAt ? { code_expires_at: new Date(profile.codeExpiresAt) } : {}),
          ...(profile.codeSentAt ? { code_sent_at: new Date(profile.codeSentAt) } : {}),
          ...(profile.verificationToken ? { verification_token: profile.verificationToken } : {}),
          ...(profile.verificationAttempts !== undefined ? { verification_attempts: profile.verificationAttempts } : {}),
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
      phoneVerified: typeof doc.phone_verified === 'boolean' ? doc.phone_verified : undefined,
      verificationCodeHash: typeof doc.verification_code_hash === 'string' ? doc.verification_code_hash : undefined,
      codeExpiresAt: doc.code_expires_at ? new Date(doc.code_expires_at as Date).toISOString() : undefined,
      codeSentAt: doc.code_sent_at ? new Date(doc.code_sent_at as Date).toISOString() : undefined,
      verificationToken: typeof doc.verification_token === 'string' ? doc.verification_token : undefined,
      verificationAttempts: typeof doc.verification_attempts === 'number' ? doc.verification_attempts : undefined,
      updatedAt: new Date(doc.updated_at as Date).toISOString(),
      createdAt: new Date(doc.created_at as Date).toISOString(),
    };
  }
}

export class PendingRegistrationMongoRepository implements PendingRegistrationRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'pending_registrations');
    // TTL de 30 minutos: los registros no verificados se borran solos.
    void this.collection.createIndex({ created_at: 1 }, { expireAfterSeconds: 1800 });
    void this.collection.createIndex({ registration_id: 1 }, { unique: true });
  }

  async create(registration: PendingRegistration): Promise<void> {
    await this.collection.updateOne(
      { registration_id: registration.id },
      {
        $set: {
          email: registration.email,
          phone: registration.phone,
          phone_digits: registration.phoneDigits,
          first_name: registration.firstName,
          last_name: registration.lastName,
          city: registration.city,
          password_encrypted: registration.passwordEncrypted,
          code_hash: registration.codeHash,
          code_expires_at: new Date(registration.codeExpiresAt),
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(registration.createdAt),
        },
      },
      { upsert: true, session: this.session },
    );
  }

  async findById(id: string): Promise<PendingRegistration | null> {
    const doc = await this.collection.findOne({ registration_id: id }, { session: this.session });
    return doc ? this.#toDomain(doc) : null;
  }

  async findByPhone(phoneDigits: string): Promise<PendingRegistration | null> {
    const doc = await this.collection.findOne({ phone_digits: phoneDigits }, { session: this.session });
    return doc ? this.#toDomain(doc) : null;
  }

  async findByEmail(email: string): Promise<PendingRegistration | null> {
    const doc = await this.collection.findOne({ email }, { session: this.session });
    return doc ? this.#toDomain(doc) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const res = await this.collection.deleteOne({ registration_id: id }, { session: this.session });
    return res.deletedCount > 0;
  }

  async deleteByPhone(phoneDigits: string): Promise<boolean> {
    const res = await this.collection.deleteOne({ phone_digits: phoneDigits }, { session: this.session });
    return res.deletedCount > 0;
  }

  async markAsVerified(id: string): Promise<void> {
    await this.collection.updateOne(
      { registration_id: id },
      {
        $set: {
          code_hash: '',
          verification_attempts: 0,
          phone_verified: true,
          updated_at: new Date(),
        },
      },
      { session: this.session },
    );
  }

  async markCompleted(id: string, data: { keycloakUserId: string; completedAt: string }): Promise<void> {
    const completedAt = new Date(data.completedAt);
    await this.collection.updateOne(
      { registration_id: id },
      {
        $set: {
          phone_verified: true,
          code_hash: '',
          // La contraseña ya no se necesita: el usuario existe en Keycloak.
          password_encrypted: '',
          keycloak_user_id: data.keycloakUserId,
          completed_at: completedAt,
          // Extiende la vida del registro (TTL de 30 min) para que el frontend
          // pueda consultar el estado después de completar la verificación.
          created_at: completedAt,
          updated_at: new Date(),
        },
      },
      { session: this.session },
    );
  }

  async incrementAttempts(id: string, attempts: number): Promise<void> {
    await this.collection.updateOne(
      { registration_id: id },
      {
        $set: {
          verification_attempts: attempts,
          updated_at: new Date(),
        },
      },
      { session: this.session },
    );
  }

  #toDomain(doc: Record<string, unknown>): PendingRegistration {
    return {
      id: String(doc.registration_id),
      email: String(doc.email),
      phone: String(doc.phone),
      phoneDigits: String(doc.phone_digits ?? ''),
      firstName: typeof doc.first_name === 'string' ? doc.first_name : '',
      lastName: typeof doc.last_name === 'string' ? doc.last_name : '',
      city: typeof doc.city === 'string' ? doc.city : '',
      passwordEncrypted: typeof doc.password_encrypted === 'string' ? doc.password_encrypted : '',
      codeHash: typeof doc.code_hash === 'string' ? doc.code_hash : '',
      codeExpiresAt: doc.code_expires_at ? new Date(doc.code_expires_at as Date).toISOString() : '',
      createdAt: doc.created_at ? new Date(doc.created_at as Date).toISOString() : '',
      phoneVerified: typeof doc.phone_verified === 'boolean' ? doc.phone_verified : undefined,
      verificationAttempts: typeof doc.verification_attempts === 'number' ? doc.verification_attempts : undefined,
      updatedAt: doc.updated_at ? new Date(doc.updated_at as Date).toISOString() : undefined,
      completedAt: doc.completed_at ? new Date(doc.completed_at as Date).toISOString() : undefined,
      keycloakUserId: typeof doc.keycloak_user_id === 'string' ? doc.keycloak_user_id : undefined,
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