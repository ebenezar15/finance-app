/**
 * Turns the text read off a payment-receipt screenshot (Google Pay, PhonePe, Paytm, a bank app)
 * into one message-style sentence that `parseAlert` in ./sms understands, e.g.
 *
 *   Paid ₹250.00 to Ramesh Stores. UPI Ref 431298765432 on 12-11-2026
 *
 * so a screenshot goes through exactly the same capture path as a notification or an SMS.
 *
 * OCR text is noisy, and the English model has no rupee sign: "₹" comes out as "%", "¥", "F",
 * "z", a digit, or not at all. So the amount is never "the number after ₹". Every number on the
 * screen is a candidate; identifiers, dates, times, balances and offers are thrown out; what is
 * left is scored on how it is marked and where it sits; and when nothing scores well enough the
 * answer is null rather than a guess. A screen that says failed, pending or declined is null too.
 *
 * Pure: no DOM, no I/O.
 */

export interface ReceiptRead {
  /** The sentence for `parseAlert` / `capturePayments`. */
  message: string;
  /** Plain decimal rupees with two places, e.g. "1249.50". */
  amount: string;
  direction: 'debit' | 'credit';
  payee?: string;
  /** 12-digit UPI reference (RRN / UTR). */
  refNo?: string;
  /** dd-mm-yyyy. */
  date?: string;
  /** True when the amount rests on weaker evidence (no currency mark, or a correction was applied). */
  unsure: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DAY_MON_YEAR = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.,-]*${MON}[\\s.,'-]*(\\d{4}|\\d{2})(?![:\\d])`, 'i');
const MON_DAY_YEAR = new RegExp(`\\b${MON}[\\s.]*(\\d{1,2})(?:st|nd|rd|th)?[\\s,]+(\\d{4})\\b`, 'i');
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\b\.?)?/gi;

/** A status row saying this is not a completed payment. Only short rows count: small print on a good receipt can say "failed" too. */
const NOT_DONE = /\b(fail(?:ed|ure)?|declined|unsuccessful|pending|processing|in progress|not completed|incomplete|cancell?ed|rejected|timed out|expired|reversed|requested|(?:payment|collect|money) request|request from)\b/i;
const isStatusRow = (l: string) => l.split(' ').length <= 5 && NOT_DONE.test(l);
const DEBIT_WORD = /\b(paid|debited|sent|payment (?:successful|done|completed?)|transfer(?:red)? to|money sent)\b/i;
const CREDIT_WORD = /\b(received|credited|refund(?:ed)?)\b/i;

/** Lines whose numbers are never the amount paid. */
const NOT_AMOUNT_LINE = /\b(utr|ref(?:erence)?|rrn|txn|transaction id|order id|upi id|vpa|mobile|phone|balance|bal|cash ?back|points?|rewards?|won|offers?|coupon|fees?|charges?|gst|tax|limit|otp|version)\b/i;
const ACCOUNT_LINE = /\b(bank|a\/c|acct?|account|card|wallet)\b|x{2,}\s?\d|\*{2,}\s?\d/i;
/** "Amount ₹ 5,000.00", "Total paid: 250": the label runs straight into the number. */
const AMOUNT_LABEL = /\b(amount|total|paid|debited|credited|received|sent|payment of)\b[^A-Za-z0-9]*$/i;
const NEAR_WORD = /\b(paid|to|from|received|sent|amount|successful(?:ly)?|completed|debited|credited)\b/i;

/** "O" for zero and "l"/"I" for one, but only inside something that is already a number. */
function fixDigits(line: string): string {
  let s = line, prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/(\d[,.]?)[Oo](?=[\dOo,.]|[^A-Za-z]|$)/g, '$10').replace(/(\d[,.]?)[lI|](?=[\d,])/g, '$11');
  }
  return s;
}

const WORD_VALUES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const WORD_SCALES: Record<string, number> = { thousand: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, crore: 10_000_000, crores: 10_000_000, million: 1_000_000 };

