import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { param } from './params';
import { z } from 'zod';

const createSessionSchema = z.object({
  mode: z.enum(['advance', 'full']).optional(),
  session: z.string().optional(),
});

export function publicPaymentsRouter(services: AppServices): Router {
  const router = Router();

  router.post(
    '/:tenantId/appointments/:appointmentId/payment-session',
    asyncRoute(async (req, res) => {
      const parsed = createSessionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError('invalid payment-session payload', { issues: parsed.error.issues });
      }
      const body = parsed.data;
      const session = body.session
        ? (await services.paymentSessions.resolveSession({ token: body.session })).session
        : await services.paymentSessions.createSession({
            tenantId: param(req, 'tenantId'),
            appointmentId: param(req, 'appointmentId'),
            mode: body.mode,
          }, req.principal?.sub ?? 'web-anonymous');
      res.json(session);
    }),
  );

  router.get(
    '/:tenantId/appointments/:appointmentId/payment-session',
    asyncRoute(async (req, res) => {
      if (typeof req.query.session !== 'string' || !req.query.session) {
        throw new ValidationError('session query param is required');
      }
      const session = await services.paymentSessions.resolveSession({ token: req.query.session });
      res.json(session.session);
    }),
  );

  return router;
}