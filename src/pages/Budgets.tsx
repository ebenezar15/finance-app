import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CalendarRange, Plus, Trash2, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar as RBar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Avatar, Bar, CatIcon, Empty, Money, Panel, Segmented, Sheet, Stat, useFmt } from '../components/ui';
import { db, getSetting, setSetting, uid } from '../db/db';
import { saveProfile, useData, useProfile, type Data } from '../db/hooks';
import type { BudgetStyle, Minor, Need, Transaction } from '../db/types';
import { addMonths, daysInMonth, isoDate, monthKey, monthLabel, startOfMonth } from '../lib/dates';
import { budgetStatus, fiftyThirtyTwenty, monthTotals, occurrences, spendByCategory, type BudgetStatus } from '../lib/finance';
import { evalAmount, toMajor, toMinor } from '../lib/money';

/* ───────────────────────── Shared bits ───────────────────────── */

const STYLES: { value: BudgetStyle; label: string; hint: string }[] = [
  { value: 'envelope', label: 'Envelope', hint: 'Each category is an envelope. When it is empty, stop spending or move money from another envelope.' },
  { value: 'zero-based', label: 'Zero-based', hint: 'Give every part of this month’s income a job until nothing is left to assign.' },
  { value: '50-30-20', label: '50/30/20', hint: 'Half of income for needs, 30% for wants and 20% for savings.' },
  { value: 'caps', label: 'Caps', hint: 'Set limits only where you need them. Everything else is left untracked.' },
];

const STATE_TEXT: Record<BudgetStatus['state'], string> = { ok: 'On track', watch: 'Watch', over: 'Over' };
const STATE_TONE: Record<BudgetStatus['state'], string> = {
  ok: 'text-good bg-good/10', watch: 'text-warn bg-warn/10', over: 'text-bad bg-bad/10',
};
const STATE_FILL: Record<BudgetStatus['state'], string> = {
  ok: 'rgb(var(--primary))', watch: 'rgb(var(--warn))', over: 'rgb(var(--bad))',
};

const parseAmount = (s: string): Minor | null => {
  const v = evalAmount(s);
  return v === null || v < 0 ? null : toMinor(v);
};

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
};

/** Rounds a suggestion to a friendly figure: nearest 10 major units, or whole units when small. */
const friendly = (m: Minor) => (m >= 100_00 ? Math.round(m / 10_00) * 10_00 : Math.round(m / 100) * 100);

const normTag = (t: string) => t.trim().replace(/^#/, '').toLowerCase();

function StatePill({ state }: { state: BudgetStatus['state'] }) {
  return <span className={`shrink-0 whitespace-nowrap text-[11px] font-bold rounded-md px-1.5 py-0.5 ${STATE_TONE[state]}`}>{STATE_TEXT[state]}</span>;
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 rounded-xl bg-sunk/60 px-3.5 py-3 text-left">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </span>
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function AmountField({ label, value, onChange, hint, id }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; id: string }) {
  const bad = value.trim() !== '' && parseAmount(value) === null;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} inputMode="decimal" className="field num" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0"
        aria-invalid={bad} aria-describedby={hint || bad ? `${id}-hint` : undefined} />
      {(hint || bad) && <p id={`${id}-hint`} className={`text-xs mt-1.5 ${bad ? 'text-bad font-semibold' : 'text-muted'}`}>{bad ? 'Enter a number, for example 250' : hint}</p>}
    </div>
  );
}

const tooltipStyle = { borderRadius: 12, border: '1px solid rgb(var(--line))', background: 'rgb(var(--surface))', fontSize: 12 };

/* ───────────────────────── Page ───────────────────────── */

export default function Budgets() {
  const data = useData();
  const profile = useProfile();
  if (!data || !profile) return null;
  return <BudgetsView data={data} budgetStyle={profile.budgetStyle} />;
}

