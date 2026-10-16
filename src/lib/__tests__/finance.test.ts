import { describe, expect, it } from 'vitest';
import type { Budget, Goal, Loan, RecurringRule, Transaction } from '../../db/types';
import {
  accountBalance, amortise, budgetStatus, detectSubscriptions, emi, forecast, goalPlan, healthScore, loanSummary,
  monthTotals, occurrences, payoffPlan, rolloverInto, safeToSpend, simulatePrepayment,
} from '../finance';

let n = 0;
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, date: '2026-03-10T10:00:00', amount: 1000, currency: 'USD', type: 'expense', accountId: 'a', tags: [],
  source: 'manual', needsReview: false, createdAt: 0, updatedAt: 0, ...p,
});

describe('balances & totals', () => {
  it('transfers move money but are not income or expense', () => {
    const txs = [
      tx({ type: 'income', amount: 5000 }), tx({ type: 'expense', amount: 1200 }),
      tx({ type: 'transfer', amount: 1000, toAccountId: 'b' }), tx({ type: 'refund', amount: 200 }),
      tx({ type: 'expense', amount: 999, deletedAt: 1 }),
    ];
    expect(accountBalance('a', 0, txs)).toBe(5000 - 1200 - 1000 + 200);
    expect(accountBalance('b', 0, txs)).toBe(1000);
    expect(monthTotals(txs, '2026-03')).toEqual({ income: 5000, expense: 1000, net: 4000 });
  });
});

describe('budgets & rollover', () => {
  const b: Budget = { id: 'b', categoryId: 'food', amount: 10000, rollover: true };
  const txs = [
    tx({ date: '2026-01-10T10:00:00', amount: 8000, categoryId: 'food' }), // +2000 carry
    tx({ date: '2026-02-10T10:00:00', amount: 13000, categoryId: 'food' }), // −3000 → carry −1000
    tx({ date: '2026-03-05T10:00:00', amount: 3000, categoryId: 'food' }),
  ];
  it('carries unused and overspent amounts forward', () => {
    expect(rolloverInto(b, txs, '2026-03')).toBe(-1000);
    expect(rolloverInto({ ...b, rollover: false }, txs, '2026-03')).toBe(0);
  });
  it('computes status, projection and burn-rate day', () => {
    const s = budgetStatus(b, txs, new Date(2026, 2, 10));
    expect(s.available).toBe(9000);
    expect(s.spent).toBe(3000);
    expect(s.remaining).toBe(6000);
    expect(s.projected).toBe(Math.round((3000 / 10) * 31));
    expect(s.overOnDay).toBe(30);
    expect(s.state).toBe('watch');
  });
  it('honours split lines per category', () => {
    const t = tx({ date: '2026-03-06T10:00:00', amount: 5000, splits: [{ categoryId: 'food', amount: 2000 }, { categoryId: 'fun', amount: 3000 }] });
    const s = budgetStatus(b, [...txs, t], new Date(2026, 2, 10));
    expect(s.spent).toBe(5000);
  });
});

describe('loans', () => {
  it('EMI matches the standard formula', () => {
    // 10,00,000 at 8.5% for 20y → ₹8,678 (well-known figure)
    expect(Math.round(emi(100000000, 8.5, 240) / 100)).toBe(8678);
    expect(emi(120000, 0, 12)).toBe(10000);
  });
  it('amortisation ends exactly at zero and principal sums to the loan', () => {
    const rows = amortise({ principal: 5000000, annualRate: 9, tenureMonths: 36, startDate: '2026-01-01', prepayments: [] });
    expect(rows.at(-1)!.balance).toBe(0);
    expect(rows.reduce((s, r) => s + r.principal + r.prepay, 0)).toBe(5000000);
    expect(rows.length).toBe(36);
  });
  it('prepayment saves interest and shortens tenure', () => {
    const loan: Loan = { id: 'l', name: 'x', lender: 'y', principal: 20000000, annualRate: 8, tenureMonths: 120, startDate: '2026-01-01', prepayments: [], kind: 'home' };
    const sim = simulatePrepayment(loan, 2000000, new Date(2026, 5, 1));
    expect(sim.interestSaved).toBeGreaterThan(0);
    expect(sim.monthsSaved).toBeGreaterThan(0);
    expect(loanSummary(loan, new Date(2026, 5, 1)).monthsLeft).toBeLessThan(120);
  });
  it('avalanche never costs more interest than snowball', () => {
    const debts = [
      { id: 'a', name: 'Card', balance: 300000, rate: 24, minPayment: 9000 },
      { id: 'b', name: 'Car', balance: 900000, rate: 7, minPayment: 20000 },
      { id: 'c', name: 'Store', balance: 50000, rate: 15, minPayment: 2500 },
    ];
    const s = payoffPlan(debts, 60000, 'snowball');
    const a = payoffPlan(debts, 60000, 'avalanche');
    expect(a.interest).toBeLessThanOrEqual(s.interest);
    expect(s.payoffOrder[0]).toBe('c');
    expect(a.payoffOrder[0]).toBe('a');
  });
});

