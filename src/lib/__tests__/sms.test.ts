import { describe, expect, it } from 'vitest';
import { REVIEW_THRESHOLD, dedupKey, parseAlert } from '../sms';
import { FIXTURES } from './sms.fixtures';

describe('SMS / alert parser', () => {
  it('has at least 30 fixtures', () => expect(FIXTURES.length).toBeGreaterThanOrEqual(30));

  it('reaches ≥ 90% field accuracy on the fixture set', () => {
    let ok = 0;
    const misses: string[] = [];
    for (const [msg, exp] of FIXTURES) {
      const p = parseAlert(msg);
      const good = exp === null
        ? p === null
        : !!p && p.amount === exp.amount && p.direction === exp.direction &&
          (exp.last4 === undefined || p.last4 === exp.last4 || (p.last4 ?? '').endsWith(exp.last4)) &&
          (exp.currency === undefined || p.currency === exp.currency);
      if (good) ok++; else misses.push(`${msg}\n   → ${JSON.stringify(p)}`);
    }
    if (misses.length) console.log('Misses:\n' + misses.join('\n'));
    expect(ok / FIXTURES.length).toBeGreaterThanOrEqual(0.9);
  });

  it('never auto-posts a wrong amount/direction: every mismatch is below review threshold', () => {
    for (const [msg, exp] of FIXTURES) {
      const p = parseAlert(msg);
      if (!p || !exp) continue;
      const wrong = p.amount !== exp.amount || p.direction !== exp.direction;
      if (wrong) expect(p.confidence).toBeLessThan(REVIEW_THRESHOLD);
    }
  });

  it('dedups by ref number, else by amount+time bucket', () => {
    const p = parseAlert(FIXTURES[0][0])!;
    expect(dedupKey(p, 0)).toBe('ref:607123456789');
    const q = { ...p, refNo: undefined };
    expect(dedupKey(q, 1000)).toBe(dedupKey(q, 2000));
  });
});
