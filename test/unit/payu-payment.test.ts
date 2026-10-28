import { describe, expect, it } from 'vitest';
import { PayuPaymentGateway } from '../../src/infrastructure/integrations/payments/payu-payment';
import { payuSign } from '../../src/infrastructure/integrations/payments/shared';
import { EventSignatureError, UnsupportedPaymentPayloadError } from '../../src/shared/errors';

const API_KEY = 'api-key-test';
const MERCHANT_ID = 'merchant-test';

const gateway = new PayuPaymentGateway({ apiKey: API_KEY, merchantId: MERCHANT_ID });

function signedPayload(input: {
  referenceSale: string;
  value: string;
  currency: string;
  statePol: string;
  transactionId?: string;
  additional?: Record<string, string>;
}): Record<string, string> {
  const payload: Record<string, string> = {
    merchant_id: MERCHANT_ID,
    state_pol: input.statePol,
    reference_sale: input.referenceSale,
    value: input.value,
    currency: input.currency,
    transaction_id: input.transactionId ?? 'pu-tx-1',
    reference_pol: 'pol-1',
    ...input.additional,
  };
  payload.sign = payuSign({
    apiKey: API_KEY,
    merchantId: MERCHANT_ID,
    referenceSale: input.referenceSale,
    value: input.value,
    currency: input.currency,
    statePol: input.statePol,
  });
  return payload;
}

describe('PayuPaymentGateway.confirmEvent', () => {
  it('accepts an approved charge confirmation', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-1', value: '12000.00', currency: 'COP', statePol: '4' });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.provider).toBe('payu');
    expect(result.operation).toBe('charge');
    expect(result.status).toBe('approved');
    expect(result.internalReference).toBe('RSV-1');
    expect(result.amount).toBe(12000);
  });

  it('accepts a signed payload sent as url-encoded raw body', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-2', value: '12000.00', currency: 'COP', statePol: '4' });
    const raw = new URLSearchParams(payload).toString();
    const result = await gateway.confirmEvent({ headers: {}, raw });
    expect(result.status).toBe('approved');
  });

  it('rejects a confirmation with an invalid sign', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-3', value: '12000.00', currency: 'COP', statePol: '4' });
    payload.sign = 'deadbeef';
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(EventSignatureError);
  });

  it('rejects a tampered value', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-4', value: '12000.00', currency: 'COP', statePol: '4' });
    payload.value = '99999.00';
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(EventSignatureError);
  });

  it('normalizes value with two decimals when signing', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-5', value: '150', currency: 'COP', statePol: '4' });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.amount).toBe(150);
  });

  it('maps a declined confirmation (state_pol 6)', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-6', value: '12000.00', currency: 'COP', statePol: '6' });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.status).toBe('declined');
  });

  it('maps a refund confirmation when refund_value is present', async () => {
    const payload = signedPayload({
      referenceSale: 'RSV-7-R',
      value: '12000.00',
      currency: 'COP',
      statePol: '4',
      additional: { refund_value: '12000.00' },
    });
    const result = await gateway.confirmEvent({ headers: {}, body: payload });
    expect(result.operation).toBe('refund');
    expect(result.amount).toBe(12000);
  });

  it('fails when merchant_id is missing', async () => {
    const payload = signedPayload({ referenceSale: 'RSV-8', value: '12000.00', currency: 'COP', statePol: '4' });
    delete payload.merchant_id;
    await expect(gateway.confirmEvent({ headers: {}, body: payload })).rejects.toBeInstanceOf(UnsupportedPaymentPayloadError);
  });
});