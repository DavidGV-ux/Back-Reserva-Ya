import { describe, it, expect, beforeEach } from 'vitest';
import { ProfileUseCases } from '../../src/application/usecases/profile/profile.usecases';
import { PendingRegistration, UserProfile } from '../../src/domain/entities';
import { ValidationError, ConflictError } from '../../src/shared/errors';

/** Repositorio en memoria para pending_registrations. */
class PendingInMemory {
  rows = new Map<string, PendingRegistration>();

  async create(r: PendingRegistration): Promise<void> {
    this.rows.set(r.id, { ...r });
  }
  async findById(id: string): Promise<PendingRegistration | null> {
    return this.rows.get(id) ?? null;
  }
  async findByPhone(phoneDigits: string): Promise<PendingRegistration | null> {
    for (const r of this.rows.values()) if (r.phoneDigits === phoneDigits) return r;
    return null;
  }
  async findByEmail(email: string): Promise<PendingRegistration | null> {
    for (const r of this.rows.values()) if (r.email === email) return r;
    return null;
  }
  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
  async deleteByPhone(phoneDigits: string): Promise<boolean> {
    let deleted = false;
    for (const [id, r] of this.rows) {
      if (r.phoneDigits === phoneDigits) {
        this.rows.delete(id);
        deleted = true;
      }
    }
    return deleted;
  }
  async markAsVerified(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { phoneVerified: true, codeHash: '', verificationAttempts: 0 });
  }
  async markCompleted(id: string, data: { keycloakUserId: string; completedAt: string }): Promise<void> {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { keycloakUserId: data.keycloakUserId, completedAt: data.completedAt });
  }
  async incrementAttempts(id: string, attempts: number): Promise<void> {
    const r = this.rows.get(id);
    if (r) (r as any).verificationAttempts = attempts;
  }
}

