import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { authRouter } from '../../src/entrypoints/http/routes/auth.routes';
import { errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import { AppServices } from '../../src/application/container';
import { ProfileUseCases } from '../../src/application/usecases/profile/profile.usecases';
import { PendingRegistrationMongoRepository } from '../../src/infrastructure/persist/mongo/repositories/users.repo';
import { KeycloakAdminGateway } from '../../src/infrastructure/auth/keycloak-admin';
import { PendingRegistration, UserProfile } from '../../src/domain/entities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountAuth(profile: Record<string, unknown>, identity: Record<string, unknown>) {
  const services = { profile, identity } as unknown as AppServices;
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter(services));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, services };
}

const registerBody = {
  firstName: 'Ana',
  lastName: 'Perez',
  email: 'ana@test.com',
  phone: '+573001112233',
  city: 'Tunja',
  password: 'secreta123',
  confirmPassword: 'secreta123',
  habeasDataConsent: true,
};

/** Repo en memoria que captura exactamente lo que el usecase intenta persistir. */
function makePendingRepo() {
  const rows = new Map<string, PendingRegistration>();
  const created: PendingRegistration[] = [];
  const repo = {
    rows,
    created,
    async create(r: PendingRegistration) {
      created.push({ ...r });
      rows.set(r.id, { ...r });
    },
    async findById(id: string) {
      return rows.get(id) ?? null;
    },
    async findByPhone(phoneDigits: string) {
      for (const r of rows.values()) if (r.phoneDigits === phoneDigits) return r;
      return null;
    },
    async findByEmail(email: string) {
      for (const r of rows.values()) if (r.email === email) return r;
      return null;
    },
    async deleteById(id: string) {
      return rows.delete(id);
    },
    async deleteByPhone(phoneDigits: string) {
      let deleted = false;
      for (const [id, r] of rows) {
        if (r.phoneDigits === phoneDigits) {
          rows.delete(id);
          deleted = true;
        }
      }
      return deleted;
    },
    async markAsVerified(id: string) {
      const r = rows.get(id);
      if (r) Object.assign(r, { phoneVerified: true, codeHash: '', verificationAttempts: 0 });
    },
    async markCompleted(id: string, data: { keycloakUserId: string; completedAt: string }) {
      const r = rows.get(id);
      if (r) Object.assign(r, data);
    },
    async incrementAttempts(id: string, attempts: number) {
      const r = rows.get(id);
      if (r) (r as any).verificationAttempts = attempts;
    },
  };
  return repo;
}

const profilesRepo = {
  async findByKeycloakUserId() {
    return null;
  },
  async findByPhone() {
    return null;
  },
  async findByVerificationToken() {
    return null;
  },
  async upsert(p: UserProfile) {
    return p;
  },
  async deleteByKeycloakUserId() {
    return false;
  },
};

// ---------------------------------------------------------------------------
// RY-REG-CODE-SELFVERIFY
// ---------------------------------------------------------------------------

describe('RY-REG-CODE-SELFVERIFY — el código nunca se expone al navegador', () => {
  it('RY-REG-CODE-SELFVERIFY · /register no devuelve code', async () => {
    const profile = {
      findByPhone: vi.fn().mockResolvedValue(null),
      requestCode: vi.fn().mockResolvedValue({ id: 'p1', code: '123456', retryAfterSeconds: 0 }),
      completeRegistration: vi.fn(),
    };
    const identity = { findByEmail: vi.fn().mockResolvedValue(null) };
    const { app } = mountAuth(profile, identity);

    const res = await request(app).post('/auth/register').send(registerBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ ok: true, id: 'p1' }));
    expect(res.body).not.toHaveProperty('code');
    expect(JSON.stringify(res.body)).not.toContain('123456');
  });

  it('RY-REG-CODE-SELFVERIFY · /resend-code no devuelve code', async () => {
    const profile = {
      resendCode: vi.fn().mockResolvedValue({ id: 'p1', code: '654321', retryAfterSeconds: 0 }),
    };
    const { app } = mountAuth(profile, {});

    const res = await request(app).post('/auth/resend-code').send({ id: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('code');
    expect(JSON.stringify(res.body)).not.toContain('654321');
  });

  it('RY-REG-CODE-SELFVERIFY · /verify-phone NO usa verifyCodeById (solo finaliza lo ya verificado por el webhook)', async () => {
    const profile = {
      verifyCodeById: vi.fn().mockResolvedValue({ id: 'p1', verified: true }),
      completeRegistration: vi.fn().mockResolvedValue({ keycloakUserId: 'kc-1' }),
    };
    const { app } = mountAuth(profile, {});

    const res = await request(app)
      .post('/auth/verify-phone')
      .send({ id: 'p1', code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, keycloakUserId: 'kc-1' });
    // El código del cliente se ignora: la ruta solo delega en completeRegistration.
    expect(profile.verifyCodeById).not.toHaveBeenCalled();
    expect(profile.completeRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
    );
  });

  it('RY-REG-CODE-SELFVERIFY · el código se publica SOLO por WhatsApp (fuera de banda)', async () => {
    const oldEndpoint = process.env.WHATSAPP_EVENTS_ENDPOINT;
    process.env.WHATSAPP_EVENTS_ENDPOINT = 'http://bot.local/events';
    const fetchSpy = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchSpy);
    const pendings = makePendingRepo();
    const usecases = new ProfileUseCases({
      userProfiles: profilesRepo as any,
      pendingRegistrations: pendings as any,
    });

    try {
      const result = await usecases.requestCode({
        email: 'ana@test.com',
        phone: '+573001112233',
        city: 'Tunja',
        firstName: 'Ana',
        lastName: 'Perez',
        password: 'secreta123',
      });

      const verifyEvents = fetchSpy.mock.calls
        .map((call) => JSON.parse(String(call[1]?.body)))
        .filter((body) => body.type === 'user.verify-code');
      expect(verifyEvents).toHaveLength(1);
      expect(verifyEvents[0].user.phone).toBe('+573001112233');
      expect(verifyEvents[0].user.code).toBe(result.code);
      expect(/^\d{6}$/.test(verifyEvents[0].user.code)).toBe(true);
      // El hash persistido corresponde al código enviado por el bot.
      expect(pendings.created[0]!.codeHash).toBe(
        createHash('sha256').update(result.code).digest('hex'),
      );
    } finally {
      vi.unstubAllGlobals();
      if (oldEndpoint === undefined) delete process.env.WHATSAPP_EVENTS_ENDPOINT;
      else process.env.WHATSAPP_EVENTS_ENDPOINT = oldEndpoint;
    }
  });
});

