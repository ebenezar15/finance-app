import { describe, expect, it } from 'vitest';
import type { Account, Category, Transaction } from '../../db/types';
import { captureSummary, isDuplicate, pickAccount, planCapture, splitMessages, type CaptureContext } from '../capture';
import { parseAlert } from '../sms';

const p = (s: string) => parseAlert(s, 'INR');

describe('payment app and bank wording', () => {
  it.each([
    ['You paid ₹120.00 to Uber India', 120_00, 'debit', 'Uber India'],
    ['₹250 paid to Ramesh Stores', 250_00, 'debit', 'Ramesh Stores'],
    ['Paid ₹1,200 to Swiggy using Google Pay', 1_200_00, 'debit', 'Swiggy'],
    ['PhonePe: Sent ₹500 to Priya Sharma. UPI Ref 431298765432', 500_00, 'debit', 'Priya Sharma'],
    ['Payment of Rs.349 to Netflix successful', 349_00, 'debit', 'Netflix'],
    ['You received ₹2,000 from Arun Kumar', 2_000_00, 'credit', 'Arun Kumar'],
    ['Anita Rao paid you ₹750.50', 750_50, 'credit', 'Anita Rao'],
    ['Dear UPI user A/C X1234 debited by 250.0 on date 12Nov26 trf to RAMESH K Refno 431234567890. If not u? call 1800111109. -SBI', 250_00, 'debit', 'Ramesh K'],
    ['Sent Rs.180.00 From HDFC Bank A/C *4321 To CITY CABS On 12/11/26 Ref 431211112222 Not You? Call 18002586161', 180_00, 'debit', 'City Cabs'],
    ['Rs 5,000.00 credited to a/c XX9876 on 12-11-26 by a/c linked to VPA arun@okaxis (UPI Ref No 431255556666).', 5_000_00, 'credit', undefined],
  ])('%s', (msg, amount, direction, merchant) => {
    const r = p(msg)!;
    expect(r).toBeTruthy();
    expect([r.amount, r.direction]).toEqual([amount, direction]);
    if (merchant) expect(r.merchant).toBe(merchant);
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('reads the reference and account digits', () => {
    const r = p('Dear UPI user A/C X1234 debited by 250.0 on date 12Nov26 trf to RAMESH K Refno 431234567890.')!;
    expect(r.refNo).toBe('431234567890');
    expect(r.last4).toBe('1234');
  });

  it.each([
    'Arun has requested ₹500 from you on Google Pay',
    'Your OTP for payment of Rs 250 is 483920',
    'Payment of ₹350 to Zomato failed. Any amount debited will be refunded.',
    'You won a scratch card worth ₹25',
    'Reminder: your electricity bill of Rs 1,450 is due on 15 Nov',
    'Hi, are we still meeting at 5?',
  ])('ignores: %s', (msg) => expect(p(msg)).toBeNull());
});

const acct = (id: string, extra: Partial<Account> = {}): Account => ({ id, name: id, type: 'bank', currency: 'INR', openingBalance: 0, ...extra } as Account);
const cat = (id: string, name: string, kind: 'expense' | 'income' = 'expense'): Category => ({ id, name, emoji: '', colour: '#000', kind, need: 'discretionary' });
const NOW = new Date(2026, 10, 12, 14, 0).getTime();
const tx = (o: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), date: new Date(NOW).toISOString(), amount: 0, type: 'expense', accountId: 'main', currency: 'INR', tags: [], source: 'manual', needsReview: false, createdAt: 0, updatedAt: 0, ...o } as Transaction);
const ctx = (txs: Transaction[] = []): CaptureContext => ({
  accounts: [acct('main'), acct('hdfc', { last4: '4321' }), acct('old', { last4: '1234', archived: true })],
  categories: [cat('transport', 'Transport'), cat('food', 'Dining out'), cat('salary', 'Salary', 'income')],
  rules: [{ id: 'r1', pattern: 'city cabs', categoryId: 'transport', hits: 3 }], txs, currency: 'INR',
});

describe('capturing a payment', () => {
  it('posts a confident, recognised payment to the right account and category', () => {
    const r = planCapture('Sent Rs.180.00 From HDFC Bank A/C *4321 To CITY CABS On 12/11/26 Ref 431211112222', ctx(), { receivedAt: NOW });
    expect(r.status).toBe('added');
    expect(r.draft).toMatchObject({ amount: 180_00, type: 'expense', accountId: 'hdfc', payee: 'City Cabs', categoryId: 'transport', paymentMethod: 'online', source: 'sms', needsReview: false, refNo: '431211112222' });
  });

  it('sends a payment it can’t categorise to the review inbox instead of guessing', () => {
    const r = planCapture('You paid ₹120.00 to Some New Shop', ctx(), { receivedAt: NOW, source: 'share' });
    expect(r.status).toBe('review');
    expect(r.draft).toMatchObject({ amount: 120_00, needsReview: true, categoryId: undefined, source: 'share', accountId: 'main' });
  });

  it('counts the app notification and the bank SMS for one payment once', () => {
    const first = planCapture('You paid ₹180.00 to City Cabs', ctx(), { receivedAt: NOW });
    const saved = tx({ ...first.draft });
    const second = planCapture('Sent Rs.180.00 From HDFC Bank A/C *4321 To CITY CABS On 12/11/26 Ref 431211112222', ctx([saved]), { receivedAt: NOW + 40_000 });
    expect(second.status).toBe('duplicate');
  });

  it('keeps two real payments of the same amount apart when their references differ, or time has passed', () => {
    const a = tx({ amount: 50_00, refNo: 'AAA111222' });
    expect(isDuplicate(p('Sent ₹50 to Tea Stall. UPI Ref BBB333444')!, NOW + 60_000, [a])).toBeUndefined();
    expect(isDuplicate(p('You paid ₹50 to Tea Stall')!, NOW + 20 * 60_000, [tx({ amount: 50_00 })])).toBeUndefined();
    expect(isDuplicate(p('You paid ₹50 to Tea Stall')!, NOW + 60_000, [tx({ amount: 50_00, deletedAt: 1 })])).toBeUndefined();
    expect(isDuplicate(p('You received ₹50 from Tea Stall')!, NOW + 60_000, [tx({ amount: 50_00 })])).toBeUndefined();
  });

  it('ignores chatter and never uses an archived account', () => {
    expect(planCapture('See you at 5', ctx()).status).toBe('ignored');
    expect(pickAccount(p('A/C X1234 debited by 250.0 trf to RAMESH')!, ctx().accounts)?.id).toBe('main');
  });

  it('splits a forwarded bundle into separate messages', () => {
    expect(splitMessages('You paid ₹120 to Uber\nYou paid ₹60 to Tea Stall')).toHaveLength(2);
    expect(splitMessages('Sent Rs.180.00 From HDFC Bank\nA/C *4321 To CITY CABS')).toHaveLength(1);
    expect(splitMessages('one\n\ntwo\n\n\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('summarises in one line', () => {
    const fmt = (m: number) => `₹${m / 100}`;
    expect(captureSummary([{ status: 'added', tx: tx({ amount: 180_00, payee: 'City Cabs' }) }], fmt)).toBe('Added ₹180 to City Cabs.');
    expect(captureSummary([{ status: 'added', tx: tx({}) }, { status: 'review', tx: tx({}) }, { status: 'duplicate' }], fmt)).toBe('Added 1 payment · 1 to check in your review inbox · 1 already recorded.');
    expect(captureSummary([{ status: 'ignored' }], fmt)).toBe('That didn’t read as a payment, so nothing was added.');
  });
});
