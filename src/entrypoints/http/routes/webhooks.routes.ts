import { Router, Request } from 'express';
import { AppServices } from '../../../application/container';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { buildMockPaymentEvent, demoEventSchema, DemoPaymentAction } from '../../../infrastructure/integrations/payments/mock-payment';
import { param } from './params';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

function toEnvelope(req: RawBodyRequest) {
  return {
    raw: req.rawBody,
    headers: req.headers as Record<string, unknown>,
    body: req.body,
  };
}

export function webhookRouter(services: AppServices): Router {
  const router = Router();

  router.post(
    '/payments',
    asyncRoute(async (req, res) => {
      const tenantId = typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : undefined;
      const result = await services.payments.processWebhook({
        rawEvent: toEnvelope(req),
        tenantId,
      });
      res.status(result.handled ? 200 : 202).json(result);
    }),
  );

  router.post(
    '/demo/payments/:action',
    asyncRoute(async (req, res) => {
      if (services.payments.provider !== 'mock') {
        throw new ForbiddenError('demo payment webhook is only available with PAYMENT_PROVIDER=mock');
      }
      const action = param(req, 'action');
      if (!['approve', 'decline', 'refund'].includes(action)) {
        throw new NotFoundError('demo action', action);
      }
      const parsed = demoEventSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid demo event', { issues: parsed.error.issues });

      const result = await services.payments.processWebhook({
        rawEvent: buildMockPaymentEvent(action as DemoPaymentAction, parsed.data),
        tenantId: parsed.data.tenantId,
      });
      res.status(result.handled ? 200 : 202).json(result);
    }),
  );

  return router;
}