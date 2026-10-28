import { UserProfileRepository } from '../../../domain/ports/repositories';
import { UserProfile } from '../../../domain/entities';
import { ValidationError } from '../../../shared/errors';
import { normalizePhoneE164 } from '../../../shared/phone';
import { publishUserInvite } from '../../../entrypoints/http/whatsapp-events';

export class ProfileUseCases {
  constructor(private readonly repos: { userProfiles: UserProfileRepository }) {}

  async get(keycloakUserId: string): Promise<UserProfile | null> {
    return this.repos.userProfiles.findByKeycloakUserId(keycloakUserId);
  }

  async remove(keycloakUserId: string): Promise<boolean> {
    return this.repos.userProfiles.deleteByKeycloakUserId(keycloakUserId);
  }

  /**
   * Guarda (o actualiza) el teléfono del usuario y, si es la primera vez (aún
   * no ha recibido la invitación de WhatsApp), pide al bot que le envíe el
   * mensaje de bienvenida al servicio. El teléfono es el que dispara el envío;
   * la ciudad es opcional (solo personaliza el saludo).
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

  async #sendInvite(profile: UserProfile): Promise<boolean> {
    try {
      await publishUserInvite({
        phone: profile.phone,
        name: profile.name,
        city: profile.city,
      });
      return true;
    } catch {
      return false;
    }
  }
}