/**
 * Pure money math. Everything here takes plain data and returns plain data so it is
 * unit-testable without a database. All amounts are integer minor units.
 */
import type { Budget, Category, Goal, Loan, Minor, RecurringRule, Transaction } from '../db/types';
import { DAY, addDays, addMonths, daysInMonth, isoDate, monthKey, monthsBetween, startOfMonth } from './dates';

const live = (t: Transaction) => !t.deletedAt;

/** Signed effect of a transaction on its own account balance. Transfers handled by caller. */
export function signed(t: Transaction): Minor {
  switch (t.type) {
    case 'income':
    case 'refund':
      return t.amount;
    case 'expense':
      return -t.amount;
    case 'adjustment':
      return t.amount; // adjustments store a signed amount
    case 'transfer':
      return -t.amount;
  }
}

export function accountBalance(accountId: string, opening: Minor, txs: Transaction[]): Minor {
  let bal = opening;
  for (const t of txs) {
    if (!live(t)) continue;
    if (t.accountId === accountId) bal += signed(t);
    if (t.type === 'transfer' && t.toAccountId === accountId) bal += t.amount;
  }
  return bal;
}

/** Per-category spend lines for a transaction, honouring splits. Refunds reduce spend. */
export function spendLines(t: Transaction): { categoryId: string; memberId?: string; amount: Minor }[] {
  if (t.type !== 'expense' && t.type !== 'refund') return [];
  const sign = t.type === 'refund' ? -1 : 1;
  if (t.splits?.length) return t.splits.map((s) => ({ ...s, amount: s.amount * sign, memberId: s.memberId ?? t.memberId }));
  return [{ categoryId: t.categoryId ?? 'uncategorised', memberId: t.memberId, amount: t.amount * sign }];
}

export function inMonth(t: Transaction, month: string) {
  return monthKey(t.date) === month;
}

export function monthTotals(txs: Transaction[], month: string) {
  let income = 0, expense = 0;
  for (const t of txs) {
    if (!live(t) || !inMonth(t, month)) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    else if (t.type === 'refund') expense -= t.amount;
  }
  return { income, expense, net: income - expense };
}

export function spendByCategory(txs: Transaction[], month: string, memberId?: string) {
  const out = new Map<string, Minor>();
  for (const t of txs) {
    if (!live(t) || !inMonth(t, month)) continue;
    for (const l of spendLines(t)) {
      if (memberId && l.memberId !== memberId) continue;
      out.set(l.categoryId, (out.get(l.categoryId) ?? 0) + l.amount);
    }
  }
  return out;
}

/* ───────────────────────── Budgets ───────────────────────── */

export interface BudgetStatus {
  budget: Budget;
  available: Minor; // this month's amount + rollover carried in
  carried: Minor;
  spent: Minor;
  remaining: Minor;
  projected: Minor; // projected month-end spend at current burn rate
  overOnDay?: number; // day of month when the pace crosses `available`
  state: 'ok' | 'watch' | 'over';
}

/**
 * Rollover: unused budget carries forward; overspend reduces next month. We walk forward
 * from the first month that has data up to (but not including) `month`.
 */
export function rolloverInto(budget: Budget, txs: Transaction[], month: string, lookbackMonths = 12): Minor {
  if (!budget.rollover) return 0;
  const [y, m] = month.split('-').map(Number);
  let carry = 0;
  for (let k = lookbackMonths; k >= 1; k--) {
    const mk = monthKey(new Date(y, m - 1 - k, 1));
    const spent = spendByCategory(txs, mk, budget.memberId).get(budget.categoryId) ?? 0;
    const hasData = txs.some((t) => inMonth(t, mk));
    if (!hasData) { carry = 0; continue; }
    carry = carry + budget.amount - spent;
  }
  return carry;
}

