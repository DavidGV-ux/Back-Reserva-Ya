import { env } from '../config/env';
import { connectMongo, getDb } from './persist/mongo/connection';
import { createRepos } from './persist/mongo/repositories/repo-factory';
import { MongoUnitOfWork } from './persist/mongo/unit-of-work';
import { ensureExtraIndexes } from './persist/mongo/repositories/base';
import { KeycloakVerifier } from './auth/keycloak';
import { KeycloakAdminGateway } from './auth/keycloak-admin';
import { MockPaymentGateway } from './integrations/payments/mock-payment';
import { MockNotificationGateway } from './integrations/notifications/mock-notifications';
import { AppServices } from '../application/container';
import { identityRealm } from '../config/env';

export interface BootContext {
  services: AppServices;
  verifier: KeycloakVerifier;
  shutdown: () => Promise<void>;
}

export async function bootstrap(): Promise<BootContext> {
  const { client, db } = await connectMongo(env.mongodbUri);
  await ensureExtraIndexes(db);

  const repos = createRepos(db);
  const uow = new MongoUnitOfWork(client, db);
  const verifier = new KeycloakVerifier(env.oidcIssuer, env.oidcClientId);

  const services = new AppServices({
    repos,
    uow,
    paymentGateway: new MockPaymentGateway(),
    notificationGateway: new MockNotificationGateway(),
    identity: new KeycloakAdminGateway({
      baseUrl: env.oidcAdminBaseUrl,
      realm: identityRealm,
      clientId: env.oidcAdminClientId,
      clientSecret: env.oidcAdminClientSecret,
    }),
  });

  return {
    services,
    verifier,
    shutdown: async () => {
      await client.close();
    },
  };
}

export { getDb };