import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { optionalAuth, requireAuth, requireTenantHeader, requireTenantMembership } from '../middleware/auth';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';
import { publishAppointmentCreated } from '../whatsapp-events';
import { z } from 'zod';
import { param } from './params';
import { resolveBookingPolicy } from '../../../domain/rules/booking-capacity';
import { Appointment } from '../../../domain/entities';

const createAppointmentSchema = z.object({
  serviceId: z.string().min(1),
  professionalId: z.string().min(1),
  startTime: z.string().min(1),
  clientInfo: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    documentId: z.string().optional(),
    habeasDataConsent: z.literal(true),
    habeasDataConsentAt: z.string().optional(),
  }),
  source: z.enum(['web', 'whatsapp', 'admin']).optional(),
  idempotencyKey: z.string().optional(),
  payment: z
    .object({
      type: z.enum(['CARD', 'NEQUI', 'PSE']).optional(),
      token: z.string().optional(),
      installments: z.number().int().positive().optional(),
    })
    .optional(),
});

export function publicRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();
  const optional = optionalAuth(verifier);

  router.get(
    '/tenants',
    asyncRoute(async (_req, res) => {
      const directory = await services.onboarding.publicDirectory();
      res.json(directory);
    }),
  );

  router.get(
    '/tenants/:slug/logo',
    asyncRoute(async (req, res) => {
      const slug = param(req, 'slug');
      const logo = await services.tenants.getPublicLogo(slug);
      if (!logo) throw new NotFoundError('TenantLogo', slug);
      const etag = `"tenant-logo-${logo.tenantId}-${logo.version}"`;
      res.set({
        'Content-Type': logo.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.end(Buffer.from(logo.data));
    }),
  );

  router.get(
    '/tenants/:slug',
    asyncRoute(async (req, res) => {
      const tenant = await services.tenants.getTenantBySlug(param(req, 'slug'));
      res.json(tenant);
    }),
  );

  router.get(
    '/:tenantId/services',
    asyncRoute(async (req, res) => {
      const servicesList = await services.catalog.listServices(param(req, 'tenantId'));
      res.json(servicesList);
    }),
  );

  router.get(
    '/:tenantId/professionals',
    asyncRoute(async (req, res) => {
      const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : undefined;
      const professionals = await services.catalog.listProfessionals(param(req, 'tenantId'), serviceId);
      res.json(professionals);
    }),
  );

  router.get(
    '/:tenantId/availability/days',
    asyncRoute(async (req, res) => {
      const tenant = await services.tenants.getTenantById(param(req, 'tenantId'));
      const professionalIds = csvList(req.query.professionalIds);
      const windowDays = numberOrDefault(req.query.window, 14);
      const days = await services.availability.listAvailableDays({
        tenantId: tenant.tenantId,
        professionalIds,
        windowDays,
        timezone: tenant.timezone,
      });
      res.json(days);
    }),
  );

  router.get(
    '/:tenantId/availability',
    asyncRoute(async (req, res) => {
      const tenant = await services.tenants.getTenantById(param(req, 'tenantId'));
      const professionalId = requiredString(req.query.professionalId, 'professionalId');
      const date = requiredString(req.query.date, 'date');
      const durationMinutes = requiredInt(req.query.durationMinutes, 'durationMinutes');
      const policy = resolveBookingPolicy(tenant);
      const slots = await services.availability.listSlots({
        tenantId: tenant.tenantId,
        professionalId,
        date,
        durationMinutes,
        timezone: tenant.timezone,
        granularityMinutes: tenant.settings.slotGranularityMinutes,
        capacityMode: policy.mode === 'capacity',
        capacity: policy.capacityPerSlot,
      });
      res.json(slots);
    }),
  );

  router.post(
    '/:tenantId/appointments',
    optional,
    asyncRoute(async (req, res) => {
      const parsed = createAppointmentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid booking payload', { issues: parsed.error.issues });
      }
      const body = parsed.data;
      const clientId = req.principal?.sub;
      const result = await services.booking.createAppointment({
        tenantId: param(req, 'tenantId'),
        serviceId: body.serviceId,
        professionalId: body.professionalId,
        startTime: body.startTime,
        clientInfo: {
          clientId,
          name: body.clientInfo.name,
          phone: body.clientInfo.phone,
          email: body.clientInfo.email,
          documentId: body.clientInfo.documentId,
          habeasDataConsent: body.clientInfo.habeasDataConsent,
          habeasDataConsentAt: body.clientInfo.habeasDataConsentAt,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        source: body.source,
        idempotencyKey: body.idempotencyKey,
        payment: body.payment,
        actor: req.principal?.sub ?? 'web-anonymous',
      });
      if (clientId && result.appointment.tenantId === param(req, 'tenantId')) {
        await services.tenants.ensureClientMembership(result.appointment.tenantId, clientId);
      }
      if (!result.replay) {
        void (async () => {
          const tenant = await services.tenants
            .getTenantById(result.appointment.tenantId)
            .catch(() => undefined);
          const professionals = await services.catalog
            .listProfessionals(result.appointment.tenantId)
            .catch(() => []);
          await publishAppointmentCreated({
            appointment: result.appointment,
            tenant,
            professional: professionals.find((p) => p.id === result.appointment.professionalId),
          });
        })();
      }
      res.status(result.replay ? 200 : 201).json(result);
    }),
  );

  router.get(
    '/:tenantId/appointments/history',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const tenantId = param(req, 'tenantId');
      const appointments = await services.history.historyByClient({
        tenantId,
        clientId: req.principal!.sub,
      });
      res.json(appointments);
    }),
  );

  router.get(
    '/:tenantId/appointments/:appointmentId',
    asyncRoute(async (req, res) => {
      const appointment = await services.booking.getAppointment(
        param(req, 'tenantId'),
        param(req, 'appointmentId'),
      );
      res.json(publicAppointmentDto(appointment));
    }),
  );

  router.post(
    '/:tenantId/appointments/:appointmentId/cancel',
    requireAuth(verifier),
    requireTenantHeader,
    requireTenantMembership(services, ['client']),
    asyncRoute(async (req, res) => {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const appointment = await services.booking.cancelAppointment({
        tenantId: param(req, 'tenantId'),
        appointmentId: param(req, 'appointmentId'),
        requestedBy: 'client',
        reason,
        actor: req.principal!.sub,
      });
      res.json(appointment);
    }),
  );

  return router;
}

/** Whitelist pública: la entidad completa incluye clientInfo (PII) y nunca debe salir por esta ruta. */
function publicAppointmentDto(appointment: Appointment) {
  return {
    id: appointment.id,
    tenantId: appointment.tenantId,
    serviceId: appointment.serviceId,
    professionalId: appointment.professionalId,
    serviceName: appointment.serviceSnapshot.name,
    serviceSnapshot: appointment.serviceSnapshot,
    source: appointment.source,
    createdAt: appointment.createdAt,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    paymentStatus: appointment.paymentStatus,
    needsReassignment: appointment.needsReassignment,
    version: appointment.version,
  };
}

function csvList(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function numberOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new ValidationError(`${name} query param is required`);
  return value;
}

function requiredInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`${name} must be a positive integer`);
  return n;
}