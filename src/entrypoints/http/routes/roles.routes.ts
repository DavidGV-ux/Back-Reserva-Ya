import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { NotFoundError, ValidationError } from '../../../shared/errors';
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

const versionedPatch = z.object({
  version: z.number().int().min(1),
  patch: z.record(z.string(), z.unknown()),
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

export function rolesRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();

  // ---------------------------------------------------------------- me
  router.get(
    '/me/tenants',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const tenants = await services.tenants.myTenants({ keycloakUserId: req.principal!.sub });
      res.json(tenants);
    }),
  );

  // ---------------------------------------------------------------- owner
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
      const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : undefined;
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
        patch: parsed.data.patch,
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
    requireTenantMembership(services, ['professional', 'owner']),
    asyncRoute(async (req, res) => {
      const from = requiredStr(req.query.from);
      const to = requiredStr(req.query.to);
      const professionalId =
        (typeof req.query.professionalId === 'string' ? req.query.professionalId : undefined) ??
        (await resolveProfessionalForUser(services, param(req, 'tenantId'), req.principal!.sub));
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
    requireTenantMembership(services, ['professional', 'owner']),
    asyncRoute(async (req, res) => {
      const parsed = blockSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid block', { issues: parsed.error.issues });
      const professionalId =
        parsed.data.professionalId ??
        (await resolveProfessionalForUser(services, param(req, 'tenantId'), req.principal!.sub));
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

  // ---------------------------------------------------------------- client
  router.get(
    '/client/:tenantId/appointments',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['client', 'owner']),
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