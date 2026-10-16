import type { Minor } from '../db/types';

/** Convert a user-typed major-unit string/number to integer minor units, rounding half away from zero. */
export function toMinor(major: number | string): Minor {
  const n = typeof major === 'string' ? Number(major.replace(/[,\s₹$€£]/g, '')) : major;
  if (!Number.isFinite(n)) return 0;
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

export const toMajor = (m: Minor) => m / 100;

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(currency: string, locale: string, decimals: number) {
  const k = `${currency}|${locale}|${decimals}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
    fmtCache.set(k, f);
  }
  return f;
}

/** Locale that gives each currency its native digit grouping (e.g. INR → 1,00,000). */
export const CURRENCY_LOCALE: Record<string, string> = {
  USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', INR: 'en-IN', AED: 'en-AE', SGD: 'en-SG',
  AUD: 'en-AU', CAD: 'en-CA', JPY: 'ja-JP', CHF: 'de-CH', ZAR: 'en-ZA', BRL: 'pt-BR',
};
export const CURRENCIES = Object.keys(CURRENCY_LOCALE);

/** Formats minor units using the currency's native grouping. Drops the minor part when the amount is whole. */
export function formatMoney(m: Minor, currency = 'USD', opts: { compact?: boolean; sign?: boolean; locale?: string } = {}) {
  const locale = opts.locale ?? CURRENCY_LOCALE[currency] ?? 'en-US';
  const abs = Math.abs(m);
  let out: string;
  if (opts.compact && abs >= 10_000_00) {
    const major = abs / 100;
    if (currency === 'INR' && major >= 1e5) {
      out = major >= 1e7 ? `₹${trim(major / 1e7)}Cr` : `₹${trim(major / 1e5)}L`;
    } else {
      out = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(major);
    }
  } else {
    out = nf(currency, locale, abs % 100 === 0 ? 0 : 2).format(abs / 100);
  }
  if (m < 0) return `−${out}`;
  if (opts.sign && m > 0) return `+${out}`;
  return out;
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Tiny calculator for the amount field: supports + - * / ( ) and decimals.
 * Recursive descent so we never use eval(). Returns null on invalid input.
 */
export function evalAmount(expr: string): number | null {
  const s = expr.replace(/[,\s₹$€£]/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!s) return null;
  let i = 0;
  const peek = () => s[i];
  function num(): number {
    if (peek() === '(') { i++; const v = add(); if (s[i] !== ')') throw 0; i++; return v; }
    if (peek() === '-') { i++; return -num(); }
    const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function mul(): number {
    let v = num();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]; const r = num();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function add(): number {
    let v = mul();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]; const r = mul();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = add();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return Math.round(v * 100) / 100;
  } catch {
    return null;
  }
}

/** Split an amount into n integer parts that sum exactly to the total (remainder goes to the first parts). */
export function splitEvenly(total: Minor, n: number): Minor[] {
  const base = Math.trunc(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, k) => base + (k < rem ? 1 : 0));
}

/** Percentage helper for integer money, rounded to 1 dp. */
export const pct = (part: Minor, whole: Minor) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