/** "Rupees One Thousand Two Hundred Forty Nine and Fifty Paise Only" → 124950 (paise). Null unless every word is understood. */
export function wordsToPaise(text: string): number | null {
  const m = /\b(?:rupees?|rs\.?|inr)\s+(.+?)\s+only\b/i.exec(text.replace(/\s+/g, ' '));
  if (!m) return null;
  const all = m[1].toLowerCase();
  let main = all, paise: string | undefined;
  const at = all.search(/\s+paise?\b/);
  if (at >= 0) {
    // "… forty nine and fifty paise": the paise are whatever follows the last "and".
    const head = all.slice(0, at), and = head.lastIndexOf(' and ');
    if (and < 0) return null;
    main = head.slice(0, and); paise = head.slice(and + 5);
  }
  const read = (s: string): number | null => {
    let total = 0, part = 0, seen = false;
    for (const w of s.replace(/-/g, ' ').split(/\s+/).filter((x) => x && x !== 'and' && !/^paise?$/.test(x))) {
      if (w in WORD_VALUES) { part += WORD_VALUES[w]; seen = true; }
      else if (w === 'hundred') { part = (part || 1) * 100; seen = true; }
      else if (w in WORD_SCALES) { total += (part || 1) * WORD_SCALES[w]; part = 0; seen = true; }
      else return null;
    }
    return seen ? total + part : null;
  };
  const r = read(main);
  if (r === null) return null;
  const p = paise === undefined ? 0 : read(paise);
  if (p === null || p > 99) return null;
  return r * 100 + p;
}

interface Candidate {
  paise: number;
  line: number;
  /** How the number was marked: a real rupee marker, a symbol that is probably a misread one, or nothing. */
  mark: 'rupee' | 'symbol' | 'none';
  alone: boolean;
  labelled: boolean;
  trailing: boolean;
  grouped: boolean;
  /** No marker, or one that stands apart from the number. */
  loose: boolean;
  /** The digits as printed, for the "₹ read as a leading digit" checks. */
  intDigits: string;
  hasComma: boolean;
  hasDecimals: boolean;
  raw: string;
  score: number;
}

/** "1,249.50" → 124950; null when the commas can't be thousands (or lakh) separators. */
function toPaise(num: string): number | null {
  const [int, dec = ''] = num.split('.');
  if (int.includes(',') && !/^\d{1,3}(?:,\d{2,3})*,\d{3}$/.test(int)) return null;
  const digits = int.replace(/,/g, '');
  if (!digits || digits.length > 8 || dec.length > 2) return null;
  return Number(digits) * 100 + Number(dec.padEnd(2, '0') || 0);
}