class ProfilesInMemory {
  rows = new Map<string, UserProfile>();
  async findByKeycloakUserId(id: string): Promise<UserProfile | null> {
    return this.rows.get(id) ?? null;
  }
  async findByPhone(digits: string): Promise<UserProfile | null> {
    for (const p of this.rows.values()) if (p.phoneDigits === digits) return p;
    return null;
  }
  async findByVerificationToken(token: string): Promise<UserProfile | null> {
    for (const p of this.rows.values()) if (p.verificationToken === token) return p;
    return null;
  }
  async upsert(p: UserProfile): Promise<UserProfile> {
    this.rows.set(p.keycloakUserId, { ...p });
    return p;
  }
  async deleteByKeycloakUserId(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}

const baseInput = {
  email: 'loop@test.com',
  phone: '+573001112233',
  city: 'Tunja',
  firstName: 'Ana',
  lastName: 'Perez',
  password: 'secreta123',
};

describe('ProfileUseCases — reintento de registro (bucle de verificación)', () => {
  let pendings: PendingInMemory;
  let profiles: ProfilesInMemory;
  let usecases: ProfileUseCases;

  beforeEach(() => {
    pendings = new PendingInMemory();
    profiles = new ProfilesInMemory();
    usecases = new ProfileUseCases({ userProfiles: profiles, pendingRegistrations: pendings as any });
  });

  it('permite reintentar el registro con los mismos datos sin cooldown y conserva el id', async () => {
    const first = await usecases.requestCode(baseInput);
    // Sin esperar cooldown: segundo intento inmediato.
    const second = await usecases.requestCode(baseInput);
    expect(second.id).toBe(first.id);
    expect(second.alreadyVerified).toBeFalsy();
    // Solo existe un pending para el teléfono.
    const rows = [...pendings.rows.values()].filter((r) => r.phoneDigits === '573001112233');
    expect(rows).toHaveLength(1);
  });

  it('regenera el código si el reintento llega con el código ya expirado', async () => {
    const first = await usecases.requestCode(baseInput);
    // Simular expiración del código.
    const row = pendings.rows.get(first.id)!;
    row.codeExpiresAt = new Date(Date.now() - 1000).toISOString();
    const second = await usecases.requestCode(baseInput);
    expect(second.id).toBe(first.id);
    expect(second.code).not.toBe(first.code);
    const updated = pendings.rows.get(first.id)!;
    expect(new Date(updated.codeExpiresAt).getTime()).toBeGreaterThan(Date.now());
    // El código nuevo verifica correctamente.
    const res = await usecases.verifyCodeById({ id: first.id, code: second.code });
    expect(res.verified).toBe(true);
  });

  it('resetea los intentos fallidos al reanudar el registro', async () => {
    const first = await usecases.requestCode(baseInput);
    // 5 intentos fallidos del código por WhatsApp.
    for (let i = 0; i < 5; i++) {
      await expect(
        usecases.verifyCodeById({ id: first.id, code: '000000' === first.code ? '111111' : '000000' }),
      ).rejects.toThrowError(ValidationError);
    }
    await expect(
      usecases.verifyCodeById({ id: first.id, code: '000000' === first.code ? '111111' : '000000' }),
    ).rejects.toThrowError(/too many attempts/i);
    // Re-registro con los mismos datos: reanuda y limpia los intentos.
    const resumed = await usecases.requestCode(baseInput);
    expect(resumed.id).toBe(first.id);
    const row = pendings.rows.get(first.id)!;
    expect((row as any).verificationAttempts ?? 0).toBeLessThan(5);
    // Y el código correcto ahora verifica.
    const ok = await usecases.verifyCodeById({ id: first.id, code: row.code });
    expect(ok.verified).toBe(true);
  });

  it('rechaza con cooldown solo si cambian los datos (mismo teléfono)', async () => {
    await usecases.requestCode(baseInput);
    await expect(
      usecases.requestCode({ ...baseInput, email: 'otro@test.com' }),
    ).rejects.toThrowError(ConflictError);
  });

  it('permite cambiar el número en el formulario: teléfono nuevo crea registro nuevo sin cooldown', async () => {
    await usecases.requestCode(baseInput);
    const changed = await usecases.requestCode({ ...baseInput, phone: '+573004445566' });
    expect(changed.id).not.toBe('');
    expect(changed.alreadyVerified).toBeFalsy();
    const old = await pendings.findByPhone('573001112233');
    const neu = await pendings.findByPhone('573004445566');
    expect(old).toBeTruthy();
    expect(neu).toBeTruthy();
  });

  it('resend-code funciona sin enviar teléfono (usa el del pending) tras el cooldown', async () => {
    const first = await usecases.requestCode(baseInput);
    // Dentro del cooldown aún: rechaza.
    await expect(usecases.resendCode({ id: first.id, phone: '' })).rejects.toThrowError(ConflictError);
    // Simular que pasó el cooldown.
    const row = pendings.rows.get(first.id)!;
    row.createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const resent = await usecases.resendCode({ id: first.id, phone: '' });
    expect(resent.id).toBe(first.id);
    expect(resent.code).not.toBe(first.code);
  });

  it('resend-code permite corregir el número de inmediato (sin cooldown) y resetea intentos', async () => {
    const first = await usecases.requestCode(baseInput);
    // Quemar intentos.
    for (let i = 0; i < 5; i++) {
      await expect(
        usecases.verifyCodeById({ id: first.id, code: first.code === '000000' ? '111111' : '000000' }),
      ).rejects.toThrowError(ValidationError);
    }
    const changed = await usecases.resendCode({ id: first.id, phone: '+573007778899' });
    expect(changed.id).toBe(first.id);
    const row = pendings.rows.get(first.id)!;
    expect(row.phoneDigits).toBe('573007778899');
    expect((row as any).verificationAttempts ?? 0).toBeLessThan(5);
  });

  it('un pending ya verificado acepta reenviar el código por WhatsApp y completa sin error de código', async () => {
    const first = await usecases.requestCode(baseInput);
    await usecases.verifyCodeById({ id: first.id, code: first.code });
    // El bot reenvía el mismo código (usuario volvió a escanear el QR):
    // no debe fallar por INVALID_CODE, debe permitir completar.
    const res = await usecases.verifyCodeById({ id: first.id, code: first.code });
    expect(res.verified).toBe(true);
    const { keycloakUserId } = await usecases.completeRegistration({
      id: first.id,
      identity: {
        createUser: async () => ({ sub: 'kc-123' }),
      },
    });
    expect(keycloakUserId).toBe('kc-123');
  });

  it('completeRegistration ya no falla por CODE_EXPIRED cuando la verificación fue exitosa', async () => {
    const first = await usecases.requestCode(baseInput);
    await usecases.verifyCodeById({ id: first.id, code: first.code });
    // El código expira justo después de verificar (creación de Keycloak falló y se reintenta tarde).
    const row = pendings.rows.get(first.id)!;
    row.codeExpiresAt = new Date(Date.now() - 1000).toISOString();
    const { keycloakUserId } = await usecases.completeRegistration({
      id: first.id,
      identity: { createUser: async () => ({ sub: 'kc-456' }) },
    });
    expect(keycloakUserId).toBe('kc-456');
  });

  it('requestCode marca alreadyVerified cuando el pending está verificado pero no completado', async () => {
    const first = await usecases.requestCode(baseInput);
    await usecases.verifyCodeById({ id: first.id, code: first.code });
    // El usuario vuelve a enviarse el formulario (página atascada).
    const second = await usecases.requestCode(baseInput);
    expect(second.alreadyVerified).toBe(true);
    expect(second.id).toBe(first.id);
  });
});