function BudgetsView({ data, budgetStyle }: { data: Data; budgetStyle: BudgetStyle }) {
  const now = useMemo(() => new Date(), []);
  const mk = monthKey(now);
  const dim = daysInMonth(now);
  const pace = now.getDate() / dim;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ open: boolean; categoryId?: string }>({ open: false });

  const statuses = useMemo(
    () => data.budgets.filter((b) => !b.memberId && !b.eventId).map((b) => budgetStatus(b, data.txs, now))
      .sort((a, b) => b.spent / Math.max(1, b.available) - a.spent / Math.max(1, a.available)),
    [data.budgets, data.txs, now],
  );
  const budgeted = statuses.reduce((s, x) => s + x.available, 0);
  const spent = statuses.reduce((s, x) => s + x.spent, 0);
  const left = budgeted - spent;
  const overCount = statuses.filter((s) => s.state === 'over').length;
  const watchCount = statuses.filter((s) => s.state === 'watch').length;

  // Income: what has come in, or what is scheduled to come in when nothing has landed yet.
  const actualIncome = monthTotals(data.txs, mk).income;
  const expectedIncome = data.recurring.filter((r) => r.type === 'income')
    .reduce((s, r) => s + occurrences(r, startOfMonth(now), new Date(now.getFullYear(), now.getMonth(), dim, 23, 59)).length * r.amount, 0);
  const income = actualIncome || expectedIncome;
  const incomeIsExpected = !actualIncome && expectedIncome > 0;

  const editingStatus = statuses.find((s) => s.budget.id === editing);
  const styleInfo = STYLES.find((s) => s.value === budgetStyle) ?? STYLES[0];

  return (
    <div className="space-y-6">
      <header className="pt-2 space-y-3">
        <div>
          <p className="sub font-semibold">Budgets · {styleInfo.label} style</p>
          <h1 className="h1">{monthLabel(now)}</h1>
        </div>
        <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
          <Segmented label="Budgeting style" value={budgetStyle} onChange={(v) => saveProfile({ budgetStyle: v })}
            options={STYLES.map((s) => ({ value: s.value, label: s.label }))} />
        </div>
        <p className="sub max-w-xl">{styleInfo.hint}</p>
      </header>

      {/* Summary + month pace */}
      <section className="panel p-5 md:p-6">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Budgeted" value={<Money value={budgeted} />} />
          <Stat label="Spent" value={<Money value={spent} />} hint={budgeted ? `${Math.round((spent / budgeted) * 100)}% used` : undefined} />
          <Stat label={left >= 0 ? 'Left' : 'Over'} value={<Money value={Math.abs(left)} className={left < 0 ? 'text-bad' : 'text-good'} />}
            hint={`${dim - now.getDate()} days to go`} />
        </div>
        {statuses.length > 0 && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mt-6 mb-3">
              <h2 className="h2">Month pace</h2>
              <p className="text-xs text-muted">
                {overCount + watchCount === 0 ? 'Every budget is on track.' : [
                  overCount ? `${overCount} over` : '', watchCount ? `${watchCount} to watch` : '',
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <PaceChart statuses={statuses} pace={pace} day={now.getDate()} data={data} onOpen={setEditing} />
          </>
        )}
      </section>

      {/* Style-specific panel */}
      {budgetStyle === 'envelope' && <EnvelopePanel statuses={statuses} data={data} onOpen={setEditing} />}
      {budgetStyle === 'zero-based' && <ZeroBasedPanel statuses={statuses} data={data} income={income} expected={incomeIsExpected} />}
      {budgetStyle === '50-30-20' && <FiftyPanel data={data} month={mk} income={income} expected={incomeIsExpected} pace={pace} />}
      {budgetStyle === 'caps' && <CapsPanel statuses={statuses} data={data} month={mk} onAdd={(categoryId) => setAdding({ open: true, categoryId })} />}

      {/* Budget list */}
      <Panel title="Household budgets" action={
        <button className="btn-primary h-10" onClick={() => setAdding({ open: true })}><Plus size={16} /> Add budget</button>
      }>
        {statuses.length === 0 ? (
          <Empty icon={<Plus size={20} />} title="No budgets yet" body="Add a budget for a category you want to keep an eye on, such as groceries or dining out. We suggest an amount from your recent spending." />
        ) : (
          <ul className="-my-1 divide-y divide-line/70">
            {statuses.map((s) => <BudgetRow key={s.budget.id} s={s} data={data} pace={pace} onOpen={() => setEditing(s.budget.id)} />)}
          </ul>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-6">
        <FamilyPanel data={data} month={mk} now={now} pace={pace} />
        <EventsPanel data={data} />
      </div>

      {editingStatus && <EditBudgetSheet key={editingStatus.budget.id} s={editingStatus} data={data} now={now} onClose={() => setEditing(null)} />}
      <AddBudgetSheet key={`${adding.open}-${adding.categoryId ?? ''}`} open={adding.open} initialCategory={adding.categoryId} data={data} now={now}
        onClose={() => setAdding({ open: false })} />
    </div>
  );
}

/* ───────────────────────── Pace chart ───────────────────────── */

function PaceChart({ statuses, pace, day, data, onOpen }: { statuses: BudgetStatus[]; pace: number; day: number; data: Data; onOpen: (id: string) => void }) {
  const fmt = useFmt();
  const D = 1.25; // the scale runs to 125% of budget so overspend stays visible
  const at = (x: number) => `${(Math.min(x, D) / D) * 100}%`;
  const cols = 'grid grid-cols-[6.5rem_1fr_4.75rem] sm:grid-cols-[9rem_1fr_5rem] gap-x-3 items-center';
  return (
    <div>
      <div className={`${cols} mb-1`} aria-hidden>
        <span />
        <div className="relative h-4 text-[11px] font-semibold text-muted">
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: at(pace) }}>Today · day {day}</span>
          <span className="absolute -translate-x-1/2 whitespace-nowrap hidden sm:inline" style={{ left: at(1) }}>Budget</span>
        </div>
        <span />
      </div>
      <ul>
        {statuses.map((s) => {
          const c = data.cat(s.budget.categoryId);
          const ratio = s.available > 0 ? s.spent / s.available : s.spent > 0 ? D : 0;
          return (
            <li key={s.budget.id}>
              <button onClick={() => onOpen(s.budget.id)} className={`${cols} w-full py-[5px] text-left group`}
                aria-label={`${c?.name ?? 'Budget'}: ${fmt(s.spent)} of ${fmt(s.available)}, ${Math.round(ratio * 100)}% used, ${STATE_TEXT[s.state].toLowerCase()}`}>
                <span className="text-[13px] font-semibold truncate group-hover:text-primary" aria-hidden>{c?.emoji} {c?.name}</span>
                <span className="relative h-3 rounded-full bg-sunk" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: at(ratio), background: STATE_FILL[s.state], transition: 'width .6s cubic-bezier(.2,.8,.2,1)' }} />
                  <span className="absolute -top-1 -bottom-1 border-l border-dashed border-ink/25" style={{ left: at(1) }} />
                  <span className="absolute -top-[9px] -bottom-[9px] w-0.5 -translate-x-1/2 bg-ink/60" style={{ left: at(pace) }} />
                </span>
                <span className={`text-xs num font-bold text-right ${s.state === 'over' ? 'text-bad' : s.state === 'watch' ? 'text-warn' : 'text-muted'}`} aria-hidden>
                  {Math.round(ratio * 100)}%{s.state !== 'ok' && <span className="font-semibold"> {STATE_TEXT[s.state].toLowerCase()}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────────────────────── Budget row ───────────────────────── */

function BudgetRow({ s, data, pace, onOpen }: { s: BudgetStatus; data: Data; pace: number; onOpen: () => void }) {
  const fmt = useFmt();
  const c = data.cat(s.budget.categoryId);
  const ratio = s.available > 0 ? s.spent / s.available : s.spent > 0 ? 2 : 0;
  return (
    <li>
      <button onClick={onOpen} className="w-full flex items-start gap-3 py-3.5 text-left rounded-xl hover:bg-sunk/50 -mx-2 px-2"
        aria-label={`Edit ${c?.name ?? 'budget'} budget`}>
        <CatIcon c={c} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0"><span className="font-semibold truncate">{c?.name ?? 'Uncategorised'}</span> <StatePill state={s.state} /></span>
            <span className={`num text-sm font-bold shrink-0 ${s.remaining < 0 ? 'text-bad' : ''}`}>
              <span className="money">{fmt(Math.abs(s.remaining))}</span> {s.remaining >= 0 ? 'left' : 'over'}
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5 mb-2 num">
            <span className="money">{fmt(s.spent)}</span> of <span className="money">{fmt(s.available)}</span>
            {s.budget.rollover && s.carried !== 0 && (
              <> · {s.carried > 0 ? <>includes <span className="money">{fmt(s.carried)}</span> carried in</> : <><span className="money">{fmt(-s.carried)}</span> overspend carried in</>}</>
            )}
          </p>
          <Bar value={ratio} marker={pace} colour={STATE_FILL[s.state]} />
          {s.overOnDay !== undefined && (
            <p className="text-xs font-semibold text-warn mt-2 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
              <span>At this pace you’ll go over by <span className="money num">{fmt(s.projected - s.available)}</span> around the {ordinal(s.overOnDay)}.</span>
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

/* ───────────────────────── Style panels ───────────────────────── */

function EnvelopePanel({ statuses, data, onOpen }: { statuses: BudgetStatus[]; data: Data; onOpen: (id: string) => void }) {
  const fmt = useFmt();
  if (!statuses.length) return null;
  return (
    <Panel title="Your envelopes">
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {statuses.map((s) => {
          const c = data.cat(s.budget.categoryId);
          const fill = s.available > 0 ? Math.max(0, Math.min(1, s.remaining / s.available)) : 0;
          return (
            <li key={s.budget.id}>
              <button onClick={() => onOpen(s.budget.id)} className="relative w-full overflow-hidden rounded-2xl border border-line/80 bg-surface text-left h-32 hover:border-primary/50"
                aria-label={`${c?.name} envelope: ${fmt(Math.abs(s.remaining))} ${s.remaining >= 0 ? 'left' : 'over'}`}>
                <span className="absolute inset-x-0 bottom-0 transition-all duration-700" style={{ height: `${fill * 100}%`, background: `${c?.colour ?? '#7C8798'}22` }} aria-hidden />
                <span className="absolute inset-x-0 top-0 h-9 bg-sunk" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} aria-hidden />
                <span className="relative flex h-full flex-col justify-end p-3">
                  <span className="text-[13px] font-semibold truncate">{c?.emoji} {c?.name}</span>
                  <span className={`text-lg font-extrabold tracking-tight money num ${s.remaining < 0 ? 'text-bad' : ''}`}>{fmt(Math.abs(s.remaining))}</span>
                  <span className="text-[11px] text-muted font-semibold">{s.remaining >= 0 ? (s.remaining === 0 ? 'Empty' : 'left in envelope') : 'over, move money in'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ZeroBasedPanel({ statuses, data, income, expected }: { statuses: BudgetStatus[]; data: Data; income: Minor; expected: boolean }) {
  const fmt = useFmt();
  const assigned = statuses.reduce((s, x) => s + x.budget.amount, 0);
  const toAssign = income - assigned;
  const total = Math.max(income, assigned, 1);
  const tone = toAssign === 0 ? 'text-good' : toAssign < 0 ? 'text-bad' : 'text-ink';
  return (
    <Panel title="Left to assign">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Money value={Math.abs(toAssign)} className={`display text-[44px] block ${tone}`} />
          <p className={`text-sm font-semibold mt-1 ${tone}`}>
            {toAssign === 0 ? 'Done. Every part of your income has a job.' : toAssign > 0 ? 'Still to assign. Add it to a budget or a goal.' : 'Over-assigned. Lower a budget to balance.'}
          </p>
        </div>
        <p className="text-sm text-muted text-right">
          {expected ? 'Expected income' : 'Income this month'} <Money value={income} className="font-bold text-ink" /><br />
          Assigned <Money value={assigned} className="font-bold text-ink" />
        </p>
      </div>
      <div className="mt-5 flex h-4 rounded-full overflow-hidden bg-sunk" role="img"
        aria-label={`${fmt(assigned)} assigned of ${fmt(income)} income`}>
        {statuses.map((s) => {
          const c = data.cat(s.budget.categoryId);
          return <span key={s.budget.id} title={`${c?.name}: ${fmt(s.budget.amount)}`} style={{ width: `${(s.budget.amount / total) * 100}%`, background: c?.colour ?? '#7C8798' }} className="border-r border-surface last:border-r-0" />;
        })}
      </div>
      <p className="text-xs text-muted mt-3">
        Zero-based means income minus budgets equals zero. {income === 0 && 'Log this month’s income or add a recurring salary to start assigning.'}
      </p>
    </Panel>
  );
}

const NEED_TO_BUCKET: Record<Need, 'needs' | 'wants' | 'savings'> = { essential: 'needs', discretionary: 'wants', savings: 'savings' };

function FiftyPanel({ data, month, income, expected, pace }: { data: Data; month: string; income: Minor; expected: boolean; pace: number }) {
  const fmt = useFmt();
  const targets = fiftyThirtyTwenty(income);
  const actual = { needs: 0, wants: 0, savings: 0 };
  for (const [catId, v] of spendByCategory(data.txs, month)) {
    const need = data.cat(catId)?.need ?? 'discretionary';
    actual[NEED_TO_BUCKET[need]] += v;
  }
  const rows = [
    { key: 'needs' as const, label: 'Needs', pct: 50, colour: 'rgb(var(--primary))', hint: 'Housing, groceries, bills, transport' },
    { key: 'wants' as const, label: 'Wants', pct: 30, colour: 'rgb(var(--indigo))', hint: 'Dining out, shopping, fun' },
    { key: 'savings' as const, label: 'Savings', pct: 20, colour: 'rgb(var(--good))', hint: 'Investing and saving' },
  ];
  const sumActual = Math.max(1, income, actual.needs + actual.wants + actual.savings);
  if (!income) {
    return (
      <Panel title="50/30/20 split">
        <p className="sub">Log this month’s income or add a recurring salary, and we’ll split it into needs, wants and savings targets.</p>
      </Panel>
    );
  }
  return (
    <Panel title="50/30/20 split" action={<span className="text-xs text-muted">{expected ? 'Based on expected income' : 'Based on income this month'} <Money value={income} className="font-bold text-ink" /></span>}>
      <div className="space-y-1.5 mb-5" aria-hidden>
        <div className="flex h-4 rounded-full overflow-hidden bg-sunk">
          {rows.map((r) => <span key={r.key} style={{ width: `${(actual[r.key] / sumActual) * 100}%`, background: r.colour }} className="border-r border-surface last:border-r-0" />)}
        </div>
        <div className="flex h-1.5 rounded-full overflow-hidden opacity-50">
          {rows.map((r) => <span key={r.key} style={{ width: `${r.pct}%`, background: r.colour }} className="border-r border-surface last:border-r-0" />)}
        </div>
        <p className="text-[11px] text-muted">Top: your actual split of income. Bottom: the 50/30/20 target.</p>
      </div>
      <ul className="space-y-4">
        {rows.map((r) => {
          const a = actual[r.key];
          const t = targets[r.key];
          const isSave = r.key === 'savings';
          const status = isSave ? (a >= t ? 'Target met' : `${fmt(t - a)} to go`) : a > t ? 'Over' : a > t * (pace + 0.1) ? 'Watch' : 'On track';
          const tone = isSave ? (a >= t ? 'text-good' : 'text-muted') : a > t ? 'text-bad' : a > t * (pace + 0.1) ? 'text-warn' : 'text-good';
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm mb-1.5">
                <span><span className="font-bold">{r.label}</span> <span className="text-muted">{r.pct}% · {r.hint}</span></span>
                <span className={`text-xs font-bold shrink-0 ${tone}`}>{status}</span>
              </div>
              <Bar value={t ? a / t : 0} marker={isSave ? undefined : pace} colour={r.colour} />
              <p className="text-xs text-muted mt-1 num"><span className="money">{fmt(a)}</span> of <span className="money">{fmt(t)}</span> · {Math.round((a / income) * 100)}% of income</p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CapsPanel({ statuses, data, month, onAdd }: { statuses: BudgetStatus[]; data: Data; month: string; onAdd: (categoryId: string) => void }) {
  const capped = new Set(statuses.map((s) => s.budget.categoryId));
  const loose = [...spendByCategory(data.txs, month)].filter(([id, v]) => v > 0 && !capped.has(id) && data.cat(id)).sort((a, b) => b[1] - a[1]);
  const looseTotal = loose.reduce((s, [, v]) => s + v, 0);
  return (
    <Panel title="Caps">
      <p className="text-sm">
        You have <b>{statuses.length} cap{statuses.length === 1 ? '' : 's'}</b>. Only these categories are tracked against a limit.
        {looseTotal > 0 && <> Another <Money value={looseTotal} className="font-bold" /> went on categories without a cap this month.</>}
      </p>
      {loose.length > 0 && (
        <>
          <p className="text-xs text-muted mt-4 mb-2">Biggest uncapped spending. Select one to add a cap.</p>
          <div className="flex flex-wrap gap-2">
            {loose.slice(0, 5).map(([id, v]) => {
              const c = data.cat(id);
              return (
                <button key={id} className="chip" onClick={() => onAdd(id)}>
                  <span aria-hidden>{c?.emoji}</span> {c?.name} <Money value={v} className="text-muted" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ───────────────────────── Edit / add sheets ───────────────────────── */

function categoryHistory(txs: Transaction[], categoryId: string, now: Date, months: number, memberId?: string) {
  return Array.from({ length: months }, (_, k) => {
    const d = addMonths(startOfMonth(now), k - months + 1);
    return { label: d.toLocaleDateString(undefined, { month: 'short' }), spent: spendByCategory(txs, monthKey(d), memberId).get(categoryId) ?? 0 };
  });
}

function EditBudgetSheet({ s, data, now, onClose }: { s: BudgetStatus; data: Data; now: Date; onClose: () => void }) {
  const fmt = useFmt();
  const c = data.cat(s.budget.categoryId);
  const [amount, setAmount] = useState(String(toMajor(s.budget.amount)));
  const [rollover, setRollover] = useState(s.budget.rollover);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const parsed = parseAmount(amount);
  const history = categoryHistory(data.txs, s.budget.categoryId, now, 6, s.budget.memberId);
  const budgetMajor = toMajor(parsed ?? s.budget.amount);
  const avg = Math.round(history.slice(0, 5).reduce((a, h) => a + h.spent, 0) / 5);

  const save = async () => {
    if (parsed === null) return;
    await db.budgets.update(s.budget.id, { amount: parsed, rollover });
    onClose();
  };
  const remove = async () => { await db.budgets.delete(s.budget.id); onClose(); };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${c?.emoji ?? ''} ${c?.name ?? 'Budget'}`.trim()}
      description={`${fmt(s.spent)} spent of ${fmt(s.available)} this month${s.carried < 0 ? `, after ${fmt(-s.carried)} overspend carried in` : s.carried > 0 ? `, including ${fmt(s.carried)} carried in` : ''} · ${STATE_TEXT[s.state]}`}>
      <div className="space-y-4">
        <div>
          <p className="text-[13px] font-semibold text-muted mb-1">Last 6 months</p>
          <div className="h-40 -mx-2" role="img" aria-label={`Spending by month: ${history.map((h) => `${h.label} ${fmt(h.spent)}`).join(', ')}. Budget ${fmt(toMinor(budgetMajor))}.`}>
            <ResponsiveContainer>
              <BarChart data={history.map((h) => ({ ...h, v: toMajor(h.spent) }))} margin={{ top: 14, right: 8, left: 8, bottom: 0 }}>
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                <YAxis hide domain={[0, (max: number) => Math.max(max, budgetMajor) * 1.1]} />
                <Tooltip cursor={{ fill: 'rgb(var(--sunk))' }} formatter={(v) => [fmt(toMinor(Number(v))), 'Spent']} contentStyle={tooltipStyle} />
                <RBar dataKey="v" radius={[6, 6, 2, 2]} maxBarSize={36}>
                  {history.map((h, i) => <Cell key={i} fill={toMajor(h.spent) > budgetMajor ? 'rgb(var(--bad))' : i === history.length - 1 ? 'rgb(var(--primary))' : 'rgb(var(--primary) / .45)'} />)}
                </RBar>
                <ReferenceLine y={budgetMajor} stroke="rgb(var(--ink))" strokeDasharray="4 3" strokeOpacity={0.6}
                  label={{ value: 'Budget', position: 'insideTopRight', fontSize: 11, fill: 'rgb(var(--muted))' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted">Red bars went over the budget. Average of the previous 5 months: <Money value={avg} className="font-bold text-ink" />.</p>
        </div>
        <AmountField id="edit-amount" label="Monthly amount" value={amount} onChange={setAmount} />
        <Toggle checked={rollover} onChange={setRollover} label="Roll over what’s left"
          hint="Unspent money carries into next month. Overspending is taken off next month." />
        <button className="btn-primary w-full" disabled={parsed === null} onClick={save}>Save budget</button>
        {confirmDelete ? (
          <div className="rounded-xl bg-bad/10 p-3 flex flex-wrap items-center gap-2" role="alert">
            <span className="text-sm font-semibold flex-1">Delete this budget? Your transactions stay.</span>
            <button className="btn-ghost h-9" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn h-9 bg-bad text-white" onClick={remove}>Delete</button>
          </div>
        ) : (
          <button className="btn-ghost w-full text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete budget</button>
        )}
      </div>
    </Sheet>
  );
}

function AddBudgetSheet({ open, initialCategory, data, now, onClose }: { open: boolean; initialCategory?: string; data: Data; now: Date; onClose: () => void }) {
  const fmt = useFmt();
  const taken = new Set(data.budgets.filter((b) => !b.memberId && !b.eventId).map((b) => b.categoryId));
  const options = data.categories.filter((c) => c.kind === 'expense' && !taken.has(c.id));
  const suggestFor = (id?: string) => {
    if (!id) return 0;
    const prev = [1, 2, 3].map((k) => spendByCategory(data.txs, monthKey(addMonths(startOfMonth(now), -k))).get(id) ?? 0);
    return friendly(Math.max(0, prev.reduce((a, b) => a + b, 0) / 3));
  };
  const [cat, setCat] = useState<string | undefined>(initialCategory && !taken.has(initialCategory) ? initialCategory : undefined);
  const [amount, setAmount] = useState(() => { const s = suggestFor(cat); return s ? String(toMajor(s)) : ''; });
  const [rollover, setRollover] = useState(false);
  const parsed = parseAmount(amount);
  const suggestion = suggestFor(cat);

  const pick = (id: string) => {
    setCat(id);
    const s = suggestFor(id);
    if (!amount.trim() || parsed === suggestFor(cat)) setAmount(s ? String(toMajor(s)) : '');
  };
  const save = async () => {
    if (!cat || !parsed) return;
    await db.budgets.add({ id: uid(), categoryId: cat, amount: parsed, rollover });
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Add budget" description="Pick a category and set a monthly amount.">
      {options.length === 0 ? (
        <p className="sub">Every spending category already has a budget. Edit an existing one instead.</p>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="label">Category</legend>
            <div className="flex flex-wrap gap-2">
              {options.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => pick(c.id)}>
                  <span aria-hidden>{c.emoji}</span> {c.name}
                </button>
              ))}
            </div>
          </fieldset>
          <AmountField id="add-amount" label="Monthly amount" value={amount} onChange={setAmount}
            hint={cat ? (suggestion ? <>Suggested <b className="money">{fmt(suggestion)}</b>, your average over the last 3 months.{parsed !== suggestion && <> <button type="button" className="font-bold text-primary underline" onClick={() => setAmount(String(toMajor(suggestion)))}>Use it</button></>}</> : 'No spending here in the last 3 months, so start with a guess.') : 'Pick a category to see a suggestion.'} />
          <Toggle checked={rollover} onChange={setRollover} label="Roll over what’s left" hint="Unspent money carries into next month." />
          <button className="btn-primary w-full" disabled={!cat || !parsed} onClick={save}>Add budget</button>
        </div>
      )}
    </Sheet>
  );
}

/* ───────────────────────── Family ───────────────────────── */

function FamilyPanel({ data, month, now, pace }: { data: Data; month: string; now: Date; pace: number }) {
  const fmt = useFmt();
  const people = data.members.filter((m) => (m.allowance ?? 0) > 0 || data.budgets.some((b) => b.memberId === m.id));
  return (
    <Panel title={<span className="flex items-center gap-2"><Users size={17} aria-hidden /> Family allowances</span>}
      action={<Link to="/family" className="text-sm font-semibold text-primary">Manage</Link>}>
      {people.length === 0 ? (
        <p className="sub">Set pocket money or a personal budget for someone in Family, and their progress shows here.</p>
      ) : (
        <ul className="space-y-5">
          {people.map((m) => {
            const own = data.txs.filter((t) => t.memberId === m.id && t.categoryId !== 'pocket' && monthKey(t.date) === month);
            const spentOwn = monthTotals(own, month).expense;
            const budgets = data.budgets.filter((b) => b.memberId === m.id).map((b) => budgetStatus(b, data.txs, now));
            return (
              <li key={m.id}>
                <div className="flex items-center gap-2.5 mb-2">
                  <Avatar m={m} size={30} />
                  <span className="font-bold flex-1">{m.name}</span>
                  {m.allowance ? <span className="text-xs text-muted">Pocket money <Money value={m.allowance} className="font-bold text-ink" /></span> : null}
                </div>
                <div className="space-y-3 pl-10">
                  {m.allowance ? (
                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-semibold">Allowance spent</span>
                        <span className={`num font-semibold ${spentOwn > m.allowance ? 'text-bad' : 'text-muted'}`}>
                          <span className="money">{fmt(spentOwn)}</span> of <span className="money">{fmt(m.allowance)}</span>{spentOwn > m.allowance ? ' · over' : ''}
                        </span>
                      </div>
                      <Bar value={spentOwn / m.allowance} marker={pace} />
                    </div>
                  ) : null}
                  {budgets.map((s) => {
                    const c = data.cat(s.budget.categoryId);
                    return (
                      <div key={s.budget.id}>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="font-semibold">{c?.emoji} {c?.name}</span>
                          <span className="num font-semibold text-muted"><span className="money">{fmt(s.spent)}</span> of <span className="money">{fmt(s.available)}</span> · {STATE_TEXT[s.state].toLowerCase()}</span>
                        </div>
                        <Bar value={s.available ? s.spent / s.available : 0} marker={pace} colour={STATE_FILL[s.state]} />
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── Event budgets ───────────────────────── */

interface EventBudget {
  id: string;
  name: string;
  emoji: string;
  total: Minor;
  start: string; // yyyy-mm-dd
  end: string;
  lines: { name: string; amount: Minor }[];
}

const EVENT_EMOJI = ['💍', '🏖️', '🎒', '🎉', '🎂', '🏠', '🎄', '✈️'];

function eventSpend(ev: EventBudget, txs: Transaction[]) {
  const tag = normTag(ev.name);
  const inEvent = txs.filter((t) => {
    if (t.type !== 'expense' && t.type !== 'refund') return false;
    const d = isoDate(new Date(t.date));
    return d >= ev.start && d <= ev.end && t.tags.some((x) => normTag(x) === tag);
  });
  const amt = (t: Transaction) => (t.type === 'refund' ? -t.amount : t.amount);
  const total = inEvent.reduce((s, t) => s + amt(t), 0);
  const lines = ev.lines.map((l) => {
    const lt = normTag(l.name);
    return { ...l, spent: inEvent.filter((t) => t.tags.some((x) => normTag(x) === lt)).reduce((s, t) => s + amt(t), 0) };
  });
  return { total, lines, count: inEvent.length };
}

function EventsPanel({ data }: { data: Data }) {
  const fmt = useFmt();
  const events = useLiveQuery(() => getSetting<EventBudget[]>('events', []), []) ?? [];
  const [editing, setEditing] = useState<EventBudget | 'new' | null>(null);
  const today = isoDate(new Date());

  const save = async (ev: EventBudget) => {
    const list = events.some((e) => e.id === ev.id) ? events.map((e) => (e.id === ev.id ? ev : e)) : [...events, ev];
    await setSetting('events', list);
    setEditing(null);
  };
  const remove = async (id: string) => { await setSetting('events', events.filter((e) => e.id !== id)); setEditing(null); };

  return (
    <Panel title={<span className="flex items-center gap-2"><CalendarRange size={17} aria-hidden /> Event budgets</span>}
      action={<button className="btn-soft h-9" onClick={() => setEditing('new')}><Plus size={15} /> New event</button>}>
      {events.length === 0 ? (
        <p className="sub">Plan for one-off costs like a wedding, a holiday or the start of school. Create an event, then tag entries with its name to count them.</p>
      ) : (
        <ul className="space-y-3">
          {events.map((ev) => {
            const sp = eventSpend(ev, data.txs);
            const startT = new Date(ev.start).getTime();
            const endT = new Date(ev.end).getTime();
            const timePace = endT > startT ? Math.max(0, Math.min(1, (new Date(today).getTime() - startT) / (endT - startT))) : undefined;
            const over = sp.total > ev.total;
            const status = today < ev.start ? 'Coming up' : today > ev.end ? 'Finished' : 'Under way';
            return (
              <li key={ev.id}>
                <button onClick={() => setEditing(ev)} className="w-full text-left rounded-2xl bg-sunk/60 p-3.5 hover:bg-sunk" aria-label={`Edit ${ev.name} event budget`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden>{ev.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold truncate">{ev.name}</p>
                      <p className="text-xs text-muted">
                        {new Date(ev.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} to {new Date(ev.end).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {status}
                      </p>
                    </div>
                    <p className={`text-sm num font-bold text-right ${over ? 'text-bad' : ''}`}>
                      <span className="money">{fmt(sp.total)}</span><span className="text-muted font-semibold"> of <span className="money">{fmt(ev.total)}</span></span>
                      {over && <span className="block text-xs">over</span>}
                    </p>
                  </div>
                  <div className="mt-3"><Bar value={ev.total ? sp.total / ev.total : 0} marker={status === 'Under way' ? timePace : undefined} /></div>
                  {sp.lines.length > 0 && (
                    <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                      {sp.lines.map((l, i) => (
                        <li key={i} className="min-w-0">
                          <div className="flex justify-between gap-2 text-[11px] mb-1">
                            <span className="font-semibold truncate">{l.name}</span>
                            <span className={`num shrink-0 ${l.spent > l.amount ? 'text-bad font-bold' : 'text-muted'}`}><span className="money">{fmt(l.spent)}</span>/<span className="money">{fmt(l.amount, { compact: true })}</span></span>
                          </div>
                          <Bar value={l.amount ? l.spent / l.amount : 0} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {sp.count === 0 && <p className="text-xs text-muted mt-2">Tag entries with “{normTag(ev.name)}” to count them here.</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <EventSheet key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)} onSave={save} onDelete={remove} />
      )}
    </Panel>
  );
}

function EventSheet({ initial, onClose, onSave, onDelete }: { initial?: EventBudget; onClose: () => void; onSave: (e: EventBudget) => void; onDelete: (id: string) => void }) {
  const fmt = useFmt();
  const today = new Date();
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '🎉');
  const [total, setTotal] = useState(initial ? String(toMajor(initial.total)) : '');
  const [start, setStart] = useState(initial?.start ?? isoDate(today));
  const [end, setEnd] = useState(initial?.end ?? isoDate(addMonths(today, 1)));
  const [lines, setLines] = useState<{ name: string; amount: string }[]>(initial?.lines.map((l) => ({ name: l.name, amount: String(toMajor(l.amount)) })) ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const totalMinor = parseAmount(total);
  const linesSum = lines.reduce((s, l) => s + (parseAmount(l.amount) ?? 0), 0);
  const valid = name.trim() && totalMinor && start && end && end >= start;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: initial?.id ?? uid(), name: name.trim(), emoji: emoji || '🎉', total: totalMinor!, start, end,
      lines: lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), amount: parseAmount(l.amount) ?? 0 })),
    });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={initial ? 'Edit event budget' : 'New event budget'}
      description="Entries tagged with the event’s name between these dates count towards it.">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <div>
            <label className="label" htmlFor="ev-name">Name</label>
            <input id="ev-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Holiday" />
          </div>
          <div>
            <label className="label" htmlFor="ev-emoji">Emoji</label>
            <input id="ev-emoji" className="field text-center text-lg" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick an emoji">
          {EVENT_EMOJI.map((e) => <button key={e} type="button" className="chip h-9 w-9 justify-center px-0 text-base" aria-pressed={emoji === e} aria-label={`Use ${e}`} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <AmountField id="ev-total" label="Total budget" value={total} onChange={setTotal}
          hint={lines.length > 0 ? <>Lines add up to <b className="money">{fmt(linesSum)}</b>{totalMinor ? (linesSum > totalMinor ? ', more than the total' : `, ${fmt(totalMinor - linesSum)} unallocated`) : ''}.</> : undefined} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ev-start">Starts</label><input id="ev-start" type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className="label" htmlFor="ev-end">Ends</label><input id="ev-end" type="date" className="field" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        {end < start && <p className="text-xs text-bad font-semibold">The end date must be on or after the start date.</p>}
        <fieldset>
          <legend className="label">Sub-budgets (optional)</legend>
          <p className="text-xs text-muted mb-2">Tag an entry with both the event and a line name, for example “{normTag(name || 'holiday')}” and “flights”.</p>
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <input className="field flex-1" aria-label={`Line ${i + 1} name`} placeholder="e.g. Flights" value={l.name}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="field w-28 num" inputMode="decimal" aria-label={`Line ${i + 1} amount`} placeholder="0" value={l.amount}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button type="button" className="btn-ghost h-11 w-11 p-0 shrink-0" aria-label={`Remove line ${l.name || i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-soft h-9 mt-2" onClick={() => setLines([...lines, { name: '', amount: '' }])}><Plus size={15} /> Add line</button>
        </fieldset>
        <button className="btn-primary w-full" disabled={!valid} onClick={submit}>{initial ? 'Save event' : 'Create event'}</button>
        {initial && (confirmDelete ? (
          <div className="rounded-xl bg-bad/10 p-3 flex flex-wrap items-center gap-2" role="alert">
            <span className="text-sm font-semibold flex-1">Delete this event? Tagged entries stay.</span>
            <button className="btn-ghost h-9" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn h-9 bg-bad text-white" onClick={() => onDelete(initial.id)}>Delete</button>
          </div>
        ) : (
          <button className="btn-ghost w-full text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete event</button>
        ))}
      </div>
    </Sheet>
  );
}
