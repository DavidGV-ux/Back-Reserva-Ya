import { ValidationError } from '../../../shared/errors';
import { normalizePhoneE164 } from '../../../shared/phone';
import { AppointmentRepository, ProfessionalRepository, TenantRepository, UserProfileRepository } from '../../../domain/ports/repositories';

export interface WhatsappIdentity {
  role: 'owner' | 'professional' | 'client' | null;
  phone: string;
  tenantId?: string;
  slug?: string;
  tenantName?: string;
  city?: string;
  address?: string;
  businessPhone?: string;
  professionalId?: string;
  professionalName?: string;
  clientName?: string;
}

/**
 * Resuelve el rol de un número de WhatsApp dentro de la plataforma usando el
 * teléfono normalizado (E.164, +57 por defecto). Prioridad: owner > professional > client.
 * - owner: el número coincide con `Tenant.phone` de un negocio activo.
 * - professional: coincide con `Professional.phone` de un negocio activo.
 * - client: tiene historial de citas con ese teléfono en `client_info.phone`.
 */
export class WhatsappUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      professionals: ProfessionalRepository;
      appointments: AppointmentRepository;
      profiles?: UserProfileRepository;
    },
  ) {}

  async resolveByPhone(phone: string): Promise<WhatsappIdentity> {
    const normalized = normalizePhoneE164(phone);
    if (!normalized) {
      throw new ValidationError('phone is not a valid E.164 number', { phone });
    }

    const tenants = (await this.repos.tenants.list()).filter(
      (t) => t.bookingStatus === 'active' && !t.deletedAt,
    );

    const owner = tenants.find((t) => normalizePhoneE164(t.phone) === normalized);
    if (owner) {
      return {
        role: 'owner',
        phone: normalized,
        tenantId: owner.tenantId,
        slug: owner.slug,
        tenantName: owner.name,
        city: owner.city,
        address: owner.address,
        businessPhone: owner.phone,
      };
    }

    for (const tenant of tenants) {
      const professionals = await this.repos.professionals.findByTenant(tenant.tenantId);
      const professional = professionals.find(
        (p) => p.active && normalizePhoneE164(p.phone) === normalized,
      );
      if (professional) {
        return {
          role: 'professional',
          phone: normalized,
          professionalId: professional.id,
          professionalName: professional.name,
          tenantId: tenant.tenantId,
          slug: tenant.slug,
          tenantName: tenant.name,
          city: tenant.city,
          address: tenant.address,
          businessPhone: tenant.phone,
        };
      }
    }

    for (const tenant of tenants) {
      const history = await this.repos.appointments.findHistoryByClient({
        tenantId: tenant.tenantId,
        phone: normalized,
      });
      if (history.length > 0) {
        return {
          role: 'client',
          phone: normalized,
          clientName: history[0]?.clientInfo.name ?? '',
          tenantId: tenant.tenantId,
          slug: tenant.slug,
          tenantName: tenant.name,
          city: tenant.city,
        };
      }
    }

    // Usuario registrado en la web que completó su perfil (teléfono + ciudad).
    if (this.repos.profiles) {
      const profile = await this.repos.profiles.findByPhone(normalized.replace(/[^0-9]/g, ''));
      if (profile) {
        return {
          role: null,
          phone: normalized,
          city: profile.city,
          clientName: profile.name ?? '',
        };
      }
    }

    return { role: null, phone: normalized };
  }
}