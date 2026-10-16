import type { Data } from '../db/hooks';
import { addMonths, monthKey, startOfMonth } from './dates';
import { budgetStatus, goalPlan, monthTotals, spendByCategory } from './finance';

const major = (m: number) => Math.round(m) / 100;

/**
 * The only thing "Ask about my money" ever sends: aggregated monthly totals, category totals,
 * budget, goal and debt summaries. No payee names, notes, dates of single purchases, account
 * numbers or people's names. Shown to the viewer verbatim before anything is sent.
 */
export function buildSummary(data: Data, currency: string, now = new Date()) {
  const months = Array.from({ length: 6 }, (_, k) => monthKey(addMonths(startOfMonth(now), k - 5)));
  const catName = (id: string) => data.cat(id)?.name ?? 'Other';
  const thisMonth = monthKey(now);
  const cur = spendByCategory(data.txs, thisMonth);
  const avg3 = new Map<string, number>();
  for (const k of [1, 2, 3]) for (const [c, v] of spendByCategory(data.txs, monthKey(addMonths(startOfMonth(now), -k)))) avg3.set(c, (avg3.get(c) ?? 0) + v / 3);
  const methods = new Map<string, number>();
  for (const t of data.txs) if (t.type === 'expense' && monthKey(t.date) === thisMonth) methods.set(t.paymentMethod ?? 'unknown', (methods.get(t.paymentMethod ?? 'unknown') ?? 0) + t.amount);
  return {
    currency,
    today: now.toISOString().slice(0, 10),
    householdSize: data.members.length,
    monthly: months.map((m) => { const t = monthTotals(data.txs, m); return { month: m, income: major(t.income), spending: major(t.expense) }; }),
    thisMonthByCategory: [...new Set([...cur.keys(), ...avg3.keys()])]
      .map((c) => ({ category: catName(c), essential: data.cat(c)?.need === 'essential', thisMonth: major(cur.get(c) ?? 0), avgLast3Months: major(avg3.get(c) ?? 0) }))
      .filter((x) => x.thisMonth || x.avgLast3Months).sort((a, b) => b.avgLast3Months - a.avgLast3Months),
    thisMonthByPaymentMethod: Object.fromEntries([...methods].map(([k, v]) => [k, major(v)])),
    budgets: data.budgets.filter((b) => !b.memberId).map((b) => { const s = budgetStatus(b, data.txs, now); return { category: catName(b.categoryId), monthlyBudget: major(b.amount), spent: major(s.spent), projectedMonthEnd: major(s.projected), status: s.state }; }),
    goals: data.goals.filter((g) => !g.memberId).map((g) => { const p = goalPlan(g, now); return { goal: g.name, target: major(g.target), saved: major(g.saved), targetDate: g.targetDate, neededPerMonth: major(p.needed), onTrack: p.onTrack }; }),
    debts: data.loanOut.map((l) => ({ kind: l.loan.kind, outstanding: major(l.outstanding), ratePct: l.loan.annualRate, monthlyPayment: major(l.emi), monthsLeft: l.monthsLeft })),
    recurringBills: data.recurring.filter((r) => r.type === 'expense').map((r) => ({ name: r.isSubscription ? `${r.name} (subscription)` : r.name, amount: major(r.amount), every: r.freq })),
    cashOnHand: major(data.liquid),
    netWorth: major(data.netWorth),
  };
}
