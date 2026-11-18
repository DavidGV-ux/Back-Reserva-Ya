import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { publicRouter } from '../../src/entrypoints/http/routes/public.routes';
import { errorHandler, notFoundHandler } from '../../src/entrypoints/http/middleware/errors';
import type { AppServices } from '../../src/application/container';
import type { KeycloakVerifier, Principal } from '../../src/infrastructure/auth/keycloak';
import { BookingUseCases } from '../../src/application/usecases/booking/booking.usecases';
import { ForbiddenError } from '../../src/shared/errors';
import type { Appointment, AppointmentStatus, PaymentStatus, Tenant } from '../../src/domain/entities';

const TENANT_ID = 't-booking-security';
const APPOINTMENT_ID = 'appt-security';
const OWNER_KC = 'kc-booking-owner';
const ATTACKER_KC = 'kc-booking-attacker';
const INJECTED_CLIENT_ID = 'kc-attacker-injected';

function futureIso(): string {
  return new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
}

function appointmentFixture(
  clientId?: string,
  status: AppointmentStatus = 'confirmed',
  paymentStatus: PaymentStatus = 'approved',
): Appointment {
  const startTime = futureIso();
  return {
    id: APPOINTMENT_ID,
    tenantId: TENANT_ID,
    professionalId: 'prof-1',
    serviceId: 'svc-1',
    serviceSnapshot: {
      serviceId: 'svc-1',
      name: 'Corte clásico',
      price: 50000,
      currency: 'COP',
      durationMinutes: 30,
    },
    commissionRateSnapshot: 0.05,
    planIdSnapshot: 'plan-1',
    source: 'web',
    clientInfo: {
      clientId,
      name: 'Víctima',
      phone: '3001112233',
      email: 'victima@example.com',
      documentId: '1234567890',
      habeasDataAcceptedAt: '2026-01-01T00:00:00.000Z',
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    },
    startTime,
    endTime: new Date(new Date(startTime).getTime() + 30 * 60 * 1000).toISOString(),
    status,
    paymentStatus,
    needsReassignment: false,
    version: 1,
  };
}

function tenantFixture(): Tenant {
  return {
    tenantId: TENANT_ID,
    currency: 'COP',
    settings: {
      advancePaymentPercentage: 0,
      cancellationToleranceHours: 48,
    },
  } as unknown as Tenant;
}

function fakeVerifier(): KeycloakVerifier {
  return {
    verify: async (token: string): Promise<Principal> => ({
      sub:
        token === 'TOKEN_OWNER'
          ? OWNER_KC
          : token === 'TOKEN_ATTACKER'
            ? ATTACKER_KC
            : token,
      roles: [],
      raw: {},
    }),
  } as unknown as KeycloakVerifier;
}

interface HttpMocks {
  createAppointment: ReturnType<typeof vi.fn>;
  getAppointment: ReturnType<typeof vi.fn>;
  cancelAppointment: ReturnType<typeof vi.fn>;
  ensureClientMembership: ReturnType<typeof vi.fn>;
  assertTenantMembership: ReturnType<typeof vi.fn>;
  reconcilePayment: ReturnType<typeof vi.fn>;
  services: AppServices;
}

function httpMocks(appointment = appointmentFixture(OWNER_KC)): HttpMocks {
  const createAppointment = vi.fn().mockResolvedValue({ appointment, intent: {}, replay: true });
  const getAppointment = vi.fn().mockResolvedValue(appointment);
  // La espía NO hace check de propiedad: eso se prueba en el usecase.
  const cancelAppointment = vi.fn().mockResolvedValue(appointment);
  const ensureClientMembership = vi.fn().mockResolvedValue(undefined);
  const assertTenantMembership = vi.fn().mockImplementation(async ({ keycloakUserId }: { keycloakUserId: string }) => {
    if (keycloakUserId !== OWNER_KC) throw new ForbiddenError();
  });
  const reconcilePayment = vi.fn().mockResolvedValue({ handled: false });
  const services = {
    booking: { createAppointment, getAppointment, cancelAppointment },
    tenants: {
      ensureClientMembership,
      assertTenantMembership,
      getTenantById: vi.fn().mockResolvedValue(undefined),
    },
    catalog: { listProfessionals: vi.fn().mockResolvedValue([]) },
    payments: { reconcilePayment },
  } as unknown as AppServices;
  return {
    createAppointment,
    getAppointment,
    cancelAppointment,
    ensureClientMembership,
    assertTenantMembership,
    reconcilePayment,
    services,
  };
}

