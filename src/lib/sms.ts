/**
 * Bank / card / wallet alert parser. Pluggable: each template is tried in order and the
 * generic heuristic parser runs last. Anything with confidence < REVIEW_THRESHOLD goes to the
 * review inbox — the app never silently posts a low-confidence parse.
 *
 * To add a bank: push a template to TEMPLATES with a `match` regex for the sender/body and an
 * `extract` that returns the fields it is sure about. See README → "Adding an SMS template".
 */
import { CURRENCIES, toMinor } from './money';

export interface ParsedAlert {
  amount: number; // minor units
  currency: string;
  direction: 'debit' | 'credit';
  last4?: string;
  merchant?: string;
  balance?: number;
  refNo?: string;
  date?: string;
  bank?: string;
  confidence: number;
  template: string;
}

export const REVIEW_THRESHOLD = 0.75;

// Symbols and local abbreviations (case-insensitive); full ISO codes are matched separately, case-sensitively.
const CUR = '(?:Rs\\.?|₹|US\\$|S\\$|A\\$|C\\$|NZ\\$|HK\\$|R\\$|\\$|€|£|¥|₩|₦|₱|₺|₫|฿|₪|₽|₴|₵|₸|zł|Kč|Ksh|Dhs?|SAR|AED|INR|USD|EUR|GBP)';
const AMT = '([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)';

const CUR_MAP: Record<string, string> = {
  inr: 'INR', rs: 'INR', 'rs.': 'INR', '₹': 'INR', usd: 'USD', us$: 'USD', $: 'USD', eur: 'EUR', '€': 'EUR',
  gbp: 'GBP', '£': 'GBP', aed: 'AED', dh: 'AED', dhs: 'AED', sar: 'SAR', s$: 'SGD', a$: 'AUD', c$: 'CAD', nz$: 'NZD', hk$: 'HKD',
  r$: 'BRL', '¥': 'JPY', '₩': 'KRW', '₦': 'NGN', '₱': 'PHP', '₺': 'TRY', '₫': 'VND', '฿': 'THB', '₪': 'ILS', '₽': 'RUB',
  '₴': 'UAH', '₵': 'GHS', '₸': 'KZT', 'zł': 'PLN', 'kč': 'CZK', ksh: 'KES',
};
/** A bare "$" or "¥" is ambiguous; callers pass the household currency as the tie-breaker. */
const normCur = (c: string, fallback: string) => {
  const k = c.toLowerCase().replace(/\s/g, '');
  if (/^[A-Z]{3}$/.test(c)) return c;
  if (k === '$' && fallback.endsWith('D')) return fallback; // USD, CAD, AUD, SGD, NZD, HKD…
  if (k === '¥' && (fallback === 'CNY' || fallback === 'JPY')) return fallback;
  return CUR_MAP[k] ?? fallback;
};
const ISO = new RegExp(`\\b(${CURRENCIES.join('|')})\\s?${'([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,3})?|[0-9]+(?:\\.[0-9]{1,3})?)'}`);
const ISO_AFTER = new RegExp(`([0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,3})?|[0-9]+(?:\\.[0-9]{1,3})?)\\s?(${CURRENCIES.join('|')})\\b`);

const DEBIT = /\b(debited|spent|paid|purchase|withdrawn|sent|charged|charge of|you made a|dr\b|debit|txn of|used at|payment of)/i;
const CREDIT = /\b(credited|received|deposited|refund(?:ed)?|cr\b|credit(?:ed)? to|added to)/i;

let fallbackCurrency = 'USD';

/** Finds the first amount with a currency marker: a symbol, an ISO code before it, or an ISO code after it ("120 SEK"). */
function amountAfterCurrency(s: string) {
  const hits: { amount: number; currency: string; index: number }[] = [];
  const sym = new RegExp(`${CUR}\\s?${AMT}`, 'i').exec(s);
  if (sym) hits.push({ amount: toMinor(sym[1]), currency: normCur(/^[^\d]+/.exec(sym[0])![0].trim(), fallbackCurrency), index: sym.index });
  const iso = ISO.exec(s);
  if (iso) hits.push({ amount: toMinor(iso[2]), currency: iso[1], index: iso.index });
  const after = ISO_AFTER.exec(s);
  if (after) hits.push({ amount: toMinor(after[1]), currency: after[2], index: after.index });
  return hits.sort((a, b) => a.index - b.index)[0] ?? null;
}

