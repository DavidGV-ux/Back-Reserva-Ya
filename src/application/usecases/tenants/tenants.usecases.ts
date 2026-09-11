import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../../shared/errors';
import { Tenant } from '../../../domain/entities';
import { AuditLogRepository, PlanRepository, PlatformUserRepository, TenantRepository, TenantUserRepository } from '../../../domain/ports/repositories';
import { hexId, uuid } from '../../../shared/id';
import { ForbiddenError } from '../../../shared/errors';

export interface AdminIdentity {
  keycloakUserId: string;
  isPlatformAdmin: boolean;
}

export const DEFAULT_TENANT_SETTINGS = {
  slotGranularityMinutes: 15,
  cancellationToleranceHours: 24,
  paymentTimeoutMinutes: 15,
  advancePaymentPercentage: 30,
  preferredNotificationChannel: 'whatsapp' as const,
};

export class TenantsUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      plans: PlanRepository;
      tenantUsers: TenantUserRepository;
      platformUsers: PlatformUserRepository;
      audit: AuditLogRepository;
    },
  ) {}

  async resolveTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.repos.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant', tenantId);
    if (tenant.bookingStatus !== 'active') {
      throw new ConflictError('TENANT_NOT_ACTIVE', `Tenant ${tenantId} is not active for bookings`);
    }
    return tenant;
  }

  async getTenantById(tenantId: string): Promise<Tenant> {
    return this.resolveTenant(tenantId);
  }

  async getTenantBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.repos.tenants.findBySlug(slug);
    if (!tenant) throw new NotFoundError('Tenant', slug);
    return tenant;
  }

  async assertTenantMembership(input: {
    tenantId: string;
    keycloakUserId: string;
    roles: Array<'owner' | 'professional' | 'client'>;
  }): Promise<void> {
    const admin = await this.repos.platformUsers.findByKeycloakUserId(input.keycloakUserId);
    if (admin && admin.role === 'admin' && admin.status === 'active') return;

    const memberships = await this.repos.tenantUsers.findByKeycloakAndTenant(
      input.tenantId,
      input.keycloakUserId,
    );
    const allowed = memberships.some(
      (m) => m.status === 'active' && input.roles.includes(m.role),
    );
    if (!allowed) {
      throw new ForbiddenError(`User has no ${input.roles.join('/')} membership in tenant ${input.tenantId}`);
    }
  }

  async assertPlatformAdmin(input: { keycloakUserId: string }): Promise<void> {
    const admin = await this.repos.platformUsers.findByKeycloakUserId(input.keycloakUserId);
    if (!admin || admin.role !== 'admin' || admin.status !== 'active') {
      throw new ForbiddenError('Platform admin role required');
    }
  }

  /**
   * Tenants a los que el usuario pertenece (con rol dentro de cada tenant).
   * Sirve a la app para resolver el contexto sin depender de claims de IdP.
   */
  async myTenants(input: {
    keycloakUserId: string;
  }): Promise<Array<{ tenantId: string; slug: string; name: string; role: string }>> {
    const memberships = await this.repos.tenantUsers.findByIdentity(input.keycloakUserId);
    const active = memberships.filter((m) => m.status === 'active');
    const rows: Array<{ tenantId: string; slug: string; name: string; role: string }> = [];
    for (const m of active) {
      const tenant = await this.repos.tenants.findById(m.tenantId);
      rows.push({
        tenantId: m.tenantId,
        slug: tenant?.slug ?? m.tenantId,
        name: tenant?.name ?? m.tenantId,
        role: m.role,
      });
    }
    return rows;
  }

  /**
   * Da de alta al usuario como `client` del tenant cuando reserva autenticado,
   * para que luego pueda consultar sus citas desde el dashboard de cliente.
   */
  async ensureClientMembership(tenantId: string, keycloakUserId: string): Promise<void> {
    await this.repos.tenantUsers.createOrUpdate({
      tenantId,
      keycloakUserId,
      role: 'client',
      status: 'active',
      syncedAt: new Date().toISOString(),
    });
  }

  async listTenants(input: { as: AdminIdentity }): Promise<
    Array<{
      tenant: Tenant;
      plan: { name: string; commissionRate: number };
      country: string;
      status: string;
    }>
  > {
    if (!input.as.isPlatformAdmin) throw new ForbiddenError();
    const tenants = await this.repos.tenants.list();
    const plans = await this.repos.plans.listActive();
    const planByCode = new Map(plans.map((p) => [p.code, p]));
    return tenants
      .filter((t) => !t.deletedAt)
      .map((t) => ({
        tenant: t,
        plan: {
          name: planByCode.get(t.planId)?.name ?? t.planId,
          commissionRate: ((planByCode.get(t.planId)?.commissionRate ?? 0) * 100),
        },
        country: t.country ?? '—',
        status: t.bookingStatus,
      }));
  }

  async createTenant(input: {
    as?: AdminIdentity;
    slug: string;
    tenantId: string;
    name: string;
    tagline?: string;
    description?: string;
    timezone?: string;
    currency: 'COP' | 'USD';
    country?: string;
    planCode: string;
    address?: string;
    phone?: string;
    logoUrl?: string;
    coverUrl?: string;
    settings?: Partial<Tenant['settings']>;
  }): Promise<Tenant> {
    if (input.as && !input.as.isPlatformAdmin) throw new ForbiddenError();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      throw new ValidationError('slug must be kebab-case', { slug: input.slug });
    }
    if (!input.tenantId || input.tenantId.length < 3) {
      throw new ValidationError('tenantId must have at least 3 chars');
    }
    const plan = await this.repos.plans.findByCode(input.planCode);
    if (!plan || !plan.active) throw new NotFoundError('Plan', input.planCode);
    if (await this.repos.tenants.findBySlug(input.slug)) {
      throw new ConflictError('SLUG_TAKEN', `slug ${input.slug} is already used`);
    }
    const now = new Date().toISOString();
    const defaults = DEFAULT_TENANT_SETTINGS;
    const tenant: Tenant = {
      id: hexId(),
      tenantId: input.tenantId,
      slug: input.slug,
      planId: plan.code,
      name: input.name,
      tagline: input.tagline ?? '',
      description: input.description ?? '',
      timezone: input.timezone ?? 'America/Bogota',
      currency: input.currency,
      country: input.country,
      address: input.address,
      phone: input.phone,
      logoUrl: input.logoUrl,
      coverUrl: input.coverUrl,
      settings: {
        ...defaults,
        defaultLanguage: 'es',
        activeLanguages: ['es', 'en'],
        reminderHours: 24,
        ...input.settings,
      },
      bookingStatus: 'active',
      version: 1,
    };
    const actor = input.as?.keycloakUserId ?? 'seed';
    const created = await this.repos.tenants.create(tenant, actor);
    await this.repos.audit.record({
      eventId: uuid(),
      tenantId: tenant.tenantId,
      collection: 'tenants',
      documentId: tenant.id,
      operation: 'insert',
      actor,
      after: tenant,
    });
    return created;
  }
}