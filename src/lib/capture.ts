/**
 * Payment capture: turns the text of a payment message (a Google Pay / PhonePe / Paytm
 * notification, a bank SMS, something shared or forwarded into Tandem) into an entry.
 *
 * Confident reads are posted straight away; unsure ones go to the review inbox; anything that
 * isn't a payment is ignored; the same payment arriving twice (the app's notification and the
 * bank's SMS) is only counted once.
 */
import { db } from '../db/db';
import { saveTransaction } from '../db/hooks';
import type { Account, Category, MerchantRule, PaymentMethod, Transaction } from '../db/types';
import { suggestCategory } from './categorize';
import { isoDate } from './dates';
import { REVIEW_THRESHOLD, parseAlert, type ParsedAlert } from './sms';
import { parseDate } from './csv';

export type CaptureSource = 'sms' | 'share' | 'ocr';
export interface CaptureResult {
  status: 'added' | 'review' | 'duplicate' | 'ignored';
  tx?: Transaction;
  parsed?: ParsedAlert;
}

/** Same payment seen twice: same reference, or same amount and direction within this window. */
export const DUP_WINDOW_MS = 15 * 60_000;

export function isDuplicate(p: ParsedAlert, at: number, existing: Transaction[]): Transaction | undefined {
  const type = p.direction === 'debit' ? 'expense' : 'income';
  return existing.find((t) => {
    if (t.deletedAt) return false;
    if (p.refNo && t.refNo === p.refNo) return true;
    if (t.amount !== p.amount || t.type !== type) return false;
    // A different reference on both sides means two real payments of the same amount.
    if (p.refNo && t.refNo && t.refNo !== p.refNo) return false;
    return Math.abs(new Date(t.date).getTime() - at) <= DUP_WINDOW_MS;
  });
}

export function pickAccount(p: ParsedAlert, accounts: Account[]): Account | undefined {
  const open = accounts.filter((a) => !a.archived);
  return (p.last4 && open.find((a) => a.last4 && (a.last4 === p.last4 || a.last4.endsWith(p.last4!) || p.last4!.endsWith(a.last4))))
    || open.find((a) => a.type === 'bank' && !a.savings) || open.find((a) => a.type === 'bank') || open[0];
}

function methodOf(text: string, account?: Account): PaymentMethod {
  if (/\b(upi|vpa|google pay|gpay|phonepe|paytm|bhim|imps|neft)\b/i.test(text)) return 'online';
  if (/\bcredit card\b/i.test(text) || account?.type === 'credit') return 'credit';
  if (/\b(debit card|card)\b/i.test(text)) return 'debit';
  if (/\batm\b/i.test(text)) return 'cash';
  return 'online';
}

/** Splits a forwarded bundle into separate messages: blank lines, or one message per line. */
export function splitMessages(text: string): string[] {
  const blocks = text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  // Several lines that each read as a payment are separate messages; otherwise it's one wrapped message.
  return lines.length > 1 && lines.filter((l) => parseAlert(l)).length >= 2 ? lines : [text.trim()].filter(Boolean);
}

export interface CaptureContext { accounts: Account[]; categories: Category[]; rules: MerchantRule[]; txs: Transaction[]; currency: string }

async function context(): Promise<CaptureContext> {
  const [accounts, categories, rules, txs, profile] = await Promise.all([
    db.accounts.toArray(), db.categories.toArray(), db.merchantRules.toArray(), db.transactions.toArray(), db.settings.get('profile'),
  ]);
  return { accounts, categories, rules, txs, currency: (profile?.value as { currency?: string } | undefined)?.currency ?? 'USD' };
}

/** Works out what to save for one message, without touching the database. */
export function planCapture(text: string, ctx: CaptureContext, opts: { source?: CaptureSource; receivedAt?: number } = {}): { status: CaptureResult['status']; parsed?: ParsedAlert; draft?: Partial<Transaction> & Pick<Transaction, 'amount' | 'type' | 'accountId'> } {
  const raw = text.trim();
  const parsed = raw ? parseAlert(raw, ctx.currency) : null;
  if (!parsed || parsed.amount <= 0) return { status: 'ignored' };
  const at = opts.receivedAt ?? Date.now();
  let when = new Date(at);
  if (parsed.date) {
    const d = parseDate(parsed.date, true);
    // Only trust a date in the message when it's recent and not in the future (formats vary by bank).
    if (d && d !== isoDate(when)) {
      const cand = new Date(`${d}T12:00:00`);
      if (cand.getTime() <= at && at - cand.getTime() < 45 * 86400_000) when = cand;
    }
  }
  if (isDuplicate(parsed, when.getTime(), ctx.txs)) return { status: 'duplicate', parsed };
  const account = pickAccount(parsed, ctx.accounts);
  if (!account) return { status: 'ignored', parsed };
  const cat = parsed.merchant ? suggestCategory(parsed.merchant, ctx.categories, ctx.rules, ctx.txs) : null;
  const expense = parsed.direction === 'debit';
  const okCat = cat && ctx.categories.find((c) => c.id === cat.categoryId && c.kind === (expense ? 'expense' : 'income'));
  // No category guess for a spend means a person should glance at it, even if the amount is certain.
  const review = parsed.confidence < REVIEW_THRESHOLD || (expense && !okCat);
  return {
    status: review ? 'review' : 'added', parsed,
    draft: {
      amount: parsed.amount, type: expense ? 'expense' : 'income', accountId: account.id, payee: parsed.merchant,
      categoryId: okCat ? cat!.categoryId : undefined, currency: account.currency ?? ctx.currency, paymentMethod: methodOf(raw, account),
      source: opts.source === 'ocr' ? 'ocr' : opts.source === 'share' ? 'share' : 'sms',
      confidence: parsed.confidence, needsReview: review, refNo: parsed.refNo, notes: raw.slice(0, 500), date: when.toISOString(),
    },
  };
}

/** Reads one or more payment messages and saves what they describe. */
export async function capturePayments(text: string, opts: { source?: CaptureSource; receivedAt?: number } = {}): Promise<CaptureResult[]> {
  const ctx = await context();
  const out: CaptureResult[] = [];
  for (const msg of splitMessages(text)) {
    const plan = planCapture(msg, ctx, opts);
    if (!plan.draft) { out.push({ status: plan.status, parsed: plan.parsed }); continue; }
    const tx = await saveTransaction(plan.draft);
    ctx.txs.push(tx); // so the next message in the same bundle can be recognised as its duplicate
    out.push({ status: plan.status, parsed: plan.parsed, tx });
  }
  return out;
}

/** One line for a toast, e.g. "Added 2 payments · 1 to review". Amounts are formatted by `fmt`. */
export function captureSummary(results: CaptureResult[], fmt: (m: number) => string): string {
  const n = (s: CaptureResult['status']) => results.filter((r) => r.status === s).length;
  const added = n('added'), review = n('review'), dup = n('duplicate');
  if (added + review === 1 && results.length === 1) {
    const r = results[0];
    const what = `${fmt(r.tx!.amount)}${r.tx!.payee ? ` ${r.tx!.type === 'expense' ? 'to' : 'from'} ${r.tx!.payee}` : ''}`;
    return r.status === 'added' ? `Added ${what}.` : `Captured ${what}. It’s in your review inbox to check.`;
  }
  const parts = [
    added ? `Added ${added} payment${added === 1 ? '' : 's'}` : '',
    review ? `${review} to check in your review inbox` : '',
    dup ? `${dup} already recorded` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' · ')}.` : 'That didn’t read as a payment, so nothing was added.';
}
