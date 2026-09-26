import { PaymentGatewayProvider, ProviderWebhookEnvelope, ChargeIntent } from '../../../domain/ports/gateways';
import { PaymentTransaction } from '../../../domain/entities/payments';
import {
  EventSignatureError,
  UnsupportedPaymentPayloadError,
  ValidationError,
} from '../../../shared/errors';
import { unwrapEnvelope, verifyWompiChecksum, wompiIntegritySignature } from './shared';
import { money } from '../../../shared/money';

export interface WompiGatewayConfig {
  eventsSecret: string;
  environment: 'test' | 'prod';
  publicKey?: string;
  privateKey?: string;
  integritySecret?: string;
  fetcher?: typeof fetch;
}

const ACCEPTANCE_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
const ACCEPTANCE_MIN_TTL_MS = 60 * 1000;
const ACCEPTANCE_FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;

const API_BASE: Record<WompiGatewayConfig['environment'], string> = {
  test: 'https://sandbox.wompi.co/v1',
  prod: 'https://production.wompi.co/v1',
};

const CHARGE_STATUS_MAP: Record<string, PaymentTransaction['status']> = {
  APPROVED: 'approved',
  PENDING: 'pending',
  DECLINED: 'declined',
  VOIDED: 'declined',
  ERROR: 'declined',
};

const REFUND_STATUS_MAP: Record<string, PaymentTransaction['status']> = {
  APPROVED: 'approved',
  PENDING: 'pending',
  DECLINED: 'declined',
  ERROR: 'declined',
};

