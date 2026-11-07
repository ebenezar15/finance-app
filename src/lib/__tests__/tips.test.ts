import { describe, expect, it } from 'vitest';
import { TIPS, dayKey, tipOfTheDay, type TipSignals, type TipTopic } from '../tips';

const TOPICS: TipTopic[] = ['budgeting', 'saving', 'debt', 'investing', 'spending', 'family', 'habits', 'safety', 'bills'];
const ROUTES = ['/budgets', '/goals', '/bills', '/debts', '/insights', '/settings', '/activity', '/inbox'];
const CURRENCY = /[$€£₹¥]/;

/** Signals for a household where nothing needs attention. */
const calm: TipSignals = {
  savingsRate: 0.15,
  topCategoryName: 'Groceries',
  topCategoryShare: 0.2,
  hasBudgets: true,
  overBudgetCount: 0,
  hasEmergencyGoal: true,
  hasGoals: true,
  billsDueSoon: 0,
  hasDebt: false,
  creditCardOwed: false,
  subscriptionsCount: 1,
  hasBackup: true,
  entriesLast7Days: 4,
  daysSinceLastEntry: 0,
  isMonthStart: false,
  isMonthEnd: false,
  isWeekend: false,
};

const day = (i: number) => new Date(2026, 0, 1 + i, 9, 30);

