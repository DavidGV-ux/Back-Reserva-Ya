import {
  Cancellation,
  CancellationPolicy,
  CancellationRequestedBy,
  RefundStatus,
} from '../entities';
import { money } from '../../shared/money';

export interface CancellationRuleInput {
  startTime: string;
  cancelledAt: string;
  cancellationToleranceHours: number;
  advanceAmount: number;
  requestedBy: CancellationRequestedBy;
  processingFeeRate: number;
  refundRateWithinWindow: number;
}

export interface CancellationDecision {
  policyApplied: CancellationPolicy;
  processingFee: number;
  refundAmount: number;
  refundStatus: RefundStatus;
}

export function applyCancellationPolicy(input: CancellationRuleInput): CancellationDecision {
  const { requestedBy, cancelledAt, startTime, cancellationToleranceHours } = input;
  const start = new Date(startTime).getTime();
  const cancelled = new Date(cancelledAt).getTime();
  const withinWindow =
    start - cancelled >= cancellationToleranceHours * 3_600_000 ||
    requestedBy !== 'client';

  let policyApplied: CancellationPolicy;
  let refundRate = 0;
  let processingFeeRate = 0;

  if (requestedBy === 'client') {
    policyApplied = withinWindow ? 'client_within_window' : 'client_outside_window';
    if (withinWindow) {
      refundRate = Math.min(1, Math.max(0, input.refundRateWithinWindow));
      processingFeeRate = withinWindow ? Math.min(1, Math.max(0, input.processingFeeRate)) : 0;
    }
  } else if (requestedBy === 'owner' || requestedBy === 'professional') {
    policyApplied = 'tenant_cancelled';
    refundRate = 1;
    processingFeeRate = 0;
  } else {
    policyApplied = 'system_cancelled';
    refundRate = 1;
    processingFeeRate = 0;
  }

  const processingFee = money(input.advanceAmount * processingFeeRate);
  const refundAmount = money(input.advanceAmount * refundRate - processingFee);

  return {
    policyApplied,
    processingFee,
    refundAmount: Math.max(0, refundAmount),
    refundStatus: refundAmount > 0 ? 'pending' : 'not_applicable',
  };
}

export function buildCancellation(
  decision: CancellationDecision,
  requestedBy: CancellationRequestedBy,
  reason: string | undefined,
  at: string,
): Cancellation {
  return {
    requestedBy,
    requestedAt: at,
    reason,
    policyApplied: decision.policyApplied,
    processingFee: decision.processingFee,
    refundAmount: decision.refundAmount,
    refundStatus: decision.refundStatus,
  };
}