import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import {
  requireAuth,
  requirePlatformAdmin,
  requireTenantHeader,
  requireTenantMembership,
} from '../middleware/auth';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';
import { z } from 'zod';
import { WeeklySchedule } from '../../../domain/entities/catalog';
import { param } from './params';

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().min(0),
  durationMinutes: z.number().int().min(1),
  currency: z.enum(['COP', 'USD']).optional(),
});

export const versionedPatch = z.object({
  version: z.number().int().min(1),
  patch: z
    .object({
      name: z.string().min(1).max(100).refine((v) => !/<[a-z!/]/i.test(v), 'invalid name').optional(),
      title: z.string().max(200).optional(),
      avatarUrl: z.string().optional(),
      serviceIds: z.array(z.string().min(1)).min(1).optional(),
      schedule: z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() }))).optional(),
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      price: z.number().min(0).optional(),
      durationMinutes: z.number().int().min(1).optional(),
      description: z.string().max(1000).optional(),
      currency: z.enum(['COP', 'USD']).optional(),
    })
    .strict(),
});

const professionalSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  avatarUrl: z.string().optional(),
  serviceIds: z.array(z.string().min(1)).min(1),
  keycloakUserId: z.string().optional(),
  schedule: z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() }))).optional(),
});

const blockSchema = z.object({
  professionalId: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  reason: z.string().optional(),
});

const inviteProfessionalSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  avatarUrl: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  serviceIds: z.array(z.string().min(1)).min(1),
  weeklySchedule: z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() }))).optional(),
});

const profileSchema = z.object({
  phone: z.string().min(7, 'teléfono requerido'),
  city: z.string().optional(),
});

const brandingSchema = z.object({
  version: z.number().int().min(1),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
});

const brandingLogoSchema = z.object({
  version: z.number().int().min(1),
  image: z.string().min(1).max(600_000),
});

