const OFFSET_RE = /GMT([+-])(\d{2}):(\d{2})/;

export function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour12: false,
  }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = OFFSET_RE.exec(name);
  if (!m) return 0;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (hours * 60 + minutes) * 60_000;
}

export function localDateParts(
  timeZone: string,
  at: Date,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute') };
}

export function utcLocalStartMs(timeZone: string, year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offset = zoneOffsetMs(timeZone, new Date(guess));
  const localMidnight = Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
  const verify = localDateParts(timeZone, new Date(localMidnight));
  if (
    verify.year !== year ||
    verify.month !== month ||
    verify.day !== day ||
    verify.hour !== 0 ||
    verify.minute !== 0
  ) {
    return localMidnight + zoneOffsetMs(timeZone, new Date(localMidnight));
  }
  return localMidnight;
}

export function todayUtcParts(timeZone: string): { year: number; month: number; day: number } {
  const p = localDateParts(timeZone, new Date());
  return { year: p.year, month: p.month, day: p.day };
}

export function addDaysUtc(
  timeZone: string,
  base: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number; ms: number } {
  const localStart = utcLocalStartMs(timeZone, base.year, base.month, base.day);
  const target = new Date(localStart + days * 86_400_000);
  const p = localDateParts(timeZone, target);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    ms: utcLocalStartMs(timeZone, p.year, p.month, p.day),
  };
}