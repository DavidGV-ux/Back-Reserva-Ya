import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BootContext, bootstrap } from '../../infrastructure/bootstrap';
import { publicRouter } from './routes/public.routes';
import { rolesRouter } from './routes/roles.routes';
import { adminRouter } from './routes/admin.routes';
import { webhookRouter } from './routes/webhooks.routes';
import { onboardingRouter } from './routes/onboarding.routes';
import { errorHandler, notFoundHandler } from './middleware/errors';

export async function buildApp(boot: BootContext) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  app.use('/api/public', publicRouter(boot.services, boot.verifier));
  app.use('/api/onboarding', onboardingRouter(boot.services, boot.verifier));
  app.use('/api', rolesRouter(boot.services, boot.verifier));
  app.use('/api/admin', adminRouter(boot.services, boot.verifier));
  app.use('/api/webhooks', webhookRouter(boot.services));

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