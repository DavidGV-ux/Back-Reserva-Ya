import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { Appointment, BookingIntent, PaymentTransaction } from '../../../domain/entities';
import { Currency } from '../../../domain/entities/types';
import { PaymentGatewayProvider } from '../../../domain/ports/gateways';
import {
  AppointmentRepository,
  PaymentTransactionRepository,
  TenantRepository,
} from '../../../domain/ports/repositories';
import { UnitOfWork } from '../../../domain/ports/unit-of-work';
import { hexId } from '../../../shared/id';

export type PaymentMode = 'advance' | 'full';

export interface PaymentSessionResult {
  token: string;
  url: string;
  expiresAt: string;
  mode: PaymentMode;
  amount: number;
  advanceAmount: number;
  fullAmount: number;
  currency: string;
  paymentReference: string;
  appointmentId: string;
  tenantId: string;
  intent: BookingIntent;
}

const PAYLOAD_SEPARATOR = '.';

export class PaymentSessionUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      appointments: AppointmentRepository;
      paymentTransactions: PaymentTransactionRepository;
    },
    private readonly uow: UnitOfWork,
    private readonly gateway: PaymentGatewayProvider,
    private readonly config: { frontBaseUrl: string; sessionSecret: string },
  ) {}

  async createSession(input: {
    tenantId: string;
    appointmentId: string;
    mode?: PaymentMode;
    now?: string;
  }, actor?: string): Promise<PaymentSessionResult> {
    const mode: PaymentMode = input.mode === 'full' ? 'full' : 'advance';
    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    if (!Number.isFinite(nowMs)) throw new ValidationError('now is invalid');

    const tenant = await this.repos.tenants.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant', input.tenantId);
    const appointment = await this.repos.appointments.findById(input.tenantId, input.appointmentId);
    if (!appointment) throw new NotFoundError('Appointment', input.appointmentId);
    if (appointment.status !== 'pending_payment' || appointment.paymentStatus !== 'pending') {
      throw new ConflictError(
        'SESSION_NOT_AVAILABLE',
        'appointment is not pending payment (already paid, expired or cancelled)',
      );
    }

    const paymentReference = appointment.paymentReference;
    if (!paymentReference) throw new ConflictError('SESSION_NOT_AVAILABLE', 'appointment has no payment reference');

    const reference = mode === 'advance' ? paymentReference : `${paymentReference}-F`;
    const advanceAmount = await this.resolveAdvanceAmount(tenant.tenantId, appointment);
    const fullAmount = appointment.serviceSnapshot.price;
    const amount = mode === 'advance' ? advanceAmount : fullAmount;

    if (mode === 'full') {
      await this.ensureFullTransaction(tenant.tenantId, appointment, reference, amount, actor ?? 'payment-session');
    }

    let intent: BookingIntent;
    const built = await this.gateway.buildChargeIntent({
      tenantId: tenant.tenantId,
      internalReference: reference,
      amount,
      currency: tenant.currency,
    });
    intent = {
      advanceAmount,
      currency: tenant.currency,
      paymentReference: reference,
      chargeMode: built.mode === 'hosted' ? 'hosted' : 'demo',
      ...(built.mode === 'hosted'
        ? {
            publicKey: built.publicKey,
            amountInCents: built.amountInCents,
            signatureIntegrity: built.signatureIntegrity,
          }
        : { amountInCents: built.amountInCents }),
    };

    const timeoutMs = tenant.settings.paymentTimeoutMinutes * 60_000;
    const expiresAtMs = nowMs + timeoutMs;
    const token = this.sign({ tenantId: tenant.tenantId, appointmentId: appointment.id, mode, exp: expiresAtMs });

    return {
      token,
      url: `${this.config.frontBaseUrl.replace(/\/$/, '')}/pagar/${tenant.tenantId}/${appointment.id}?session=${encodeURIComponent(token)}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
      mode,
      amount,
      advanceAmount,
      fullAmount,
      currency: tenant.currency,
      paymentReference: reference,
      appointmentId: appointment.id,
      tenantId: tenant.tenantId,
      intent,
    };
  }

  async resolveSession(input: { token: string; now?: string }): Promise<{
    session: PaymentSessionResult;
    appointment: Appointment;
  }> {
    const payload = this.verify(input.token);
    if (!payload) throw new ValidationError('invalid or expired payment session');

    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    if (!Number.isFinite(nowMs) || nowMs > payload.exp) {
      throw new ConflictError('SESSION_EXPIRED', 'payment session has expired');
    }

    const tenant = await this.repos.tenants.findById(payload.tenantId);
    if (!tenant) throw new NotFoundError('Tenant', payload.tenantId);
    const appointment = await this.repos.appointments.findById(payload.tenantId, payload.appointmentId);
    if (!appointment) throw new NotFoundError('Appointment', payload.appointmentId);

    const session = await this.createSession(
      {
        tenantId: payload.tenantId,
        appointmentId: payload.appointmentId,
        mode: payload.mode,
        now: new Date(nowMs).toISOString(),
      },
      'payment-session',
    );
    return { session, appointment };
  }

  private sign(input: { tenantId: string; appointmentId: string; mode: PaymentMode; exp: number }): string {
    const payload = Buffer.from(JSON.stringify(input)).toString('base64url');
    const signature = createHmac('sha256', this.config.sessionSecret).update(payload).digest('hex');
    return `${payload}${PAYLOAD_SEPARATOR}${signature}`;
  }

  private verify(token: string): { tenantId: string; appointmentId: string; mode: PaymentMode; exp: number } | null {
    const sep = token.lastIndexOf(PAYLOAD_SEPARATOR);
    if (sep <= 0) return null;
    const payload = token.slice(0, sep);
    const signature = token.slice(sep + 1);
    const expected = createHmac('sha256', this.config.sessionSecret).update(payload).digest('hex');
    const provided = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        tenantId?: unknown;
        appointmentId?: unknown;
        mode?: unknown;
        exp?: unknown;
      };
      if (
        typeof parsed.tenantId !== 'string' ||
        typeof parsed.appointmentId !== 'string' ||
        (parsed.mode !== 'advance' && parsed.mode !== 'full') ||
        typeof parsed.exp !== 'number'
      ) {
        return null;
      }
      return { tenantId: parsed.tenantId, appointmentId: parsed.appointmentId, mode: parsed.mode, exp: parsed.exp };
    } catch {
      return null;
    }
  }

  private async resolveAdvanceAmount(tenantId: string, appointment: Appointment): Promise<number> {
    const paymentReference = appointment.paymentReference;
    if (paymentReference) {
      const transaction = await this.repos.paymentTransactions.findByInternalReference(tenantId, paymentReference);
      if (transaction && transaction.status === 'pending' && transaction.amount > 0) {
        return transaction.amount;
      }
    }
    return Math.round(((appointment.serviceSnapshot.price * 0.3) / 100) * 100) / 100;
  }

  private async ensureFullTransaction(
    tenantId: string,
    appointment: Appointment,
    reference: string,
    amount: number,
    actor: string,
  ): Promise<PaymentTransaction> {
    const existing = await this.repos.paymentTransactions.findByInternalReference(tenantId, reference);
    if (existing) return existing;
    return this.uow.withTransaction(async (tx) => {
      const created = tx.paymentTransactions.create(
        {
          id: hexId(),
          tenantId: appointment.tenantId,
          appointmentId: appointment.id,
          provider: this.gateway.name,
          internalReference: reference,
          operation: 'charge',
          amount,
          currency: appointment.serviceSnapshot.currency as Currency,
          status: 'pending',
          version: 1,
        },
        actor,
      );
      return created;
    });
  }
}