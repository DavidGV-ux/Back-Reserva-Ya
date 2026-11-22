import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
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

/** Orígenes permitidos para CORS. */
const ALLOWED_ORIGINS = [
  'https://djbfmoum5t7ct.cloudfront.net',
  'http://localhost:4200',
  'http://localhost:3000',
];

/** Rate limiter global: 100 req/min por IP. */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'too many requests' } },
});

/** Rate limiter estricto para auth: 10 req/min por IP. */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'too many auth attempts' } },
});

export async function buildApp(boot: BootContext) {
  const app = express();

  // Security headers (helmet)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://qa0x18nga6.execute-api.us-east-1.amazonaws.com"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS restringido a orígenes conocidos
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-whatsapp-secret'],
  }));

  // Compresión gzip/brotli
  app.use(compression());

  // Rate limiting global
  app.use(globalLimiter);

  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Rate limiting estricto en auth
  app.use('/api/public/auth', authLimiter, authRouter(boot.services));

  app.use('/api/public', publicRouter(boot.services, boot.verifier));
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
    console.error('[reserwaya-back] failed to start', err);
    process.exit(1);
  });
}
