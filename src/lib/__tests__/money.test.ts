import { describe, expect, it } from 'vitest';
import { evalAmount, formatMoney, splitEvenly, toMinor } from '../money';

describe('money', () => {
  it('converts to integer minor units without float drift', () => {
    expect(toMinor('0.1')).toBe(10);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor('1,00,000.55')).toBe(10000055);
    expect(toMinor('-12.345')).toBe(-1235);
    expect(Number.isInteger(toMinor(19.99))).toBe(true);
  });
  it('evaluates calculator expressions safely', () => {
    expect(evalAmount('250+120*2')).toBe(490);
    expect(evalAmount('250+120×2')).toBe(490);
    expect(evalAmount('(10+5)/2')).toBe(7.5);
    expect(evalAmount('100−25')).toBe(75);
    expect(evalAmount('2+')).toBeNull();
    expect(evalAmount('alert(1)')).toBeNull();
  });
  it('splits evenly with no lost cents', () => {
    const parts = splitEvenly(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });
  it('formats with native digit grouping', () => {
    expect(formatMoney(10000000, 'INR')).toBe('₹1,00,000');
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(-5000, 'USD')).toBe('−$50');
    expect(formatMoney(250000000, 'INR', { compact: true })).toBe('₹25L');
  });
});
