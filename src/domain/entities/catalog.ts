import { Currency } from './types';

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  price: number;
  currency: Currency;
  durationMinutes: number;
  active: boolean;
  version: number;
}

export interface WorkInterval {
  start: string;
  end: string;
}

export interface WeeklySchedule {
  monday: WorkInterval[];
  tuesday: WorkInterval[];
  wednesday: WorkInterval[];
  thursday: WorkInterval[];
  friday: WorkInterval[];
  saturday: WorkInterval[];
  sunday: WorkInterval[];
}

export const WEEK_DAY_KEYS: Array<keyof WeeklySchedule> = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Horario por defecto para profesionales dados de alta sin horario explícito
 * (lunes a sábado 09:00-18:00, domingo descanso). Garantiza que un negocio
 * recién creado ya tenga disponibilidad para reservar.
 */
export const DEFAULT_WEEK_SCHEDULE: WeeklySchedule = {
  monday: [{ start: '09:00', end: '18:00' }],
  tuesday: [{ start: '09:00', end: '18:00' }],
  wednesday: [{ start: '09:00', end: '18:00' }],
  thursday: [{ start: '09:00', end: '18:00' }],
  friday: [{ start: '09:00', end: '18:00' }],
  saturday: [{ start: '09:00', end: '18:00' }],
  sunday: [],
};

export function emptyWeeklySchedule(): WeeklySchedule {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

export function defaultWeeklySchedule(): WeeklySchedule {
  return normalizeWeeklySchedule(DEFAULT_WEEK_SCHEDULE);
}

/** Normaliza cualquier entrada a un WeeklySchedule con las 7 claves y el shape correcto. */
export function normalizeWeeklySchedule(input?: unknown): WeeklySchedule {
  const result = emptyWeeklySchedule();
  if (!input || typeof input !== 'object') return result;
  const src = input as Record<string, unknown>;
  for (const day of WEEK_DAY_KEYS) {
    const arr = src[day];
    if (!Array.isArray(arr)) continue;
    result[day] = arr
      .filter(
        (x): x is { start: string; end: string } =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { start?: unknown }).start === 'string' &&
          typeof (x as { end?: unknown }).end === 'string' &&
          /^\d{1,2}:\d{2}$/.test((x as { start: string }).start) &&
          /^\d{1,2}:\d{2}$/.test((x as { end: string }).end),
      )
      .map((x) => ({ start: x.start, end: x.end }));
  }
  return result;
}

export interface Professional {
  id: string;
  tenantId: string;
  name: string;
  title?: string;
  avatarUrl?: string;
  serviceIds: string[];
  schedule: WeeklySchedule;
  active: boolean;
  keycloakUserId?: string;
  phone?: string;
  version: number;
}