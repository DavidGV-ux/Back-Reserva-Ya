import { PaymentGatewayProvider, ProviderWebhookEnvelope, ChargeIntent } from '../../../domain/ports/gateways';
import { PaymentTransaction } from '../../../domain/entities/payments';
import {
  EventSignatureError,
  UnsupportedPaymentPayloadError,
  ValidationError,
} from '../../../shared/errors';
import { unwrapEnvelope, payuSign, verifyPayuSign } from './shared';
import { money } from '../../../shared/money';

export interface PayuGatewayConfig {
  apiKey: string;
  apiSecret?: string;
  merchantId: string;
  accountId?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.payulatam.com';

function parsePayuBody(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const obj: Record<string, string> = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}

function parsePayload(envelope: ProviderWebhookEnvelope): Record<string, string> {
  if (envelope.body && typeof envelope.body === 'object') {
    const body = envelope.body as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      result[k] = String(v);
    }
    return result;
  }
  return parsePayuBody(envelope.raw);
}

function mapStatePol(statePol: string): PaymentTransaction['status'] {
  switch (statePol) {
    case '4': return 'approved';
    case '2': return 'pending';
    case '7': return 'pending';
    case '3': return 'pending';
    case '10': return 'pending';
    case '11': return 'pending';
    case '12': return 'pending';
    case '13': return 'pending';
    case '1': return 'pending';
    case '6': return 'declined';
    case '104': return 'declined';
    case '5': return 'declined';
    case '0': return 'declined';
    default: return 'declined';
  }
}

export class PayuPaymentGateway implements PaymentGatewayProvider {
  readonly name = 'payu';

  constructor(private readonly config: PayuGatewayConfig) {}

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiSecret ?? ''}`).toString('base64')}`;
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const fetcher = this.config.fetcher ?? fetch;
    const res = await fetcher(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new ValidationError('PayU returned a non-JSON response', { body: text.slice(0, 500) });
    }
    if (!res.ok) {
      throw new ValidationError(`PayU request failed with HTTP ${res.status}`, json);
    }
    return json;
  }

  async buildChargeIntent(input: {
    tenantId: string;
    internalReference: string;
    amount: number;
    currency: string;
  }): Promise<ChargeIntent> {
    return {
      mode: 'demo',
      amountInCents: Math.round(money(input.amount) * 100),
      currency: input.currency,
      reference: input.internalReference,
    };
  }

  async createCharge(input: {
    tenantId: string;
    appointmentId: string;
    internalReference: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }> {
    const accountId = this.config.accountId;
    if (!accountId || !this.config.apiSecret) {
      throw new EventSignatureError(
        'PayU refund requires accountId and apiSecret (PAYU_ACCOUNT_ID, PAYU_API_SECRET)',
      );
    }
    const json = await this.post('/payments-api/4.3/transactions', {
      language: 'es',
      command: 'SUBMIT_TRANSACTION',
      transaction: {
        order: {
          accountId,
          referenceCode: input.internalReference,
          description: `ReserYa ${input.internalReference}`,
          language: 'es',
          additionalValues: [
            {
              value: Number(input.amount).toFixed(2),
              currency: input.currency,
              name: 'TX_VALUE',
            },
          ],
          buyer: input.metadata?.buyerEmail
            ? { emailAddress: String(input.metadata.buyerEmail) }
            : undefined,
        },
        type: 'AUTHORIZATION_AND_CAPTURE',
        paymentMethod: String(input.metadata?.paymentMethodCode ?? 'VISA'),
        payer: input.metadata?.payerDocument
          ? {
              document: String(input.metadata.payerDocument),
              documentType: String(input.metadata.payerDocumentType ?? 'CC'),
            }
          : undefined,
        creditCard: input.metadata?.creditCardTokenId
          ? { token: String(input.metadata.creditCardTokenId) }
          : undefined,
      },
    });
    const txResponse = json.transactionResponse as Record<string, unknown> | undefined;
    if (!txResponse) throw new ValidationError('PayU response missing transactionResponse', { json });
    const providerTransactionId = String(txResponse.transactionId ?? '');
    const pendingStates = ['PENDING', 'INITIATED', 'UNPAID', 'DECLINED'];
    const status = pendingStates.includes(String(txResponse.state ?? ''))
      ? 'pending'
      : String(txResponse.state) === 'APPROVED'
        ? 'approved'
        : 'declined';
    return { providerTransactionId, status };
  }

  async createRefund(input: {
    tenantId: string;
    appointmentId: string;
    internalReference: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }> {
    const accountId = this.config.accountId;
    if (!accountId) {
      throw new EventSignatureError('PayU refund requires accountId (PAYU_ACCOUNT_ID)');
    }
    const json = await this.post('/payments-api/4.3/transactions', {
      language: 'es',
      command: 'SUBMIT_TRANSACTION',
      transaction: {
        type: 'REFUND',
        order: {
          accountId,
          referenceCode: input.internalReference,
        },
        parentTransactionId: String(input.metadata?.providerTransactionId ?? ''),
        description: `ReserYa refund ${input.internalReference}`,
        amount: Number(input.amount).toFixed(2),
      },
    });
    const txResponse = json.transactionResponse as Record<string, unknown> | undefined;
    const providerTransactionId = String(txResponse?.transactionId ?? `payu-refund-${input.internalReference}`);
    return { providerTransactionId, status: 'pending' };
  }

  async fetchChargeStatus(_input: {
    internalReference: string;
  }): Promise<{
    providerTransactionId: string;
    status: PaymentTransaction['status'];
    amount: number;
    currency: string;
  } | null> {
    return null;
  }

  async confirmEvent(event: ProviderWebhookEnvelope | unknown): Promise<{
    provider: string;
    providerEventId: string;
    providerTransactionId?: string;
    operation: PaymentTransaction['operation'];
    internalReference: string;
    amount: number;
    currency: string;
    status: PaymentTransaction['status'];
    metadata?: Record<string, unknown>;
  }> {
    const envelope = unwrapEnvelope(event);
    const payload = parsePayload(envelope);
    if (!payload.merchant_id) {
      throw new UnsupportedPaymentPayloadError('PayU confirmation is missing merchant_id');
    }
    if (!verifyPayuSign(envelope, payload, this.config.apiKey, this.config.merchantId)) {
      throw new EventSignatureError('PayU confirmation sign is invalid');
    }

    const isRefund = !!(payload.refund_value && Number(payload.refund_value) > 0);
    const statePol = String(payload.state_pol ?? '');
    const status = mapStatePol(statePol);
    const internalReference = String(payload.reference_sale ?? '');
    const value = isRefund ? Number(payload.refund_value) : Number(payload.value ?? 0);

    const providerEventId = [payload.reference_sale, payload.state_pol, payload.transaction_id, payload.sign]
      .filter(Boolean)
      .join(':');

    return {
      provider: this.name,
      providerEventId,
      providerTransactionId: payload.transaction_id ?? payload.reference_pol ?? undefined,
      operation: isRefund ? 'refund' : 'charge',
      internalReference,
      amount: Math.round(value * 100) / 100,
      currency: String(payload.currency ?? 'COP').toUpperCase() as 'COP' | 'USD',
      status,
      metadata: {
        tenantId: payload.tenantId ?? payload.tenant_id ?? undefined,
        payuStatePol: statePol,
        payuTransactionType: payload.lap_transaction_type ?? payload.transaction_type ?? undefined,
      },
    };
  }
}