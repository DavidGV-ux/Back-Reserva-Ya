import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';

/**
 * Endpoints internos para el servicio de WhatsApp independiente.
 * Protegidos con WHATSAPP_BOT_SECRET (si está configurado en producción).
 */
export function whatsappRouter(services: AppServices, verifier: KeycloakVerifier): Router {
  const router = Router();

  const guard = (reqHeaders: Record<string, string | string[] | undefined>): void => {
    const secret = process.env.WHATSAPP_BOT_SECRET;
    const sent = reqHeaders['x-whatsapp-secret'];
    if (secret && (typeof sent !== 'string' || sent !== secret)) {
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

  return router;
}

export default whatsappRouter;