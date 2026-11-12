/**
 * The daily spending guide: for each budgeted category, how much has gone this month, how much
 * is left, and what that means for today.
 *
 * Today's amount is fixed at the start of the day (what was left this morning ÷ days left,
 * today included), so it doesn't shrink while you spend; only "left today" moves.
 * Categories that are mostly bills (rent, a subscription) get a month view only: a daily figure
 * for a once-a-month payment would be noise.
 */
import type { Budget, Category, Minor, RecurringRule, Transaction } from '../db/types';
import { daysInMonth, isoDate, monthKey, startOfMonth } from './dates';
import { occurrences, rolloverInto, spendLines } from './finance';

export type AllowanceState = 'fresh' | 'ok' | 'near' | 'reached' | 'over' | 'spent-out';

export interface CategoryAllowance {
  categoryId: string;
  /** This month's budget including anything rolled over. */
  budget: Minor;
  spentMonth: Minor;
  /** Negative when the month's budget is overspent. */
  leftMonth: Minor;
  /** What today's share is, set this morning. 0 when the month's budget was already gone. */
  today: Minor;
  spentToday: Minor;
  /** today − spentToday; negative when over today's share. */
  leftToday: Minor;
  /** Mostly paid by bills: shown as a monthly figure only. */
  fixed: boolean;
  state: AllowanceState;
}

export interface DailyGuide {
  items: CategoryAllowance[];
  daysLeft: number;
  /** Totals across everyday (non-fixed) categories. */
  today: Minor;
  spentToday: Minor;
  leftToday: Minor;
  /** Everyday categories that still have room today / have used today's share / are over it. */
  withRoom: number;
  reached: number;
  over: number;
}

const live = (t: Transaction) => !t.deletedAt;
const dayOf = (t: Transaction) => isoDate(new Date(t.date));

function stateOf(a: Pick<CategoryAllowance, 'today' | 'spentToday' | 'leftMonth' | 'budget'>): AllowanceState {
  if (a.leftMonth < 0) return 'spent-out';
  if (a.today <= 0) return a.spentToday > 0 ? 'over' : 'spent-out';
  if (a.spentToday <= 0) return 'fresh';
  const r = a.spentToday / a.today;
  if (r > 1.02) return 'over';
  if (r >= 0.98) return 'reached';
  return r >= 0.75 ? 'near' : 'ok';
}

/** Rounds today's share down to a figure that's easy to hold in your head. */
export function friendlyDown(m: Minor): Minor {
  if (m >= 1000_00) return Math.floor(m / 50_00) * 50_00;
  if (m >= 200_00) return Math.floor(m / 10_00) * 10_00;
  if (m >= 20_00) return Math.floor(m / 100) * 100;
  return m;
}

export function dailyGuide(o: { budgets: Budget[]; txs: Transaction[]; recurring: RecurringRule[]; categories: Category[]; now: Date }): DailyGuide {
  const { now } = o;
  const mk = monthKey(now);
  const todayKey = isoDate(now);
  const dim = daysInMonth(now);
  const daysLeft = dim - now.getDate() + 1;
  const known = new Set(o.categories.map((c) => c.id));

  const month = new Map<string, Minor>();
  const today = new Map<string, Minor>();
  for (const t of o.txs) {
    if (!live(t) || monthKey(t.date) !== mk) continue;
    const isToday = dayOf(t) === todayKey;
    for (const l of spendLines(t)) {
      month.set(l.categoryId, (month.get(l.categoryId) ?? 0) + l.amount);
      if (isToday) today.set(l.categoryId, (today.get(l.categoryId) ?? 0) + l.amount);
    }
  }
  // Bills expected this month, per category.
  const bills = new Map<string, Minor>();
  const from = startOfMonth(now);
  const to = new Date(now.getFullYear(), now.getMonth(), dim, 23, 59);
  for (const r of o.recurring) {
    if (r.type !== 'expense' || !r.categoryId) continue;
    bills.set(r.categoryId, (bills.get(r.categoryId) ?? 0) + occurrences(r, from, to).length * r.amount);
  }

  const items: CategoryAllowance[] = [];
  for (const b of o.budgets) {
    if (b.memberId || b.eventId || !known.has(b.categoryId)) continue;
    const budget = b.amount + rolloverInto(b, o.txs, mk);
    const spentMonth = month.get(b.categoryId) ?? 0;
    const spentToday = today.get(b.categoryId) ?? 0;
    const leftThisMorning = budget - (spentMonth - spentToday);
    const fixed = budget > 0 && (bills.get(b.categoryId) ?? 0) >= budget * 0.6;
    const share = fixed ? 0 : friendlyDown(Math.max(0, Math.floor(leftThisMorning / daysLeft)));
    const base = { categoryId: b.categoryId, budget, spentMonth, leftMonth: budget - spentMonth, today: share, spentToday, leftToday: share - spentToday, fixed };
    items.push({ ...base, state: fixed ? (base.leftMonth < 0 ? 'spent-out' : 'ok') : stateOf(base) });
  }
  // Most urgent first: over, reached, near, then by what's been used today; fixed ones last.
  const rank: Record<AllowanceState, number> = { over: 0, reached: 1, near: 2, ok: 3, fresh: 4, 'spent-out': 5 };
  items.sort((a, b) => Number(a.fixed) - Number(b.fixed) || rank[a.state] - rank[b.state] || b.spentToday - a.spentToday || b.today - a.today);

  const daily = items.filter((i) => !i.fixed);
  const sum = (f: (i: CategoryAllowance) => number) => daily.reduce((s, i) => s + f(i), 0);
  return {
    items, daysLeft,
    today: sum((i) => i.today), spentToday: sum((i) => i.spentToday), leftToday: sum((i) => Math.max(0, i.leftToday)),
    withRoom: daily.filter((i) => i.state === 'fresh' || i.state === 'ok' || i.state === 'near').length,
    reached: daily.filter((i) => i.state === 'reached').length,
    over: daily.filter((i) => i.state === 'over' || i.state === 'spent-out').length,
  };
}

/** One plain sentence for a category, e.g. after logging a spend. Amounts are pre-formatted by `fmt`. */
export function allowanceLine(a: CategoryAllowance, name: string, fmt: (m: Minor) => string): string {
  if (a.fixed) return a.leftMonth >= 0 ? `${name}: ${fmt(a.leftMonth)} left this month.` : `${name} is ${fmt(-a.leftMonth)} over this month.`;
  switch (a.state) {
    case 'fresh': return `${name}: ${fmt(a.today)} to spend today.`;
    case 'ok':
    case 'near': return `${name}: ${fmt(a.leftToday)} left for today.`;
    case 'reached': return `${name}: that’s today’s share used. ${fmt(Math.max(0, a.leftMonth))} left this month.`;
    case 'over': return a.leftMonth >= 0
      ? `${name}: ${fmt(-a.leftToday)} over today’s share. Still ${fmt(a.leftMonth)} left this month.`
      : `${name} is ${fmt(-a.leftMonth)} over this month.`;
    case 'spent-out': return a.leftMonth < 0 ? `${name} is ${fmt(-a.leftMonth)} over this month.` : `${name}: this month’s budget is used up.`;
  }
}
