import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkPlus, LayoutTemplate, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, getSetting, setSetting, uid } from '../db/db';
import { saveProfile, type Data } from '../db/hooks';
import type { BudgetStyle, Minor } from '../db/types';
import {
  GROUP_COLOURS, PLAN_KEY, TEMPLATES_KEY, applyTemplate, cleanPlan, makeTemplate, moveCategory, newGroup, planProgress, planTotalPct, starterPlan,
  type BudgetTemplate, type CustomPlan,
} from '../lib/budgetPlan';
import { spendByCategory } from '../lib/finance';
import { askConfirm, useUI } from '../store/ui';
import { Bar, Money, Panel, Sheet, useFmt } from './ui';

const toast = (t: string) => useUI.getState().toast(t);
const STYLE_NAME: Record<BudgetStyle, string> = { envelope: 'Envelope', 'zero-based': 'Zero-based', '50-30-20': '50/30/20', caps: 'Caps', custom: 'Custom' };

/** The saved custom plan, or a starter one built from the household's categories. */
function usePlan(data: Data) {
  const saved = useLiveQuery(() => getSetting<CustomPlan | null>(PLAN_KEY, null), []);
  return useMemo(() => (saved === undefined ? undefined : cleanPlan(saved ?? starterPlan(data.categories), data.categories)), [saved, data.categories]);
}

/* ───────────────────────── Custom style panel ───────────────────────── */

export function CustomPanel({ data, month, income, expected, pace }: { data: Data; month: string; income: Minor; expected: boolean; pace: number }) {
  const fmt = useFmt();
  const plan = usePlan(data);
  const [editing, setEditing] = useState(false);
  if (!plan) return null;
  const { rows, unplanned, unassignedPct } = planProgress(plan, { income, spend: spendByCategory(data.txs, month), budgets: data.budgets, categories: data.categories });
  const total = planTotalPct(plan);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0) + unplanned;
  const scale = Math.max(1, income, totalSpent);

  return (
    <Panel title="Your plan" action={<button className="btn-soft h-10" onClick={() => setEditing(true)}><Pencil size={15} /> Edit plan</button>}>
      <p className="text-xs text-muted mb-4">
        {income ? <>{expected ? 'Based on expected income' : 'Based on income this month'} <Money value={income} className="font-bold text-ink" />.</> : 'Log this month’s income or add a recurring salary to see each group’s share in money.'}
        {total !== 100 && <> Your groups add up to <b className={total > 100 ? 'text-bad' : 'text-warn'}>{total}%</b>{total < 100 ? `, so ${Math.round((100 - total) * 100) / 100}% of income is left unplanned` : ', more than your income'}.</>}
      </p>

      {rows.length > 0 && (
        <div className="space-y-1.5 mb-5" aria-hidden>
          <div className="flex h-4 rounded-full overflow-hidden bg-sunk">
            {rows.map((r) => <span key={r.group.id} style={{ width: `${(r.spent / scale) * 100}%`, background: r.group.colour }} className="border-r border-surface last:border-r-0" />)}
            {unplanned > 0 && <span style={{ width: `${(unplanned / scale) * 100}%` }} className="bg-muted/40" />}
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden opacity-50">
            {rows.map((r) => <span key={r.group.id} style={{ width: `${Math.min(100, r.group.pct)}%`, background: r.group.colour }} className="border-r border-surface last:border-r-0" />)}
          </div>
          <p className="text-[11px] text-muted">Top: what you’ve spent so far. Bottom: your plan.</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="sub">No groups yet. Use <b>Edit plan</b> to make your own, like Home 40%, Kids 15% and Giving 10%.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map(({ group, target, budgeted, spent }) => {
            const cats = group.categoryIds.map((id) => data.cat(id)).filter(Boolean);
            const over = target > 0 && spent > target;
            const watch = !over && target > 0 && spent > target * (pace + 0.1);
            return (
              <li key={group.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm mb-1.5">
                  <span className="min-w-0">
                    <span className="inline-block h-2.5 w-2.5 rounded-full mr-1.5 align-middle" style={{ background: group.colour }} aria-hidden />
                    <span className="font-bold">{group.name}</span> <span className="text-muted">{group.pct}%</span>
                  </span>
                  {target > 0 && <span className={`text-xs font-bold shrink-0 ${over ? 'text-bad' : watch ? 'text-warn' : 'text-good'}`}>{over ? 'Over' : watch ? 'Watch' : 'On track'}</span>}
                </div>
                <Bar value={target ? spent / target : 0} marker={target ? pace : undefined} colour={group.colour} />
                <p className="text-xs text-muted mt-1 num">
                  <span className="money">{fmt(spent)}</span>{target > 0 && <> of <span className="money">{fmt(target)}</span></>}
                  {budgeted > 0 && <> · budgets <span className={`money ${target && budgeted > target ? 'text-warn font-semibold' : ''}`}>{fmt(budgeted)}</span></>}
                </p>
                <p className="text-xs text-muted mt-0.5 truncate">{cats.length ? cats.map((c) => `${c!.emoji} ${c!.name}`).join(' · ') : 'No categories yet'}</p>
              </li>
            );
          })}
        </ul>
      )}
      {unplanned > 0 && <p className="text-xs text-muted mt-4"><Money value={unplanned} className="font-bold text-ink" /> went on categories that aren’t in any group. Add them in <b>Edit plan</b>.</p>}
      {unassignedPct > 0 && rows.length > 0 && income > 0 && <p className="text-xs text-muted mt-1">{fmt(Math.round((income * unassignedPct) / 100))} ({unassignedPct}%) of income isn’t in a group.</p>}

      {editing && <PlanSheet plan={plan} data={data} income={income} onClose={() => setEditing(false)} />}
    </Panel>
  );
}