function parsePayload(envelope: ProviderWebhookEnvelope): Record<string, unknown> {
  if (envelope.body && typeof envelope.body === 'object') {
    return envelope.body as Record<string, unknown>;
  }
  if (envelope.raw) {
    try {
      const parsed = JSON.parse(envelope.raw) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch (err) {
      throw new ValidationError(`Invalid Wompi JSON payload: ${(err as Error).message}`);
    }
  }
  throw new UnsupportedPaymentPayloadError('Wompi event payload is missing');
}

export class WompiPaymentGateway implements PaymentGatewayProvider {
  readonly name = 'wompi';

  constructor(private readonly config: WompiGatewayConfig) {}

  private get baseUrl(): string {
    return API_BASE[this.config.environment];
  }

  private acceptanceCache: { acceptanceToken: string; acceptPersonalAuth: string; refreshesAt: number } | undefined;

  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: { headers?: Record<string, string>; body?: unknown; bearer?: string } = {},
  ): Promise<Record<string, unknown>> {
    const fetcher = this.config.fetcher ?? fetch;
    const res = await fetcher(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new ValidationError('Wompi returned a non-JSON response', { body: text.slice(0, 500) });
    }
    if (!res.ok) {
      throw new ValidationError(`Wompi request failed with HTTP ${res.status}`, {
        code: (json.error as Record<string, unknown> | undefined)?.type ?? json,
      });
    }
    return json;
  }

  private jwExp(token: string | undefined): number | undefined {
    if (!token) return undefined;
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payloadPart = parts[1];
    if (!payloadPart) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (typeof payload.exp !== 'number') return undefined;
      const exp = payload.exp * 1000;
      return exp > Date.now() ? exp : undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveAcceptanceTokens(): Promise<{ acceptanceToken: string; acceptPersonalAuth: string }> {
    const cached = this.acceptanceCache;
    if (cached && cached.refreshesAt > Date.now()) {
      return { acceptanceToken: cached.acceptanceToken, acceptPersonalAuth: cached.acceptPersonalAuth };
    }
    const publicKey = this.config.publicKey;
    if (!publicKey) throw new ValidationError('Wompi public key is not configured (WOMPI_PUBLIC_KEY)');
    const json = await this.request('GET', '/merchants/info', {
      headers: { 'x-merchant-public-key': publicKey },
    });
    const data = (json.data ?? {}) as Record<string, unknown>;
    const acceptance =
      String(((data.presigned_acceptance ?? {}) as Record<string, unknown>).acceptance_token ?? '') || undefined;
    const personal =
      String(((data.presigned_personal_data_auth ?? {}) as Record<string, unknown>).acceptance_token ?? '') || undefined;
    if (!acceptance || !personal) {
      throw new ValidationError('Wompi merchants endpoint did not return acceptance tokens', { json });
    }
    const exp = this.jwExp(acceptance);
    const scheduled = exp ? exp - ACCEPTANCE_REFRESH_MARGIN_MS : Date.now() + ACCEPTANCE_FALLBACK_TTL_MS;
    const earliest = Date.now() + ACCEPTANCE_MIN_TTL_MS;
    const refreshesAt = scheduled > earliest ? scheduled : earliest;
    this.acceptanceCache = { acceptanceToken: acceptance, acceptPersonalAuth: personal, refreshesAt };
    return { acceptanceToken: acceptance, acceptPersonalAuth: personal };
  }

  async buildChargeIntent(input: {
    tenantId: string;
    internalReference: string;
    amount: number;
    currency: string;
  }): Promise<ChargeIntent> {
    const publicKey = this.config.publicKey;
    if (!publicKey) throw new ValidationError('Wompi public key is not configured (WOMPI_PUBLIC_KEY)');
    const integritySecret = this.config.integritySecret;
    if (!integritySecret) throw new ValidationError('Wompi integrity secret is not configured (WOMPI_INTEGRITY_SECRET)');
    const amountInCents = Math.round(money(input.amount) * 100);
    return {
      mode: 'hosted',
      publicKey,
      amountInCents,
      currency: input.currency,
      reference: input.internalReference,
      signatureIntegrity: wompiIntegritySignature({
        reference: input.internalReference,
        amountInCents,
        currency: input.currency,
        integritySecret,
      }),
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
    const privateKey = this.config.privateKey;
    if (!privateKey) throw new ValidationError('Wompi private key is not configured (WOMPI_PRIVATE_KEY)');
    const integritySecret = this.config.integritySecret;
    if (!integritySecret) throw new ValidationError('Wompi integrity secret is not configured (WOMPI_INTEGRITY_SECRET)');

    const paymentMethodType = String(input.metadata?.paymentMethodType ?? 'CARD');
    const token = String(input.metadata?.token ?? '');
    if (!token && paymentMethodType === 'CARD') {
      throw new ValidationError('Wompi CARD charges require a payment token', { internalReference: input.internalReference });
    }
    const customerEmail = String(input.metadata?.customerEmail ?? '');
    if (!customerEmail) {
      throw new ValidationError('Wompi charges require customer_email (proporciona clientInfo.email)', {
        internalReference: input.internalReference,
      });
    }

    const amountInCents = Math.round(money(input.amount) * 100);
    const { acceptanceToken, acceptPersonalAuth } = await this.resolveAcceptanceTokens();
    const signature = wompiIntegritySignature({
      reference: input.internalReference,
      amountInCents,
      currency: input.currency,
      integritySecret,
    });

    const body: Record<string, unknown> = {
      acceptance_token: acceptanceToken,
      accept_personal_auth: acceptPersonalAuth,
      amount_in_cents: amountInCents,
      currency: input.currency,
      customer_email: customerEmail,
      payment_method: { type: paymentMethodType, token },
      payment_method_type: paymentMethodType,
      reference: input.internalReference,
      signature,
    };
    const customerIp = String(input.metadata?.customerIp ?? '');
    if (customerIp) body.ip = customerIp;
    if (input.metadata?.installments) body.installments = Number(input.metadata.installments);

    const json = await this.request('POST', '/transactions', { body, bearer: privateKey });
    const data = json.data as Record<string, unknown> | undefined;
    if (!data?.id) throw new ValidationError('Wompi charge response missing transaction id', { json });
    return { providerTransactionId: String(data.id), status: 'pending' };
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
    const privateKey = this.config.privateKey;
    if (!privateKey) throw new ValidationError('Wompi private key is not configured (WOMPI_PRIVATE_KEY)');
    const providerTransactionId = String(input.metadata?.providerTransactionId ?? '');
    if (!providerTransactionId) {
      throw new ValidationError('Wompi refund requires the original providerTransactionId');
    }
    const json = await this.request(
      'POST',
      '/refunds',
      {
        body: {
          transaction_id: providerTransactionId,
          amount_in_cents: Math.round(money(input.amount) * 100),
          reason: 'solicitud_comprador',
          reference: input.internalReference,
        },
        bearer: privateKey,
      },
    );
    const data = json.data as Record<string, unknown> | undefined;
    if (!data?.id) throw new ValidationError('Wompi refund response missing refund id', { json });
    return { providerTransactionId: String(data.id), status: 'pending' };
  }

  async fetchChargeStatus(input: {
    internalReference: string;
  }): Promise<{
    providerTransactionId: string;
    status: PaymentTransaction['status'];
    amount: number;
    currency: string;
  } | null> {
    const privateKey = this.config.privateKey;
    if (!privateKey) throw new ValidationError('Wompi private key is not configured (WOMPI_PRIVATE_KEY)');
    const json = await this.request('GET', `/transactions?reference=${encodeURIComponent(input.internalReference)}`, {
      bearer: privateKey,
    });
    const data = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
    const tx = data.find((t) => String(t.reference ?? '') === input.internalReference);
    if (!tx?.id) return null;
    const amountCents = Number(tx.amount_in_cents ?? 0);
    return {
      providerTransactionId: String(tx.id),
      status: CHARGE_STATUS_MAP[String(tx.status ?? '')] ?? 'pending',
      amount: Math.round((amountCents / 100) * 100) / 100,
      currency: String(tx.currency ?? 'COP').toUpperCase() as 'COP' | 'USD',
    };
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

    if (!verifyWompiChecksum(envelope, payload, this.config.eventsSecret)) {
      throw new EventSignatureError('Wompi event checksum is invalid', {
        providerEvent: String(payload.event ?? '') || undefined,
      });
    }

    const signature = (payload.signature ?? {}) as Record<string, unknown>;
    const properties = Array.isArray(signature.properties) ? (signature.properties as string[]) : [];
    const eventName = String(payload.event ?? '');
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const timestamp = String(signature.timestamp ?? payload.timestamp ?? '');

    const transaction = (data.transaction ?? undefined) as Record<string, unknown> | undefined;
    const refund = (data.refund ?? data.refunded_payment_method ?? undefined) as Record<string, unknown> | undefined;

    const isRefund = refund !== undefined && transaction === undefined;
    const entity = isRefund ? refund : transaction;
    if (!entity) {
      throw new UnsupportedPaymentPayloadError(`Unsupported Wompi event "${eventName}": no transaction/refund data`);
    }

    const entityId = String(entity.id ?? '');
    const rawStatus = String(entity.status ?? '');
    const status = isRefund
      ? (REFUND_STATUS_MAP[rawStatus] ?? 'declined')
      : (CHARGE_STATUS_MAP[rawStatus] ?? 'declined');

    const amountCents = Number(entity.amount_in_cents ?? entity.amount ?? 0);
    const internalReference = String(entity.reference ?? '');

    const eventId = [eventName, entityId, timestamp].filter(Boolean).join(':');
    return {
      provider: this.name,
      providerEventId: eventId,
      providerTransactionId: entityId || undefined,
      operation: isRefund ? 'refund' : 'charge',
      internalReference,
      amount: money(amountCents / 100),
      currency: String(entity.currency ?? payload.currency ?? 'COP').toUpperCase() as 'COP' | 'USD',
      status,
      metadata: {
        wompiProperties: properties,
        environment: String(payload.environment ?? ''),
      },
    };
  }
}