// ---------------------------------------------------------------------------
// RY-RESEND-IDENTITY-REWRITE
// ---------------------------------------------------------------------------

describe('RY-RESEND-IDENTITY-REWRITE — reenviar código no reescribe identidad', () => {
  it('RY-RESEND-IDENTITY-REWRITE · la ruta solo acepta {id, phone}', async () => {
    const profile = {
      resendCode: vi.fn().mockResolvedValue({ id: 'p1', retryAfterSeconds: 0 }),
    };
    const { app } = mountAuth(profile, {});

    const res = await request(app).post('/auth/resend-code').send({
      id: 'p1',
      phone: '+573004445566',
      email: 'evil@attacker.com',
      firstName: 'Evil',
      lastName: 'Hacker',
      password: 'hacked1234',
      city: 'Hacked',
    });

    expect(res.status).toBe(200);
    expect(profile.resendCode).toHaveBeenCalledWith({
      id: 'p1',
      phone: '+573004445566',
    });
  });

  it('RY-RESEND-IDENTITY-REWRITE · resendCode preserva email, nombre y credencial', async () => {
    const pendings = makePendingRepo();
    const usecases = new ProfileUseCases({
      userProfiles: profilesRepo as any,
      pendingRegistrations: pendings as any,
    });
    const first = await usecases.requestCode({
      email: 'ana@test.com',
      phone: '+573001112233',
      city: 'Tunja',
      firstName: 'Ana',
      lastName: 'Perez',
      password: 'secreta123',
    });
    const before = pendings.rows.get(first.id)!;
    const originalCredential = (before as any).passwordEncrypted ?? (before as any).password;
    // Simular que pasó el cooldown para el reenvío con el mismo número.
    before.createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    await usecases.resendCode({
      id: first.id,
      phone: '',
      email: 'evil@attacker.com',
      firstName: 'Evil',
      lastName: 'Hacker',
      password: 'hacked1234',
      city: 'Hacked',
    } as any);

    const after = pendings.rows.get(first.id)!;
    expect(after.email).toBe('ana@test.com');
    expect(after.firstName).toBe('Ana');
    expect(after.lastName).toBe('Perez');
    expect(after.city).toBe('Tunja');
    expect((after as any).passwordEncrypted ?? (after as any).password).toBe(originalCredential);
  });
});

// ---------------------------------------------------------------------------
// RY-PENDING-PLAINTEXT-PASSWORD
// ---------------------------------------------------------------------------

