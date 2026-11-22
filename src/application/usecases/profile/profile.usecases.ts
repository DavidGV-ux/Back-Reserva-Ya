import { createHash, randomBytes, randomInt } from 'node:crypto';
import { UserProfileRepository, PendingRegistrationRepository } from '../../../domain/ports/repositories';
import { UserProfile, PendingRegistration } from '../../../domain/entities';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { normalizePhoneE164 } from '../../../shared/phone';
import { decryptSecret, encryptSecret } from '../../../shared/crypto';
import { publishPhoneVerificationCode, publishUserInvite } from '../../../entrypoints/http/whatsapp-events';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const RESEND_COOLDOWN_MS = 4 * 60 * 1000; // 4 min
const MAX_ATTEMPTS = 5;

export class ProfileUseCases {
  constructor(
    private readonly repos: {
      userProfiles: UserProfileRepository;
      pendingRegistrations: PendingRegistrationRepository;
    },
  ) {}

  async get(keycloakUserId: string): Promise<UserProfile | null> {
    return this.repos.userProfiles.findByKeycloakUserId(keycloakUserId);
  }

  async findByPhone(phone: string): Promise<UserProfile | null> {
    const digits = phone.replace(/[^0-9]/g, '');
    return this.repos.userProfiles.findByPhone(digits);
  }

  async getVerificationByToken(token: string): Promise<UserProfile | null> {
    return this.repos.userProfiles.findByVerificationToken(token);
  }

  async remove(keycloakUserId: string): Promise<boolean> {
    return this.repos.userProfiles.deleteByKeycloakUserId(keycloakUserId);
  }

