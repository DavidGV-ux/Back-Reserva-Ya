import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../../shared/errors';
import { Tenant } from '../../../domain/entities';
import {
  AuditLogRepository,
  PlanRepository,
  PlatformUserRepository,
  TenantAssetRepository,
  TenantLogoAsset,
  TenantRepository,
  TenantUserRepository,
} from '../../../domain/ports/repositories';
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

const BRAND_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/;

function detectLogoType(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function parseLogoDataUrl(image: string): { data: Buffer; contentType: string } {
  if (typeof image !== 'string') {
    throw new ValidationError('logo image is required');
  }
  const match = LOGO_DATA_URL_RE.exec(image.trim());
  if (!match) {
    throw new ValidationError('logo must be a PNG, JPEG or WebP data URL');
  }
  const data = Buffer.from((match[2] ?? '').replace(/\s/g, ''), 'base64');
  if (data.length === 0) {
    throw new ValidationError('logo image is empty');
  }
  if (data.length > MAX_LOGO_BYTES) {
    throw new ValidationError(`logo exceeds the ${Math.round(MAX_LOGO_BYTES / 1024)} KB limit`, {
      maxBytes: MAX_LOGO_BYTES,
      bytes: data.length,
    });
  }
  const contentType = detectLogoType(data);
  if (!contentType) {
    throw new ValidationError('logo content is not a valid PNG, JPEG or WebP image');
  }
  return { data, contentType };
}

export class TenantsUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      plans: PlanRepository;
      tenantUsers: TenantUserRepository;
      platformUsers: PlatformUserRepository;
      tenantAssets: TenantAssetRepository;
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

  private async getTenantForBranding(tenantId: string): Promise<Tenant> {
    const tenant = await this.repos.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant', tenantId);
    return tenant;
  }

  /** Datos de personalización del negocio (logo + color de marca). */
  async getBranding(tenantId: string): Promise<Tenant> {
    return this.getTenantForBranding(tenantId);
  }

  /**
   * Actualiza el color de marca del tenant. Se usa OCC con la versión que
   * envió el panel para no pisar cambios concurrentes del negocio.
   */
  async updateBranding(input: {
    tenantId: string;
    actor: string;
    version: number;
    brandColor: string | null;
  }): Promise<Tenant> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ValidationError('version is required');
    }
    if (input.brandColor !== null && !BRAND_COLOR_RE.test(input.brandColor)) {
      throw new ValidationError('brandColor must be a #RRGGBB color');
    }
    const tenant = await this.getTenantForBranding(input.tenantId);
    tenant.version = input.version;
    tenant.brandColor = input.brandColor?.toLowerCase();
    return this.repos.tenants.update(tenant, input.actor);
  }

  /**
   * Guarda el logo ya comprimido por el cliente y publica una URL versionada
   * (`?v=...`) para que el navegador pueda cachearla como inmutable.
   */
  async uploadLogo(input: {
    tenantId: string;
    actor: string;
    version: number;
    image: string;
  }): Promise<Tenant> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ValidationError('version is required');
    }
    const tenant = await this.getTenantForBranding(input.tenantId);
    const { data, contentType } = parseLogoDataUrl(input.image);
    const logoVersion = Date.now();
    await this.repos.tenantAssets.saveLogo({
      tenantId: tenant.tenantId,
      data,
      contentType,
      version: logoVersion,
    });
    tenant.version = input.version;
    tenant.logoUrl = `/public/tenants/${encodeURIComponent(tenant.slug)}/logo?v=${logoVersion}`;
    return this.repos.tenants.update(tenant, input.actor);
  }

  /** Elimina el logo actual y deja de referenciarlo en el tenant. */
  async removeLogo(input: { tenantId: string; actor: string; version: number }): Promise<Tenant> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ValidationError('version is required');
    }
    const tenant = await this.getTenantForBranding(input.tenantId);
    tenant.version = input.version;
    tenant.logoUrl = undefined;
    const updated = await this.repos.tenants.update(tenant, input.actor);
    // El borrado del binario va después: si falla, solo queda un huérfano
    // inofensivo; nunca dejamos la página apuntando a un logo inexistente.
    await this.repos.tenantAssets.deleteLogo(tenant.tenantId);
    return updated;
  }

  /** Logo público del tenant, servido con caché inmutable desde su URL versionada. */
  async getPublicLogo(slug: string): Promise<TenantLogoAsset | null> {
    const tenant = await this.repos.tenants.findBySlug(slug);
    if (!tenant) return null;
    return this.repos.tenantAssets.findLogo(tenant.tenantId);
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
   * Con `role` se filtra para devolver SOLO los negocios donde el usuario
   * tiene ese rol concreto: así cada panel ve exclusivamente su asociación
   * (dueño → solo negocios que administra; profesional → solo negocios donde
   * trabaja; cliente → solo negocios donde es cliente).
   */
  async myTenants(input: {
    keycloakUserId: string;
    role?: 'owner' | 'professional' | 'client';
  }): Promise<Array<{ tenantId: string; slug: string; name: string; role: string; roles: string[] }>> {
    const memberships = await this.repos.tenantUsers.findByIdentity(input.keycloakUserId);
    const scoped = input.role
      ? memberships.filter((m) => m.role === input.role)
      : memberships;
    const active = scoped.filter((m) => m.status === 'active');
    // Una sola fila por negocio: agrega todos los roles del usuario en ese tenant
    // (p. ej. puede ser dueño y además cliente o profesional) y usa el "mejor" rol
    // como primario para las vistas.
    const ROLE_PRIORITY: Record<string, number> = { owner: 0, professional: 1, client: 2 };
    const byTenant = new Map<string, { slug: string; name: string; roles: Set<string> }>();
    for (const m of active) {
      const row = byTenant.get(m.tenantId) ?? { slug: m.tenantId, name: m.tenantId, roles: new Set<string>() };
      row.roles.add(m.role);
      byTenant.set(m.tenantId, row);
    }
    const rows: Array<{ tenantId: string; slug: string; name: string; role: string; roles: string[] }> = [];
    for (const [tenantId, row] of byTenant) {
      const tenant = await this.repos.tenants.findById(tenantId);
      const roles = [...row.roles].sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99));
      rows.push({
        tenantId,
        slug: tenant?.slug ?? row.slug,
        name: tenant?.name ?? row.name,
        role: roles[0] ?? 'client',
        roles,
      });
    }
    return rows.sort(
      (a, b) =>
        (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99) ||
        a.name.localeCompare(b.name),
    );
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
    category?: Tenant['category'];
    timezone?: string;
    currency: 'COP' | 'USD';
    country?: string;
    city?: string;
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
      category: input.category,
      city: input.city,
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