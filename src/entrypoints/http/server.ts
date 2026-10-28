import express, { Request, Response } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BootContext, bootstrap } from '../../infrastructure/bootstrap';
import { publicRouter } from './routes/public.routes';
import { authRouter } from './routes/auth.routes';
import { publicPaymentsRouter } from './routes/public-payments.routes';
import { rolesRouter } from './routes/roles.routes';
import { adminRouter } from './routes/admin.routes';
import { webhookRouter } from './routes/webhooks.routes';
import { onboardingRouter } from './routes/onboarding.routes';
import { whatsappRouter } from './routes/whatsapp.routes';
import { errorHandler, notFoundHandler } from './middleware/errors';

export interface RawBodyRequest extends Request {
  rawBody?: string;
}

function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = buf.toString('utf8');
}

export async function buildApp(boot: BootContext) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  app.use('/api/public', publicRouter(boot.services, boot.verifier));
  app.use('/api/public/auth', authRouter(boot.services));
  app.use('/api/public', publicPaymentsRouter(boot.services));
  app.use('/api/onboarding', onboardingRouter(boot.services, boot.verifier));
  app.use('/api', rolesRouter(boot.services, boot.verifier));
  app.use('/api/admin', adminRouter(boot.services, boot.verifier));
  app.use('/api/webhooks', webhookRouter(boot.services));
  app.use('/api/public/whatsapp', whatsappRouter(boot.services, boot.verifier));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export async function startServer(): Promise<BootContext> {
  const boot = await bootstrap();
  const app = await buildApp(boot);
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[reserwaya-back] listening on :${port}`);
  });
  const shutdown = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await boot.shutdown();
  };
  return { services: boot.services, verifier: boot.verifier, shutdown };
}

export { bootstrap };

if (!process.env.AWS_LAMBDA_FUNCTION_NAME && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[reserwaya-back] failed to start', err);
    process.exit(1);
  });
}