export function budgetStatus(budget: Budget, txs: Transaction[], now: Date): BudgetStatus {
  const month = monthKey(now);
  const carried = rolloverInto(budget, txs, month);
  const available = budget.amount + carried;
  const spent = spendByCategory(txs, month, budget.memberId).get(budget.categoryId) ?? 0;
  const day = now.getDate();
  const dim = daysInMonth(now);
  const projected = Math.round((spent / day) * dim);
  let overOnDay: number | undefined;
  if (spent > 0 && projected > available && spent < available) {
    overOnDay = Math.min(dim, Math.ceil(available / (spent / day)));
  }
  const ratio = available > 0 ? spent / available : spent > 0 ? 2 : 0;
  const pace = day / dim;
  const state: BudgetStatus['state'] = ratio >= 1 ? 'over' : ratio > pace + 0.1 || projected > available ? 'watch' : 'ok';
  return { budget, available, carried, spent, remaining: available - spent, projected, overOnDay, state };
}

/** 50/30/20 split of monthly income into needs / wants / savings targets. */
export function fiftyThirtyTwenty(income: Minor) {
  const needs = Math.round(income * 0.5);
  const wants = Math.round(income * 0.3);
  return { needs, wants, savings: income - needs - wants };
}

/* ───────────────────────── Recurring & bills ───────────────────────── */

