import { describe, expect, it } from 'vitest';
import type { Budget, Category } from '../../db/types';
import { applyTemplate, cleanPlan, makeTemplate, moveCategory, newGroup, planProgress, planTotalPct, starterPlan } from '../budgetPlan';

const cat = (id: string, name: string, need: Category['need'], extra: Partial<Category> = {}): Category =>
  ({ id, name, emoji: '', colour: '#000', kind: 'expense', need, ...extra });
const CATS: Category[] = [
  cat('rent', 'Rent', 'essential'), cat('food', 'Groceries', 'essential'), cat('fun', 'Dining out', 'discretionary'),
  cat('sip', 'Investing', 'savings'), cat('pay', 'Salary', 'essential', { kind: 'income' }), cat('veg', 'Vegetables', 'essential', { parentId: 'food' }),
];
const budget = (categoryId: string, amount: number, extra: Partial<Budget> = {}): Budget => ({ id: categoryId + amount, categoryId, amount, rollover: false, ...extra });

describe('custom budget plan', () => {
  it('starts from needs, wants and savings using the household’s own expense categories', () => {
    const p = starterPlan(CATS);
    expect(p.groups.map((g) => [g.name, g.pct, g.categoryIds])).toEqual([
      ['Needs', 50, ['rent', 'food']], ['Wants', 30, ['fun']], ['Savings', 20, ['sip']],
    ]);
    expect(planTotalPct(p)).toBe(100);
    expect(newGroup(p).pct).toBe(0);
  });

  it('keeps each category in one group only', () => {
    const p = starterPlan(CATS);
    const moved = moveCategory(p, 'fun', p.groups[0].id);
    expect(moved.groups[0].categoryIds).toContain('fun');
    expect(moved.groups[1].categoryIds).not.toContain('fun');
    expect(moveCategory(moved, 'fun').groups.flatMap((g) => g.categoryIds)).not.toContain('fun');
    expect(cleanPlan(p, CATS.filter((c) => c.id !== 'rent')).groups[0].categoryIds).toEqual(['food']);
  });

  it('works out each group’s target, budgets and spending, counting sub-categories with their parent', () => {
    const p = starterPlan(CATS);
    const r = planProgress(p, {
      income: 100_000_00,
      spend: new Map([['rent', 30_000_00], ['veg', 2_000_00], ['fun', 5_000_00], ['other', 700_00]]),
      budgets: [budget('rent', 30_000_00), budget('food', 8_000_00), budget('fun', 6_000_00), budget('fun', 999, { memberId: 'kid' })],
      categories: CATS,
    });
    expect(r.rows.map((x) => [x.group.name, x.target, x.budgeted, x.spent])).toEqual([
      ['Needs', 50_000_00, 38_000_00, 32_000_00], ['Wants', 30_000_00, 6_000_00, 5_000_00], ['Savings', 20_000_00, 0, 0],
    ]);
    expect(r.unplanned).toBe(700_00);
    expect(r.unassignedPct).toBe(0);
  });
});

describe('budget templates', () => {
  const budgets = [budget('rent', 30_000_00), budget('fun', 6_000_00, { rollover: true }), budget('fun', 500_00, { memberId: 'kid' }), budget('food', 1, { eventId: 'trip' })];

  it('saves only the household budgets, and the plan for the custom style', () => {
    const plan = starterPlan(CATS);
    const t = makeTemplate('  Normal month ', { style: 'custom', budgets, categories: CATS, plan, income: 100_000_00 });
    expect(t.name).toBe('Normal month');
    expect(t.budgets).toEqual([
      { categoryId: 'rent', categoryName: 'Rent', amount: 30_000_00, rollover: false },
      { categoryId: 'fun', categoryName: 'Dining out', amount: 6_000_00, rollover: true },
    ]);
    expect(t.plan?.groups).toHaveLength(3);
    plan.groups[0].name = 'changed later';
    expect(t.plan?.groups[0].name).toBe('Needs');
    expect(makeTemplate('x', { style: 'envelope', budgets, categories: CATS, plan }).plan).toBeUndefined();
  });

  it('applies by category, falling back to the name after a restore, and reports what is missing', () => {
    const t = makeTemplate('Normal', { style: 'custom', budgets, categories: CATS, plan: starterPlan(CATS) });
    t.budgets.push({ categoryId: 'gone', categoryName: 'Pet care', amount: 100, rollover: false });
    const restored = CATS.map((c) => (c.id === 'fun' ? { ...c, id: 'fun-2' } : c));
    const r = applyTemplate(t, restored);
    expect(r.budgets).toEqual([
      { categoryId: 'rent', amount: 30_000_00, rollover: false },
      { categoryId: 'fun-2', amount: 6_000_00, rollover: true },
    ]);
    expect(r.missing).toEqual(['Pet care']);
    expect(r.plan?.groups[1].categoryIds).toEqual(['fun-2']);
  });

  it('scales amounts to a new income with friendly rounding', () => {
    const t = makeTemplate('Normal', { style: 'envelope', budgets, categories: CATS, income: 100_000_00 });
    expect(applyTemplate(t, CATS, 1.1).budgets.map((b) => b.amount)).toEqual([33_000_00, 6_600_00]);
    expect(applyTemplate(t, CATS, 0.333).budgets.map((b) => b.amount)).toEqual([9_990_00, 2_000_00]);
  });
});
