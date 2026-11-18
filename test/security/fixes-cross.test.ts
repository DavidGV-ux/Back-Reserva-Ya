import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { whatsappRouter } from '../../src/entrypoints/http/routes/whatsapp.routes';
import { webhookRouter } from '../../src/entrypoints/http/routes/webhooks.routes';
import { asyncRoute, errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import type { AppServices } from '../../src/application/container';
import type { KeycloakVerifier } from '../../src/infrastructure/auth/keycloak';

const SECRET_KEYS = ['WHATSAPP_BOT_SECRET', 'DEMO_WEBHOOK_SECRET'] as const;
const savedEnv: Record<string, string | undefined> = {};

function mockServices(): AppServices {
  return {
    whatsapp: { resolveByPhone: vi.fn().mockResolvedValue({ phone: '3000000000', clientId: 'c-1' }) },
    payments: {
      provider: 'mock',
      processWebhook: vi.fn().mockResolvedValue({ handled: true }),
    },
  } as unknown as AppServices;
}

function appFor(router: Router, path: string) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const demoBody = { reference: 'RSV-1', amount: 1000, currency: 'COP', tenantId: 't-1' };
const demoPath = '/api/webhooks/demo/payments/approve';

let whatsappApp: ReturnType<typeof appFor>;
let webhookApp: ReturnType<typeof appFor>;

beforeEach(() => {
  for (const key of SECRET_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const services = mockServices();
  whatsappApp = appFor(whatsappRouter(services, {} as KeycloakVerifier), '/api/public/whatsapp');
  webhookApp = appFor(webhookRouter(services), '/api/webhooks');
});

afterEach(() => {
  for (const key of SECRET_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('RY-WHATSAPP-SECRET-FAILOPEN', () => {
  it('sin WHATSAPP_BOT_SECRET responde 403 (fail-closed)', async () => {
    const res = await request(whatsappApp).get('/api/public/whatsapp/lookup').query({ phone: '3000000000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('con WHATSAPP_BOT_SECRET y x-whatsapp-secret correcto responde 200', async () => {
    process.env.WHATSAPP_BOT_SECRET = 'bot-secret';
    const res = await request(whatsappApp)
      .get('/api/public/whatsapp/lookup')
      .query({ phone: '3000000000' })
      .set('x-whatsapp-secret', 'bot-secret');
    expect(res.status).toBe(200);
  });

  it('con WHATSAPP_BOT_SECRET y x-whatsapp-secret erróneo responde 403', async () => {
    process.env.WHATSAPP_BOT_SECRET = 'bot-secret';
    const res = await request(whatsappApp)
      .get('/api/public/whatsapp/lookup')
      .query({ phone: '3000000000' })
      .set('x-whatsapp-secret', 'wrong');
    expect(res.status).toBe(403);
  });

  it('con WHATSAPP_BOT_SECRET y authorization Bearer correcto responde 200', async () => {
    process.env.WHATSAPP_BOT_SECRET = 'bot-secret';
    const res = await request(whatsappApp)
      .get('/api/public/whatsapp/lookup')
      .query({ phone: '3000000000' })
      .set('authorization', 'Bearer bot-secret');
    expect(res.status).toBe(200);
  });
});

describe('RY-ERROR-LEAK', () => {
  it('errorHandler responde 500 con mensaje fijo y no filtra secrets', async () => {
    const app = express();
    app.get(
      '/boom',
      asyncRoute(async () => {
        throw new Error('DB_PASSWORD=secreto');
      }),
    );
    app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toBe('Internal Server Error');
    expect(JSON.stringify(res.body)).not.toContain('secreto');
  });

  it('notFoundHandler responde mensaje fijo sin reflejar la ruta', async () => {
    const res = await request(whatsappApp).get('/api/public/whatsapp/ruta-sensibile-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Route not found');
    expect(JSON.stringify(res.body)).not.toContain('ruta-sensibile-xyz');
  });
});

describe('RY-DEMO-WEBHOOK-MOCK', () => {
  it('sin DEMO_WEBHOOK_SECRET responde 403', async () => {
    const res = await request(webhookApp).post(demoPath).send(demoBody);
    expect(res.status).toBe(403);
  });

  it('con DEMO_WEBHOOK_SECRET y cabecera correcta responde 200', async () => {
    process.env.DEMO_WEBHOOK_SECRET = 'demo-secret';
    const res = await request(webhookApp)
      .post(demoPath)
      .set('x-demo-webhook-secret', 'demo-secret')
      .send(demoBody);
    expect(res.status).toBe(200);
  });

  it('con DEMO_WEBHOOK_SECRET y cabecera errónea responde 403', async () => {
    process.env.DEMO_WEBHOOK_SECRET = 'demo-secret';
    const res = await request(webhookApp)
      .post(demoPath)
      .set('x-demo-webhook-secret', 'wrong')
      .send(demoBody);
    expect(res.status).toBe(403);
  });
});
