/**
 * Import from the CashBook app (cashbook.in) and similar cash-register apps.
 *
 * CashBook exports each book as Excel/CSV: a few title rows (book name, period, totals) and then
 * a table with columns like Date | Time | Remark | Category | Mode | Cash In | Cash Out | Balance.
 * Column names and order vary between app versions and languages, so instead of a fixed layout
 * we find the header row by scoring known column names, and the person can correct any mapping.
 */
import type { Minor, PaymentMethod } from '../db/types';
import { parseDate } from './csv';
import { toMinor } from './money';
import { excelSerialToDate } from './xlsx';

export type CbField = 'date' | 'time' | 'remark' | 'category' | 'mode' | 'cashIn' | 'cashOut' | 'amount' | 'type' | 'balance' | 'party' | 'entryBy';
export type CbColumns = Partial<Record<CbField, number>>;

export const FIELD_LABEL: Record<CbField, string> = {
  date: 'Date', time: 'Time', remark: 'Remark / description', category: 'Category', mode: 'Payment mode',
  cashIn: 'Cash in', cashOut: 'Cash out', amount: 'Amount (single column)', type: 'In / out type',
  balance: 'Balance', party: 'Party / contact', entryBy: 'Entry by',
};

const SYNONYMS: Record<CbField, string[]> = {
  date: ['date', 'txn date', 'transaction date', 'entry date', 'date of entry'],
  time: ['time', 'entry time'],
  remark: ['remark', 'remarks', 'description', 'particulars', 'details', 'narration', 'note', 'notes', 'comment'],
  category: ['category', 'categories', 'head', 'expense head'],
  mode: ['mode', 'payment mode', 'payment method', 'mode of payment', 'method', 'payment type'],
  cashIn: ['cash in', 'in', 'credit', 'credit amount', 'received', 'income', 'deposit', 'money in', 'cr', 'inflow'],
  cashOut: ['cash out', 'out', 'debit', 'debit amount', 'paid', 'expense', 'withdrawal', 'money out', 'dr', 'outflow'],
  amount: ['amount', 'amt', 'value'],
  type: ['type', 'entry type', 'in/out', 'transaction type', 'cash in/out'],
  balance: ['balance', 'running balance', 'net balance', 'closing balance'],
  party: ['party', 'contact', 'customer', 'supplier', 'party name', 'contact name'],
  entryBy: ['entry by', 'created by', 'added by', 'member', 'user'],
};

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}/ ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Finds the header row (within the first 30 rows) and maps columns to fields. */
export function detectTable(rows: string[][]): { headerRow: number; cols: CbColumns; bookName?: string } | null {
  let best: { headerRow: number; cols: CbColumns; score: number } | null = null;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cols: CbColumns = {};
    let score = 0;
    rows[r].forEach((cell, i) => {
      const h = norm(cell);
      if (!h) return;
      for (const [field, names] of Object.entries(SYNONYMS) as [CbField, string[]][]) {
        if (cols[field] !== undefined) continue;
        if (names.includes(h)) { cols[field] = i; score += 2; return; }
      }
      for (const [field, names] of Object.entries(SYNONYMS) as [CbField, string[]][]) {
        if (cols[field] !== undefined) continue;
        if (names.some((n) => n.length > 3 && h.startsWith(n))) { cols[field] = i; score += 1; return; }
      }
    });
    const usable = cols.date !== undefined && (cols.cashIn !== undefined || cols.cashOut !== undefined || cols.amount !== undefined);
    if (usable && (!best || score > best.score)) best = { headerRow: r, cols, score };
  }
  if (!best) return null;
  // The book's name is usually the first title line above the table.
  const title = rows.slice(0, best.headerRow).map((r) => r.find((c) => c.trim())).find((c) => c && !/report|generated|duration|period|from|total|balance|date/i.test(c));
  return { headerRow: best.headerRow, cols: best.cols, bookName: title?.trim() };
}

export interface CbEntry {
  row: number;
  date: Date;
  remark: string;
  category?: string;
  mode?: string;
  party?: string;
  entryBy?: string;
  amount: Minor; // always positive
  direction: 'in' | 'out';
  balance?: Minor;
}

const num = (s?: string) => {
  if (!s) return 0;
  const t = s.trim();
  if (!t || t === '-' || t === '—') return 0;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/[^\d.\-()]/g, ''));
  const m = toMinor(t.replace(/[()]/g, '').replace(/^-/, ''));
  return neg ? -Math.abs(m) : Math.abs(m);
};

