import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';
import { z } from 'zod';

const createTenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case required'),
  tenantId: z.string().min(3),
  name: z.string().min(1),
  currency: z.enum(['COP', 'USD']),
  planCode: z.string().min(1),
  timezone: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  settings: z
    .object({
      cancellationToleranceHours: z.number().optional(),
      upfrontPercent: z.number().optional(),
      slotGranularityMinutes: z.number().optional(),
    })
    .optional(),
});

export function adminRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();

  router.get(
    '/tenants',
    requireAuth(verifier),
    requirePlatformAdmin(services),
    asyncRoute(async (req, res) => {
      const rows = await services.tenants.listTenants({
        as: { keycloakUserId: req.principal!.sub, isPlatformAdmin: true },
      });
      res.json(
        rows.map((r) => ({
          slug: r.tenant.slug,
          name: r.tenant.name,
          country: r.country,
          plan: r.plan.name,
          commission: r.plan.commissionRate,
          status: r.status === 'active' ? 'active' : 'suspended',
        })),
      );
    }),
  );

  router.post(
    '/tenants',
    requireAuth(verifier),
    requirePlatformAdmin(services),
    asyncRoute(async (req, res) => {
      const parsed = createTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid tenant payload', { issues: parsed.error.issues });
      }
      const body = parsed.data;
      const tenant = await services.tenants.createTenant({
        as: { keycloakUserId: req.principal!.sub, isPlatformAdmin: true },
        slug: body.slug,
        tenantId: body.tenantId,
        name: body.name,
        currency: body.currency,
        planCode: body.planCode,
        timezone: body.timezone,
        country: body.country,
        address: body.address,
        phone: body.phone,
        tagline: body.tagline,
        description: body.description,
        settings: body.settings
          ? {
            cancellationToleranceHours: body.settings?.cancellationToleranceHours,
            advancePaymentPercentage: body.settings?.upfrontPercent,
            slotGranularityMinutes: body.settings?.slotGranularityMinutes,
          }
          : undefined,
      });
      res.status(201).json(tenant);
    }),
  );

  return router;
}

export { requireAuth };