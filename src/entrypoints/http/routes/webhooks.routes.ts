import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { MockPaymentEvent } from '../../../infrastructure/integrations/payments/mock-payment';
import { z } from 'zod';
import { param } from './params';

const demoEventSchema = z.object({
  reference: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['COP', 'USD']),
  tenantId: z.string().optional(),
});

export function webhookRouter(services: AppServices): Router {
  const router = Router();

  router.post(
    '/payments',
    asyncRoute(async (req, res) => {
      const tenantId = typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : undefined;
      const result = await services.payments.processWebhook({ rawEvent: req.body, tenantId });
      res.status(result.handled ? 200 : 202).json(result);
    }),
  );

  router.post(
    '/demo/payments/:action',
    asyncRoute(async (req, res) => {
      const action = param(req, 'action');
      if (!['approve', 'decline', 'refund'].includes(action)) {
        throw new NotFoundError('demo action', action);
      }
      const parsed = demoEventSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid demo event', { issues: parsed.error.issues });
      const body = parsed.data;

      let event: MockPaymentEvent;
      if (action === 'approve') {
        event = { type: 'payment.charge.approved', data: { ...body } };
      } else if (action === 'decline') {
        event = { type: 'payment.charge.declined', data: { ...body } };
      } else {
        event = { type: 'payment.refund.approved', data: { ...body } };
      }

      const result = await services.payments.processWebhook({
        rawEvent: event,
        tenantId: body.tenantId,
      });
      res.status(result.handled ? 200 : 202).json(result);
    }),
  );

  return router;
}