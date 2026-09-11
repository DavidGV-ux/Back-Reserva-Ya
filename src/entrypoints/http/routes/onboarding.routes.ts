import { Router } from 'express';
import { z } from 'zod';
import { AppServices } from '../../../application/container';
import { ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { requireAuth } from '../middleware/auth';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';

const onboardingSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case requerido'),
  name: z.string().min(1),
  tagline: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string().optional(),
  country: z.string().optional(),
  currency: z.enum(['COP', 'USD']).default('COP'),
  phone: z.string().optional(),
  address: z.string().optional(),
  logoUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  settings: z
    .object({
      cancellationToleranceHours: z.number().optional(),
      upfrontPercent: z.number().min(0).max(100).optional(),
      slotGranularityMinutes: z.number().optional(),
      paymentTimeoutMinutes: z.number().optional(),
      preferredNotificationChannel: z.enum(['whatsapp', 'email', 'sms']).optional(),
    })
    .optional(),
});

export function onboardingRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();

  router.post(
    '/tenants',
    requireAuth(verifier),
    asyncRoute(async (req, res) => {
      const parsed = onboardingSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('invalid onboarding payload', { issues: parsed.error.issues });
      }
      const body = parsed.data;
      const result = await services.onboarding.onboardTenant({
        actor: {
          keycloakUserId: req.principal!.sub,
          email: req.principal!.email,
          name: req.principal!.name,
          preferredUsername: req.principal!.preferredUsername,
        },
        slug: body.slug,
        name: body.name,
        tagline: body.tagline,
        description: body.description,
        timezone: body.timezone,
        country: body.country,
        currency: body.currency,
        phone: body.phone,
        address: body.address,
        logoUrl: body.logoUrl,
        coverUrl: body.coverUrl,
        settings: body.settings
          ? {
              cancellationToleranceHours: body.settings?.cancellationToleranceHours,
              advancePaymentPercentage: body.settings?.upfrontPercent,
              slotGranularityMinutes: body.settings?.slotGranularityMinutes,
              paymentTimeoutMinutes: body.settings?.paymentTimeoutMinutes,
              preferredNotificationChannel: body.settings?.preferredNotificationChannel,
            }
          : undefined,
      });
      res.status(201).json({
        tenant: result.tenant,
        identity: { ownerRoleGranted: result.ownerRoleGranted },
        confirmation: {
          message: 'Tenant creado. Si el rol no aparece aún, vuelve a autenticarte.',
          nextStep: '/app/owner',
        },
      });
    }),
  );

  return router;
}

export { requireAuth };