/**
 * Encouragement: streaks, small wins and the daily "pat on the back".
 * Everything is worked out from the household's own entries, so there's nothing extra to store.
 * The tone is a friend who notices effort: celebrates, steadies, never scolds.
 */
import type { Goal, Minor, Transaction } from '../db/types';
import { DAY, isoDate, monthKey } from './dates';
import type { DailyGuide } from './allowance';

export interface Streaks {
  /** Days in a row with at least one entry, ending today (or yesterday if nothing's logged yet today). */
  logging: number;
  /** True when today already counts towards the logging streak. */
  loggedToday: boolean;
  bestLogging: number;
  /** Days this month with entries logged around them but no spending. */
  noSpendDays: number;
  totalEntries: number;
}

const live = (t: Transaction) => !t.deletedAt;

export function streaks(txs: Transaction[], now: Date): Streaks {
  const days = new Set<string>();
  const spendDays = new Set<string>();
  let total = 0;
  for (const t of txs) {
    if (!live(t)) continue;
    total++;
    const d = isoDate(new Date(t.date));
    days.add(d);
    if (t.type === 'expense') spendDays.add(d);
  }
  const today = isoDate(now);
  const loggedToday = days.has(today);
  let logging = 0;
  for (let d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (loggedToday ? 0 : 1)); days.has(isoDate(d)); d = new Date(d.getTime() - DAY)) logging++;

  // Best run ever.
  const sorted = [...days].sort();
  let best = 0, run = 0, prev = 0;
  for (const s of sorted) {
    const [y, m, dd] = s.split('-').map(Number);
    const ts = new Date(y, m - 1, dd).getTime();
    run = prev && Math.round((ts - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = ts;
  }

  // No-spend days: only between the first entry this month and yesterday, so an unused app doesn't look frugal.
  const mk = monthKey(now);
  const firstThisMonth = sorted.find((s) => s.startsWith(mk));
  let noSpendDays = 0;
  if (firstThisMonth) {
    for (let day = Number(firstThisMonth.slice(8)); day < now.getDate(); day++) {
      if (!spendDays.has(`${mk}-${String(day).padStart(2, '0')}`)) noSpendDays++;
    }
  }
  return { logging, loggedToday, bestLogging: Math.max(best, logging), noSpendDays, totalEntries: total };
}

export interface Badge { id: string; emoji: string; name: string; how: string; earned: boolean; progress?: string }

export function badges(o: { txs: Transaction[]; goals: Goal[]; streaks: Streaks; budgetsCount: number; lastMonthWithinBudget?: boolean }): Badge[] {
  const s = o.streaks;
  const best = s.bestLogging;
  const goalDone = o.goals.some((g) => g.target > 0 && g.saved >= g.target);
  const run = (n: number) => (best >= n ? undefined : `${Math.min(best, n)} of ${n} days`);
  return [
    { id: 'first-entry', emoji: '🌱', name: 'First entry', how: 'Log your first entry.', earned: s.totalEntries > 0 },
    { id: 'streak-3', emoji: '✨', name: 'Three in a row', how: 'Log entries three days running.', earned: best >= 3, progress: run(3) },
    { id: 'streak-7', emoji: '🔥', name: 'A full week', how: 'Log entries seven days running.', earned: best >= 7, progress: run(7) },
    { id: 'streak-30', emoji: '🏅', name: 'Thirty-day habit', how: 'Log entries thirty days running.', earned: best >= 30, progress: run(30) },
    { id: 'no-spend-5', emoji: '🧘', name: 'Five quiet days', how: 'Have five no-spend days in one month.', earned: s.noSpendDays >= 5, progress: s.noSpendDays >= 5 ? undefined : `${s.noSpendDays} of 5 this month` },
    { id: 'planner', emoji: '🗺️', name: 'Has a plan', how: 'Set budgets for at least three categories.', earned: o.budgetsCount >= 3, progress: o.budgetsCount >= 3 ? undefined : `${o.budgetsCount} of 3` },
    { id: 'on-budget-month', emoji: '🎯', name: 'On-budget month', how: 'Finish a month inside your total budget.', earned: !!o.lastMonthWithinBudget },
    { id: 'goal-reached', emoji: '🏆', name: 'Goal reached', how: 'Fill a savings goal to 100%.', earned: goalDone },
    { id: 'hundred', emoji: '💯', name: 'A hundred entries', how: 'Log one hundred entries.', earned: s.totalEntries >= 100, progress: s.totalEntries >= 100 ? undefined : `${s.totalEntries} of 100` },
  ];
}

export type CheerTone = 'celebrate' | 'steady' | 'nudge';
export interface Cheer { id: string; emoji: string; title: string; body: string; tone: CheerTone; /** A milestone worth confetti, once. */ milestone?: string }

function seed(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = <T,>(xs: T[], key: string) => xs[seed(key) % xs.length];

/**
 * Today's pat on the back. `fmt` formats money; `topName` is the category with the most room or
 * the one that's used up, for a concrete line. Stable for the day unless the situation changes.
 */
export function cheer(o: { guide: DailyGuide; streaks: Streaks; now: Date; fmt: (m: Minor) => string; name?: string; reachedName?: string; roomiestName?: string }): Cheer {
  const { guide: g, streaks: s, now, fmt } = o;
  const day = isoDate(now);
  const who = o.name ? `, ${o.name}` : '';
  const hour = now.getHours();
  const daily = g.withRoom + g.reached + g.over;

  // Milestones first: they're rare and earned.
  if (s.loggedToday && [3, 7, 14, 30, 50, 100].includes(s.logging)) {
    const n = s.logging;
    return {
      id: `streak-${n}`, emoji: n >= 30 ? '🏅' : n >= 7 ? '🔥' : '✨', tone: 'celebrate', milestone: `streak-${n}-${day}`,
      title: n >= 30 ? `${n} days in a row${who}. That’s a real habit` : `${n} days in a row${who}`,
      body: pick([
        'Knowing where the money goes is most of the work, and you keep showing up for it.',
        'Small entries, every day. This is exactly how people get on top of their money.',
        'Consistency beats perfection. Keep the streak alive tomorrow.',
      ], day),
    };
  }
  if (!daily) {
    return s.totalEntries === 0
      ? { id: 'start', emoji: '👋', tone: 'steady', title: `Welcome${who}`, body: 'Log your first spend with the + button. One entry is all it takes to get going.' }
      : { id: 'no-budgets', emoji: '🗺️', tone: 'nudge', title: 'Give today a number', body: 'Set a budget for a few categories and you’ll see what’s fine to spend on each one, every day.' };
  }
  if (g.over > 0 && g.withRoom === 0 && g.reached === 0) {
    return {
      id: 'all-over', emoji: '🌤️', tone: 'nudge', title: 'A heavier day. It happens',
      body: pick([
        'Tomorrow’s share adjusts by itself, so one big day never breaks the month.',
        'The month is long. A lighter day or two and you’re back on pace.',
      ], day),
    };
  }
  if (g.over > 0) {
    return {
      id: 'some-over', emoji: '🧭', tone: 'nudge',
      title: o.reachedName ? `${o.reachedName} went past today’s share` : 'One category went past today’s share',
      body: `No drama: ${g.withRoom} other${g.withRoom === 1 ? '' : 's'} still ${g.withRoom === 1 ? 'has' : 'have'} room, with ${fmt(g.leftToday)} left for today overall.`,
    };
  }
  if (g.reached > 0 && g.withRoom > 0) {
    return {
      id: 'some-reached', emoji: '👌', tone: 'steady',
      title: o.reachedName ? `${o.reachedName} is done for today` : 'One category is done for today',
      body: `Right on its share. You still have ${fmt(g.leftToday)} across ${g.withRoom} other${g.withRoom === 1 ? '' : 's'}.`,
    };
  }
  if (g.spentToday > 0) {
    return {
      id: 'on-pace', emoji: pick(['💪', '🙌', '🌊'], day), tone: 'celebrate',
      title: pick([`Nicely paced${who}`, 'Right on course today', `You’re doing this well${who}`], day),
      body: `Everything’s inside today’s share, with ${fmt(g.leftToday)} still free${o.roomiestName ? `, most of it in ${o.roomiestName}` : ''}.`,
    };
  }
  // Nothing spent yet today.
  if (hour >= 19) {
    return {
      id: 'no-spend', emoji: '🧘', tone: 'celebrate', title: 'A no-spend day so far',
      body: `Quiet days like this are what make the month work. Tomorrow’s share grows a little because of it.`,
    };
  }
  if (s.logging >= 2) {
    return {
      id: 'streak-going', emoji: '🔥', tone: 'steady', title: `${s.logging}-day streak going${who}`,
      body: `Fresh day: ${fmt(g.today)} across ${daily} categor${daily === 1 ? 'y' : 'ies'}. Log today’s first spend to keep the streak.`,
    };
  }
  return {
    id: 'fresh', emoji: pick(['🌅', '☀️', '🌊'], day), tone: 'steady', title: hour < 12 ? `Fresh day${who}` : `The day’s still yours${who}`,
    body: `${fmt(g.today)} to spend across ${daily} categor${daily === 1 ? 'y' : 'ies'} today, and every one of them is untouched.`,
  };
}

/** A short cheer for the toast after saving a spend. Returns undefined when there's nothing kind and true to say. */
export function savedCheer(o: { state: 'fresh' | 'ok' | 'near' | 'reached' | 'over' | 'spent-out'; streak: number; firstToday: boolean }): string | undefined {
  if (o.firstToday && o.streak >= 2) return `Day ${o.streak} of your streak.`;
  if (o.firstToday) return 'First entry of the day. Nice.';
  if (o.state === 'ok') return 'Well inside today’s share.';
  if (o.state === 'reached') return 'Spot on today’s share.';
  return undefined;
}