const LAST4 = /(?:a\/?c|acct|account|card|ending|xx+|\*+)\s*(?:no\.?\s*)?(?:ending\s*(?:in|with)?\s*)?[x*]*\s?(\d{3,4})\b/i;
const BAL = new RegExp(`(?:avl\\.?\\s*bal(?:ance)?|available balance|bal(?:ance)?)\\s*(?:is|:)?\\s*${CUR}?\\s?${AMT}`, 'i');
const REF = /(?:ref(?:erence)?\s*(?:no\.?|#|:)?|upi\s*(?:ref|txn)?\s*(?:no\.?|id)?[:\s]*|txn\s*(?:id|no)\.?[:\s]*|rrn[:\s]*)\s*([A-Z0-9]{6,})/i;
const DATE = /\b(\d{1,2}[-/ ](?:\d{1,2}|[A-Za-z]{3})[-/ ]\d{2,4})\b/;

function merchantOf(s: string): string | undefined {
  const pats = [
    /\b(?:transaction|purchase|payment) with\s+([A-Za-z0-9&.' _-]{2,40}?)(?=\s+(?:on|via|using)\b|[.,]|$)/i,
    /\b(?:at|to|towards|@)\s+([A-Za-z0-9&.' _-]{2,40}?)(?=\s+(?:on|via|using|ref|for|from|upi|avl|with|was|has|is|card)\b|[.,;]|$)/i,
    /\bVPA\s+([a-z0-9._-]+@[a-z]+)/i,
    /\bfrom\s+([A-Za-z0-9&.' _-]{2,40}?)(?=\s+(?:on|via|ref|\.|,)|[.,]|$)/i,
    /\bInfo:?\s*([A-Za-z0-9*&._ -]{2,40})/i,
  ];
  for (const p of pats) {
    const m = p.exec(s);
    if (m) {
      const v = m[1].trim().replace(/\s{2,}/g, ' ');
      if (!/^(your|a\/c|ac|account|card|you)\b/i.test(v) && !/^\d+$/.test(v)) return tidy(v);
    }
  }
  return undefined;
}
const tidy = (v: string) => {
  const vpa = /^([a-z0-9._-]+)@/i.exec(v);
  const base = vpa ? vpa[1].replace(/[._-]/g, ' ').replace(/\d+/g, '').trim() || v : v.replace(/[*_]+/g, ' ');
  return base.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
};

interface Template { name: string; match: RegExp; extract: (s: string) => Partial<ParsedAlert> | null }

/** Bank-specific templates. These boost confidence when the structure is fully recognised. */
export const TEMPLATES: Template[] = [
  {
    name: 'upi-debit',
    match: /(debited|sent).*(UPI|VPA)|UPI.*(debited|sent)/i,
    extract: (s) => {
      const a = amountAfterCurrency(s);
      return a ? { amount: a.amount, currency: a.currency, direction: 'debit', confidence: 0.92 } : null;
    },
  },
  {
    name: 'card-spend',
    match: /(spent|used|purchase|charged).*(card|credit card|debit card)|card.*(spent|used|purchase|charged)/i,
    extract: (s) => {
      const a = amountAfterCurrency(s);
      return a ? { amount: a.amount, currency: a.currency, direction: 'debit', confidence: 0.9 } : null;
    },
  },
  {
    name: 'account-credit',
    match: /(credited|deposited|received)/i,
    extract: (s) => {
      const a = amountAfterCurrency(s);
      return a ? { amount: a.amount, currency: a.currency, direction: 'credit', confidence: 0.88 } : null;
    },
  },
  {
    name: 'atm-withdrawal',
    match: /(withdrawn|withdrawal).*(ATM)|ATM.*(withdraw)/i,
    extract: (s) => {
      const a = amountAfterCurrency(s);
      return a ? { amount: a.amount, currency: a.currency, direction: 'debit', merchant: 'ATM withdrawal', confidence: 0.93 } : null;
    },
  },
];

/** Messages that look financial but are not transactions (OTPs, offers, due reminders). */
const NOISE = /\b(OTP|one time password|verification code|offer|cashback upto|apply now|loan approved|pre-approved|is due|due on|min(?:imum)? amount due|will be debited|requested|request of|declined|failed)\b/i;

/** `homeCurrency` resolves ambiguous symbols like a bare "$" (USD vs CAD vs AUD…). */
export function parseAlert(raw: string, homeCurrency = 'USD'): ParsedAlert | null {
  fallbackCurrency = homeCurrency;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || NOISE.test(s)) return null;
  const base = amountAfterCurrency(s);
  if (!base) return null;

  let result: Partial<ParsedAlert> | null = null;
  let template = 'generic';
  for (const t of TEMPLATES) {
    if (!t.match.test(s)) continue;
    const r = t.extract(s);
    if (r) { result = r; template = t.name; break; }
  }
  if (!result) {
    const isDebit = DEBIT.test(s), isCredit = CREDIT.test(s);
    if (isDebit === isCredit) {
      // Ambiguous direction → low confidence so it lands in review.
      result = { amount: base.amount, currency: base.currency, direction: isCredit ? 'credit' : 'debit', confidence: 0.4 };
    } else {
      result = { amount: base.amount, currency: base.currency, direction: isDebit ? 'debit' : 'credit', confidence: 0.7 };
    }
  }
  // When both words appear the earlier one wins ("debited … credited to beneficiary").
  const d = s.search(DEBIT), c = s.search(CREDIT);
  if (d >= 0 && c >= 0 && template !== 'atm-withdrawal') result.direction = d < c ? 'debit' : 'credit';

  const last4 = LAST4.exec(s)?.[1];
  const bal = BAL.exec(s);
  const ref = REF.exec(s)?.[1];
  const date = DATE.exec(s)?.[1];
  const merchant = result.merchant ?? merchantOf(s);
  let confidence = result.confidence ?? 0.5;
  if (last4) confidence += 0.03;
  if (merchant) confidence += 0.03;
  if (ref) confidence += 0.02;

  return {
    amount: result.amount!, currency: result.currency!, direction: result.direction!,
    last4: last4?.slice(-4), merchant, balance: bal ? toMinor(bal[1]) : undefined, refNo: ref, date,
    confidence: Math.min(0.99, confidence), template,
  };
}

/** Dedup key: ref no if present, else amount + 10-minute bucket. */
export function dedupKey(p: ParsedAlert, receivedAt: number) {
  return p.refNo ? `ref:${p.refNo}` : `amt:${p.amount}:${Math.floor(receivedAt / 600_000)}`;
}
