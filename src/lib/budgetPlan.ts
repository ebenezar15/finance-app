/**
 * Custom budgeting and budget templates.
 *
 * A custom plan splits income into groups the person names themselves ("Home 40%", "Kids 15%",
 * "Giving 10%"…), each holding the categories they choose. A template is a saved copy of the
 * household's budgets (and the custom plan, if any) that can be applied again later, for example
 * a "Festival month" or "Tight month" setup.
 */
import type { Budget, BudgetStyle, Category, Minor } from '../db/types';

export interface PlanGroup { id: string; name: string; pct: number; colour: string; categoryIds: string[] }
export interface CustomPlan { groups: PlanGroup[] }

export interface TemplateBudget { categoryId: string; categoryName: string; amount: Minor; rollover: boolean }
export interface BudgetTemplate {
  id: string;
  name: string;
  createdAt: number;
  style: BudgetStyle;
  budgets: TemplateBudget[];
  plan?: CustomPlan;
  /** Monthly income when it was saved, so it can be scaled to a different income later. */
  income?: Minor;
}

export const PLAN_KEY = 'budgetPlan';
export const TEMPLATES_KEY = 'budgetTemplates';
export const GROUP_COLOURS = ['#0F766E', '#4F46E5', '#16A34A', '#D97706', '#DB2777', '#0284C7', '#7C3AED', '#65A30D'];

const gid = () => Math.random().toString(36).slice(2, 10);

/** A sensible first plan: the person's expense categories sorted into needs, wants and savings. */
export function starterPlan(categories: Category[]): CustomPlan {
  const exp = categories.filter((c) => c.kind === 'expense' && !c.parentId);
  const of = (n: Category['need']) => exp.filter((c) => c.need === n).map((c) => c.id);
  return {
    groups: [
      { id: gid(), name: 'Needs', pct: 50, colour: GROUP_COLOURS[0], categoryIds: of('essential') },
      { id: gid(), name: 'Wants', pct: 30, colour: GROUP_COLOURS[1], categoryIds: of('discretionary') },
      { id: gid(), name: 'Savings', pct: 20, colour: GROUP_COLOURS[2], categoryIds: of('savings') },
    ],
  };
}

export const newGroup = (plan: CustomPlan): PlanGroup => ({
  id: gid(), name: '', pct: Math.max(0, 100 - planTotalPct(plan)), colour: GROUP_COLOURS[plan.groups.length % GROUP_COLOURS.length], categoryIds: [],
});

export const planTotalPct = (plan: CustomPlan) => Math.round(plan.groups.reduce((s, g) => s + (Number.isFinite(g.pct) ? g.pct : 0), 0) * 100) / 100;

/** Puts a category in one group only (or none, with `groupId` undefined). */
export function moveCategory(plan: CustomPlan, categoryId: string, groupId?: string): CustomPlan {
  return {
    groups: plan.groups.map((g) => {
      const rest = g.categoryIds.filter((id) => id !== categoryId);
      return { ...g, categoryIds: g.id === groupId ? [...rest, categoryId] : rest };
    }),
  };
}

/** Drops categories that no longer exist (deleted or after a restore). */
export function cleanPlan(plan: CustomPlan, categories: Category[]): CustomPlan {
  const ids = new Set(categories.map((c) => c.id));
  return { groups: plan.groups.map((g) => ({ ...g, categoryIds: g.categoryIds.filter((id) => ids.has(id)) })) };
}

export interface GroupProgress { group: PlanGroup; target: Minor; budgeted: Minor; spent: Minor }

/**
 * How each group is doing this month. `target` is the group's share of income, `budgeted` the sum
 * of its categories' budgets, `spent` what went on its categories. Sub-categories count towards
 * their parent's group.
 */
export function planProgress(plan: CustomPlan, opts: { income: Minor; spend: Map<string, Minor>; budgets: Budget[]; categories: Category[] }) {
  const groupOf = new Map<string, string>();
  for (const g of plan.groups) for (const id of g.categoryIds) groupOf.set(id, g.id);
  const parent = new Map(opts.categories.map((c) => [c.id, c.parentId]));
  const owner = (catId: string) => groupOf.get(catId) ?? (parent.get(catId) ? groupOf.get(parent.get(catId)!) : undefined);

  const spent = new Map<string, Minor>();
  let unplanned = 0;
  for (const [catId, v] of opts.spend) {
    const g = owner(catId);
    if (g) spent.set(g, (spent.get(g) ?? 0) + v); else unplanned += v;
  }
  const budgeted = new Map<string, Minor>();
  for (const b of opts.budgets) {
    if (b.memberId || b.eventId) continue;
    const g = owner(b.categoryId);
    if (g) budgeted.set(g, (budgeted.get(g) ?? 0) + b.amount);
  }
  const rows: GroupProgress[] = plan.groups.map((group) => ({
    group, target: Math.round((opts.income * (group.pct || 0)) / 100), budgeted: budgeted.get(group.id) ?? 0, spent: spent.get(group.id) ?? 0,
  }));
  return { rows, unplanned, unassignedPct: Math.max(0, 100 - planTotalPct(plan)) };
}

/** Saves the household's current budgets (not personal allowances or event budgets) as a template. */
export function makeTemplate(name: string, o: { style: BudgetStyle; budgets: Budget[]; categories: Category[]; plan?: CustomPlan; income?: Minor; id?: string }): BudgetTemplate {
  const cat = new Map(o.categories.map((c) => [c.id, c]));
  return {
    id: o.id ?? gid(),
    name: name.trim() || 'My budget',
    createdAt: Date.now(),
    style: o.style,
    budgets: o.budgets.filter((b) => !b.memberId && !b.eventId && cat.has(b.categoryId))
      .map((b) => ({ categoryId: b.categoryId, categoryName: cat.get(b.categoryId)!.name, amount: b.amount, rollover: b.rollover })),
    plan: o.style === 'custom' && o.plan ? structuredClone(o.plan) : undefined,
    income: o.income || undefined,
  };
}

/** Rounds to a friendly figure after scaling: whole units under 100, else the nearest 10. */
const tidy = (m: Minor) => (m >= 100_00 ? Math.round(m / 10_00) * 10_00 : Math.round(m / 100) * 100);

/**
 * Turns a template back into budgets for this household. Categories are matched by id, then by
 * name (so templates keep working after a restore or on another phone). `scale` multiplies every
 * amount, e.g. new income ÷ the income when the template was saved.
 */
export function applyTemplate(t: BudgetTemplate, categories: Category[], scale = 1) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  const remap = new Map<string, string>();
  const missing: string[] = [];
  const budgets: Omit<Budget, 'id'>[] = [];
  const seen = new Set<string>();
  for (const b of t.budgets) {
    const c = byId.get(b.categoryId) ?? byName.get(b.categoryName.trim().toLowerCase());
    if (!c) { missing.push(b.categoryName); continue; }
    remap.set(b.categoryId, c.id);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    budgets.push({ categoryId: c.id, amount: scale === 1 ? b.amount : tidy(b.amount * scale), rollover: b.rollover });
  }
  let plan: CustomPlan | undefined;
  if (t.plan) {
    plan = {
      groups: t.plan.groups.map((g) => ({
        ...g, categoryIds: g.categoryIds.map((id) => remap.get(id) ?? (byId.has(id) ? id : '')).filter(Boolean),
      })),
    };
  }
  return { budgets, plan, missing };
}
