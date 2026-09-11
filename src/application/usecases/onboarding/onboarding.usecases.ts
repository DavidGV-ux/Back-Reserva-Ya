import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { Professional, Tenant, TenantUser, WeeklySchedule } from '../../../domain/entities';
import {
  PlanRepository,
  ProfessionalRepository,
  ServiceRepository,
  TenantRepository,
  TenantUserRepository,
} from '../../../domain/ports/repositories';
import { IdentityGateway } from '../../../domain/ports/gateways';
import { hexId, uuid } from '../../../shared/id';

export interface Actor {
  keycloakUserId: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class OnboardingUseCases {
  constructor(
    private readonly deps: {
      tenants: TenantRepository;
      plans: PlanRepository;
      services: ServiceRepository;
      professionals: ProfessionalRepository;
      tenantUsers: TenantUserRepository;
      identity: IdentityGateway;
    },
  ) {}

  /**
   * Alta self-service de un negocio (plan básico) por un usuario autenticado.
   * Crea el tenant, vincula al usuario como `owner` y solicita el rol `ry_owner`
   * en el Identity Provider para que la UI desbloquee el dashboard de owner.
   */
  async onboardTenant(input: {
    actor: Actor;
    slug: string;
    name: string;
    tagline?: string;
    description?: string;
    timezone?: string;
    country?: string;
    currency: 'COP' | 'USD';
    phone?: string;
    address?: string;
    logoUrl?: string;
    coverUrl?: string;
    settings?: Partial<Tenant['settings']>;
  }): Promise<{ tenant: Tenant; ownerRoleGranted: boolean }> {
    if (!SLUG_RE.test(input.slug)) {
      throw new ValidationError('slug must be kebab-case', { slug: input.slug });
    }
    if (!input.name?.trim()) {
      throw new ValidationError('name is required');
    }
    if (await this.deps.tenants.findBySlug(input.slug)) {
      throw new ConflictError('SLUG_TAKEN', `slug ${input.slug} is already used`);
    }

    const plan = await this.deps.plans.findByCode('basico');
    if (!plan || !plan.active) throw new NotFoundError('Plan', 'basico');

    const now = new Date().toISOString();
    const mergedSettings: Tenant['settings'] = {
      slotGranularityMinutes: 15,
      cancellationToleranceHours: 24,
      paymentTimeoutMinutes: 15,
      advancePaymentPercentage: 30,
      preferredNotificationChannel: 'whatsapp',
      defaultLanguage: 'es',
      activeLanguages: ['es', 'en'],
      reminderHours: 24,
    };
    if (input.settings) {
      for (const [key, value] of Object.entries(input.settings) as Array<[keyof Tenant['settings'], unknown]>) {
        if (value !== undefined) {
          (mergedSettings as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    const tenant: Tenant = {
      id: hexId(),
      tenantId: input.slug,
      slug: input.slug,
      planId: plan.code,
      name: input.name.trim(),
      tagline: input.tagline ?? '',
      description: input.description ?? '',
      timezone: input.timezone ?? 'America/Bogota',
      currency: input.currency,
      country: input.country,
      address: input.address,
      phone: input.phone,
      logoUrl: input.logoUrl,
      coverUrl: input.coverUrl,
      settings: mergedSettings,
      bookingStatus: 'active',
      version: 1,
    };
    await this.deps.tenants.create(tenant, input.actor.keycloakUserId);

    const membership: TenantUser = {
      tenantId: tenant.tenantId,
      keycloakUserId: input.actor.keycloakUserId,
      role: 'owner',
      status: 'active',
      syncedAt: now,
    };
    await this.deps.tenantUsers.createOrUpdate(membership);

    try {
      await this.deps.identity.ensureRealmRole(input.actor.keycloakUserId, 'ry_owner');
    } catch {
      // La creación del negocio no debe fallar si el IdP no puede sincronizar roles.
      return { tenant, ownerRoleGranted: false };
    }

    return { tenant, ownerRoleGranted: true };
  }

  /**
   * El dueño invita un profesional creándole cuenta de acceso (contraseña temporal),
   * asignándole `ry_professional` y dándole de alta en el catálogo y la membresía.
   */
  async inviteProfessional(args: {
    actor: Actor;
    tenantId: string;
    professional: {
      name: string;
      title?: string;
      avatarUrl?: string;
      serviceIds: string[];
      email: string;
      phone?: string;
      weeklySchedule?: Record<string, Array<{ start: string; end: string }>>;
    };
  }): Promise<{
    professional: {
      id: string;
      tenantId: string;
      name: string;
      keycloakUserId: string;
    };
    linkedExistingAccount: boolean;
    temporaryPassword?: string;
  }> {
    const { tenantId, actor } = args;
    const input = args.professional;
    const email = input.email?.toLowerCase();
    if (!email?.includes('@')) {
      throw new ValidationError('a valid email is required to invite a professional');
    }
    if (!input.name?.trim()) {
      throw new ValidationError('name is required');
    }
    if (!input.serviceIds.length) {
      throw new ValidationError('at least one serviceId is required');
    }

    const existingByEmail = await this.deps.identity.findByEmail(email);
    let sub = existingByEmail?.sub;
    let linkedExistingAccount = Boolean(sub);
    let temporaryPassword: string | undefined;

    if (!sub) {
      temporaryPassword = tempPassword();
      const created = await this.deps.identity.createUser({
        username: email,
        email,
        firstName: input.name.trim().split(' ')[0],
        lastName: input.name.trim().split(' ').slice(1).join(' '),
        temporaryPassword,
      });
      sub = created.sub;
      await this.deps.identity.ensureRealmRole(sub, 'ry_professional');
    } else {
      await this.deps.identity.ensureRealmRole(sub, 'ry_professional');
    }

    const existing = await this.deps.professionals.findByKeycloakUserId(tenantId, sub);
    if (existing) {
      throw new ConflictError(
        'PROFESSIONAL_ALREADY_LINKED',
        `A professional linked to ${email} already exists in tenant ${tenantId}`,
      );
    }

    const professional: Professional = {
      id: uuid(),
      tenantId,
      name: input.name.trim(),
      title: input.title,
      avatarUrl: input.avatarUrl,
      serviceIds: input.serviceIds,
      schedule: normalizeWeeklySchedule(input.weeklySchedule),
      active: true,
      keycloakUserId: sub,
      version: 1,
    };
    await this.deps.professionals.create(professional, actor.keycloakUserId);

    const membership: TenantUser = {
      tenantId,
      keycloakUserId: sub,
      role: 'professional',
      status: 'active',
      syncedAt: new Date().toISOString(),
    };
    await this.deps.tenantUsers.createOrUpdate(membership);

    return {
      professional: {
        id: professional.id,
        tenantId,
        name: professional.name,
        keycloakUserId: sub,
      },
      linkedExistingAccount,
      ...(linkedExistingAccount ? {} : { temporaryPassword }),
    };
  }

  /** Directorio público de negocios activos para la home de la plataforma. */
  async publicDirectory(): Promise<
    Array<{
      slug: string;
      name: string;
      tagline: string;
      description: string;
      country: string;
      currency: 'COP' | 'USD';
      logoUrl?: string;
      coverUrl?: string;
      address?: string;
      servicesCount: number;
      professionalsCount: number;
    }>
  > {
    const tenants = await this.deps.tenants.list();
    const active = tenants.filter((t) => t.bookingStatus === 'active' && !t.deletedAt);
    const rows: ReturnType<OnboardingUseCases['publicDirectory']> extends Promise<infer R>
      ? R
      : never = [];
    for (const tenant of active) {
      const services = await this.deps.services.findByTenant(tenant.tenantId, true);
      const professionals = await this.deps.professionals.findByTenant(tenant.tenantId);
      rows.push({
        slug: tenant.slug,
        name: tenant.name,
        tagline: tenant.tagline,
        description: tenant.description,
        country: tenant.country ?? '',
        currency: tenant.currency,
        logoUrl: tenant.logoUrl,
        coverUrl: tenant.coverUrl,
        address: tenant.address,
        servicesCount: services.filter((s) => s.active).length,
        professionalsCount: professionals.filter((p) => p.active).length,
      });
    }
    return rows;
  }
}

function tempPassword(): string {
  return `Ry!${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWeeklySchedule(input?: Record<string, Array<{ start: string; end: string }>>): WeeklySchedule {
  const empty = (): WeeklySchedule => ({
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  });
  if (!input) return empty();
  const result = empty();
  for (const day of Object.keys(result) as Array<keyof WeeklySchedule>) {
    if (Array.isArray(input[day])) {
      result[day] = input[day] as WeeklySchedule[typeof day];
    }
  }
  return result;
}