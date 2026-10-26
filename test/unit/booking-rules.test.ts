import { describe, expect, it } from 'vitest';
import {
  buildServiceSnapshot,
  clientInfoFrom,
  computeAdvance,
} from '../../src/domain/rules/booking-rules';

describe('computeAdvance', () => {
  it('applies the tenant percentage and rounds to 2 decimals', () => {
    const advance = computeAdvance({
      service: { id: 's1', name: 'Corte', price: 55000, currency: 'COP', durationMinutes: 75 },
      plan: { code: 'pro', commissionRate: 0.05 },
      tenantSettings: { advancePaymentPercentage: 30 },
    });
    expect(advance).toBe(16500);
  });
});

describe('buildServiceSnapshot', () => {
  it('copies pricing and duration into the snapshot', () => {
    const snap = buildServiceSnapshot({
      id: 's1', name: 'Ritual', price: 30000, currency: 'COP', durationMinutes: 45,
    });
    expect(snap).toEqual({
      serviceId: 's1', name: 'Ritual', price: 30000, currency: 'COP', durationMinutes: 45,
    });
  });
});

describe('clientInfoFrom', () => {
  it('throws without habeas data consent', () => {
    expect(() =>
      clientInfoFrom({ name: 'Ana', habeasDataConsent: false }),
    ).toThrow(/HabeasData/);
  });
  it('records acceptedAt when consent given', () => {
    const info = clientInfoFrom({ name: 'Ana', habeasDataConsent: true, phone: '+57' });
    expect(info.habeasDataAcceptedAt).toBeTruthy();
    expect(info.phone).toBe('+57');
  });
});