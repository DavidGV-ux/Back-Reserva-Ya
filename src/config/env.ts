import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: required('MONGODB_URI', 'mongodb://localhost:27017/reservaya'),
  oidcIssuer: required('OIDC_ISSUER', 'http://localhost:8080/realms/reserwaya'),
  oidcClientId: required('OIDC_CLIENT_ID', 'reserwaya-web'),
  oidcAdminBaseUrl: required('OIDC_ADMIN_BASE_URL', 'http://localhost:8080'),
  oidcAdminClientId: required('OIDC_ADMIN_CLIENT_ID', 'reserwaya-back'),
  oidcAdminClientSecret: required('OIDC_ADMIN_CLIENT_SECRET', ''),
  paymentProvider: required('PAYMENT_PROVIDER', 'mock'),
  whatsappProvider: required('WHATSAPP_PROVIDER', 'mock'),
  cancellationProcessingFeeRate: Number(process.env.CANCELLATION_PROCESSING_FEE_RATE ?? 0),
  seedAdmin: process.env.ADMIN_USER_ID ?? '',
  seedOwnerKeycloakId: process.env.SEED_OWNER_KEYCLOAK_ID ?? '',
  seedProfessionalKeycloakId: process.env.SEED_PROFESSIONAL_KEYCLOAK_ID ?? '',
} as const;

export const isProduction = env.nodeEnv === 'production';

export const identityRealm = new URL(env.oidcIssuer).pathname.replace(/^\/realms\//, '') || 'reserwaya';