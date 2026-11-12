import { describe, expect, it } from 'vitest';
import type { Budget, Category, RecurringRule, Transaction } from '../../db/types';
import { allowanceLine, dailyGuide, friendlyDown } from '../allowance';
import { badges, cheer, savedCheer, streaks } from '../cheer';

const NOW = new Date(2026, 10, 21, 14, 0); // 21 Nov 2026: 10 days left including today
const cat = (id: string, name: string): Category => ({ id, name, emoji: '', colour: '#000', kind: 'expense', need: 'discretionary' });
const CATS = [cat('cab', 'Cab'), cat('food', 'Groceries'), cat('rent', 'Rent'), cat('fun', 'Fun')];
const b = (categoryId: string, amount: number, extra: Partial<Budget> = {}): Budget => ({ id: 'b-' + categoryId, categoryId, amount, rollover: false, ...extra });
let n = 0;
const tx = (categoryId: string, amount: number, day: number, hour = 10, extra: Partial<Transaction> = {}): Transaction => ({
  id: 't' + ++n, date: new Date(2026, 10, day, hour).toISOString(), amount, type: 'expense', accountId: 'a', categoryId, currency: 'INR', tags: [], source: 'manual', needsReview: false, createdAt: 0, updatedAt: 0, ...extra,
} as Transaction);
const fmt = (m: number) => `¤${(m / 100).toLocaleString('en-US')}`;
const rentRule: RecurringRule = { id: 'r', name: 'Rent', type: 'expense', amount: 20_000_00, estimated: false, categoryId: 'rent', accountId: 'a', freq: 'monthly', day: 1, startDate: '2026-01-01', autoPost: true, isSubscription: false };

describe('daily spending guide', () => {
  const budgets = [b('cab', 3_000_00), b('food', 9_000_00), b('rent', 20_000_00), b('fun', 2_000_00), b('fun', 500_00, { memberId: 'kid' })];
  const txs = [
    tx('cab', 1_800_00, 5), tx('cab', 150_00, 21),          // 1,200 left this morning → 120 a day; 150 today → over
    tx('food', 4_000_00, 10), tx('food', 200_00, 21),       // 5,000 left this morning → 500 a day; 200 today → ok
    tx('rent', 20_000_00, 1),
    tx('fun', 2_300_00, 12),                                // month overspent
  ];
  const g = dailyGuide({ budgets, txs, recurring: [rentRule], categories: CATS, now: NOW });
  const by = (id: string) => g.items.find((i) => i.categoryId === id)!;

  it('sets today’s share from what was left this morning, over the days left', () => {
    expect(g.daysLeft).toBe(10);
    expect(by('cab')).toMatchObject({ budget: 3_000_00, spentMonth: 1_950_00, leftMonth: 1_050_00, today: 120_00, spentToday: 150_00, leftToday: -30_00, state: 'over' });
    expect(by('food')).toMatchObject({ today: 500_00, spentToday: 200_00, leftToday: 300_00, state: 'ok' });
  });

  it('treats bill-driven categories as monthly only and overspent ones as used up', () => {
    expect(by('rent')).toMatchObject({ fixed: true, today: 0, leftMonth: 0, state: 'ok' });
    expect(by('fun')).toMatchObject({ fixed: false, today: 0, leftMonth: -300_00, state: 'spent-out' });
    expect(g.items.filter((i) => i.categoryId === 'fun')).toHaveLength(1); // the child's allowance isn't a household budget
  });

  it('totals everyday categories and puts the urgent ones first', () => {
    expect(g.today).toBe(620_00);
    expect(g.spentToday).toBe(350_00);
    expect(g.leftToday).toBe(300_00);
    expect([g.withRoom, g.reached, g.over]).toEqual([1, 0, 2]);
    expect(g.items.map((i) => i.categoryId)).toEqual(['cab', 'food', 'fun', 'rent']);
  });

  it('doesn’t shrink today’s share as the day’s spending is logged', () => {
    const more = dailyGuide({ budgets, txs: [...txs, tx('food', 250_00, 21, 13)], recurring: [rentRule], categories: CATS, now: NOW });
    const food = more.items.find((i) => i.categoryId === 'food')!;
    expect(food.today).toBe(500_00);
    expect(food).toMatchObject({ spentToday: 450_00, leftToday: 50_00, state: 'near' });
  });

  it('says it in one plain sentence', () => {
    expect(allowanceLine(by('cab'), 'Cab', fmt)).toBe('Cab: ¤30 over today’s share. Still ¤1,050 left this month.');
    expect(allowanceLine(by('food'), 'Groceries', fmt)).toBe('Groceries: ¤300 left for today.');
    expect(allowanceLine(by('fun'), 'Fun', fmt)).toBe('Fun is ¤300 over this month.');
    expect(allowanceLine(by('rent'), 'Rent', fmt)).toBe('Rent: ¤0 left this month.');
  });

  it('rounds shares down to memorable figures', () => {
    expect([friendlyDown(123_45), friendlyDown(987_65), friendlyDown(4_321_00), friendlyDown(12_50)]).toEqual([123_00, 980_00, 4_300_00, 12_50]);
  });
});

