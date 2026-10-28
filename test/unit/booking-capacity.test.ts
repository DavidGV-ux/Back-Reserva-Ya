import { describe, expect, it } from 'vitest';
import { resolveBookingPolicy } from '../../src/domain/rules/booking-capacity';
import { Tenant } from '../../src/domain/entities';

function tenant(category: Tenant['category'], settings: Partial<Tenant['settings']> = {}): Tenant {
  return {
    id: 't1',
    tenantId: 't1',
    slug: 't1',
    planId: 'basico',
    name: 'Negocio',
    tagline: '',
    description: '',
    timezone: 'America/Bogota',
    currency: 'COP',
    category,
    settings: {
      defaultLanguage: 'es',
      activeLanguages: ['es'],
      slotGranularityMinutes: 15,
      cancellationToleranceHours: 24,
      paymentTimeoutMinutes: 15,
      advancePaymentPercentage: 30,
      preferredNotificationChannel: 'whatsapp',
      reminderHours: 24,
      ...settings,
    },
    bookingStatus: 'active',
    version: 1,
  };
}

describe('resolveBookingPolicy', () => {
  it('usa capacidad compartida por defecto en cafés y restaurantes', () => {
    expect(resolveBookingPolicy(tenant('bars_cafes'))).toEqual({
      mode: 'capacity',
      capacityPerSlot: 20,
    });
    expect(resolveBookingPolicy(tenant('food'))).toEqual({
      mode: 'capacity',
      capacityPerSlot: 20,
    });
  });

  it('mantiene exclusividad en barberías, salud y servicios personales', () => {
    expect(resolveBookingPolicy(tenant('beauty'))).toEqual({
      mode: 'exclusive',
      capacityPerSlot: 1,
    });
    expect(resolveBookingPolicy(tenant('health'))).toEqual({
      mode: 'exclusive',
      capacityPerSlot: 1,
    });
    expect(resolveBookingPolicy(tenant('home'))).toEqual({
      mode: 'exclusive',
      capacityPerSlot: 1,
    });
  });

  it('permite sobreescribir el modo y el aforo por tenant', () => {
    expect(resolveBookingPolicy(tenant('bars_cafes', { bookingMode: 'exclusive' }))).toEqual({
      mode: 'exclusive',
      capacityPerSlot: 1,
    });
    expect(resolveBookingPolicy(tenant('beauty', { bookingMode: 'capacity', capacityPerSlot: 4 }))).toEqual({
      mode: 'capacity',
      capacityPerSlot: 4,
    });
    expect(resolveBookingPolicy(tenant('food', { capacityPerSlot: 0 }))).toEqual({
      mode: 'capacity',
      capacityPerSlot: 20,
    });
  });
});
