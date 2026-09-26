import { describe, expect, it } from 'vitest';
import {
  buildSlots,
  fitForDuration,
  reasonForStart,
  weeklyScheduleForDay,
} from '../../src/domain/rules/availability-rules';
import {
  emptyWeeklySchedule,
  normalizeWeeklySchedule,
  WeeklySchedule,
} from '../../src/domain/entities/catalog';

const FULL_WEEK: WeeklySchedule = {
  monday: [{ start: '09:00', end: '18:00' }],
  tuesday: [{ start: '09:00', end: '18:00' }],
  wednesday: [{ start: '09:00', end: '18:00' }],
  thursday: [{ start: '09:00', end: '18:00' }],
  friday: [{ start: '09:00', end: '20:00' }],
  saturday: [{ start: '09:00', end: '20:00' }],
  sunday: [],
} as WeeklySchedule;

const dayStart = Date.UTC(2026, 2, 23); // Monday

describe('weeklyScheduleForDay', () => {
  it('returns intervals for a working weekday', () => {
    expect(weeklyScheduleForDay(FULL_WEEK, 1)).toEqual([{ start: '09:00', end: '18:00' }]);
  });
  it('returns empty for a rest day', () => {
    expect(weeklyScheduleForDay(FULL_WEEK, 0)).toEqual([]);
  });
  it('uses the default business hours when the whole schedule is empty', () => {
    const schedule = emptyWeeklySchedule();
    expect(weeklyScheduleForDay(schedule, 1)).toEqual([{ start: '09:00', end: '18:00' }]);
    expect(weeklyScheduleForDay(schedule, 6)).toEqual([{ start: '09:00', end: '18:00' }]);
    expect(weeklyScheduleForDay(schedule, 0)).toEqual([]);
  });
  it('keeps a day off when the schedule has other working days', () => {
    const schedule = { ...emptyWeeklySchedule(), monday: [{ start: '09:00', end: '13:00' }] };
    expect(weeklyScheduleForDay(schedule, 1)).toEqual([{ start: '09:00', end: '13:00' }]);
    expect(weeklyScheduleForDay(schedule, 2)).toEqual([]);
  });
});

describe('normalizeWeeklySchedule', () => {
  it('fills every day key and keeps valid intervals only', () => {
    const normalized = normalizeWeeklySchedule({
      monday: [{ start: '09:00', end: '18:00' }, { start: 'BAD', end: '18:00' }],
      sunday: 'not-an-array',
    });
    expect(Object.keys(normalized).sort()).toEqual([
      'friday',
      'monday',
      'saturday',
      'sunday',
      'thursday',
      'tuesday',
      'wednesday',
    ]);
    expect(normalized.monday).toEqual([{ start: '09:00', end: '18:00' }]);
    expect(normalized.sunday).toEqual([]);
  });
});

describe('availability for a professional without a configured schedule', () => {
  it('still produces available slots on a weekday', () => {
    const mondayStart = Date.UTC(2026, 2, 23); // Monday
    const intervals = weeklyScheduleForDay(emptyWeeklySchedule(), 1).map((w) => {
      const [sh = 0, sm = 0] = w.start.split(':').map(Number);
      const [eh = 0, em = 0] = w.end.split(':').map(Number);
      return {
        start: mondayStart + (sh * 60 + sm) * 60_000,
        end: mondayStart + (eh * 60 + em) * 60_000,
      };
    });
    const slots = buildSlots({
      shiftIntervals: intervals,
      granularityMinutes: 30,
      occupied: [],
      blocked: [],
      now: mondayStart,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.available)).toBe(true);
  });

  it('produces no slots on sunday (rest day)', () => {
    expect(weeklyScheduleForDay(emptyWeeklySchedule(), 0)).toEqual([]);
  });
});

describe('buildSlots', () => {
  const dayStart = Date.UTC(2026, 2, 23); // Monday 09:00 local start assumed at dayStart

  it('marks past slots unavailable (reason past)', () => {
    const later = dayStart + 5 * 60 * 60_000;
    const slots = buildSlots({
      shiftIntervals: [{ start: dayStart, end: dayStart + 3 * 60 * 60_000 }],
      granularityMinutes: 30,
      occupied: [],
      blocked: [],
      now: later,
    });
    expect(slots[0].available).toBe(false);
    expect(slots[0].reason).toBe('past');
  });

  it('marks slots overlapping an existing appointment as booked', () => {
    const slots = buildSlots({
      shiftIntervals: [{ start: dayStart, end: dayStart + 3 * 60 * 60_000 }],
      granularityMinutes: 30,
      occupied: [{ start: dayStart + 60 * 60_000, end: dayStart + 90 * 60_000 }],
      blocked: [],
      now: dayStart,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    });
    const first = slots.find((s) => new Date(s.start).getTime() === dayStart)!;
    const second = slots.find((s) => new Date(s.start).getTime() === dayStart + 60 * 60_000)!;
    expect(first.available).toBe(true);
    expect(second.available).toBe(false);
    expect(second.reason).toBe('booked');
  });

  it('marks slots inside a block as blocked', () => {
    const slots = buildSlots({
      shiftIntervals: [{ start: dayStart, end: dayStart + 3 * 60 * 60_000 }],
      granularityMinutes: 30,
      occupied: [],
      blocked: [{ start: dayStart + 60 * 60_000, end: dayStart + 90 * 60_000 }],
      now: dayStart,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    });
    const second = slots.find((s) => new Date(s.start).getTime() === dayStart + 60 * 60_000)!;
    expect(second.blocked).toBe(true);
    expect(second.reason).toBe('block');
  });
});

describe('fitForDuration', () => {
  it('returns only starts where the full 60min fits inside the shift and before a booking', () => {
    const occupied = [{ start: dayStart + 90 * 60_000, end: dayStart + 150 * 60_000 }];
    const starts = fitForDuration({
      shiftIntervals: [{ start: dayStart, end: dayStart + 3 * 60 * 60_000 }],
      granularityMinutes: 30,
      occupied,
      blocked: [],
      durationMinutes: 60,
      now: dayStart,
    });
    expect(starts.map((s) => s.start)).toEqual([
      dayStart,
      dayStart + 30 * 60_000,
    ]);
  });
});

describe('reasonForStart', () => {
  it('returns undefined for a free slot', () => {
    expect(
      reasonForStart(dayStart, 30, [], []),
    ).toBeUndefined();
  });
  it('returns booked when overlapping an occupied range', () => {
    expect(
      reasonForStart(dayStart, 30, [{ start: dayStart, end: dayStart + 60 * 60_000 }], []),
    ).toBe('booked');
  });
  it('returns block when overlapping a block', () => {
    expect(
      reasonForStart(dayStart, 30, [], [{ start: dayStart, end: dayStart + 60 * 60_000 }]),
    ).toBe('block');
  });
});