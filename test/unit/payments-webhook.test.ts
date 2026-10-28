import { describe, it, expect, vi } from 'vitest';
import { PaymentsUseCases, PaymentEventResult } from '../../src/application/usecases/payments/payments.usecases';
import { Appointment, PaymentTransaction } from '../../src/domain/entities';
import { UnitOfWork, TransactionRepositories } from '../../src/domain/ports/unit-of-work';
import { PaymentGatewayProvider } from '../../src/domain/ports/gateways';

function pendingAppointment(tenantId: string, id = 'appt-1'): Appointment {
  return {
    id,
    tenantId,
    professionalId: 'prof-1',
    serviceId: 'svc-1',
    serviceSnapshot: {
      serviceId: 'svc-1',
      name: 'Corte',
      price: 40000,
      currency: 'COP',
      durationMinutes: 60,
    },
    commissionRateSnapshot: 0.3,
    planIdSnapshot: 'plan-1',
    source: 'public_portal',
    paymentReference: 'RSV-UNIQUE',
    clientInfo: {
      name: 'Juan',
      phone: '3000000000',
      habeasDataAcceptedAt: new Date().toISOString(),
    },
    startTime: '2026-09-26T14:00:00.000Z',
    endTime: '2026-09-26T15:00:00.000Z',
    status: 'pending_payment',
    paymentStatus: 'pending',
    needsReassignment: false,
    version: 1,
  };
}

function pendingPayment(tenantId: string): PaymentTransaction {
  return {
    id: 'ptx-1',
    tenantId,
    appointmentId: 'appt-1',
    provider: 'wompi',
    providerTransactionId: 'wtx-1',
    internalReference: 'RSV-UNIQUE',
    operation: 'charge',
    amount: 12000,
    currency: 'COP',
    status: 'pending',
    version: 1,
  };
}

describe('PaymentsUseCases.processWebhook', () => {
  it('resolves the tenant from the payment reference when no tenant header is present', async () => {
    const tenantA = 'tenant-A';
    const tenantB = 'tenant-B';
    const tx = pendingPayment(tenantB);
    const appointment = pendingAppointment(tenantB);
    const txByReference = new Map<string, PaymentTransaction>([[tx.internalReference, tx]]);

    const fakePaymentTx = {
      findByProviderEvent: vi.fn().mockResolvedValue(null),
      findByInternalReference: vi.fn(async (tenantId: string | undefined, reference: string) => {
        return txByReference.get(reference) ?? null;
      }),
      updateStatus: vi.fn(async (_tenantId: string, _id: string, _version: number, status: string, opts?: { providerTransactionId?: string; providerEventId?: string }) => {
        return Promise.resolve({
          ...tx,
          status,
          providerTransactionId: opts?.providerTransactionId ?? tx.providerTransactionId,
          providerEventId: opts?.providerEventId ?? tx.providerEventId,
          version: tx.version + 1,
        }) as Promise<PaymentTransaction>;
      }),
      create: vi.fn(),
    };

    const fakeAppointments = {
      findById: vi.fn(async (tenantId: string) => {
        return tenantId === tenantB ? appointment : null;
      }),
      updateStatus: vi.fn(async (_tenantId: string, _id: string, _version: number, updates: Partial<Appointment>) => {
        return Promise.resolve({ ...appointment, ...updates, version: appointment.version + 1 }) as Promise<Appointment>;
      }),
    };

    const fakeLedger = {
      create: vi.fn(async (entry: unknown) => Promise.resolve(entry)),
    };
    void tenantA;

    const fakeTx = {
      paymentTransactions: fakePaymentTx,
      appointments: fakeAppointments,
      ledger: fakeLedger,
    } as unknown as TransactionRepositories;

    const fakeUow = {
      withTransaction: vi.fn(async <R>(fn: (tx: TransactionRepositories) => Promise<R>): Promise<R> => fn(fakeTx)),
    } as unknown as UnitOfWork;

    const gateway = {
      name: 'wompi',
      confirmEvent: vi.fn().mockResolvedValue({
        provider: 'wompi',
        providerEventId: 'transaction.updated:wtx-1:1',
        operation: 'charge',
        internalReference: tx.internalReference,
        status: 'approved',
        providerTransactionId: tx.providerTransactionId,
        metadata: {},
      }),
    } as unknown as PaymentGatewayProvider;

    const uc = new PaymentsUseCases(
      fakeUow,
      gateway,
      {
        appointments: fakeAppointments,
        tenants: { findById: vi.fn(), findBySlug: vi.fn() },
        paymentTransactions: fakePaymentTx,
      },
    );

    const result: PaymentEventResult = await uc.processWebhook({ rawEvent: {} });

    expect(result.handled).toBe(true);
    expect(result.appointment?.status).toBe('confirmed');
    expect(result.appointment?.paymentStatus).toBe('approved');
    expect(result.appointment?.tenantId).toBe(tenantB);
    expect(fakePaymentTx.findByInternalReference).toHaveBeenCalledWith(undefined, tx.internalReference);
    expect(fakePaymentTx.updateStatus).toHaveBeenCalledWith(
      tenantB,
      tx.id,
      tx.version,
      'approved',
      expect.objectContaining({ providerEventId: 'transaction.updated:wtx-1:1', actor: 'payment-gateway' }),
    );
    expect(fakeAppointments.updateStatus).toHaveBeenCalledWith(
      tenantB,
      appointment.id,
      appointment.version,
      expect.objectContaining({ status: 'confirmed', paymentStatus: 'approved' }),
      'payment-gateway',
    );
    expect(fakeLedger.create).toHaveBeenCalledTimes(2);
  });

  it('returns unknown_reference when no transaction matches the event reference', async () => {
    const fakePaymentTx = {
      findByProviderEvent: vi.fn().mockResolvedValue(null),
      findByInternalReference: vi.fn().mockResolvedValue(null),
    };
    const fakeTx = {
      paymentTransactions: fakePaymentTx,
      appointments: { findById: vi.fn(), updateStatus: vi.fn() },
      ledger: { create: vi.fn() },
    } as unknown as TransactionRepositories;
    const fakeUow = {
      withTransaction: vi.fn(async <R>(fn: (tx: TransactionRepositories) => Promise<R>): Promise<R> => fn(fakeTx)),
    } as unknown as UnitOfWork;

    const gateway = {
      name: 'wompi',
      confirmEvent: vi.fn().mockResolvedValue({
        provider: 'wompi',
        providerEventId: 'transaction.updated:wtx-9:1',
        operation: 'charge',
        internalReference: 'RSV-NOPE',
        status: 'approved',
        providerTransactionId: 'wtx-9',
        metadata: {},
      }),
    } as unknown as PaymentGatewayProvider;

    const uc = new PaymentsUseCases(
      fakeUow,
      gateway,
      {
        appointments: { findById: vi.fn(), updateStatus: vi.fn() },
        tenants: { findById: vi.fn(), findBySlug: vi.fn() },
        paymentTransactions: fakePaymentTx,
      },
    );

    const result = await uc.processWebhook({ rawEvent: {} });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('unknown_reference');
  });
});