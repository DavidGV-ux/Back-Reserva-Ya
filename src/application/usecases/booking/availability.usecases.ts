import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AppointmentStatus } from '../../../domain/entities/types';
import { SlotView } from '../../../domain/entities/availability';
import { AppointmentRepository, AvailabilityBlockRepository, ProfessionalRepository } from '../../../domain/ports/repositories';
import { buildSlots, weeklyScheduleForDay } from '../../../domain/rules/availability-rules';
import { addDaysUtc, todayUtcParts, utcLocalStartMs } from '../../../shared/timezone';

const OCCUPIED_STATUSES: AppointmentStatus[] = ['confirmed', 'pending_payment'];

export class AvailabilityUseCases {
  constructor(
    private readonly repos: {
      professionals: ProfessionalRepository;
      appointments: AppointmentRepository;
      availabilityBlocks: AvailabilityBlockRepository;
    },
  ) {}

  async listAvailableDays(input: {
    tenantId: string;
    professionalIds: string[];
    windowDays?: number;
    timezone: string;
  }): Promise<string[]> {
    const { timezone, windowDays = 14 } = input;
    if (input.professionalIds.length === 0) return [];
    const professionals = await this.repos.professionals.findByTenant(input.tenantId, false);
    const byId = new Map(professionals.map((p) => [p.id, p]));

    const today = todayUtcParts(timezone);
    const days: string[] = [];
    for (let i = 1; i <= windowDays; i++) {
      const day = addDaysUtc(timezone, today, i);
      const date = new Date(day.ms).toISOString().slice(0, 10);
      const weekday = new Date(day.ms).getUTCDay();
      const someoneWorks = input.professionalIds.some((pid) => {
        const prof = byId.get(pid);
        return prof ? weeklyScheduleForDay(prof.schedule, weekday).length > 0 : false;
      });
      if (someoneWorks) days.push(date);
    }
    return days;
  }

  async listSlots(input: {
    tenantId: string;
    professionalId: string;
    date: string;
    durationMinutes: number;
    timezone: string;
    granularityMinutes: number;
    now?: Date;
  }): Promise<SlotView[]> {
    const professional = await this.repos.professionals.findById(input.tenantId, input.professionalId);
    if (!professional || !professional.active) {
      throw new NotFoundError('Professional', input.professionalId);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
    if (!match) throw new ValidationError('date must be YYYY-MM-DD');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dayStart = utcLocalStartMs(input.timezone, year, month, day);
    const dayEnd = dayStart + 86_400_000;
    const now = input.now ?? new Date();

    const from = new Date(dayStart).toISOString();
    const to = new Date(dayEnd).toISOString();

    const [appointments, blocks] = await Promise.all([
      this.repos.appointments.findByProfessional(input.tenantId, input.professionalId, from, to),
      this.repos.availabilityBlocks.findActiveByProfessional(input.tenantId, input.professionalId, from, to),
    ]);

    const occupied = appointments
      .filter((a) => OCCUPIED_STATUSES.includes(a.status))
      .map((a) => ({ start: new Date(a.startTime).getTime(), end: new Date(a.endTime).getTime() }));
    const blocked = blocks.map((b) => ({ start: new Date(b.startTime).getTime(), end: new Date(b.endTime).getTime() }));

    const intervals = weeklyScheduleForDay(professional.schedule, new Date(dayStart).getUTCDay()).map((w) => {
      const [sh = 0, sm = 0] = w.start.split(':').map(Number);
      const [eh = 0, em = 0] = w.end.split(':').map(Number);
      return {
        start: dayStart + (((sh * 60 + sm) / input.granularityMinutes) * input.granularityMinutes) * 60_000,
        end: dayStart + (((eh * 60 + em) / input.granularityMinutes) * input.granularityMinutes) * 60_000,
      };
    });

    const slots = buildSlots({
      shiftIntervals: intervals,
      granularityMinutes: input.granularityMinutes,
      occupied,
      blocked,
      now: now.getTime(),
    });

    if (input.durationMinutes <= input.granularityMinutes) return slots;

    return slots.map((s) => {
      const start = new Date(s.start).getTime();
      const end = start + input.durationMinutes * 60_000;
      const fits =
        !s.blocked &&
        s.reason !== 'past' &&
        occupied.every((o) => start >= o.end || end <= o.start) &&
        blocked.every((b) => start >= b.end || end <= b.start) &&
        intervals.some((i) => start >= i.start && end <= i.end);
      return { ...s, available: fits, reason: s.reason ?? (fits ? undefined : 'booked') };
    });
  }
}