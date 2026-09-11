import { AppointmentSource, ClientInfo } from '../entities';

export interface BookingRuleInput {
  service: {
    id: string;
    name: string;
    price: number;
    currency: string;
    durationMinutes: number;
  };
  plan: {
    code: string;
    commissionRate: number;
  };
  tenantSettings: {
    advancePaymentPercentage: number;
  };
}

export function buildServiceSnapshot(service: BookingRuleInput['service']): {
  serviceId: string;
  name: string;
  price: number;
  currency: string;
  durationMinutes: number;
} {
  return {
    serviceId: service.id,
    name: service.name,
    price: service.price,
    currency: service.currency,
    durationMinutes: service.durationMinutes,
  };
}

export function computeAdvance(input: BookingRuleInput): number {
  const rate = input.tenantSettings.advancePaymentPercentage / 100;
  return Math.round(input.service.price * rate * 100) / 100;
}

export function buildTimezoneIso(start: Date): string {
  return start.toISOString();
}

export function clientInfoFrom(input: {
  name: string;
  phone?: string;
  email?: string;
  habeasDataConsent: boolean;
  habeasDataConsentAt?: string;
  ip?: string;
  userAgent?: string;
  clientId?: string;
}): ClientInfo {
  if (!input.habeasDataConsent) {
    throw new Error('HabeasDataRequired: client must accept data processing');
  }
  return {
    clientId: input.clientId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    habeasDataAcceptedAt: input.habeasDataConsentAt ?? new Date().toISOString(),
    ip: input.ip,
    userAgent: input.userAgent,
  };
}

export function defaultSource(source?: AppointmentSource): AppointmentSource {
  return source ?? 'web';
}

export function hourMinutesFromIso(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  if (hour === 24) hour = 0;
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${String(hour).padStart(2, '0')}:${minute}`;
}