describe('RY-PENDING-PLAINTEXT-PASSWORD — secreto cifrado en reposo', () => {
  const baseInput = {
    email: 'ana@test.com',
    phone: '+573001112233',
    city: 'Tunja',
    firstName: 'Ana',
    lastName: 'Perez',
    password: 'secreta123',
  };

  it('RY-PENDING-PLAINTEXT-PASSWORD · el pending creado por el usecase no contiene password en plano', async () => {
    const pendings = makePendingRepo();
    const usecases = new ProfileUseCases({
      userProfiles: profilesRepo as any,
      pendingRegistrations: pendings as any,
    });

    await usecases.requestCode(baseInput);

    const persisted = pendings.created[0]! as any;
    expect(persisted.password).toBeUndefined();
    expect(typeof persisted.passwordEncrypted).toBe('string');
    expect(persisted.passwordEncrypted).not.toContain(baseInput.password);
    expect(persisted.passwordEncrypted).not.toBe(baseInput.password);
    expect(persisted.codeHash).toBeTruthy();
  });

  it('RY-PENDING-PLAINTEXT-PASSWORD · el documento Mongo no persiste code ni password plano', async () => {
    const updates: Array<Record<string, any>> = [];
    const collection = {
      async updateOne(_filter: unknown, update: { $set: Record<string, any> }) {
        updates.push(update.$set);
        return {} as any;
      },
      async createIndex() {
        return 'idx';
      },
    };
    const db = { collection: () => collection } as any;
    const repo = new PendingRegistrationMongoRepository(db);
    const registration = {
      id: 'p1',
      email: 'ana@test.com',
      phone: '+573001112233',
      phoneDigits: '573001112233',
      firstName: 'Ana',
      lastName: 'Perez',
      city: 'Tunja',
      password: 'secreta123',
      passwordEncrypted: 'iv:tag:cipher',
      code: '123456',
      codeHash: createHash('sha256').update('123456').digest('hex'),
      codeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    } as unknown as PendingRegistration;

    await repo.create(registration);

    const set = updates[0]!;
    expect(set).not.toHaveProperty('code');
    expect(set).not.toHaveProperty('password');
    expect(set.password_encrypted).toBe('iv:tag:cipher');
    expect(JSON.stringify(set)).not.toContain('secreta123');
    expect(set.code_hash).toBeTruthy();
  });

  it('RY-PENDING-PLAINTEXT-PASSWORD · completeRegistration descifra y entrega la contraseña correcta a Keycloak', async () => {
    const pendings = makePendingRepo();
    const usecases = new ProfileUseCases({
      userProfiles: profilesRepo as any,
      pendingRegistrations: pendings as any,
    });
    const first = await usecases.requestCode(baseInput);
    await usecases.verifyCodeById({ id: first.id, code: first.code });
    const createUser = vi.fn(async () => ({ sub: 'kc-1' }));

    await usecases.completeRegistration({
      id: first.id,
      identity: { createUser },
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@test.com',
        temporaryPassword: 'secreta123',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// RY-EMAIL-VERIFIED-NO-PROOF
// ---------------------------------------------------------------------------

describe('RY-EMAIL-VERIFIED-NO-PROOF — emailVerified nunca se deriva de la contraseña', () => {
  const originalFetch = globalThis.fetch;
  let bodies: any[] = [];

  beforeEach(() => {
    bodies = [];
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/users') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return new Response('', {
          status: 201,
          headers: { location: 'http://keycloak.local/admin/realms/x/users/new-sub' },
        });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  function gateway() {
    return new KeycloakAdminGateway({
      baseUrl: 'http://keycloak.local',
      realm: 'x',
      clientId: 'admin-cli',
      clientSecret: 'secret',
    });
  }

  it('RY-EMAIL-VERIFIED-NO-PROOF · autorregistro: emailVerified=false y requiredActions incluye VERIFY_EMAIL', async () => {
    await gateway().createUser({
      username: 'ry-1',
      email: 'ana@test.com',
      temporaryPassword: 'secreta123',
      persistentPassword: true,
      enabled: true,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].emailVerified).toBe(false);
    expect(bodies[0].requiredActions).toContain('VERIFY_EMAIL');
    expect(bodies[0].credentials[0].temporary).toBe(false);
  });

  it('RY-PENDING-PLAINTEXT-PASSWORD · en producción exige REGISTRATION_ENCRYPTION_KEY (fail-closed)', async () => {
    const { encryptSecret } = await import('../../src/shared/crypto');
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.REGISTRATION_ENCRYPTION_KEY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.REGISTRATION_ENCRYPTION_KEY;
      expect(() => encryptSecret('secreta123')).toThrowError(/REGISTRATION_ENCRYPTION_KEY is required/);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey === undefined) delete process.env.REGISTRATION_ENCRYPTION_KEY;
      else process.env.REGISTRATION_ENCRYPTION_KEY = prevKey;
    }
  });

  it('RY-EMAIL-VERIFIED-NO-PROOF · invitado (temporary): emailVerified=false sin VERIFY_EMAIL', async () => {
    await gateway().createUser({
      username: 'guest-1',
      email: 'invitado@test.com',
      temporaryPassword: 'tempPass123',
      persistentPassword: false,
      requiredActions: ['UPDATE_PROFILE'],
      enabled: true,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].emailVerified).toBe(false);
    expect(bodies[0].requiredActions).not.toContain('VERIFY_EMAIL');
    expect(bodies[0].requiredActions).toContain('UPDATE_PROFILE');
  });
});
