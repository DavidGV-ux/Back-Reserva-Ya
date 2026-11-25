import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';
import { z } from 'zod';

/**
 * Endpoints internos para el servicio de WhatsApp independiente.
 * Protegidos con WHATSAPP_BOT_SECRET (obligatorio: fail-closed si falta).
 */
export function whatsappRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();

  const guard = (reqHeaders: Record<string, string | string[] | undefined>): void => {
    const secret = process.env.WHATSAPP_BOT_SECRET;
    const header = reqHeaders['x-whatsapp-secret'];
    const auth = reqHeaders['authorization'];
    const sent =
      (typeof header === 'string' ? header : undefined) ??
      (typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined);
    if (!secret || !sent || sent !== secret) {
      throw new ForbiddenError('invalid whatsapp bot secret');
    }
  };

  router.get(
    '/lookup',
    asyncRoute(async (req, res) => {
      guard(req.headers);
      if (typeof req.query.phone !== 'string' || !req.query.phone) {
        throw new ValidationError('phone query param is required');
      }
      const identity = await services.whatsapp.resolveByPhone(req.query.phone);
      res.json(identity);
    }),
  );

  // Verificación de código por WhatsApp (llamada desde el webhook del bot).
  // Valida el código contra pending_registrations y, si es válido, crea el
  // usuario en Keycloak + user_profiles (registro completado).
  const verifyCodeByPhoneSchema = z
    .object({
      phone: z.string().min(1),
      code: z.string().regex(/^\d{6}$/).optional(),
      verificationToken: z.string().regex(/^RY-[0-9a-f]{12}$/i).optional(),
    })
    .refine((v) => Boolean(v.code || v.verificationToken), {
      message: 'code or verificationToken is required',
    });

  router.post(
    '/verify-code',
    asyncRoute(async (req, res) => {
      guard(req.headers);
      const parsed = verifyCodeByPhoneSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError('invalid verification payload', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }

      const verified = parsed.data.verificationToken
        ? await services.profile.verifyVerificationTokenByPhone({
            phone: parsed.data.phone,
            token: parsed.data.verificationToken,
          })
        : await services.profile.verifyPendingByPhone({
            phone: parsed.data.phone,
            code: parsed.data.code ?? '',
          });
      const { id } = verified;

      // Completar el registro: crear en Keycloak + user_profiles
      // (usa los datos guardados en pending_registrations).
      const { keycloakUserId } = await services.profile.completeRegistration({
        id,
        identity: {
          createUser: (input) => services.identity.createUser(input),
        },
      });

      res.json({ ok: true, keycloakUserId });
    }),
  );

  return router;
}

export default whatsappRouter;