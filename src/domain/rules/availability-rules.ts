import { WorkInterval, WeeklySchedule } from '../entities/catalog';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (intervals as any[]).length ? intervals : [];
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