describe('recurring, forecast & safe-to-spend', () => {
  const rent: RecurringRule = { id: 'r', name: 'Rent', type: 'expense', amount: 150000, estimated: false, accountId: 'a', freq: 'monthly', day: 31, startDate: '2026-01-01', autoPost: true, isSubscription: false };
  const pay: RecurringRule = { ...rent, id: 'p', name: 'Pay', type: 'income', amount: 400000, day: 1 };
  it('clamps month-end days (31st → 28 Feb)', () => {
    const occ = occurrences(rent, new Date(2026, 1, 1), new Date(2026, 2, 31));
    expect(occ.map((d) => d.getDate())).toEqual([28, 31]);
  });
  it('forecast applies scheduled items on their dates', () => {
    const pts = forecast(100000, [rent, pay], [], new Date(2026, 2, 15), 30);
    const end = pts.at(-1)!.balance;
    expect(end).toBe(100000 - 150000 + 400000);
    expect(pts.some((p) => p.low)).toBe(true); // dips below 0 after rent on the 31st
  });
  it('safe to spend reserves bills still due', () => {
    const s = safeToSpend(310000, [rent], 0, new Date(2026, 2, 1));
    expect(s.billsLeft).toBe(150000);
    expect(s.today).toBe(Math.floor(160000 / 31));
    const capped = safeToSpend(310000, [rent], 0, new Date(2026, 2, 1), 31000);
    expect(capped).toMatchObject({ limitedBy: 'budget', today: 1000 });
  });
});

describe('goals, subscriptions & health score', () => {
  it('goal plan computes required monthly amount', () => {
    const g: Goal = { id: 'g', name: 'Trip', emoji: '', target: 120000, saved: 20000, targetDate: '2027-01-01', priority: 1, contributions: [] };
    const p = goalPlan(g, new Date(2026, 0, 1));
    expect(p.needed).toBe(Math.ceil(100000 / 12));
    expect(p.onTrack).toBe(false);
  });
  it('detects monthly subscriptions and price changes', () => {
    const txs = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'].map((d, i) => tx({ date: `${d}T08:00:00`, payee: 'Netflix', amount: i === 3 ? 1799 : 1549 }));
    const subs = detectSubscriptions(txs);
    expect(subs).toHaveLength(1);
    expect(subs[0].priceChange).toEqual({ from: 1549, to: 1799 });
  });
  it('health score is bounded and transparent', () => {
    const perfect = healthScore({ monthlyIncome: 100, monthlyExpense: 70, essentialMonthly: 10, liquid: 100, monthlyDebtPayments: 0, budgetsOnTrack: 5, budgetsTotal: 5, billsOnTime: 3, billsTotal: 3 });
    expect(perfect.total).toBe(100);
    const poor = healthScore({ monthlyIncome: 100, monthlyExpense: 130, essentialMonthly: 100, liquid: 0, monthlyDebtPayments: 60, budgetsOnTrack: 0, budgetsTotal: 4, billsOnTime: 0, billsTotal: 2 });
    expect(poor.total).toBe(0);
    expect(poor.parts).toHaveLength(5);
  });
});
