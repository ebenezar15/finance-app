import type { Minor } from '../db/types';
import { APP_LOCALE } from './locale';

/** Convert a user-typed major-unit string/number to integer minor units, rounding half away from zero. */
export function toMinor(major: number | string): Minor {
  // Accept any currency symbol or code around the number ("€12", "12 kr", "CHF 9.50").
  const n = typeof major === 'string' ? Number(major.replace(/[^0-9.\-]/g, '')) : major;
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

/**
 * Preferred locale per currency, for currencies with a strong national convention (e.g.
 * INR → 1,00,000). Every other currency is formatted with the device's own locale.
 */
const PREFERRED_LOCALE: Record<string, string> = {
  USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', INR: 'en-IN', AED: 'en-AE', SGD: 'en-SG', AUD: 'en-AU', CAD: 'en-CA',
  JPY: 'en-JP', CHF: 'de-CH', ZAR: 'en-ZA', BRL: 'pt-BR', PKR: 'en-PK', BDT: 'en-BD', NPR: 'en-NP', LKR: 'en-LK',
  NZD: 'en-NZ', HKD: 'en-HK', PHP: 'en-PH', NGN: 'en-NG', KES: 'en-KE', MXN: 'es-MX', CNY: 'zh-CN', KRW: 'ko-KR',
};

/** Fallback when the runtime can't enumerate ISO currencies. */
const COMMON = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'SGD', 'HKD', 'NZD', 'AED', 'SAR', 'QAR',
  'KWD', 'BHD', 'OMR', 'ZAR', 'NGN', 'KES', 'EGP', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'SEK', 'NOK', 'DKK', 'PLN',
  'CZK', 'HUF', 'RON', 'TRY', 'ILS', 'RUB', 'UAH', 'PKR', 'BDT', 'LKR', 'NPR', 'IDR', 'MYR', 'THB', 'VND', 'PHP', 'KRW', 'TWD'];

/** Every ISO 4217 currency the runtime knows (~300), else a list of common ones. */
export const CURRENCIES: string[] = (() => {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency');
    if (all?.length) return all;
  } catch { /* older runtime */ }
  return [...COMMON].sort();
})();
export const POPULAR_CURRENCIES = COMMON.slice(0, 16);

export const isCurrency = (code: string) => {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try { new Intl.NumberFormat('en', { style: 'currency', currency: code }); return true; } catch { return false; }
};

const deviceLocale = () => {
  try { return navigator.language || 'en-US'; } catch { return 'en-US'; }
};
export const localeFor = (currency: string) => PREFERRED_LOCALE[currency] ?? deviceLocale();

export function currencyName(code: string, locale = deviceLocale()) {
  try { return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code; } catch { return code; }
}

/** How many decimals the currency uses (JPY 0, USD 2, KWD 3). */
export function currencyDigits(code: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}

export function currencySymbol(code: string, locale = localeFor(code)) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch { return code; }
}

/**
 * Formats minor units (amount × 100) for any ISO currency, using its own decimal places.
 * Whole amounts drop the decimals. Invalid codes fall back to a plain number + code.
 */
export function formatMoney(m: Minor, currency = 'USD', opts: { compact?: boolean; sign?: boolean; locale?: string } = {}) {
  const locale = opts.locale ?? localeFor(currency);
  const abs = Math.abs(m);
  const major = abs / 100;
  let out: string;
  try {
    if (opts.compact && abs >= 10_000_00) {
      if (currency === 'INR' && major >= 1e5) {
        out = major >= 1e7 ? `₹${trim(major / 1e7)}Cr` : `₹${trim(major / 1e5)}L`;
      } else {
        out = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(major);
      }
    } else {
      const digits = currencyDigits(currency);
      out = nf(currency, locale, abs % 100 === 0 ? 0 : Math.min(2, digits) === 0 ? 0 : digits).format(major);
    }
  } catch {
    out = `${major.toLocaleString(APP_LOCALE, { maximumFractionDigits: 2 })} ${currency}`;
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
  // Strip currency symbols (any Unicode \p{Sc}), spaces, grouping commas and a leading or
  // trailing currency code like "CHF" or "kr"; anything else that isn't arithmetic is invalid.
  const s = expr.trim().replace(/^[A-Za-z]{1,3}\.?\s*|\s*[A-Za-z]{1,3}\.?$/g, '')
    .replace(/[\p{Sc},\s]/gu, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
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
