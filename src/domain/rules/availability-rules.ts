import {
  DEFAULT_WEEK_SCHEDULE,
  WEEK_DAY_KEYS,
  WorkInterval,
  WeeklySchedule,
} from '../entities/catalog';
import { SlotReason, SlotView } from '../entities/availability';

export interface ShiftInterval {
  start: number;
  end: number;
}

export interface OccupiedRange {
  start: number;
  end: number;
}

function intervalIntersects(a: ShiftInterval, b: OccupiedRange): boolean {
  return a.start < b.end && a.end > b.start;
}

export function weeklyScheduleForDay(schedule: WeeklySchedule, weekday: number): WorkInterval[] {
  const key = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ][weekday] as keyof WeeklySchedule;
  const intervals: WorkInterval[] = schedule[key] ?? [];
  if (intervals.length) return intervals;
  // Un profesional sin ningún intervalo configurado (p.ej. dado de alta sin horario)
  // opera con los horarios por defecto: ningún negocio queda sin disponibilidad por accidente.
  const hasAnyInterval = WEEK_DAY_KEYS.some((day) => (schedule[day] ?? []).length > 0);
  if (!hasAnyInterval) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return DEFAULT_WEEK_SCHEDULE[key] as any[];
  }
  return [];
}

export function buildSlots(params: {
  shiftIntervals: ShiftInterval[];
  granularityMinutes: number;
  occupied: OccupiedRange[];
  blocked: OccupiedRange[];
  now: number;
}): SlotView[] {
  const { shiftIntervals, granularityMinutes, occupied, blocked, now } = params;
  const step = granularityMinutes * 60_000;
  const slots: SlotView[] = [];

  for (const shift of shiftIntervals) {
    for (let t = shift.start; t + step <= shift.end; t += step) {
      const end = t + step;
      if (t < now) {
        slots.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString(), available: false, blocked: false, reason: 'past' });
        continue;
      }
      const intersectsBlock = blocked.some((b) => intervalIntersects({ start: t, end }, b) || b.start >= t && b.start < end);
      if (intersectsBlock) {
        slots.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString(), available: false, blocked: true, reason: 'block' });
        continue;
      }
      const busy = occupied.some((o) => o.start < end && o.end > t);
      slots.push({
        start: new Date(t).toISOString(),
        end: new Date(end).toISOString(),
        available: !busy,
        blocked: false,
        reason: busy ? 'booked' : undefined,
      });
    }
  }
  return slots;
}

export function fitForDuration(params: {
  shiftIntervals: ShiftInterval[];
  granularityMinutes: number;
  occupied: OccupiedRange[];
  blocked: OccupiedRange[];
  durationMinutes: number;
  now: number;
}): ShiftInterval[] {
  const { shiftIntervals, granularityMinutes, occupied, blocked, durationMinutes, now } = params;
  const step = granularityMinutes * 60_000;
  const duration = durationMinutes * 60_000;
  const starts: ShiftInterval[] = [];

  for (const shift of shiftIntervals) {
    for (let t = shift.start; t + step <= shift.end; t += step) {
      const end = t + duration;
      if (end > shift.end || t < now) continue;
      const conflicts = [...occupied, ...blocked];
      const free = conflicts.every((o) => t >= o.end || end <= o.start);
      if (free) starts.push({ start: t, end });
    }
  }
  return starts;
}

export function reasonForStart(
  start: number,
  granularityMinutes: number,
  occupied: OccupiedRange[],
  blocked: OccupiedRange[],
): SlotReason | undefined {
  const end = start + granularityMinutes * 60_000;
  if (blocked.some((b) => b.start < end && b.end > start)) return 'block';
  if (occupied.some((o) => o.start < end && o.end > start)) return 'booked';
  return undefined;
}

/**
 * Slots para negocios con capacidad compartida (cafés, restaurantes, eventos).
 *
 * A diferencia de `buildSlots`, varias reservas pueden solaparse en la misma
 * franja: el límite es `capacity`, no el profesional. La duración del servicio
 * se usa para contar cuántas reservas se solapan con la franja solicitada.
 */
export function buildCapacitySlots(params: {
  shiftIntervals: ShiftInterval[];
  granularityMinutes: number;
  occupied: OccupiedRange[];
  blocked: OccupiedRange[];
  durationMinutes: number;
  capacity: number;
  now: number;
}): SlotView[] {
  const { shiftIntervals, granularityMinutes, occupied, blocked, durationMinutes, now } = params;
  const step = granularityMinutes * 60_000;
  const duration = Math.max(granularityMinutes, durationMinutes) * 60_000;
  const capacity = Math.max(1, Math.floor(params.capacity));
  const slots: SlotView[] = [];

  for (const shift of shiftIntervals) {
    for (let t = shift.start; t + step <= shift.end; t += step) {
      const displayEnd = t + step;
      if (t < now) {
        slots.push({
          start: new Date(t).toISOString(),
          end: new Date(displayEnd).toISOString(),
          available: false,
          blocked: false,
          reason: 'past',
        });
        continue;
      }
      if (t + duration > shift.end) {
        slots.push({
          start: new Date(t).toISOString(),
          end: new Date(displayEnd).toISOString(),
          available: false,
          blocked: false,
          reason: 'gap',
        });
        continue;
      }
      const intersectsBlock = blocked.some((b) => b.start < t + duration && b.end > t);
      if (intersectsBlock) {
        slots.push({
          start: new Date(t).toISOString(),
          end: new Date(displayEnd).toISOString(),
          available: false,
          blocked: true,
          reason: 'block',
        });
        continue;
      }
      const overlapping = occupied.filter((o) => o.start < t + duration && o.end > t).length;
      slots.push({
        start: new Date(t).toISOString(),
        end: new Date(displayEnd).toISOString(),
        available: overlapping < capacity,
        blocked: false,
        reason: overlapping < capacity ? undefined : 'booked',
      });
    }
  }
  return slots;
}
