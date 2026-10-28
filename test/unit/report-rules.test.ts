import { describe, expect, it } from 'vitest';
import { Appointment, LedgerEntry } from '../../src/domain/entities';
import { buildOwnerReport, dayRange, localDayKey } from '../../src/domain/rules/report-rules';

const TZ = 'America/Bogota';

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'led',
  tenantId: 't1',
  transactionId: 'tx',
  type: 'payment_approved',
  account: 'tenant_balance',
  direction: 'credit',
  amount: 0,
  currency: 'COP',
  status: 'posted',
  // 10:00 en Bogotá (UTC-5)
  timestamp: '2026-10-10T15:00:00.000Z',
  ...overrides,
});

const appt = (status: Appointment['status']): Appointment => ({ status } as Appointment);

describe('buildOwnerReport', () => {
  const report = buildOwnerReport({
    from: '2026-10-10',
    to: '2026-10-12',
    timeZone: TZ,
    currency: 'COP',
    movements: [
      entry({ id: 'a', amount: 28_500 }),
      entry({ id: 'b', type: 'platform_commission', account: 'platform_revenue', amount: 1_500 }),
      entry({ id: 'c', amount: 19_000, timestamp: '2026-10-12T23:00:00.000Z' }),
      entry({
        id: 'd',
        type: 'refund',
        account: 'customer_refund_liability',
        direction: 'debit',
        amount: 10_000,
        timestamp: '2026-10-11T14:00:00.000Z',
      }),
      entry({ id: 'e', amount: 55_555, status: 'reversed' }),
      entry({ id: 'f', amount: 7_000, status: 'failed' }),
    ],
    appointments: [appt('completed'), appt('cancelled'), appt('confirmed'), appt('no_show')],
  });

  it('suma ingresos, comisión y reembolsos', () => {
    expect(report.income).toBe(47_500);
    expect(report.commission).toBe(1_500);
    expect(report.refunds).toBe(10_000);
    expect(report.net).toBe(37_500);
    expect(report.paymentsCount).toBe(2);
  });

  it('ignora asientos anulados o fallidos', () => {
    expect(report.movements.map((m) => m.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('genera un día por fecha del rango, en la zona horaria del negocio', () => {
    expect(report.daily.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(report.daily[0]).toMatchObject({ income: 28_500, commission: 1_500 });
    expect(report.daily[1]).toMatchObject({ income: 0, commission: 0 });
    // 23:00 UTC del 12 = 18:00 del 12 en Bogotá
    expect(report.daily[2]!.income).toBe(19_000);
  });

  it('ordena los movimientos del más reciente al más antiguo', () => {
    expect(report.movements[0]!.id).toBe('c');
  });

  it('cuenta citas por estado', () => {
    expect(report.appointments).toEqual({ total: 4, confirmed: 1, completed: 1, cancelled: 1, noShow: 1 });
  });

  it('marca el reporte como completo (no parcial)', () => {
    expect(report.partial).toBe(false);
    expect(report.currency).toBe('COP');
  });
});

describe('helpers de fechas', () => {
  it('dayRange incluye ambos extremos y cruza meses', () => {
    expect(dayRange('2026-01-30', '2026-02-02')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('localDayKey usa la fecha local del negocio, no la UTC', () => {
    // 02:00 UTC del 11 = 21:00 del 10 en Bogotá
    expect(localDayKey(TZ, new Date('2026-10-11T02:00:00.000Z'))).toBe('2026-10-10');
  });
});