export const ownerSettingsSchema = z
  .object({
    version: z.number().int().min(1).optional(),
    reminderHours: z.number().int().min(1).max(72).optional(),
    preferredNotificationChannel: z.enum(['whatsapp', 'email', 'sms']).optional(),
    whatsappPhoneNumberId: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.reminderHours !== undefined ||
      d.preferredNotificationChannel !== undefined ||
      d.whatsappPhoneNumberId !== undefined,
    { message: 'at least one setting field must be provided' },
  );

export function rolesRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();

  // ---------------------------------------------------------------- me
  router.get(
    '/me/tenants',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const rawRole = typeof req.query.role === 'string' ? req.query.role : undefined;
      const role =
        rawRole === 'owner' || rawRole === 'professional' || rawRole === 'client'
          ? rawRole
          : undefined;
      const tenants = await services.tenants.myTenants({
        keycloakUserId: req.principal!.sub,
        role,
      });
      res.json(tenants);
    }),
  );

  router.get(
    '/me/appointments',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const appointments = await services.history.historyByClient({ clientId: req.principal!.sub });
      res.json(appointments);
    }),
  );

  // Perfil complementario del usuario (teléfono + ciudad): se captura tras el
  // registro y habilita el acceso por WhatsApp (el bot invita al usuario).
  router.get(
    '/me/profile',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const profile = await services.profile.get(req.principal!.sub);
      res.json({ profile: profile ?? null });
    }),
  );

  router.put(
    '/me/profile',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid profile payload', { issues: parsed.error.issues });
      }
      const saved = await services.profile.save({
        keycloakUserId: req.principal!.sub,
        phone: parsed.data.phone,
        city: parsed.data.city,
        name: req.principal!.name,
        email: req.principal!.email,
      });
      res.json({ profile: saved });
    }),
  );

  router.delete(
    '/me/profile',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      await services.profile.remove(req.principal!.sub);
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- owner
  router.get(
    '/owner/:tenantId/branding',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const tenant = await services.tenants.getBranding(param(req, 'tenantId'));
      res.json(tenant);
    }),
  );

  router.patch(
    '/owner/:tenantId/branding',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = brandingSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid branding payload', { issues: parsed.error.issues });
      }
      const tenant = await services.tenants.updateBranding({
        tenantId: param(req, 'tenantId'),
        actor: req.principal!.sub,
        version: parsed.data.version,
        brandColor: parsed.data.brandColor,
      });
      res.json(tenant);
    }),
  );

  router.put(
    '/owner/:tenantId/branding/logo',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = brandingLogoSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid logo payload', { issues: parsed.error.issues });
      }
      const tenant = await services.tenants.uploadLogo({
        tenantId: param(req, 'tenantId'),
        actor: req.principal!.sub,
        version: parsed.data.version,
        image: parsed.data.image,
      });
      res.json(tenant);
    }),
  );

  router.delete(
    '/owner/:tenantId/branding/logo',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const version = Number(req.query.version ?? req.body?.version);
      if (!Number.isInteger(version) || version < 1) throw new ValidationError('version is required');
      const tenant = await services.tenants.removeLogo({
        tenantId: param(req, 'tenantId'),
        actor: req.principal!.sub,
        version,
      });
      res.json(tenant);
    }),
  );

  // B-03 (RF-2.8): Consultar y actualizar configuración de notificaciones/recordatorios del negocio
  router.get(
    '/owner/:tenantId/settings',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const tenant = await services.tenants.getBranding(param(req, 'tenantId'));
      res.json({
        tenantId: tenant.tenantId,
        version: tenant.version,
        settings: tenant.settings,
      });
    }),
  );

  router.patch(
    '/owner/:tenantId/settings',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = ownerSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid settings payload', { issues: parsed.error.issues });
      }
      const tenant = await services.tenants.updateSettings({
        tenantId: param(req, 'tenantId'),
        actor: req.principal!.sub,
        version: parsed.data.version,
        reminderHours: parsed.data.reminderHours,
        preferredNotificationChannel: parsed.data.preferredNotificationChannel,
        whatsappPhoneNumberId: parsed.data.whatsappPhoneNumberId,
      });
      res.json(tenant);
    }),
  );

  router.get(
    '/owner/:tenantId/overview',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const overview = await services.dashboard.ownerOverview(param(req, 'tenantId'), req.principal!.sub);
      res.json(overview);
    }),
  );

  router.get(
    '/owner/:tenantId/appointments',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const fromRaw = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
      const toRaw = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;
      // Validate date format (ISO 8601) to prevent NoSQL injection
      const from = fromRaw && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(fromRaw) ? fromRaw : undefined;
      const to = toRaw && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(toRaw) ? toRaw : undefined;
      const result = await services.dashboard.ownerAppointments({
        tenantId: param(req, 'tenantId'),
        from,
        to,
      });
      res.json(result);
    }),
  );

  router.post(
    '/owner/:tenantId/appointments/:appointmentId/status',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const status = typeof req.body?.status === 'string' ? req.body.status : undefined;
      const version = Number(req.body?.version);
      const allowed = ['completed', 'no_show'];
      if (!allowed.includes(status ?? '')) {
        throw new ValidationError(`status must be one of: ${allowed.join(', ')}`);
      }
      if (!Number.isInteger(version)) throw new ValidationError('version is required');
      const row = await services.dashboard.ownerSetStatus({
        tenantId: param(req, 'tenantId'),
        appointmentId: param(req, 'appointmentId'),
        status: status as 'completed' | 'no_show',
        version,
        actor: req.principal!.sub,
      });
      res.json(row);
    }),
  );

  router.get(
    '/owner/:tenantId/services',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const list = await services.catalog.listServices(param(req, 'tenantId'), true);
      res.json(list);
    }),
  );

  router.post(
    '/owner/:tenantId/services',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = serviceSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid service', { issues: parsed.error.issues });
      const body = parsed.data;
      const created = await services.catalog.createService({
        tenantId: param(req, 'tenantId'),
        actor: req.principal!.sub,
        service: {
          name: body.name,
          description: body.description,
          price: body.price,
          durationMinutes: body.durationMinutes,
          currency: body.currency ?? 'COP',
        },
      });
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/owner/:tenantId/services/:serviceId',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = versionedPatch.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid patch', { issues: parsed.error.issues });
      const service = await services.catalog.updateService({
        tenantId: param(req, 'tenantId'),
        id: param(req, 'serviceId'),
        actor: req.principal!.sub,
        expectedVersion: parsed.data.version,
        patch: parsed.data.patch,
      });
      res.json(service);
    }),
  );

  router.delete(
    '/owner/:tenantId/services/:serviceId',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const version = Number(req.query.version ?? req.body?.version);
      if (!Number.isInteger(version)) throw new ValidationError('version is required');
      await services.catalog.deleteService({
        tenantId: param(req, 'tenantId'),
        id: param(req, 'serviceId'),
        actor: req.principal!.sub,
        expectedVersion: version,
      });
      res.status(204).end();
    }),
  );

  router.get(
    '/owner/:tenantId/professionals',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const serviceIdRaw = typeof req.query.serviceId === 'string' ? req.query.serviceId : undefined;
      const serviceId = serviceIdRaw && /^[a-zA-Z0-9_-]{1,64}$/.test(serviceIdRaw) ? serviceIdRaw : undefined;
      const list = await services.catalog.listProfessionals(param(req, 'tenantId'), serviceId);
      res.json(list);
    }),
  );

  router.post(
    '/owner/:tenantId/professionals/invite',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = inviteProfessionalSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid invite payload', { issues: parsed.error.issues });
      }
      const result = await services.onboarding.inviteProfessional({
        actor: {
          keycloakUserId: req.principal!.sub,
          email: req.principal!.email,
          name: req.principal!.name,
          preferredUsername: req.principal!.preferredUsername,
        },
        tenantId: param(req, 'tenantId'),
        professional: parsed.data,
      });
      res.status(201).json(result);
    }),
  );

  router.post(
    '/owner/:tenantId/professionals',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = professionalSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid professional', { issues: parsed.error.issues });
      }
      const body = parsed.data;
      const created = await services.catalog.createProfessional({
        tenantId: param(req, 'tenantId'),
        actor: req.principal!.sub,
        professional: {
          name: body.name,
          title: body.title,
          avatarUrl: body.avatarUrl,
          serviceIds: body.serviceIds,
          keycloakUserId: body.keycloakUserId,
          schedule: body.schedule as WeeklySchedule | undefined,
        },
      });
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/owner/:tenantId/professionals/:professionalId',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const parsed = versionedPatch.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid patch', { issues: parsed.error.issues });
      const professional = await services.catalog.updateProfessional({
        tenantId: param(req, 'tenantId'),
        id: param(req, 'professionalId'),
        actor: req.principal!.sub,
        expectedVersion: parsed.data.version,
        patch: { ...parsed.data.patch, schedule: parsed.data.patch.schedule as WeeklySchedule | undefined },
      });
      res.json(professional);
    }),
  );

  router.delete(
    '/owner/:tenantId/professionals/:professionalId',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const version = Number(req.query.version ?? req.body?.version);
      if (!Number.isInteger(version)) throw new ValidationError('version is required');
      await services.catalog.deleteProfessional({
        tenantId: param(req, 'tenantId'),
        id: param(req, 'professionalId'),
        actor: req.principal!.sub,
        expectedVersion: version,
      });
      res.status(204).end();
    }),
  );

  router.get(
    '/owner/:tenantId/reports',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const report = await services.dashboard.ownerReport({
        tenantId: param(req, 'tenantId'),
        from: requiredStr(req.query.from),
        to: requiredStr(req.query.to),
      });
      res.json(report);
    }),
  );

  router.post(
    '/owner/:tenantId/appointments/:appointmentId/cancel',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['owner']),
    asyncRoute(async (req, res) => {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const appointment = await services.booking.cancelAppointment({
        tenantId: param(req, 'tenantId'),
        appointmentId: param(req, 'appointmentId'),
        requestedBy: 'owner',
        reason,
        actor: req.principal!.sub,
      });
      res.json(appointment);
    }),
  );

  // ---------------------------------------------------------------- professional
  router.get(
    '/professional/:tenantId/agenda',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['professional']),
    asyncRoute(async (req, res) => {
      const from = requiredStr(req.query.from);
      const to = requiredStr(req.query.to);
      const professionalId = await resolveProfessionalForUser(services, param(req, 'tenantId'), req.principal!.sub);
      const requested = typeof req.query.professionalId === 'string' ? req.query.professionalId : undefined;
      if (requested && requested !== professionalId) {
        throw new ForbiddenError('cannot access another professional');
      }
      const agenda = await services.dashboard.professionalAgenda({
        tenantId: param(req, 'tenantId'),
        professionalId,
        from,
        to,
      });
      res.json(agenda);
    }),
  );

  router.post(
    '/professional/:tenantId/availability/blocks',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['professional']),
    asyncRoute(async (req, res) => {
      const parsed = blockSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid block', { issues: parsed.error.issues });
      const professionalId = await resolveProfessionalForUser(services, param(req, 'tenantId'), req.principal!.sub);
      if (parsed.data.professionalId && parsed.data.professionalId !== professionalId) {
        throw new ForbiddenError('cannot access another professional');
      }
      const block = await services.booking.createAvailabilityBlock({
        tenantId: param(req, 'tenantId'),
        professionalId,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        reason: parsed.data.reason,
        actor: req.principal!.sub,
      });
      res.status(201).json(block);
    }),
  );

  router.post(
    '/professional/:tenantId/appointments/:appointmentId/cancel',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['professional']),
    asyncRoute(async (req, res) => {
      const tenantId = param(req, 'tenantId');
      // El profesional sale siempre del token: no se acepta uno enviado por el cliente.
      const professionalId = await resolveProfessionalForUser(services, tenantId, req.principal!.sub);
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const appointment = await services.booking.cancelAppointment({
        tenantId,
        appointmentId: param(req, 'appointmentId'),
        requestedBy: 'professional',
        professionalId,
        reason,
        actor: req.principal!.sub,
      });
      res.json(appointment);
    }),
  );

  // ---------------------------------------------------------------- client
  router.get(
    '/client/:tenantId/appointments',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['client']),
    asyncRoute(async (req, res) => {
      const appointments = await services.history.clientAppointments({
        tenantId: param(req, 'tenantId'),
        clientId: req.principal!.sub,
      });
      res.json(appointments);
    }),
  );

  return router;
}

async function resolveProfessionalForUser(
  services: AppServices,
  tenantId: string,
  keycloakUserId: string,
): Promise<string> {
  const professional = await services.catalog.findProfessionalByKeycloakUserId(tenantId, keycloakUserId);
  if (!professional) throw new NotFoundError('Professional', keycloakUserId);
  return professional.id;
}

function requiredStr(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new ValidationError('required query param missing');
  }
  return value;
}

export { requirePlatformAdmin };