function PlanSheet({ plan, data, income, onClose }: { plan: CustomPlan; data: Data; income: Minor; onClose: () => void }) {
  const fmt = useFmt();
  const [draft, setDraft] = useState<CustomPlan>(() => structuredClone(plan));
  const [pcts, setPcts] = useState<Record<string, string>>(() => Object.fromEntries(plan.groups.map((g) => [g.id, String(g.pct)])));
  const cats = data.categories.filter((c) => c.kind === 'expense' && !c.parentId);
  const total = planTotalPct(draft);
  const groupOf = (catId: string) => draft.groups.find((g) => g.categoryIds.includes(catId))?.id ?? '';

  const setGroup = (id: string, patch: Partial<CustomPlan['groups'][number]>) => setDraft((d) => ({ groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
  const setPct = (id: string, v: string) => {
    setPcts((p) => ({ ...p, [id]: v }));
    const n = Number(v.replace(',', '.').replace('%', ''));
    setGroup(id, { pct: Number.isFinite(n) && n >= 0 ? Math.min(100, n) : 0 });
  };
  const add = () => {
    const g = newGroup(draft);
    setDraft((d) => ({ groups: [...d.groups, g] }));
    setPcts((p) => ({ ...p, [g.id]: String(g.pct) }));
  };
  const reset = () => {
    const s = starterPlan(data.categories);
    setDraft(s);
    setPcts(Object.fromEntries(s.groups.map((g) => [g.id, String(g.pct)])));
  };
  const save = async () => {
    const clean: CustomPlan = { groups: draft.groups.map((g, i) => ({ ...g, name: g.name.trim() || `Group ${i + 1}` })) };
    await setSetting(PLAN_KEY, clean);
    toast('Plan saved');
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Edit your plan" description="Name your groups, give each a share of income and choose which categories belong to it." wide>
      <div className="space-y-5">
        <ul className="space-y-3">
          {draft.groups.map((g, i) => (
            <li key={g.id} className="rounded-2xl border border-line p-3 space-y-2">
              <div className="flex items-center gap-2">
                <button type="button" className="h-7 w-7 shrink-0 rounded-full border-2 border-surface shadow" style={{ background: g.colour }}
                  aria-label={`Change colour of ${g.name || `group ${i + 1}`}`}
                  onClick={() => setGroup(g.id, { colour: GROUP_COLOURS[(GROUP_COLOURS.indexOf(g.colour) + 1) % GROUP_COLOURS.length] })} />
                <input className="field h-11 flex-1 min-w-0" aria-label={`Group ${i + 1} name`} placeholder="Name, e.g. Home" value={g.name} onChange={(e) => setGroup(g.id, { name: e.target.value })} />
                <div className="relative w-24 shrink-0">
                  <input className="field h-11 num pr-7 text-right" inputMode="decimal" aria-label={`${g.name || `Group ${i + 1}`} share of income, percent`} value={pcts[g.id] ?? ''} onChange={(e) => setPct(g.id, e.target.value)} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm" aria-hidden>%</span>
                </div>
                <button type="button" className="btn-ghost h-11 w-11 p-0 shrink-0 text-muted" aria-label={`Remove ${g.name || `group ${i + 1}`}`}
                  onClick={() => setDraft((d) => ({ groups: d.groups.filter((x) => x.id !== g.id) }))}><Trash2 size={17} /></button>
              </div>
              {income > 0 && <p className="text-xs text-muted pl-9 num">{fmt(Math.round((income * g.pct) / 100))} a month</p>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-soft h-10" onClick={add}><Plus size={16} /> Add group</button>
          <button type="button" className="btn-ghost h-10 text-muted" onClick={reset}><RotateCcw size={15} /> Start from needs / wants / savings</button>
          <p className={`ml-auto text-sm font-bold ${total === 100 ? 'text-good' : total > 100 ? 'text-bad' : 'text-warn'}`} role="status">
            Total {total}%{total < 100 ? ` · ${Math.round((100 - total) * 100) / 100}% unplanned` : total > 100 ? ' · over 100%' : ''}
          </p>
        </div>

        {draft.groups.length > 0 && (
          <fieldset>
            <legend className="label">Which group is each category in?</legend>
            <ul className="divide-y divide-line/70 rounded-2xl border border-line">
              {cats.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-sm"><span aria-hidden>{c.emoji}</span> {c.name}</span>
                  <select className="field h-10 w-40 shrink-0 text-sm" aria-label={`Group for ${c.name}`} value={groupOf(c.id)}
                    onChange={(e) => setDraft((d) => moveCategory(d, c.id, e.target.value || undefined))}>
                    <option value="">Not in a group</option>
                    {draft.groups.map((g, i) => <option key={g.id} value={g.id}>{g.name.trim() || `Group ${i + 1}`}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <button className="btn-primary w-full h-12" onClick={save}>Save plan</button>
      </div>
    </Sheet>
  );
}

/* ───────────────────────── Templates ───────────────────────── */

export function TemplatesPanel({ data, style, income }: { data: Data; style: BudgetStyle; income: Minor }) {
  const fmt = useFmt();
  const templates = useLiveQuery(() => getSetting<BudgetTemplate[]>(TEMPLATES_KEY, []), []) ?? [];
  const plan = usePlan(data);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<BudgetTemplate | null>(null);
  const household = data.budgets.filter((b) => !b.memberId && !b.eventId);

  const remove = async (t: BudgetTemplate) => {
    if (!(await askConfirm(`Delete the “${t.name}” template? Your current budgets stay as they are.`, 'Delete template'))) return;
    await setSetting(TEMPLATES_KEY, templates.filter((x) => x.id !== t.id));
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><LayoutTemplate size={17} aria-hidden /> Budget templates</span>} action={
      <button className="btn-soft h-10" aria-label="Save as template" disabled={!household.length && style !== 'custom'} onClick={() => setSaving(true)}><BookmarkPlus size={16} /> Save<span className="hidden sm:inline">&nbsp;as template</span></button>
    }>
      {templates.length === 0 ? (
        <p className="sub">Save this month’s budgets{style === 'custom' ? ' and your plan' : ''} as a template, like “Normal month” or “Festival month”, and switch back to it in one tap whenever you need it.</p>
      ) : (
        <ul className="-my-1 divide-y divide-line/70">
          {templates.map((t) => {
            const sum = t.budgets.reduce((s, b) => s + b.amount, 0);
            return (
              <li key={t.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{t.name}</p>
                  <p className="text-xs text-muted num">
                    {STYLE_NAME[t.style]} · {t.budgets.length} budget{t.budgets.length === 1 ? '' : 's'}{sum > 0 && <> · {fmt(sum)} a month</>}
                    {t.plan && <> · {t.plan.groups.length} groups</>} · saved {new Date(t.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <button className="btn-primary h-9 px-3" onClick={() => setApplying(t)}>Use</button>
                <button className="btn-ghost h-9 w-9 p-0 text-muted" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><Trash2 size={16} /></button>
              </li>
            );
          })}
        </ul>
      )}
      {saving && <SaveTemplateSheet data={data} style={style} income={income} plan={plan} templates={templates} onClose={() => setSaving(false)} />}
      {applying && <ApplyTemplateSheet t={applying} data={data} income={income} onClose={() => setApplying(null)} />}
    </Panel>
  );
}

function SaveTemplateSheet({ data, style, income, plan, templates, onClose }: { data: Data; style: BudgetStyle; income: Minor; plan?: CustomPlan; templates: BudgetTemplate[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const existing = templates.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  const preview = makeTemplate(name, { style, budgets: data.budgets, categories: data.categories, plan, income });
  const save = async () => {
    const t = makeTemplate(name, { style, budgets: data.budgets, categories: data.categories, plan, income, id: existing?.id });
    await setSetting(TEMPLATES_KEY, existing ? templates.map((x) => (x.id === existing.id ? t : x)) : [...templates, t]);
    toast(`Saved “${t.name}”`);
    onClose();
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Save as template"
      description={`Saves your ${preview.budgets.length} household budget${preview.budgets.length === 1 ? '' : 's'}${preview.plan ? ' and your custom plan' : ''} with the ${STYLE_NAME[style]} style. Allowances and event budgets aren’t included.`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save(); }}>
        <label className="block"><span className="label">Template name</span>
          <input autoFocus className="field" placeholder="e.g. Normal month" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
        <div className="flex flex-wrap gap-2" aria-label="Name ideas">
          {['Normal month', 'Tight month', 'Festival month', 'Holiday month'].map((s) => <button key={s} type="button" className="chip" onClick={() => setName(s)}>{s}</button>)}
        </div>
        {existing && <p className="text-sm text-warn font-semibold">This replaces your saved “{existing.name}” template.</p>}
        <button className="btn-primary w-full h-12" disabled={!name.trim()}>{existing ? 'Replace template' : 'Save template'}</button>
      </form>
    </Sheet>
  );
}

function ApplyTemplateSheet({ t, data, income, onClose }: { t: BudgetTemplate; data: Data; income: Minor; onClose: () => void }) {
  const fmt = useFmt();
  const canScale = !!t.income && income > 0 && Math.abs(income - t.income) / t.income > 0.01;
  const [scaleOn, setScaleOn] = useState(false);
  const factor = scaleOn && canScale ? income / t.income! : 1;
  const r = applyTemplate(t, data.categories, factor);
  const current = data.budgets.filter((b) => !b.memberId && !b.eventId);

  const apply = async () => {
    await db.transaction('rw', db.budgets, db.settings, async () => {
      await db.budgets.bulkDelete(current.map((b) => b.id));
      await db.budgets.bulkAdd(r.budgets.map((b) => ({ id: uid(), ...b })));
      if (r.plan) await setSetting(PLAN_KEY, r.plan);
    });
    await saveProfile({ budgetStyle: t.style });
    toast(`Now using “${t.name}”`);
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Use “${t.name}”`}
      description={`Replaces your ${current.length} current household budget${current.length === 1 ? '' : 's'} and switches to the ${STYLE_NAME[t.style]} style. Allowances, event budgets and your transactions stay as they are.`}>
      <div className="space-y-4">
        {canScale && (
          <label className="flex items-start gap-3 rounded-xl bg-sunk/60 px-3.5 py-3 text-sm">
            <input type="checkbox" className="h-5 w-5 mt-0.5 accent-[rgb(var(--primary))]" checked={scaleOn} onChange={(e) => setScaleOn(e.target.checked)} />
            <span><b>Scale to this month’s income</b><span className="block text-xs text-muted mt-0.5 num">Saved with an income of {fmt(t.income!)}; it’s {fmt(income)} now, so amounts change by {Math.round((factor === 1 ? income / t.income! : factor) * 100 - 100)}%.</span></span>
          </label>
        )}
        <ul className="divide-y divide-line/70 rounded-2xl border border-line max-h-72 overflow-y-auto">
          {r.budgets.length === 0 && <li className="px-3 py-3 text-sm text-muted">No category budgets in this template{r.plan ? '; it sets your plan’s groups only' : ''}.</li>}
          {r.budgets.map((b) => {
            const c = data.cat(b.categoryId);
            return (
              <li key={b.categoryId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate"><span aria-hidden>{c?.emoji}</span> {c?.name}{b.rollover && <span className="text-xs text-muted"> · rolls over</span>}</span>
                <Money value={b.amount} className="font-semibold shrink-0" />
              </li>
            );
          })}
        </ul>
        {r.plan && <p className="text-xs text-muted">Also sets your plan: {r.plan.groups.map((g) => `${g.name} ${g.pct}%`).join(', ')}.</p>}
        {r.missing.length > 0 && <p className="text-xs text-warn font-semibold">Skipped because the category no longer exists: {r.missing.join(', ')}.</p>}
        <button className="btn-primary w-full h-12" onClick={apply}>Use this template</button>
      </div>
    </Sheet>
  );
}
