import { addDays, isoDate } from './dates';
import { toMinor } from './money';

export interface VoiceDraft { amount?: number; payee?: string; categoryHint?: string; date: string; type: 'expense' | 'income' }

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
};

/**
 * "Spent 450 on groceries at Whole Foods yesterday" → draft. Deliberately simple rules so
 * it runs offline; the user always confirms before saving.
 */
export function parseVoice(text: string, now = new Date()): VoiceDraft {
  const s = text.toLowerCase().replace(/[,]/g, '');
  const type: VoiceDraft['type'] = /\b(got|received|earned|salary|income|paid me)\b/.test(s) ? 'income' : 'expense';
  let amount: number | undefined;
  const m = /(\d+(?:\.\d{1,2})?)\s*(k|thousand|grand)?/.exec(s);
  if (m) amount = toMinor(parseFloat(m[1]) * (m[2] ? 1000 : 1));
  else {
    const words = s.split(/\s+/).map((w) => WORD_NUM[w]).filter((n) => n !== undefined);
    if (words.length) amount = toMinor(words.reduce((acc, n) => (n >= 100 ? (acc || 1) * n : acc + n), 0));
  }
  let date = now;
  if (/\byesterday\b/.test(s)) date = addDays(now, -1);
  const ago = /(\d+|two|three) days? ago/.exec(s);
  if (ago) date = addDays(now, -(Number(ago[1]) || WORD_NUM[ago[1]] || 0));
  const payee = /\b(?:at|from|to)\s+([a-z0-9&' ]+?)(?=\s+(?:yesterday|today|on|for|\d)|$)/.exec(s)?.[1];
  const categoryHint = /\b(?:on|for)\s+([a-z ]+?)(?=\s+(?:at|from|yesterday|today|\d)|$)/.exec(s)?.[1];
  const cap = (x?: string) => x?.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return { amount, payee: cap(payee), categoryHint: categoryHint?.trim(), date: isoDate(date), type };
}
