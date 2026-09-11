import { describe, expect, it } from 'vitest';
import {
  buildSlots,
  fitForDuration,
  reasonForStart,
  weeklyScheduleForDay,
} from '../../src/domain/rules/availability-rules';
import { WeeklySchedule } from '../../src/domain/entities/catalog';

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