/** Next occurrences of a recurring rule between [from, to]. */
export function occurrences(rule: RecurringRule, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const start = new Date(rule.startDate);
  const stepMonths = rule.freq === 'monthly' ? 1 : rule.freq === 'quarterly' ? 3 : rule.freq === 'yearly' ? 12 : 0;
  if (rule.freq === 'weekly') {
    let d = new Date(start);
    while (d.getDay() !== rule.day % 7) d = addDays(d, 1);
    while (d < from) d = addDays(d, 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  for (let guard = 0; guard < 600 && d <= to; guard++) {
    const occ = new Date(d.getFullYear(), d.getMonth(), Math.min(rule.day, daysInMonth(d)));
    if (occ >= start && occ >= from && occ <= to) out.push(occ);
    d = addMonths(d, stepMonths);
  }
  return out;
}

export interface Upcoming { rule: RecurringRule; date: Date }

export function upcomingBills(rules: RecurringRule[], now: Date, days: number): Upcoming[] {
  const from = new Date(isoDate(now));
  const to = addDays(from, days);
  return rules
    .flatMap((rule) => occurrences(rule, from, to).map((date) => ({ rule, date })))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Rules that are due (on or before today) since they last posted — for auto-posting. */
export function duePostings(rule: RecurringRule, now: Date): Date[] {
  const from = rule.lastPosted ? addDays(new Date(rule.lastPosted), 1) : new Date(rule.startDate);
  return occurrences(rule, from, now);
}

export const yearlyCost = (r: RecurringRule) =>
  r.amount * (r.freq === 'weekly' ? 52 : r.freq === 'monthly' ? 12 : r.freq === 'quarterly' ? 4 : 1);

export interface DetectedSubscription {
  payee: string;
  amount: Minor;
  count: number;
  lastDate: string;
  yearly: Minor;
  priceChange?: { from: Minor; to: Minor };
}

/**
 * Subscription detector: same payee charged in ≥3 distinct months at a roughly monthly
 * cadence (25–35 days apart) with amounts within 15% of each other.
 */
export function detectSubscriptions(txs: Transaction[]): DetectedSubscription[] {
  const byPayee = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!live(t) || t.type !== 'expense' || !t.payee) continue;
    const k = t.payee.trim().toLowerCase();
    (byPayee.get(k) ?? byPayee.set(k, []).get(k)!).push(t);
  }
  const out: DetectedSubscription[] = [];
  for (const list of byPayee.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const months = new Set(list.map((t) => monthKey(t.date)));
    if (months.size < 3) continue;
    const gaps = list.slice(1).map((t, i) => (new Date(t.date).getTime() - new Date(list[i].date).getTime()) / DAY);
    const monthly = gaps.filter((g) => g >= 25 && g <= 35).length >= gaps.length * 0.7;
    if (!monthly) continue;
    const amounts = list.map((t) => t.amount);
    const median = [...amounts].sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
    if (!amounts.every((a) => Math.abs(a - median) <= median * 0.15)) continue;
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    out.push({
      payee: last.payee!,
      amount: last.amount,
      count: list.length,
      lastDate: last.date,
      yearly: last.amount * 12,
      priceChange: prev.amount !== last.amount ? { from: prev.amount, to: last.amount } : undefined,
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

/* ───────────────────────── Loans ───────────────────────── */

/** Standard reducing-balance EMI. rate in % p.a. Result rounded to the nearest minor unit. */
export function emi(principal: Minor, annualRate: number, months: number): Minor {
  if (months <= 0) return principal;
  const r = annualRate / 12 / 100;
  if (r === 0) return Math.round(principal / months);
  const f = Math.pow(1 + r, months);
  return Math.round((principal * r * f) / (f - 1));
}

export interface AmortRow { n: number; date: string; payment: Minor; interest: Minor; principal: Minor; prepay: Minor; balance: Minor }

/**
 * Amortisation with prepayments. Prepayments reduce tenure (EMI stays fixed), which is what
 * most lenders default to. Final row absorbs rounding so balance ends exactly at 0.
 */
export function amortise(loan: Pick<Loan, 'principal' | 'annualRate' | 'tenureMonths' | 'startDate' | 'prepayments'>): AmortRow[] {
  const pay = emi(loan.principal, loan.annualRate, loan.tenureMonths);
  const r = loan.annualRate / 12 / 100;
  const rows: AmortRow[] = [];
  let bal = loan.principal;
  const start = new Date(loan.startDate);
  for (let n = 1; bal > 0 && n <= loan.tenureMonths * 2; n++) {
    const date = addMonths(start, n);
    const interest = Math.round(bal * r);
    let principal = Math.min(pay - interest, bal);
    if (principal <= 0) principal = Math.min(bal, 1); // guard against negative amortisation
    bal -= principal;
    const mk = monthKey(date);
    const prepay = Math.min(bal, loan.prepayments.filter((p) => monthKey(p.date) === mk).reduce((s, p) => s + p.amount, 0));
    bal -= prepay;
    rows.push({ n, date: isoDate(date), payment: interest + principal, interest, principal, prepay, balance: bal });
  }
  return rows;
}

export function loanSummary(loan: Loan, now = new Date()) {
  const rows = amortise(loan);
  const base = amortise({ ...loan, prepayments: [] });
  const paid = rows.filter((r) => new Date(r.date) <= now);
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0);
  const baseInterest = base.reduce((s, r) => s + r.interest, 0);
  return {
    emi: emi(loan.principal, loan.annualRate, loan.tenureMonths),
    outstanding: paid.length ? paid[paid.length - 1].balance : loan.principal,
    monthsLeft: rows.length - paid.length,
    totalInterest,
    interestSaved: baseInterest - totalInterest,
    monthsSaved: base.length - rows.length,
    payoffDate: rows.length ? rows[rows.length - 1].date : loan.startDate,
    rows,
  };
}

export function simulatePrepayment(loan: Loan, amount: Minor, now = new Date()) {
  const extra: Loan = { ...loan, prepayments: [...loan.prepayments, { date: isoDate(addMonths(now, 1)), amount }] };
  const a = loanSummary(loan, now);
  const b = loanSummary(extra, now);
  return { interestSaved: a.totalInterest - b.totalInterest, monthsSaved: a.rows.length - b.rows.length, newPayoff: b.payoffDate };
}

export interface DebtPlanItem { id: string; name: string; balance: Minor; rate: number; minPayment: Minor }

/** Snowball (smallest balance first) vs avalanche (highest rate first). Returns months and total interest. */
export function payoffPlan(debts: DebtPlanItem[], monthlyBudget: Minor, strategy: 'snowball' | 'avalanche') {
  const ds = debts.map((d) => ({ ...d }));
  const order = () =>
    ds.filter((d) => d.balance > 0).sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.rate - a.rate));
  let months = 0, interest = 0;
  const payoffOrder: string[] = [];
  while (ds.some((d) => d.balance > 0) && months < 600) {
    months++;
    for (const d of ds) {
      if (d.balance <= 0) continue;
      const i = Math.round((d.balance * d.rate) / 1200);
      d.balance += i; interest += i;
    }
    let pool = monthlyBudget;
    for (const d of ds) {
      if (d.balance <= 0) continue;
      const p = Math.min(d.minPayment, d.balance, pool);
      d.balance -= p; pool -= p;
    }
    for (const d of order()) {
      if (pool <= 0) break;
      const p = Math.min(d.balance, pool);
      d.balance -= p; pool -= p;
    }
    for (const d of ds) if (d.balance <= 0 && !payoffOrder.includes(d.id)) payoffOrder.push(d.id);
    if (pool === monthlyBudget) break; // budget can't cover anything
  }
  return { months, interest, payoffOrder };
}

/* ───────────────────────── Goals ───────────────────────── */

export function goalPlan(goal: Goal, now = new Date()) {
  const remaining = Math.max(0, goal.target - goal.saved);
  const monthsLeft = Math.max(1, monthsBetween(now, new Date(goal.targetDate)));
  const needed = Math.ceil(remaining / monthsLeft);
  const recent = goal.contributions.filter((c) => new Date(c.date) > addMonths(now, -3));
  const pace = Math.round(recent.reduce((s, c) => s + c.amount, 0) / 3);
  return {
    remaining, monthsLeft, needed, pace,
    progress: goal.target ? Math.min(1, goal.saved / goal.target) : 0,
    onTrack: remaining === 0 || pace >= needed,
  };
}

/* ───────────────────────── Forecast ───────────────────────── */

export interface ForecastPoint { date: string; balance: Minor; low: boolean; events: string[] }

/**
 * Cash-flow forecast: start from current liquid balance, apply scheduled recurring rules on their
 * dates, and spread the trailing-3-month average *non-recurring* daily spend evenly.
 */
export function forecast(
  startBalance: Minor, rules: RecurringRule[], txs: Transaction[], now: Date, days: number,
  opts: { lowThreshold?: Minor; spendFactor?: number; extraMonthly?: Minor } = {},
): ForecastPoint[] {
  const factor = opts.spendFactor ?? 1;
  const from = addMonths(startOfMonth(now), -3);
  const recurringPayees = new Set(rules.map((r) => r.name.toLowerCase()));
  let discretionary = 0;
  for (const t of txs) {
    if (!live(t) || t.type !== 'expense' || t.source === 'recurring') continue;
    const d = new Date(t.date);
    if (d < from || d >= startOfMonth(now)) continue;
    if (t.payee && recurringPayees.has(t.payee.toLowerCase())) continue;
    discretionary += t.amount;
  }
  const daysSpan = Math.max(1, Math.round((startOfMonth(now).getTime() - from.getTime()) / DAY));
  const daily = Math.round((discretionary / daysSpan) * factor);
  const extraDaily = Math.round((opts.extraMonthly ?? 0) / 30);
  const low = opts.lowThreshold ?? 0;
  const pts: ForecastPoint[] = [];
  let bal = startBalance;
  const to = addDays(now, days);
  const sched = rules.flatMap((r) => occurrences(r, addDays(now, 1), to).map((d) => ({ r, k: isoDate(d) })));
  for (let i = 1; i <= days; i++) {
    const d = addDays(now, i);
    const k = isoDate(d);
    const events: string[] = [];
    bal -= daily - extraDaily;
    for (const s of sched) {
      if (s.k !== k) continue;
      bal += s.r.type === 'income' ? s.r.amount : -s.r.amount;
      events.push(s.r.name);
    }
    pts.push({ date: k, balance: bal, low: bal < low, events });
  }
  return pts;
}

/* ───────────────────────── Safe to spend ───────────────────────── */

/**
 * What can be spent today without breaking the month: liquid balance minus bills still due
 * this month minus goal set-asides, spread over the remaining days (today included).
 */
export function safeToSpend(liquid: Minor, rules: RecurringRule[], goalsMonthly: Minor, now: Date) {
  const dim = daysInMonth(now);
  const end = new Date(now.getFullYear(), now.getMonth(), dim);
  const rest = rules.flatMap((r) => occurrences(r, addDays(new Date(isoDate(now)), 1), end).map(() => r));
  const billsLeft = rest.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const incomeLeft = rest.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const pool = liquid - billsLeft - goalsMonthly + incomeLeft;
  const daysLeft = dim - now.getDate() + 1;
  const today = Math.max(0, Math.floor(pool / daysLeft));
  return { today, week: Math.max(0, Math.min(pool, today * 7)), pool, billsLeft, incomeLeft, daysLeft };
}

/* ───────────────────────── Health score ───────────────────────── */

export interface HealthPart { key: string; label: string; score: number; max: number; value: string; tip: string }

export function healthScore(input: {
  monthlyIncome: Minor; monthlyExpense: Minor; essentialMonthly: Minor; liquid: Minor;
  monthlyDebtPayments: Minor; budgetsOnTrack: number; budgetsTotal: number; billsOnTime: number; billsTotal: number;
}): { total: number; parts: HealthPart[] } {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const savingsRate = input.monthlyIncome ? (input.monthlyIncome - input.monthlyExpense) / input.monthlyIncome : 0;
  const efMonths = input.essentialMonthly ? input.liquid / input.essentialMonthly : 0;
  const dti = input.monthlyIncome ? input.monthlyDebtPayments / input.monthlyIncome : 0;
  const adherence = input.budgetsTotal ? input.budgetsOnTrack / input.budgetsTotal : 1;
  const punctual = input.billsTotal ? input.billsOnTime / input.billsTotal : 1;
  const parts: HealthPart[] = [
    { key: 'savings', label: 'Savings rate', max: 25, score: Math.round(25 * clamp(savingsRate / 0.2)), value: `${Math.round(savingsRate * 100)}%`, tip: 'Aim to keep 20% of income. Automate a transfer on payday.' },
    { key: 'emergency', label: 'Emergency fund', max: 25, score: Math.round(25 * clamp(efMonths / 6)), value: `${efMonths.toFixed(1)} months`, tip: 'Six months of essential costs is the usual target.' },
    { key: 'debt', label: 'Debt load', max: 20, score: Math.round(20 * clamp(1 - Math.max(0, dti - 0.1) / 0.4)), value: `${Math.round(dti * 100)}% of income`, tip: 'Keep loan repayments under 30% of take-home pay.' },
    { key: 'budget', label: 'Budget adherence', max: 15, score: Math.round(15 * adherence), value: `${input.budgetsOnTrack}/${input.budgetsTotal} on track`, tip: 'Review the categories marked "watch" mid-month.' },
    { key: 'bills', label: 'Bills on time', max: 15, score: Math.round(15 * punctual), value: `${Math.round(punctual * 100)}%`, tip: 'Turn on reminders three days before each due date.' },
  ];
  return { total: parts.reduce((s, p) => s + p.score, 0), parts };
}

/* ───────────────────────── Anomalies ───────────────────────── */

export interface Anomaly { id: string; kind: 'large' | 'duplicate' | 'new-merchant' | 'spike'; title: string; detail: string; txId?: string; categoryId?: string }

export function detectAnomalies(txs: Transaction[], categories: Category[], now: Date): Anomaly[] {
  const out: Anomaly[] = [];
  const month = monthKey(now);
  const exp = txs.filter((t) => live(t) && t.type === 'expense');
  const recent = exp.filter((t) => new Date(t.date) > addDays(now, -30));
  const older = exp.filter((t) => new Date(t.date) <= addDays(now, -30));
  const catName = (id?: string) => categories.find((c) => c.id === id)?.name ?? 'Other';

  // Unusual amount: > mean + 3σ for its category (needs ≥ 6 samples)
  const byCat = new Map<string, number[]>();
  for (const t of older) (byCat.get(t.categoryId ?? '') ?? byCat.set(t.categoryId ?? '', []).get(t.categoryId ?? '')!).push(t.amount);
  for (const t of recent) {
    const xs = byCat.get(t.categoryId ?? '');
    if (!xs || xs.length < 6) continue;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    if (t.amount > mean + 3 * sd && t.amount > mean * 2) {
      out.push({ id: `large-${t.id}`, kind: 'large', txId: t.id, title: `Unusually large ${catName(t.categoryId)} spend`, detail: `${t.payee ?? 'A payment'} is about ${Math.round(t.amount / mean)}× your usual.` });
    }
  }
  // Duplicate: same payee + amount within 48 hours
  const sorted = [...recent].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.payee && a.payee === b.payee && a.amount === b.amount && new Date(b.date).getTime() - new Date(a.date).getTime() < 2 * DAY) {
      out.push({ id: `dup-${b.id}`, kind: 'duplicate', txId: b.id, title: 'Possible duplicate charge', detail: `${b.payee} charged the same amount twice within two days.` });
    }
  }
  // New merchants this month
  const seen = new Set(older.map((t) => t.payee?.toLowerCase()).filter(Boolean));
  const fresh = new Set<string>();
  for (const t of recent) if (t.payee && !seen.has(t.payee.toLowerCase()) && inMonth(t, month)) fresh.add(t.payee);
  if (fresh.size) out.push({ id: 'new-merchants', kind: 'new-merchant', title: `${fresh.size} new merchant${fresh.size > 1 ? 's' : ''} this month`, detail: [...fresh].slice(0, 4).join(', ') });
  // Category spike vs 3-month average
  const cur = spendByCategory(txs, month);
  const dayFrac = now.getDate() / daysInMonth(now);
  for (const [cat, spent] of cur) {
    const prev = [1, 2, 3].map((k) => spendByCategory(txs, monthKey(addMonths(startOfMonth(now), -k))).get(cat) ?? 0);
    const avg = prev.reduce((a, b) => a + b, 0) / 3;
    if (avg > 0 && spent > avg * 1.4 && spent > avg * dayFrac * 1.6 && spent - avg > 2000_00 * 0.05) {
      out.push({ id: `spike-${cat}`, kind: 'spike', categoryId: cat, title: `${catName(cat)} is running hot`, detail: `${Math.round((spent / avg - 1) * 100)}% above your 3-month average already.` });
    }
  }
  return out;
}

