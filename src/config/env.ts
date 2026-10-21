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
  whatsappProvider: required(
    'WHATSAPP_PROVIDER',
    process.env.NODE_ENV === 'production' ? 'resend' : 'mock',
  ),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? 'ReservaYa <notificaciones@reservaya.co>',
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? 'v22.0',
  metaVerifyToken: process.env.META_VERIFY_TOKEN ?? '',
  metaAppSecret: process.env.META_APP_SECRET ?? '',
  notificationFallbackDelayMs: Number(process.env.NOTIFICATION_FALLBACK_DELAY_MS ?? 50),
  cancellationProcessingFeeRate: Number(process.env.CANCELLATION_PROCESSING_FEE_RATE ?? 0),
  wompiEnvironment: ((process.env.WOMPI_ENVIRONMENT && process.env.WOMPI_ENVIRONMENT.trim().length > 0
    ? process.env.WOMPI_ENVIRONMENT
    : (process.env.NODE_ENV === 'production' ? 'prod' : 'test')) as 'test' | 'prod'),
  wompiEventsSecret: process.env.WOMPI_EVENTS_SECRET ?? '',
  wompiPublicKey: process.env.WOMPI_PUBLIC_KEY ?? '',
  wompiPrivateKey: process.env.WOMPI_PRIVATE_KEY ?? '',
  wompiIntegritySecret: process.env.WOMPI_INTEGRITY_SECRET ?? '',
  payuApiKey: process.env.PAYU_API_KEY ?? '',
  payuApiSecret: process.env.PAYU_API_SECRET ?? '',
  payuMerchantId: process.env.PAYU_MERCHANT_ID ?? '',
  payuAccountId: process.env.PAYU_ACCOUNT_ID ?? '',
  payuBaseUrl: process.env.PAYU_BASE_URL ?? 'https://api.payulatam.com',
  frontBaseUrl: required('FRONT_BASE_URL', 'http://localhost:4200'),
  paymentSessionSecret: required('PAYMENT_SESSION_SECRET', 'dev-reservaya-payment-session-secret'),
  r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  r2BucketName: process.env.R2_BUCKET_NAME ?? 'reservaya-backups',
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 30),
  seedAdmin: process.env.ADMIN_USER_ID ?? '',
  seedOwnerKeycloakId: process.env.SEED_OWNER_KEYCLOAK_ID ?? '',
  seedProfessionalKeycloakId: process.env.SEED_PROFESSIONAL_KEYCLOAK_ID ?? '',
} as const;

export const isProduction = env.nodeEnv === 'production';

export const identityRealm = new URL(env.oidcIssuer).pathname.replace(/^\/realms\//, '') || 'reserwaya';