// A number, with whatever is stuck to the front of it. Group 1: text marker, 2: one-character
// marker, 3: the number.
const NUMBER = /(?:(₹|rs\.?|inr)\s{0,2}|([^\sA-Za-z0-9.,:;()[\]'"*@/+-]\s?|(?<![A-Za-z0-9])[RFXZT](?=\d)))?(\d[\d,]*(?:\.\d{1,2})?)(?!\d)/gi;

function candidatesOf(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  lines.forEach((full, i) => {
    if (NOT_AMOUNT_LINE.test(full)) return;
    // Dates and times go first so their digits can't be mistaken for money.
    const line = full.replace(DAY_MON_YEAR, ' ').replace(MON_DAY_YEAR, ' ').replace(NUMERIC_DATE, ' ').replace(TIME, ' ');
    const accountLine = ACCOUNT_LINE.test(line);
    for (const m of line.matchAll(NUMBER)) {
      const num = m[3], start = m.index!, end = start + m[0].length;
      const before = line.slice(0, start), after = line.slice(end);
      // Part of an identifier, a handle, a percentage or "5G".
      if (/[A-Za-z0-9@._-]$/.test(before) && !/\s$/.test(before)) continue;
      if (/^(?:[A-Za-z@%_]|\.\d|-\d)/.test(after)) continue;
      const mark: Candidate['mark'] = m[1] ? 'rupee' : m[2] ? (m[2].trim() === '₹' ? 'rupee' : 'symbol') : 'none';
      const paise = toPaise(num);
      if (paise === null || paise <= 0) continue;
      const intDigits = num.split('.')[0].replace(/,/g, '');
      const junk = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').length;
      const alone = junk(before) <= 1 && junk(after) <= 1;
      const labelled = AMOUNT_LABEL.test(before);
      // "Anil Kumar 12,000": the number closes a row that starts with a name.
      const trailing = !alone && junk(after) === 0 && /[A-Za-z]{3,}/.test(before);
      const hasComma = num.includes(','), hasDecimals = num.includes('.');
      // On a row about an account only a real rupee marker counts ("A/c X1234" is not ₹1,234).
      if (accountLine && mark === 'symbol' && /[A-Za-z]/.test(m[2])) continue;
      if (mark === 'none') {
        // An unmarked number counts only where an amount would be printed, and never on a line about an account.
        if (accountLine || !(alone || labelled || trailing)) continue;
        if (/^(?:19|20)\d\d$/.test(num) && !alone) continue; // a year left over from a date that didn't parse
        if (intDigits.length > 7) continue;                 // a phone number or a reference
      }
      out.push({ paise, line: i, mark, alone, labelled, trailing, grouped: hasComma || hasDecimals, loose: mark === 'none' || (mark === 'symbol' && /\s$/.test(m[2])), intDigits, hasComma, hasDecimals, raw: m[0].trim(), score: 0 });
    }
  });
  return out;
}

const fmt = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

/** The same number without its first digit, for when that digit may be a misread "₹". */
function withoutFirstDigit(c: Candidate): number | null {
  // An amount is never printed with a leading zero, so "2050" can't be "₹050".
  if (c.mark !== 'none' || c.intDigits.length < 2 || !/^[237][1-9]/.test(c.intDigits)) return null;
  const rest = c.intDigits.slice(1);
  const dec = c.raw.includes('.') ? c.raw.split('.')[1] : '';
  const p = Number(rest) * 100 + Number(dec.padEnd(2, '0') || 0);
  return p > 0 ? p : null;
}

function pickAmount(lines: string[], words: number | null): { paise: number; unsure: boolean; raw: string[] } | null {
  const cands = candidatesOf(lines);
  if (!cands.length) return words ? { paise: words, unsure: true, raw: [] } : null;
  const keyLines = lines.map((l, i) => (NEAR_WORD.test(l) ? i : -1)).filter((i) => i >= 0);
  const count = (p: number) => cands.filter((c) => c.paise === p).length;
  for (const c of cands) {
    const near = keyLines.some((k) => Math.abs(k - c.line) <= 3);
    // One or two digits, bare or after a detached symbol ("© 2"), are what icons and avatars turn
    // into. They count only beside an amount label, however often they repeat.
    const tiny = c.loose && c.intDigits.length <= 2 && !c.hasDecimals;
    c.score = (c.mark === 'rupee' ? 4 : c.mark === 'symbol' ? 3 : 0) + (c.alone ? 2 : 0) + (c.labelled ? 3 : 0) + (c.trailing ? 1 : 0)
      + (near ? 1 : 0) + (count(c.paise) >= 2 && !tiny ? 2 : 0) + (c.grouped ? 1 : 0) - (tiny ? (c.labelled ? 3 : 9) : 0);
  }
  const raws = (p: number) => cands.filter((c) => c.paise === p).map((c) => c.raw);

  // The amount in words (Paytm, cheques, bank receipts) settles it when a number on screen agrees.
  if (words) {
    if (cands.some((c) => c.paise === words)) return { paise: words, unsure: false, raw: raws(words) };
    const cut = cands.find((c) => withoutFirstDigit(c) === words);
    if (cut) return { paise: words, unsure: false, raw: [cut.raw] };
    return { paise: words, unsure: true, raw: [] };
  }

  const best = [...cands].sort((a, b) => b.score - a.score || a.line - b.line)[0];
  if (best.score < 3) return null;
  let paise = best.paise, unsure = best.mark === 'none';
  const cut = withoutFirstDigit(best);
  if (cut !== null) {
    // "₹" read as a leading 2, 3 or 7. Believed when the screen shows the shorter number as well
    // (PhonePe prints the amount twice), or when the digits can't be how an app prints an amount:
    // four or more digits with no thousands separator.
    const twice = cands.some((c) => c !== best && c.paise === cut && c.mark !== 'none');
    const ungrouped = best.alone && best.intDigits.length >= 4 && !best.hasComma && !best.hasDecimals;
    if (twice || ungrouped) { paise = cut; unsure = !twice; }
  }
  return { paise, unsure, raw: [...raws(best.paise), ...raws(paise)] };
}

const PAYEE_DEBIT = /^(?:you\s+)?(?:paid(?:\s+successfully)?\s+to|sent\s+to|transfer(?:red)?\s+to|payee(?:\s+name)?|beneficiary(?:\s+name)?|merchant(?:\s+name)?|to)\b\s*[:\-–]?\s*(.*)$/i;
const PAYEE_CREDIT = /^(?:you\s+)?(?:received\s+from|payer(?:\s+name)?|sender(?:\s+name)?|remitter(?:\s+name)?|from)\b\s*[:\-–]?\s*(.*)$/i;
/** Label rows that start with the same words but name something else ("To account", "From bank"). */
const NOT_A_NAME = /^(?:a\/?c|acct?|account|bank|wallet|upi|vpa|self|your|my|date|time|amount|mobile)\b/i;

function cleanName(text: string, amountRaws: string[]): string | undefined {
  let s = text;
  for (const r of amountRaws) if (r) s = s.split(r).join(' ');
  s = s.replace(/\([^)]*\)?/g, ' ')                              // "(HDFC Bank)"
    .replace(/(?:₹|rs\.?|inr)\s?\d[\d,]*(?:\.\d{1,2})?/gi, ' ')  // any other marked amount on the row
    .replace(/\S*@\S*/g, ' ')                                    // a UPI handle
    .replace(/[^A-Za-z0-9&' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[-' ]+|[-'& ]+$/g, '');
  // The avatar's initials, read as a word in front of the name: "SL Sri Lakshmi Medicals".
  const words = s.split(' ');
  if (words.length >= 3 && /^[A-Z]{1,3}$/.test(words[0]) && words[0] === words.slice(1, 1 + words[0].length).map((w) => w[0]?.toUpperCase()).join('')) s = words.slice(1).join(' ');
  if (s.length > 40) s = s.slice(0, 40).replace(/\s+\S*$/, '');
  if ((s.match(/[A-Za-z]/g) ?? []).length < 2 || NOT_A_NAME.test(s)) return undefined;
  return s;
}

function findPayee(lines: string[], direction: 'debit' | 'credit', amountRaws: string[]): string | undefined {
  const label = direction === 'debit' ? PAYEE_DEBIT : PAYEE_CREDIT;
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    const same = cleanName(m[1], amountRaws);
    if (same) return same;
    if (m[1].replace(/[^A-Za-z0-9]/g, '').length > 2) continue; // the row said something else
    // The label sits on its own row; the name is on one of the next two (an avatar may come between).
    for (const next of lines.slice(i + 1, i + 3)) {
      if (label.test(next) || NOT_AMOUNT_LINE.test(next) || ACCOUNT_LINE.test(next)) break;
      const name = cleanName(next, amountRaws);
      if (name && name.length >= 3) return name;
    }
  }
  return undefined;
}

function findDirection(lines: string[]): 'debit' | 'credit' {
  const text = lines.join('\n');
  const d = text.search(DEBIT_WORD), c = text.search(CREDIT_WORD);
  if (d >= 0 || c >= 0) return c >= 0 && (d < 0 || c < d) ? 'credit' : 'debit';
  // Google Pay's screen has neither word: it opens with "To Ramesh Stores" or "From Meera Nair".
  for (const l of lines) {
    if (/^to\b\s*:?\s+\S/i.test(l)) return 'debit';
    if (/^from\b\s*:?\s+\S/i.test(l)) return 'credit';
  }
  return 'debit';
}

function findRef(lines: string[]): string | undefined {
  const LABEL = /\b(utr|rrn|upi\s*(?:ref(?:erence)?|transaction|txn)(?:\s*(?:no|number|id))?|(?:bank\s*)?ref(?:erence)?(?:\s*(?:no|number|id))?)\b\.?\s*[:#-]?\s*/i;
  const twelve = (s: string) => /(?<![A-Za-z0-9])(\d{12})(?![A-Za-z0-9])/.exec(fixDigits(s))?.[1];
  for (let i = 0; i < lines.length; i++) {
    const m = LABEL.exec(lines[i]);
    if (!m) continue;
    const r = twelve(lines[i].slice(m.index + m[0].length)) ?? (lines[i].slice(m.index + m[0].length).trim() ? undefined : twelve(lines[i + 1] ?? ''));
    if (r) return r;
  }
  // No label survived the OCR: a 12-digit number alone on a row is still the UPI reference.
  for (const l of lines) { const r = /^\D{0,2}(\d{12})\D{0,6}$/.exec(fixDigits(l))?.[1]; if (r) return r; }
  return undefined;
}

function findDate(lines: string[]): string | undefined {
  const out = (d: string, m: number, y: string) => {
    const day = Number(d), year = y.length === 2 ? `20${y}` : y;
    return day >= 1 && day <= 31 && m >= 1 && m <= 12 ? `${String(day).padStart(2, '0')}-${String(m).padStart(2, '0')}-${year}` : undefined;
  };
  const mon = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  for (const l of lines) {
    const s = fixDigits(l);
    let m = DAY_MON_YEAR.exec(s);
    if (m) { const r = out(m[1], mon(m[2]), m[3]); if (r) return r; }
    m = MON_DAY_YEAR.exec(s);
    if (m) { const r = out(m[2], mon(m[1]), m[3]); if (r) return r; }
    m = NUMERIC_DATE.exec(s);
    if (m) { const r = out(m[1], Number(m[2]), m[3]); if (r) return r; }
  }
  return undefined;
}

/** Everything that could be read off a receipt screen, or null when it isn't a completed payment with a clear amount. */
export function readReceipt(ocrText: string): ReceiptRead | null {
  let lines = ocrText.split(/\r?\n/).map((l) => fixDigits(l.replace(/\s+/g, ' ').trim())).filter(Boolean);
  if (!lines.length || lines.some(isStatusRow)) return null;
  // A currency sign that ended up on the row above its number.
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:₹|rs\.?|inr|[%#¥£€$])$/i.test(lines[i]) && /^\d/.test(lines[i + 1] ?? '')) { merged.push(`₹${lines[i + 1]}`); i++; }
    else merged.push(lines[i]);
  }
  lines = merged;

  const wordsAt = lines.findIndex((l) => /^(?:rupees?|inr)\s+[a-z]/i.test(l));
  const words = wordsAt >= 0 ? wordsToPaise(lines.slice(wordsAt, wordsAt + 3).join(' ')) : null;
  const picked = pickAmount(lines, words);
  if (!picked) return null;

  const direction = findDirection(lines);
  const payee = findPayee(lines, direction, picked.raw);
  const refNo = findRef(lines), date = findDate(lines);
  const amount = fmt(picked.paise);
  const message = `${direction === 'debit' ? 'Paid' : 'Received'} ₹${amount}${payee ? ` ${direction === 'debit' ? 'to' : 'from'} ${payee}` : ''}.`
    + `${refNo ? ` UPI Ref ${refNo}` : ''}${date ? ` on ${date}` : ''}`;
  return { message, amount, direction, payee, refNo, date, unsure: picked.unsure };
}

/** One message-style sentence for `parseAlert`, or null when the screen can't be read with reasonable certainty. */
export function receiptToMessage(ocrText: string): string | null {
  return readReceipt(ocrText)?.message ?? null;
}
