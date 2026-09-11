import { describe, expect, it } from 'vitest';
import { applyCancellationPolicy } from '../../src/domain/rules/cancellation-rules';

const startTime = new Date(Date.UTC(2026, 3, 10, 14, 0)).toISOString();

describe('applyCancellationPolicy', () => {
  it('refunds fully when client cancels within tolerance window', () => {
    const cancelledAt = new Date(Date.UTC(2026, 3, 9, 12, 0)).toISOString(); // 26h before
    const d = applyCancellationPolicy({
      startTime,
      cancelledAt,
      cancellationToleranceHours: 24,
      advanceAmount: 10000,
      requestedBy: 'client',
      processingFeeRate: 0,
      refundRateWithinWindow: 1,
    });
    expect(d.policyApplied).toBe('client_within_window');
    expect(d.refundAmount).toBe(10000);
    expect(d.refundStatus).toBe('pending');
  });

  it('does not refund when client cancels outside the window', () => {
    const cancelledAt = new Date(Date.UTC(2026, 3, 10, 13, 0)).toISOString(); // 1h before
    const d = applyCancellationPolicy({
      startTime,
      cancelledAt,
      cancellationToleranceHours: 24,
      advanceAmount: 10000,
      requestedBy: 'client',
      processingFeeRate: 0,
      refundRateWithinWindow: 1,
    });
    expect(d.policyApplied).toBe('client_outside_window');
    expect(d.refundAmount).toBe(0);
    expect(d.refundStatus).toBe('not_applicable');
  });

  it('applies a processing fee on refunds when configured', () => {
    const cancelledAt = new Date(Date.UTC(2026, 3, 9, 12, 0)).toISOString(); // 26h before
    const d = applyCancellationPolicy({
      startTime,
      cancelledAt,
      cancellationToleranceHours: 24,
      advanceAmount: 10000,
      requestedBy: 'client',
      processingFeeRate: 0.02,
      refundRateWithinWindow: 1,
    });
    expect(d.refundAmount).toBe(9800);
  });

  it('always refunds when it is a tenant cancellation', () => {
    const cancelledAt = new Date(Date.UTC(2026, 3, 10, 13, 0)).toISOString();
    const d = applyCancellationPolicy({
      startTime,
      cancelledAt,
      cancellationToleranceHours: 24,
      advanceAmount: 10000,
      requestedBy: 'owner',
      processingFeeRate: 0,
      refundRateWithinWindow: 1,
    });
    expect(d.policyApplied).toBe('tenant_cancelled');
    expect(d.refundAmount).toBe(10000);
  });
});