describe('streaks, badges and cheer', () => {
  const run = [17, 18, 19, 20, 21].map((d) => tx('food', 100_00, d));
  it('counts days in a row, and keeps yesterday’s streak alive until today is logged', () => {
    expect(streaks(run, NOW)).toMatchObject({ logging: 5, loggedToday: true, bestLogging: 5 });
    expect(streaks(run.slice(0, 4), NOW)).toMatchObject({ logging: 4, loggedToday: false });
    expect(streaks([tx('food', 1, 3), tx('food', 1, 4), tx('food', 1, 5), tx('food', 1, 21)], NOW)).toMatchObject({ logging: 1, bestLogging: 3 });
    expect(streaks([], NOW)).toMatchObject({ logging: 0, noSpendDays: 0, totalEntries: 0 });
  });

  it('counts no-spend days only after the first entry of the month', () => {
    const s = streaks([tx('food', 1, 15), tx('food', 1, 18), tx('pay', 5, 19, 10, { type: 'income' })], NOW);
    expect(s.noSpendDays).toBe(4); // 16, 17, 19 (income only), 20
  });

  it('awards badges from real activity', () => {
    const s = streaks(run, NOW);
    const got = badges({ txs: run, goals: [], streaks: s, budgetsCount: 3 }).filter((x) => x.earned).map((x) => x.id);
    expect(got).toEqual(['first-entry', 'streak-3', 'planner']);
    expect(badges({ txs: run, goals: [], streaks: s, budgetsCount: 0 }).find((x) => x.id === 'streak-7')!.progress).toBe('5 of 7 days');
  });

  const guide = (over: number, reached: number, withRoom: number, spentToday: number) => ({ items: [], daysLeft: 10, today: 620_00, spentToday, leftToday: 300_00, withRoom, reached, over });
  it('celebrates, steadies or nudges, and never scolds', () => {
    const s = streaks(run, NOW);
    expect(cheer({ guide: guide(0, 0, 3, 200_00), streaks: s, now: NOW, fmt })).toMatchObject({ tone: 'celebrate' });
    expect(cheer({ guide: guide(1, 0, 2, 200_00), streaks: s, now: NOW, fmt, reachedName: 'Cab' })).toMatchObject({ tone: 'nudge', title: 'Cab went past today’s share' });
    expect(cheer({ guide: guide(0, 1, 2, 200_00), streaks: s, now: NOW, fmt, reachedName: 'Cab' }).title).toBe('Cab is done for today');
    expect(cheer({ guide: guide(0, 0, 0, 0), streaks: streaks([], NOW), now: NOW, fmt }).id).toBe('start');
    const week = streaks([15, 16, 17, 18, 19, 20, 21].map((d) => tx('food', 1, d)), NOW);
    expect(cheer({ guide: guide(0, 0, 3, 100), streaks: week, now: NOW, fmt })).toMatchObject({ id: 'streak-7', milestone: 'streak-7-2026-11-21' });
    for (const c of [cheer({ guide: guide(3, 0, 0, 900_00), streaks: s, now: NOW, fmt })]) expect(`${c.title} ${c.body}`).not.toMatch(/overspen|bad|fail|shame|too much/i);
  });

  it('is the same all day for the same situation', () => {
    const s = streaks(run, NOW);
    const a = cheer({ guide: guide(0, 0, 3, 200_00), streaks: s, now: NOW, fmt });
    const later = cheer({ guide: guide(0, 0, 3, 200_00), streaks: s, now: new Date(2026, 10, 21, 17), fmt });
    expect(later).toEqual(a);
  });

  it('adds a kind word after saving only when it’s true', () => {
    expect(savedCheer({ state: 'ok', streak: 4, firstToday: true })).toBe('Day 4 of your streak.');
    expect(savedCheer({ state: 'over', streak: 4, firstToday: false })).toBeUndefined();
  });
});
