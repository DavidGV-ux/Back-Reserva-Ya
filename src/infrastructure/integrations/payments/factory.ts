import { env } from '../../../config/env';
import { PaymentGatewayProvider } from '../../../domain/ports/gateways';
import { MockPaymentGateway } from './mock-payment';
import { WompiPaymentGateway } from './wompi-payment';
import { PayuPaymentGateway } from './payu-payment';

export function buildPaymentGateway(): PaymentGatewayProvider {
  switch (env.paymentProvider) {
    case 'mock':
      return new MockPaymentGateway();
    case 'wompi': {
      if (!env.wompiEventsSecret) {
        throw new Error('Missing WOMPI_EVENTS_SECRET for PAYMENT_PROVIDER=wompi');
      }
      if (!env.wompiPublicKey) {
        throw new Error('Missing WOMPI_PUBLIC_KEY for PAYMENT_PROVIDER=wompi');
      }
      if (!env.wompiPrivateKey) {
        throw new Error('Missing WOMPI_PRIVATE_KEY for PAYMENT_PROVIDER=wompi');
      }
      if (!env.wompiIntegritySecret) {
        throw new Error('Missing WOMPI_INTEGRITY_SECRET for PAYMENT_PROVIDER=wompi');
      }
      return new WompiPaymentGateway({
        eventsSecret: env.wompiEventsSecret,
        environment: env.wompiEnvironment,
        publicKey: env.wompiPublicKey,
        privateKey: env.wompiPrivateKey,
        integritySecret: env.wompiIntegritySecret,
      });
    }
    case 'payu': {
      if (!env.payuApiKey) throw new Error('Missing PAYU_API_KEY for PAYMENT_PROVIDER=payu');
      if (!env.payuMerchantId) throw new Error('Missing PAYU_MERCHANT_ID for PAYMENT_PROVIDER=payu');
      return new PayuPaymentGateway({
        apiKey: env.payuApiKey,
        apiSecret: env.payuApiSecret,
        merchantId: env.payuMerchantId,
        accountId: env.payuAccountId,
        baseUrl: env.payuBaseUrl,
      });
    }
    default:
      throw new Error(`Unsupported PAYMENT_PROVIDER: ${env.paymentProvider}`);
  }
}