describe('tip library', () => {
  it('has enough tips and facts', () => {
    expect(TIPS.filter((t) => t.kind === 'tip').length).toBeGreaterThanOrEqual(45);
    expect(TIPS.filter((t) => t.kind === 'fact').length).toBeGreaterThanOrEqual(25);
  });

  it('covers every topic', () => {
    for (const topic of TOPICS) expect(TIPS.some((t) => t.topic === topic)).toBe(true);
  });

  it('has unique kebab-case ids', () => {
    const ids = TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('keeps titles and bodies within length limits, in sentence case', () => {
    for (const t of TIPS) {
      expect(t.title.length, t.id).toBeLessThan(60);
      expect(t.body.length, t.id).toBeLessThan(220);
      expect(t.title[0], t.id).toBe(t.title[0].toUpperCase());
      expect(`${t.title} ${t.body}`, t.id).not.toMatch(/!/);
    }
  });

  it('uses only known action routes', () => {
    for (const t of TIPS) if (t.action) expect(ROUTES, t.id).toContain(t.action.to);
  });

  it('never mentions a currency symbol or survey-style percentages', () => {
    for (const t of TIPS) {
      expect(`${t.title} ${t.body}`, t.id).not.toMatch(CURRENCY);
      expect(t.body, t.id).not.toMatch(/%\s+of\s+(people|adults|households|americans|respondents|consumers|users)/i);
      expect(t.body, t.id).not.toMatch(/\b(survey|study found that \d)/i);
    }
  });
});

describe('dayKey', () => {
  it('formats the local date', () => {
    expect(dayKey(new Date(2026, 2, 5, 23, 59))).toBe('2026-03-05');
    expect(dayKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('tipOfTheDay', () => {
  it('is stable through the day', () => {
    const morning = tipOfTheDay(new Date(2026, 4, 10, 0, 1));
    const night = tipOfTheDay(new Date(2026, 4, 10, 23, 59));
    expect(night.tip.id).toBe(morning.tip.id);
    expect(tipOfTheDay(new Date(2026, 4, 10, 12), calm).tip.id).toBe(tipOfTheDay(new Date(2026, 4, 10, 18), calm).tip.id);
  });

  it('varies across days and alternates tips and facts', () => {
    const picks = Array.from({ length: 30 }, (_, i) => tipOfTheDay(day(i)).tip);
    expect(new Set(picks.map((t) => t.id)).size).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < picks.length; i++) expect(picks[i].id).not.toBe(picks[i - 1].id);
    const kinds = new Set(picks.map((t) => t.kind));
    expect(kinds).toEqual(new Set(['tip', 'fact']));
  });

  it('gives distinct alternatives for skip 0..10', () => {
    for (const signals of [undefined, calm, { ...calm, creditCardOwed: true, hasDebt: true, billsDueSoon: 2 }]) {
      const ids = Array.from({ length: 11 }, (_, skip) => tipOfTheDay(day(3), signals, { skip }).tip.id);
      expect(new Set(ids).size).toBe(11);
    }
  });

  it('does not repeat until the library is exhausted', () => {
    const ids = Array.from({ length: TIPS.length }, (_, skip) => tipOfTheDay(day(7), calm, { skip }).tip.id);
    expect(new Set(ids).size).toBe(TIPS.length);
    expect(tipOfTheDay(day(7), calm, { skip: TIPS.length }).tip.id).toBe(ids[0]);
  });

  it('personalises about half of days, with debt tips when a card is owed', () => {
    const signals = { ...calm, creditCardOwed: true, hasDebt: true };
    let personalised = 0;
    for (let i = 0; i < 60; i++) {
      const r = tipOfTheDay(day(i), signals);
      if (r.personal) {
        personalised++;
        expect(r.tip.topic).toBe('debt');
      }
    }
    expect(personalised).toBeGreaterThanOrEqual(15);
    expect(personalised).toBeLessThanOrEqual(45);
  });

  it('does not personalise when nothing stands out', () => {
    for (let i = 0; i < 30; i++) expect(tipOfTheDay(day(i), calm).personal).toBeUndefined();
  });

  it('names the top category and its share', () => {
    const signals = { ...calm, topCategoryName: 'Dining out', topCategoryShare: 0.34 };
    const results = Array.from({ length: 30 }, (_, i) => tipOfTheDay(day(i), signals)).filter((r) => r.personal);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tip.id).toBe('top-category');
      expect(r.personal).toBe('Dining out was 34% of your spending this month.');
    }
  });

  it('maps signals to sensible tips', () => {
    const cases: [Partial<TipSignals>, string, TipTopic][] = [
      [{ hasBudgets: false }, 'start-a-budget', 'budgeting'],
      [{ overBudgetCount: 2 }, 'budget-recovery', 'budgeting'],
      [{ hasEmergencyGoal: false }, 'emergency-fund', 'saving'],
      [{ creditCardOwed: true }, 'pay-card-in-full', 'debt'],
      [{ subscriptionsCount: 6 }, 'subscription-audit', 'spending'],
      [{ hasBackup: false }, 'back-up-data', 'safety'],
      [{ daysSinceLastEntry: 4 }, 'catch-up-entries', 'habits'],
      [{ isMonthStart: true }, 'plan-the-month', 'budgeting'],
      [{ isMonthEnd: true }, 'review-the-month', 'budgeting'],
      [{ billsDueSoon: 3 }, 'bills-due-soon', 'bills'],
    ];
    for (const [patch, id, topic] of cases) {
      const hits = Array.from({ length: 30 }, (_, i) => tipOfTheDay(day(i), { ...calm, ...patch })).filter((r) => r.personal);
      expect(hits.length, id).toBeGreaterThan(0);
      for (const r of hits) {
        expect(r.tip.id, id).toBe(id);
        expect(r.tip.topic, id).toBe(topic);
        expect(r.personal, id).not.toMatch(CURRENCY);
      }
    }
    const bills = Array.from({ length: 30 }, (_, i) => tipOfTheDay(day(i), { ...calm, billsDueSoon: 3 })).find((r) => r.personal);
    expect(bills?.personal).toBe('You have 3 bills due this week.');
  });

  it('avoids recently seen tips', () => {
    for (let i = 0; i < 20; i++) {
      const first = tipOfTheDay(day(i), calm);
      const next = tipOfTheDay(day(i), calm, { seen: [first.tip.id] });
      expect(next.tip.id).not.toBe(first.tip.id);
    }
    // A personalised pick that was already seen gives way too.
    const signals = { ...calm, creditCardOwed: true };
    const i = Array.from({ length: 30 }, (_, k) => k).find((k) => tipOfTheDay(day(k), signals).personal)!;
    const seenPick = tipOfTheDay(day(i), signals, { seen: ['pay-card-in-full'] });
    expect(seenPick.tip.id).not.toBe('pay-card-in-full');
    // Seen tips still come back once everything else is used up.
    const all = TIPS.map((t) => t.id);
    expect(all).toContain(tipOfTheDay(day(i), signals, { seen: all }).tip.id);
  });

  it('is deterministic for the same day, signals and skip', () => {
    const signals = { ...calm, overBudgetCount: 1, billsDueSoon: 1, isWeekend: true };
    for (let i = 0; i < 10; i++) {
      for (const skip of [0, 1, 5]) {
        expect(tipOfTheDay(day(i), signals, { skip })).toEqual(tipOfTheDay(day(i), signals, { skip }));
      }
    }
  });
});