/* ───────────────────────── Trends ───────────────────────── */

export function monthlySeries(txs: Transaction[], now: Date, months: number) {
  return Array.from({ length: months }, (_, k) => {
    const d = addMonths(startOfMonth(now), k - months + 1);
    const mk = monthKey(d);
    const tot = monthTotals(txs, mk);
    return { month: mk, label: d.toLocaleDateString(undefined, { month: 'short' }), ...tot };
  });
}

/** Builds Sankey-ready flows: income sources → household → categories (+ savings). */
export function cashFlowGraph(txs: Transaction[], categories: Category[], month: string, topN = 6) {
  const incomeBy = new Map<string, Minor>();
  for (const t of txs) {
    if (!live(t) || !inMonth(t, month) || t.type !== 'income') continue;
    const k = categories.find((c) => c.id === t.categoryId)?.name ?? t.payee ?? 'Income';
    incomeBy.set(k, (incomeBy.get(k) ?? 0) + t.amount);
  }
  const spend = [...spendByCategory(txs, month)].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = spend.slice(0, topN);
  const restTotal = spend.slice(topN).reduce((s, [, v]) => s + v, 0);
  const income = [...incomeBy.values()].reduce((a, b) => a + b, 0);
  const spent = spend.reduce((s, [, v]) => s + v, 0);
  const outs = top.map(([id, v]) => {
    const c = categories.find((x) => x.id === id);
    return { id, name: c?.name ?? 'Other', colour: c?.colour ?? '#8A94A6', value: v };
  });
  if (restTotal > 0) outs.push({ id: 'rest', name: 'Everything else', colour: '#8A94A6', value: restTotal });
  const saved = income - spent;
  if (saved > 0) outs.push({ id: 'saved', name: 'Kept / saved', colour: 'rgb(var(--good))', value: saved });
  return { ins: [...incomeBy].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value), outs, income, spent, saved };
}
