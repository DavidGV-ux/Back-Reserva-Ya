import { Appointment, LedgerEntry } from '../entities';
import { money } from '../../shared/money';

export interface ReportAppointmentStats {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface ReportDay {
  /** Día local del negocio en formato YYYY-MM-DD. */
  date: string;
  income: number;
  commission: number;
}

/**
 * Reporte de ingresos del owner para un rango de días (contrato que consume
 * el front en `shared/utils/owner-report.ts`).
 */
export interface OwnerReport {
  from: string;
  to: string;
  currency: string;
  /** Abonos al saldo del negocio (payment_approved · tenant_balance · credit). */
  income: number;
  /** Comisión retenida por la plataforma (platform_commission · platform_revenue · credit). */
  commission: number;
  /** Reembolsos a clientes (refund · debit). */
  refunds: number;
  /** income − refunds. */
  net: number;
  paymentsCount: number;
  appointments: ReportAppointmentStats;
  daily: ReportDay[];
  movements: LedgerEntry[];
  /** Siempre false: el back calcula el reporte con todos los movimientos del rango. */
  partial: false;
}

export const isIncomeEntry = (m: LedgerEntry): boolean =>
  m.type === 'payment_approved' && m.account === 'tenant_balance' && m.direction === 'credit';

export const isCommissionEntry = (m: LedgerEntry): boolean =>
  m.type === 'platform_commission' && m.account === 'platform_revenue' && m.direction === 'credit';

export const isRefundEntry = (m: LedgerEntry): boolean => m.type === 'refund' && m.direction === 'debit';

/** YYYY-MM-DD del instante `at` en la zona horaria del negocio. */
export function localDayKey(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Lista de días YYYY-MM-DD entre `from` y `to`, ambos inclusive. */
export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Arma el reporte a partir de los asientos y citas ya filtrados por rango.
 * Ignora asientos anulados o fallidos para no inflar los totales.
 */
export function buildOwnerReport(input: {
  from: string;
  to: string;
  timeZone: string;
  currency: string;
  movements: LedgerEntry[];
  appointments: Appointment[];
}): OwnerReport {
  const movements = input.movements
    .filter((m) => m.status !== 'reversed' && m.status !== 'failed')
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const sum = (pred: (m: LedgerEntry) => boolean) =>
    money(movements.filter(pred).reduce((s, m) => s + m.amount, 0));

  const income = sum(isIncomeEntry);
  const commission = sum(isCommissionEntry);
  const refunds = sum(isRefundEntry);

  const days = new Map<string, ReportDay>(
    dayRange(input.from, input.to).map((date) => [date, { date, income: 0, commission: 0 }]),
  );
  for (const m of movements) {
    const day = days.get(localDayKey(input.timeZone, new Date(m.timestamp)));
    if (!day) continue;
    if (isIncomeEntry(m)) day.income = money(day.income + m.amount);
    if (isCommissionEntry(m)) day.commission = money(day.commission + m.amount);
  }

  const count = (status: Appointment['status']) =>
    input.appointments.filter((a) => a.status === status).length;

  return {
    from: input.from,
    to: input.to,
    currency: input.currency,
    income,
    commission,
    refunds,
    net: money(income - refunds),
    paymentsCount: movements.filter(isIncomeEntry).length,
    appointments: {
      total: input.appointments.length,
      confirmed: count('confirmed'),
      completed: count('completed'),
      cancelled: count('cancelled'),
      noShow: count('no_show'),
    },
    daily: [...days.values()],
    movements,
    partial: false,
  };
}
