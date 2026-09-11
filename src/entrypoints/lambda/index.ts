import serverless from 'serverless-http';
import { bootstrap } from '../../infrastructure/bootstrap';
import { buildApp } from '../http/server';

let cachedHandler: ReturnType<typeof serverless> | null = null;

async function getHandler() {
  if (!cachedHandler) {
    const boot = await bootstrap();
    const app = await buildApp(boot);
    cachedHandler = serverless(app);
  }
  return cachedHandler;
}

export async function lambdaHandler(event: unknown, context: unknown): Promise<unknown> {
  const handler = await getHandler();
  return handler(event as object, context as object);
}