function appFor(router: Router) {
  const app = express();
  app.use(express.json());
  app.use('/api/public', router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function usecaseFor(appointment: Appointment) {
  const updateStatus = vi.fn().mockImplementation(async (_tenantId: string, _id: string, _version: number, patch: unknown) => ({
    ...appointment,
    ...patch,
  }));
  const removeForAppointment = vi.fn().mockResolvedValue(undefined);
  const repos = {
    appointments: { findById: vi.fn().mockResolvedValue(appointment) },
    tenants: { findById: vi.fn().mockResolvedValue(tenantFixture()) },
    timeSlots: { findByAppointment: vi.fn().mockResolvedValue([]) },
  };
  const uow = {
    withTransaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        appointments: { updateStatus },
        timeSlots: { removeForAppointment },
        paymentTransactions: { create: vi.fn() },
      }),
    ),
  };
  const gateway = { name: 'fake', createRefund: vi.fn() };
  const usecases = new BookingUseCases(repos as never, uow as never, gateway as never);
  return { usecases, updateStatus };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RY-ANON-CLIENTID', () => {
  it('un anónimo no puede inyectar clientInfo.clientId: llega undefined al usecase y no crea membresía', async () => {
    const m = httpMocks();
    const app = appFor(publicRouter(m.services, fakeVerifier()));

    const res = await request(app).post(`/api/public/${TENANT_ID}/appointments`).send({
      serviceId: 'svc-1',
      professionalId: 'prof-1',
      startTime: futureIso(),
      clientInfo: {
        clientId: INJECTED_CLIENT_ID,
        name: 'Atacante',
        phone: '3000000000',
        habeasDataConsent: true,
      },
    });

    expect(res.status).toBe(200);
    expect(m.createAppointment).toHaveBeenCalledTimes(1);
    expect(m.createAppointment.mock.calls[0]?.[0].clientInfo.clientId).toBeUndefined();
    expect(m.ensureClientMembership).not.toHaveBeenCalled();
  });
});

describe('RY-APPT-GET-PII', () => {
  it('el GET anónimo no expone PII y no reconcilia el pago', async () => {
    const pending = appointmentFixture(OWNER_KC, 'pending_payment', 'pending');
    const m = httpMocks(pending);
    const app = appFor(publicRouter(m.services, fakeVerifier()));

    const res = await request(app).get(`/api/public/${TENANT_ID}/appointments/${APPOINTMENT_ID}`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    for (const field of [
      'clientInfo',
      'documentId',
      'phone',
      'email',
      'ip',
      'userAgent',
      'habeasDataConsent',
      'habeasDataAcceptedAt',
      'habeasDataConsentAt',
    ]) {
      expect(body).not.toContain(`"${field}"`);
    }
    expect(res.body.id).toBe(APPOINTMENT_ID);
    expect(res.body.status).toBe('pending_payment');
    expect(res.body.paymentStatus).toBe('pending');
    expect(res.body.startTime).toBe(pending.startTime);
    expect(res.body.endTime).toBe(pending.endTime);
    expect(res.body.serviceName).toBe(pending.serviceSnapshot.name);
    expect(m.reconcilePayment).not.toHaveBeenCalled();
  });
});

describe('RY-CANCEL-NO-OWNERSHIP', () => {
  it('rechaza 403 a un autenticado sin membresía client y NO cancela', async () => {
    const m = httpMocks();
    const app = appFor(publicRouter(m.services, fakeVerifier()));

    const res = await request(app)
      .post(`/api/public/${TENANT_ID}/appointments/${APPOINTMENT_ID}/cancel`)
      .set('Authorization', 'Bearer TOKEN_ATTACKER')
      .set('x-tenant-id', TENANT_ID)
      .send({ reason: 'ataque' });

    expect(res.status).toBe(403);
    expect(m.assertTenantMembership).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, keycloakUserId: ATTACKER_KC, roles: ['client'] }),
    );
    expect(m.cancelAppointment).not.toHaveBeenCalled();
  });

  it('exige la cabecera x-tenant-id aunque el token sea válido', async () => {
    const m = httpMocks();
    const app = appFor(publicRouter(m.services, fakeVerifier()));

    const res = await request(app)
      .post(`/api/public/${TENANT_ID}/appointments/${APPOINTMENT_ID}/cancel`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .send({ reason: 'sin header' });

    expect(res.status).toBe(403);
    expect(m.cancelAppointment).not.toHaveBeenCalled();
  });

  it('el dueño con membresía client sí puede cancelar', async () => {
    const m = httpMocks();
    const app = appFor(publicRouter(m.services, fakeVerifier()));

    const res = await request(app)
      .post(`/api/public/${TENANT_ID}/appointments/${APPOINTMENT_ID}/cancel`)
      .set('Authorization', 'Bearer TOKEN_OWNER')
      .set('x-tenant-id', TENANT_ID)
      .send({ reason: 'ya no voy' });

    expect(res.status).toBe(200);
    expect(m.cancelAppointment).toHaveBeenCalledTimes(1);
    expect(m.cancelAppointment.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      appointmentId: APPOINTMENT_ID,
      requestedBy: 'client',
      actor: OWNER_KC,
    });
  });

  it('el usecase niega la cancelación a un actor distinto del clientId de la cita', async () => {
    const { usecases, updateStatus } = usecaseFor(appointmentFixture(OWNER_KC));

    await expect(
      usecases.cancelAppointment({
        tenantId: TENANT_ID,
        appointmentId: APPOINTMENT_ID,
        requestedBy: 'client',
        actor: ATTACKER_KC,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('el usecase permite cancelar al clientId de la cita', async () => {
    const { usecases, updateStatus } = usecaseFor(appointmentFixture(OWNER_KC));

    const cancelled = await usecases.cancelAppointment({
      tenantId: TENANT_ID,
      appointmentId: APPOINTMENT_ID,
      requestedBy: 'client',
      actor: OWNER_KC,
    });

    expect(cancelled.status).toBe('cancelled');
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });
});
