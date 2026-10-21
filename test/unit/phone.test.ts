import { describe, expect, it } from 'vitest';
import { normalizePhoneE164 } from '../../src/shared/phone';

describe('normalizePhoneE164', () => {
  it('normalizes a local Colombian mobile number', () => {
    expect(normalizePhoneE164('3001234567')).toBe('+573001234567');
  });
  it('keeps an explicit international number', () => {
    expect(normalizePhoneE164('+573001234567')).toBe('+573001234567');
  });
  it('handles an international number typed without + if it includes the country code', () => {
    expect(normalizePhoneE164('573001234567')).toBe('+573001234567');
  });
  it('drops a leading 0 when adding the country code', () => {
    expect(normalizePhoneE164('03001234567')).toBe('+573001234567');
  });
  it('converts the 00 international prefix to +', () => {
    expect(normalizePhoneE164('00573001234567')).toBe('+573001234567');
  });
  it('strips spaces, dashes and parentheses', () => {
    expect(normalizePhoneE164('+57 (300) 123-4567')).toBe('+573001234567');
  });
  it('supports other country codes when the caller provides them', () => {
    expect(normalizePhoneE164('2025550111', '1')).toBe('+12025550111');
  });
  it('returns null for empty/invalid input', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('   ')).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
    expect(normalizePhoneE164('+57')).toBeNull();
    expect(normalizePhoneE164('123')).toBeNull();
  });
});