function parseWhen(dateCell: string, timeCell: string | undefined, dayFirst: boolean): Date | null {
  let d: Date | null = null;
  const n = Number(dateCell);
  if (dateCell && Number.isFinite(n) && n > 20000 && n < 80000) d = excelSerialToDate(n);
  else {
    const iso = parseDate(dateCell, dayFirst);
    if (iso) { const [y, mo, da] = iso.split('-').map(Number); d = new Date(y, mo - 1, da); }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const t = timeCell?.trim();
  if (t) {
    const frac = Number(t);
    if (Number.isFinite(frac) && frac >= 0 && frac < 1) {
      const mins = Math.round(frac * 1440);
      d.setHours(Math.floor(mins / 60), mins % 60);
    } else {
      const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i.exec(t);
      if (m) {
        let h = Number(m[1]) % 24;
        const ap = m[3]?.toLowerCase().replace(/\./g, '');
        if (ap === 'pm' && h < 12) h += 12;
        if (ap === 'am' && h === 12) h = 0;
        d.setHours(h, Number(m[2]));
      }
    }
  } else d.setHours(12, 0);
  return d;
}

/**
 * Turns the table into entries. Rows without a valid date or amount (totals, blank lines,
 * "opening balance" lines) are skipped and counted. Returns entries oldest-first.
 */
export function parseCashbook(rows: string[][], headerRow: number, cols: CbColumns, opts: { dayFirst?: boolean } = {}) {
  const dayFirst = opts.dayFirst ?? true;
  const get = (r: string[], f: CbField) => (cols[f] === undefined ? undefined : r[cols[f]!] ?? '');
  const entries: CbEntry[] = [];
  let skipped = 0;
  rows.slice(headerRow + 1).forEach((r, i) => {
    const when = parseWhen(get(r, 'date') ?? '', get(r, 'time'), dayFirst);
    let amount = 0;
    let direction: 'in' | 'out' = 'out';
    if (cols.cashIn !== undefined || cols.cashOut !== undefined) {
      const inn = Math.abs(num(get(r, 'cashIn')));
      const out = Math.abs(num(get(r, 'cashOut')));
      if (inn && !out) { amount = inn; direction = 'in'; }
      else if (out && !inn) { amount = out; direction = 'out'; }
      else if (inn && out) { amount = Math.abs(inn - out); direction = inn >= out ? 'in' : 'out'; }
    } else {
      const a = num(get(r, 'amount'));
      const type = norm(get(r, 'type') ?? '');
      amount = Math.abs(a);
      direction = /in|credit|received|income|cr/.test(type) ? 'in' : /out|debit|paid|expense|dr/.test(type) ? 'out' : a < 0 ? 'out' : 'in';
    }
    const remark = (get(r, 'remark') ?? '').trim();
    if (!when || !amount || /^(total|opening balance|closing balance|net balance)/i.test(remark)) { skipped++; return; }
    const bal = get(r, 'balance');
    entries.push({
      row: headerRow + 2 + i, date: when, remark, amount, direction,
      category: get(r, 'category')?.trim() || undefined,
      mode: get(r, 'mode')?.trim() || undefined,
      party: get(r, 'party')?.trim() || undefined,
      entryBy: get(r, 'entryBy')?.trim() || undefined,
      balance: bal !== undefined && bal.trim() !== '' ? num(bal) : undefined,
    });
  });
  // CashBook usually lists newest first; keep the file's order inside a day but sort oldest-first.
  const newestFirst = entries.length > 1 && entries[0].date > entries[entries.length - 1].date;
  const ordered = newestFirst ? [...entries].reverse() : entries;
  ordered.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { entries: ordered, skipped };
}

/** The balance before the first entry, so the imported account ends on the same balance as CashBook. */
export function openingBalance(entries: CbEntry[]): Minor | undefined {
  const first = entries[0];
  if (!first || first.balance === undefined) return undefined;
  return first.balance - (first.direction === 'in' ? first.amount : -first.amount);
}

export function totals(entries: CbEntry[]) {
  let cashIn = 0, cashOut = 0;
  for (const e of entries) e.direction === 'in' ? (cashIn += e.amount) : (cashOut += e.amount);
  return { cashIn, cashOut, net: cashIn - cashOut };
}

/** CashBook's payment modes → Tandem's payment methods. */
export function modeToMethod(mode?: string): PaymentMethod {
  const m = (mode ?? '').toLowerCase();
  if (!m) return 'cash';
  if (/cash/.test(m)) return 'cash';
  if (/credit\s*card/.test(m)) return 'credit';
  if (/card|debit/.test(m)) return 'debit';
  if (/cheque|check/.test(m)) return 'cheque';
  if (/neft|rtgs|imps|bank|transfer|wire|ach/.test(m)) return 'transfer';
  if (/wallet|paytm wallet/.test(m)) return 'wallet';
  if (/online|upi|gpay|google pay|phonepe|paytm|bhim|net ?banking|pix|venmo|zelle/.test(m)) return 'online';
  return 'other';
}