  /**
   * Guarda el teléfono del usuario ya verificado (después de completar el registro).
   * El teléfono es el que dispara el envío de la invitación de WhatsApp.
   */
  async save(input: {
    keycloakUserId: string;
    phone: string;
    city?: string;
    name?: string;
    email?: string;
  }): Promise<UserProfile> {
    const phone = normalizePhoneE164(input.phone);
    if (!phone) {
      throw new ValidationError('phone is not a valid E.164 number', { phone: input.phone });
    }
    const city = String(input.city ?? '').trim();
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    const existing = await this.repos.userProfiles.findByKeycloakUserId(input.keycloakUserId);

    const profile: UserProfile = {
      keycloakUserId: input.keycloakUserId,
      phone,
      phoneDigits,
      city,
      name: input.name,
      email: input.email,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    // Evitar duplicar el envío de la invitación en cada guardado.
    if (existing?.inviteSentAt) {
      delete profile.inviteSentAt;
    } else {
      const sent = await this.#sendInvite(profile);
      if (sent) profile.inviteSentAt = new Date().toISOString();
    }

    await this.repos.userProfiles.upsert(profile);
    return profile;
  }

  /**
   * Paso 1 del registro: valida los datos, genera el código de 6 dígitos y lo
   * guarda en pending_registrations (TTL 30 min). NO crea usuario en Keycloak
   * ni guarda nada en user_profiles hasta verificar WhatsApp.
   * El código se entrega SOLO al bot de WhatsApp (fuera de banda), nunca al cliente.
   *
   * Reintentos: si el mismo usuario (mismo email + contraseña) vuelve a
   * registrarse con el mismo teléfono y aún no está verificado, se REANUDA el
   * registro pendiente (mismo id y código vigente, o código nuevo si expiró)
   * sin aplicar cooldown. Así la página nunca queda atascada: puede volver a
   * escanear el QR o corregir el número (teléfono distinto => registro nuevo).
   */
  async requestCode(input: {
    email: string;
    phone: string;
    city?: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<{ id: string; code: string; retryAfterSeconds: number; alreadyVerified?: boolean }> {
    const phone = normalizePhoneE164(input.phone);
    if (!phone) {
      throw new ValidationError('phone is not a valid E.164 number', { phone: input.phone });
    }
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    const email = input.email.toLowerCase().trim();

    // Si ya hay un pending para este teléfono, decidir: reanudar, limpiar o cooldown.
    const existingPending = await this.repos.pendingRegistrations.findByPhone(phoneDigits);
    if (existingPending) {
      if (existingPending.completedAt) {
        // Registro ya completado: limpiar y crear uno nuevo (el route ya validó
        // contra user_profiles/Keycloak).
        await this.repos.pendingRegistrations.deleteByPhone(phoneDigits);
      } else {
        const samePerson =
          existingPending.email === email &&
          decryptSecret(existingPending.passwordEncrypted) === input.password;
        if (samePerson && existingPending.phoneVerified === true) {
          // Verificado por WhatsApp pero no completado (p. ej. falló la creación
          // en Keycloak): devolver el id para que el route complete el registro.
          return {
            id: existingPending.id,
            code: existingPending.code ?? '',
            retryAfterSeconds: 0,
            alreadyVerified: true,
          };
        }
        if (samePerson) {
          // Reintento legítimo: reanudar sin cooldown, reseteando los intentos
          // fallidos y extendiendo el TTL (misma fila, mismo id).
          const codeStillValid =
            Boolean(existingPending.code) &&
            Boolean(existingPending.codeExpiresAt) &&
            new Date(existingPending.codeExpiresAt).getTime() > Date.now();
          const code: string = codeStillValid
            ? existingPending.code ?? ''
            : String(randomInt(0, 1_000_000)).padStart(6, '0');
          const now = Date.now();
          await this.repos.pendingRegistrations.deleteById(existingPending.id);
          await this.repos.pendingRegistrations.create({
            ...existingPending,
            email,
            phone,
            phoneDigits,
            code,
            codeHash: createHash('sha256').update(code).digest('hex'),
            codeExpiresAt: new Date(now + CODE_TTL_MS).toISOString(),
            createdAt: new Date(now).toISOString(),
            phoneVerified: undefined,
            verificationAttempts: 0,
          });
          await publishPhoneVerificationCode({ phone, code, name: existingPending.firstName });
          return { id: existingPending.id, code, retryAfterSeconds: 0 };
        }
        // Datos distintos para el mismo teléfono: mantener el cooldown anti-spam.
        const now = Date.now();
        const elapsed = now - new Date(existingPending.createdAt).getTime();
        if (elapsed < RESEND_COOLDOWN_MS) {
          throw new ConflictError('CODE_RATE_LIMITED', 'code recently sent, please wait', {
            retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
          });
        }
        await this.repos.pendingRegistrations.deleteByPhone(phoneDigits);
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const id = randomBytes(16).toString('hex');
    const now = Date.now();
    const registration: PendingRegistration = {
      id,
      email,
      phone,
      phoneDigits,
      firstName: input.firstName,
      lastName: input.lastName,
      city: input.city ?? '',
      passwordEncrypted: encryptSecret(input.password),
      code,
      codeHash,
      codeExpiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    };

    await this.repos.pendingRegistrations.create(registration);
    // Entrega fuera de banda: el código NUNCA se devuelve al navegador.
    await publishPhoneVerificationCode({ phone, code, name: input.firstName });

    return { id, code, retryAfterSeconds: 0 };
  }

  /**
   * Reenvía el código para un registro pendiente.
   * - Si no llega `phone`, se reutiliza el teléfono del registro pendiente
   *   (así el botón "Reenviar código" del frontend funciona sin enviar nada más).
   * - Si llega un teléfono DISTINTO (corregir número mal digitado), el cambio se
   *   aplica de inmediato sin esperar el cooldown.
   * - El cooldown de 4 min solo aplica al reenvío con el MISMO número.
   * En todos los casos se resetean los intentos fallidos (se recrea la fila).
   */
  async resendCode(input: {
    id: string;
    phone?: string;
  }): Promise<{ id: string; code: string; retryAfterSeconds: number }> {
    const existing = await this.repos.pendingRegistrations.findById(input.id);
    if (!existing) {
      throw new ValidationError('no pending registration', { code: 'NO_PENDING_REGISTRATION' });
    }
    if (existing.completedAt) {
      throw new ValidationError('registration already completed', { code: 'ALREADY_COMPLETED' });
    }

    const rawPhone = input.phone?.trim() ? input.phone : existing.phone;
    const phone = normalizePhoneE164(rawPhone);
    if (!phone) {
      throw new ValidationError('phone is not a valid E.164 number', { phone: rawPhone });
    }
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    const changingNumber = phoneDigits !== existing.phoneDigits;

    if (changingNumber) {
      // Evitar duplicar pendientes para el nuevo número. Si otro registro
      // pendiente ya usa ese teléfono con otro correo, no secuestrarlo.
      const conflict = await this.repos.pendingRegistrations.findByPhone(phoneDigits);
      if (conflict && !conflict.completedAt && conflict.id !== existing.id) {
        if (conflict.email === existing.email) {
          await this.repos.pendingRegistrations.deleteByPhone(phoneDigits);
        } else {
          throw new ConflictError('PHONE_TAKEN', 'phone is already in another pending registration');
        }
      }
    } else {
      const now = Date.now();
      const elapsed = now - new Date(existing.createdAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new ConflictError('CODE_RATE_LIMITED', 'code recently sent, please wait', {
          retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
        });
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const updated: PendingRegistration = {
      ...existing,
      phone,
      phoneDigits,
      code,
      codeHash,
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      createdAt: new Date(Date.now()).toISOString(),
      // Reenviar reinicia el flujo de verificación: limpiar estado previo.
      phoneVerified: undefined,
      verificationAttempts: 0,
    };

    await this.repos.pendingRegistrations.deleteById(existing.id);
    await this.repos.pendingRegistrations.create(updated);
    await publishPhoneVerificationCode({ phone, code, name: existing.firstName });

    return { id: updated.id, code, retryAfterSeconds: 0 };
  }

  /**
   * Paso 2 del registro: valida el código de 6 dígitos enviado por WhatsApp.
   * Si es válido, MARCA el registro pendiente como verificado (pero aún no crea
   * el usuario en Keycloak ni en user_profiles).
   */
  async verifyCodeByPhone(input: { phone: string; code: string }): Promise<{ id: string; verified: boolean }> {
    const phoneDigits = input.phone.replace(/[^0-9]/g, '');
    const registration = await this.repos.pendingRegistrations.findByPhone(phoneDigits);
    return this.verifyPendingCode(registration, input.code);
  }

  /**
   * Valida el código de 6 dígitos contra un registro pendiente por su id.
   * Usado por el endpoint /verify-phone.
   */
  async verifyCodeById(input: { id: string; code: string }): Promise<{ id: string; verified: boolean }> {
    const registration = await this.repos.pendingRegistrations.findById(input.id);
    return this.verifyPendingCode(registration, input.code);
  }

  /**
   * Valida el código de 6 dígitos contra un registro pendiente por teléfono.
   * Usado por el webhook de WhatsApp. Retorna el id para completar el registro.
   */
  async verifyPendingByPhone(input: { phone: string; code: string }): Promise<{ id: string; verified: boolean }> {
    const phoneDigits = input.phone.replace(/[^0-9]/g, '');
    const registration = await this.repos.pendingRegistrations.findByPhone(phoneDigits);
    return this.verifyPendingCode(registration, input.code);
  }

  /**
   * Obtiene un registro pendiente por su id (para polling de estado).
   */
  async getPendingById(id: string): Promise<PendingRegistration | null> {
    return this.repos.pendingRegistrations.findById(id);
  }

  private async verifyPendingCode(registration: PendingRegistration | null, code: string): Promise<{ id: string; verified: boolean }> {
    if (!registration) {
      throw new ValidationError('no pending registration', { code: 'NO_PENDING_REGISTRATION' });
    }
    if (registration.completedAt) {
      throw new ValidationError('registration already completed', { code: 'ALREADY_COMPLETED' });
    }
    // Ya verificado pero no completado (p. ej. falló la creación en Keycloak):
    // reenviar el mismo código por WhatsApp no debe quedar en "código inválido";
    // se permite continuar para completar el registro.
    if (registration.phoneVerified === true) {
      return { id: registration.id, verified: true };
    }
    if (new Date(registration.codeExpiresAt).getTime() < Date.now()) {
      throw new ValidationError('code expired', { code: 'CODE_EXPIRED' });
    }
    const attempts = (registration as any).verificationAttempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      throw new ValidationError('too many attempts', { code: 'TOO_MANY_ATTEMPTS' });
    }
    const hash = createHash('sha256').update(code.trim()).digest('hex');
    if (hash !== registration.codeHash) {
      await this.repos.pendingRegistrations.incrementAttempts(registration.id, attempts + 1);
      throw new ValidationError('invalid code', { code: 'INVALID_CODE' });
    }

    // Marcar como verificado (limpiar hash para que no se pueda reusar).
    await this.repos.pendingRegistrations.markAsVerified(registration.id);

    return { id: registration.id, verified: true };
  }

  /**
   * Paso 3 del registro: crea el usuario en Keycloak y en user_profiles
   * SOLO si el registro pendiente está verificado.
   */
  async completeRegistration(input: {
    id: string;
    identity: {
      createUser: (input: {
        username: string;
        email: string;
        firstName: string;
        lastName: string;
        temporaryPassword: string;
        persistentPassword: boolean;
        requiredActions: string[];
        enabled: boolean;
      }) => Promise<{ sub: string }>;
    };
  }): Promise<{ keycloakUserId: string }> {
    const registration = await this.repos.pendingRegistrations.findById(input.id);
    if (!registration) {
      throw new ValidationError('no pending registration', { code: 'NO_PENDING_REGISTRATION' });
    }
    // Idempotencia: si el registro ya se completó, devolver el usuario creado
    // (por ejemplo, si el webhook reintenta la llamada).
    if (registration.completedAt && registration.keycloakUserId) {
      return { keycloakUserId: registration.keycloakUserId };
    }
    if (!(registration as any).phoneVerified || (registration as any).codeHash !== '') {
      throw new ValidationError('phone not verified', { code: 'PHONE_NOT_VERIFIED' });
    }

    const username = `ry-${randomBytes(4).toString('hex')}`;
    const created = await input.identity.createUser({
      username,
      email: registration.email,
      firstName: registration.firstName,
      lastName: registration.lastName,
      temporaryPassword: decryptSecret(registration.passwordEncrypted),
      persistentPassword: true,
      requiredActions: [],
      enabled: true, // ya está verificado por WhatsApp
    });

    const profile: UserProfile = {
      keycloakUserId: created.sub,
      phone: registration.phone,
      phoneDigits: registration.phoneDigits,
      city: registration.city,
      name: registration.firstName,
      email: registration.email,
      phoneVerified: true,
      updatedAt: new Date().toISOString(),
      createdAt: registration.createdAt,
    };
    await this.repos.userProfiles.upsert(profile);

    // Enviar invitación de bienvenida por WhatsApp.
    const sent = await this.#sendInvite(profile);
    if (sent) {
      await this.repos.userProfiles.upsert({
        ...profile,
        inviteSentAt: new Date().toISOString(),
      });
    }

    // Marcar como completado (no borrar de inmediato): el frontend consulta
    // verify-status para iniciar sesión automáticamente. El TTL lo limpia después.
    await this.repos.pendingRegistrations.markCompleted(input.id, {
      keycloakUserId: created.sub,
      completedAt: new Date().toISOString(),
    });

    return { keycloakUserId: created.sub };
  }

  /**
   * Verifica el código de 6 dígitos contra un usuario ya existente (flujo
   * legacy: cambiar teléfono de un usuario ya registrado).
   */
  async verifyCode(input: { keycloakUserId: string; code: string }): Promise<UserProfile> {
    const existing = await this.repos.userProfiles.findByKeycloakUserId(input.keycloakUserId);
    return this.verifyAndMark(existing, input.code);
  }

  private async verifyAndMark(profile: UserProfile | null, code: string): Promise<UserProfile> {
    if (!profile || !profile.verificationCodeHash || !profile.codeExpiresAt) {
      throw new ValidationError('no verification pending', { code: 'NO_PENDING_CODE' });
    }
    if (profile.phoneVerified) {
      return profile;
    }
    if (new Date(profile.codeExpiresAt).getTime() < Date.now()) {
      throw new ValidationError('code expired', { code: 'CODE_EXPIRED' });
    }
    const attempts = profile.verificationAttempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      throw new ValidationError('too many attempts', { code: 'TOO_MANY_ATTEMPTS' });
    }
    const hash = createHash('sha256').update(code.trim()).digest('hex');
    if (hash !== profile.verificationCodeHash) {
      await this.repos.userProfiles.upsert({
        ...profile,
        verificationAttempts: attempts + 1,
        updatedAt: new Date().toISOString(),
      });
      throw new ValidationError('invalid code', { code: 'INVALID_CODE' });
    }
    const verified: UserProfile = {
      ...profile,
      phoneVerified: true,
      verificationCodeHash: undefined,
      codeExpiresAt: undefined,
      verificationToken: undefined,
      verificationAttempts: 0,
      updatedAt: new Date().toISOString(),
    };
    const sent = await this.#sendInvite(verified);
    if (sent) verified.inviteSentAt = new Date().toISOString();
    await this.repos.userProfiles.upsert(verified);
    return verified;
  }

  /**
   * Cambia el número pendiente de verificación y reenvía el código (sujeto
   * al cooldown de 4 minutos).
   */
  async changePhone(input: {
    keycloakUserId: string;
    phone: string;
    city?: string;
    name?: string;
    email?: string;
  }): Promise<{ id: string; code: string; retryAfterSeconds: number }> {
    // changePhone no aplica a registros pendientes; se usa para usuarios
    // ya verificados que quieren cambiar su teléfono.
    const phone = normalizePhoneE164(input.phone);
    if (!phone) {
      throw new ValidationError('phone is not a valid E.164 number', { phone: input.phone });
    }
    const existing = await this.repos.userProfiles.findByKeycloakUserId(input.keycloakUserId);
    if (!existing) {
      throw new ValidationError('user not found', { code: 'USER_NOT_FOUND' });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const id = randomBytes(16).toString('hex');
    const now = Date.now();

    // Guardar como pending para verificar el nuevo teléfono.
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    const registration: PendingRegistration = {
      id,
      email: existing.email ?? '',
      phone,
      phoneDigits,
      firstName: existing.name ?? '',
      lastName: '',
      city: input.city ?? existing.city ?? '',
      passwordEncrypted: '', // no se revalida la contraseña
      code,
      codeHash,
      codeExpiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    await this.repos.pendingRegistrations.create(registration);
    return { id, code, retryAfterSeconds: 0 };
  }

  async #sendInvite(profile: UserProfile): Promise<boolean> {
    try {
      return await publishUserInvite({
        phone: profile.phone,
        name: profile.name,
        city: profile.city,
      });
    } catch {
      return false;
    }
  }
}
