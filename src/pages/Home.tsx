import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox, LayoutGrid, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { FlowRiver } from '../components/FlowRiver';
import { Bar, CatIcon, Money, Panel, Ring, Sheet, useFmt } from '../components/ui';
import { saveProfile, useData, useProfile, type Data } from '../db/hooks';
import type { Profile } from '../db/types';
import { addMonths, daysInMonth, monthKey, monthLabel, relativeDay, startOfMonth } from '../lib/dates';
import {
  budgetStatus, cashFlowGraph, detectAnomalies, goalPlan, monthTotals, monthlySeries, safeToSpend, upcomingBills,
} from '../lib/finance';
import { useUI } from '../store/ui';
import { APP_LOCALE } from '../lib/locale';

const CARD_NAMES: Record<string, string> = {
  flow: 'Cash-flow river', budgets: 'Budgets', bills: 'Upcoming bills', goals: 'Goals', trend: 'Income vs spending', networth: 'Net worth', insights: 'Insights',
};

export default function Home() {
  const data = useData();
  const profile = useProfile();
  if (!data || !profile) return null;
  if (data.viewer) return <KidsHome data={data} />;
  return <Dashboard data={data} profile={profile} />;
}

function Dashboard({ data, profile }: { data: Data; profile: Profile }) {
  const fmt = useFmt();
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const now = useMemo(() => new Date(), []);
  const [offset, setOffset] = useState(0);
  const [customise, setCustomise] = useState(false);
  const viewMonth = addMonths(startOfMonth(now), offset);
  const mk = monthKey(viewMonth);

  const goalsMonthly = data.goals.filter((g) => !g.memberId).reduce((s, g) => s + goalPlan(g, now).needed, 0);
  const statuses = data.budgets.filter((b) => !b.memberId).map((b) => budgetStatus(b, data.txs, now));
  const budgetLeft = statuses.length ? statuses.reduce((s, b) => s + Math.max(0, b.remaining), 0) : undefined;
  const safe = safeToSpend(data.spendable, data.recurring, Math.min(goalsMonthly, Math.max(0, data.spendable / 4)), now, budgetLeft);
  const totals = monthTotals(data.txs, monthKey(now));
  const prevTotals = monthTotals(data.txs, monthKey(addMonths(now, -1)));
  const flow = useMemo(() => cashFlowGraph(data.txs, data.categories, mk), [data.txs, data.categories, mk]);
  const pace = now.getDate() / daysInMonth(now);
  const bills = upcomingBills(data.recurring.filter((r) => r.type === 'expense'), now, 7);
  const series = monthlySeries(data.txs, now, 6);
  const anomalies = detectAnomalies(data.txs, data.categories, now);
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nwPrev = data.netWorth - totals.net; // rough: last month's closing ≈ now minus this month's net

  const cards: Record<string, JSX.Element> = {
    flow: (
      <Panel className="lg:col-span-2" title="Where the money went"
        action={
          <div className="flex items-center gap-1">
            <button className="btn-ghost h-9 w-9 p-0" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}><ChevronLeft size={18} /></button>
            <span className="text-sm font-semibold min-w-[5.5rem] text-center">{viewMonth.toLocaleDateString(APP_LOCALE, { month: 'short', year: 'numeric' })}</span>
            <button className="btn-ghost h-9 w-9 p-0" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)}><ChevronRight size={18} /></button>
          </div>
        }>
        {flow.income + flow.spent === 0 ? (
          <p className="sub py-10 text-center">No income or spending recorded for {monthLabel(viewMonth)} yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4">
              <Legend label="Came in" value={fmt(flow.income)} tone="text-good" />
              <Legend label="Went out" value={fmt(flow.spent)} />
              <Legend label={flow.saved >= 0 ? 'Kept' : 'Overspent'} value={fmt(Math.abs(flow.saved))} tone={flow.saved >= 0 ? 'text-good' : 'text-bad'}
                hint={flow.income ? `${Math.round((flow.saved / flow.income) * 100)}% of income` : undefined} />
            </div>
            <FlowRiver ins={flow.ins} outs={flow.outs} month={mk} />
            <p className="text-xs text-muted mt-3">Hover or tab through a stream to isolate it. Select a category to see its transactions.</p>
          </>
        )}
      </Panel>
    ),
    budgets: (
      <Panel title="Budgets" action={<Link to="/budgets" className="text-sm font-semibold text-primary">All budgets</Link>}>
        {statuses.length === 0 ? <p className="sub">Set a budget to see progress here.</p> : (
          <ul className="space-y-4">
            {statuses.sort((a, b) => b.spent / Math.max(1, b.available) - a.spent / Math.max(1, a.available)).slice(0, 5).map((s) => {
              const c = data.cat(s.budget.categoryId);
              return (
                <li key={s.budget.id} className="flex items-center gap-3">
                  <CatIcon c={c} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-semibold truncate">{c?.name}</span>
                      <span className={`num font-semibold ${s.state === 'over' ? 'text-bad' : s.state === 'watch' ? 'text-warn' : 'text-muted'}`}>
                        <span className="money">{fmt(Math.abs(s.remaining))}</span> {s.remaining >= 0 ? 'left' : 'over'}
                      </span>
                    </div>
                    <Bar value={s.spent / Math.max(1, s.available)} marker={pace} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    ),
    bills: (
      <Panel title="Due in the next 7 days" action={<Link to="/bills" className="text-sm font-semibold text-primary">Calendar</Link>}>
        {bills.length === 0 ? <p className="sub">Nothing due this week.</p> : (
          <ul className="divide-y divide-line/70 -my-2">
            {bills.slice(0, 5).map((b) => (
              <li key={b.rule.id + b.date.toISOString()} className="flex items-center gap-3 py-2.5">
                <div className="w-11 text-center shrink-0 rounded-xl bg-sunk py-1">
                  <p className="text-[10px] font-bold text-muted uppercase">{b.date.toLocaleDateString(APP_LOCALE, { month: 'short' })}</p>
                  <p className="text-[17px] font-extrabold leading-none num">{b.date.getDate()}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{b.rule.name}</p>
                  <p className="text-xs text-muted">{relativeDay(b.date.toISOString(), now)}{b.rule.autoPost ? ' · auto-pay' : ''}</p>
                </div>
                <Money value={b.rule.amount} className="font-bold text-sm" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    ),
    goals: (
      <Panel title="Goals" action={<Link to="/goals" className="text-sm font-semibold text-primary">All goals</Link>}>
        <ul className="grid grid-cols-2 gap-3">
          {data.goals.filter((g) => !g.memberId).slice(0, 4).map((g) => {
            const p = goalPlan(g, now);
            return (
              <li key={g.id} className="rounded-2xl bg-sunk/60 p-3 flex items-center gap-3">
                <Ring value={p.progress} size={48} stroke={5} colour={p.onTrack ? 'rgb(var(--good))' : 'rgb(var(--warn))'}><span className="text-lg">{g.emoji}</span></Ring>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{g.name}</p>
                  <p className="text-xs text-muted num">{Math.round(p.progress * 100)}% · {p.onTrack ? 'on track' : 'behind'}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    ),
    trend: (
      <Panel title="Income vs spending" action={<Link to="/insights" className="text-sm font-semibold text-primary">Insights</Link>}>
        <div className="h-40 -mx-2">
          <ResponsiveContainer>
            <AreaChart data={series.map((s) => ({ ...s, income: s.income / 100, expense: s.expense / 100 }))} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--good))" stopOpacity={0.35} /><stop offset="1" stopColor="rgb(var(--good))" stopOpacity={0} /></linearGradient>
                <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--indigo))" stopOpacity={0.3} /><stop offset="1" stopColor="rgb(var(--indigo))" stopOpacity={0} /></linearGradient>
              </defs>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
              <Tooltip formatter={(v, n) => [fmt(Math.round(Number(v) * 100)), n === 'income' ? 'Income' : 'Spending']} contentStyle={{ borderRadius: 12, border: '1px solid rgb(var(--line))', background: 'rgb(var(--surface))' }} />
              <Area type="monotone" dataKey="income" stroke="rgb(var(--good))" strokeWidth={2.5} fill="url(#gi)" />
              <Area type="monotone" dataKey="expense" stroke="rgb(var(--indigo))" strokeWidth={2.5} fill="url(#ge)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    networth: (
      <Panel title="Net worth" action={<Link to="/wealth" className="text-sm font-semibold text-primary">Details</Link>}>
        <Money value={data.netWorth} className="display text-[34px]" />
        <p className={`text-sm font-semibold mt-1 flex items-center gap-1 ${data.netWorth >= nwPrev ? 'text-good' : 'text-bad'}`}>
          {data.netWorth >= nwPrev ? <ArrowUp size={14} /> : <ArrowDown size={14} />}<span className="money num">{fmt(data.netWorth - nwPrev, { sign: true })}</span> this month
        </p>
        <div className="mt-4 flex h-3 rounded-full overflow-hidden" aria-hidden>
          <span style={{ flex: data.assets }} className="bg-good" />
          <span style={{ flex: data.liabilities }} className="bg-bad/70" />
        </div>
        <div className="flex justify-between text-xs mt-2 text-muted"><span>Assets <Money value={data.assets} compact className="font-bold text-ink" /></span><span>Owed <Money value={data.liabilities} compact className="font-bold text-ink" /></span></div>
      </Panel>
    ),
    insights: (
      <Panel title="Worth a look" action={<Link to="/insights" className="text-sm font-semibold text-primary">All insights</Link>}>
        <ul className="space-y-3">
          {data.review.length > 0 && (
            <li><Link to="/inbox" className="flex gap-3 items-start rounded-2xl bg-warn/10 p-3">
              <Inbox size={18} className="text-warn mt-0.5 shrink-0" />
              <span className="text-sm"><b>{data.review.length} entries need a quick review</b><br /><span className="text-muted">Captured automatically with low confidence.</span></span>
            </Link></li>
          )}
          {anomalies.slice(0, 3).map((a) => (
            <li key={a.id} className="flex gap-3 items-start p-1">
              <Sparkles size={18} className="text-primary mt-0.5 shrink-0" />
              <span className="text-sm"><b>{a.title}</b><br /><span className="text-muted">{a.detail}</span></span>
            </li>
          ))}
          {anomalies.length === 0 && data.review.length === 0 && <li className="sub">Nothing unusual this month.</li>}
        </ul>
      </Panel>
    ),
  };

  const order = profile.dashboardCards.length ? profile.dashboardCards : Object.keys(cards).map((id) => ({ id, hidden: false }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 pt-2">
        <div>
          <p className="sub font-semibold">{greet}{profile.primaryUser ? `, ${profile.primaryUser}` : ''}</p>
          <h1 className="h1">{monthLabel(now)}</h1>
        </div>
        <button className="btn-ghost text-muted" onClick={() => setCustomise(true)}><LayoutGrid size={17} /> <span className="hidden sm:inline">Customise</span></button>
      </div>

      {/* Hero: the one number that matters day to day */}
      <section className="panel overflow-hidden grid md:grid-cols-[1.3fr_1fr]">
        <div className="p-6 md:p-7 relative">
          <p className="text-sm font-bold text-muted">Safe to spend today</p>
          <Money value={safe.today} className="display text-[56px] md:text-[72px] block mt-2 text-primary" />
          <p className="text-sm text-muted mt-2 max-w-sm">
            {safe.limitedBy === 'budget'
              ? <>What’s left in your budgets, spread across the {safe.daysLeft} days left this month. Bills of <b className="text-ink money num">{fmt(safe.billsLeft)}</b> are already set aside.</>
              : <>After <b className="text-ink money num">{fmt(safe.billsLeft)}</b> of bills still due and your goal savings, across the {safe.daysLeft} days left this month.</>}
          </p>
          <div className="mt-5 flex gap-2 flex-wrap">
            <button className="btn-primary" onClick={() => openQuickAdd('expense')}>Log a spend</button>
            <span className="chip h-11 px-4 text-sm cursor-default">This week <Money value={safe.week} className="font-extrabold" /></span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-1 border-t md:border-t-0 md:border-l border-line/70">
          <HeroStat label="Income this month" value={totals.income} prev={prevTotals.income} good="up" />
          <HeroStat label="Spent this month" value={totals.expense} prev={prevTotals.expense} good="down" pace={pace} />
          <div className="col-span-2 md:col-span-1 px-6 py-4 border-t border-line/70 flex items-center justify-between">
            <span className="text-sm font-semibold text-muted">Everyday accounts</span><Money value={data.spendable} className="font-extrabold" />
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {order.filter((c) => !c.hidden && cards[c.id]).map((c) => <div key={c.id} className={`min-w-0 ${c.id === 'flow' ? 'lg:col-span-2' : ''}`}>{cards[c.id]}</div>)}
      </div>

      <Sheet open={customise} onOpenChange={setCustomise} title="Customise home" description="Reorder or hide cards. Changes save instantly.">
        <ul className="space-y-2">
          {order.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl bg-sunk/60 px-3 h-12">
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={!c.hidden} aria-label={`Show ${CARD_NAMES[c.id]}`}
                onChange={() => saveProfile({ dashboardCards: order.map((x) => (x.id === c.id ? { ...x, hidden: !x.hidden } : x)) })} />
              <span className="flex-1 font-semibold text-sm">{CARD_NAMES[c.id]}</span>
              <button className="btn-ghost h-9 w-9 p-0" disabled={i === 0} aria-label="Move up" onClick={() => { const o = [...order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; saveProfile({ dashboardCards: o }); }}><ArrowUp size={16} /></button>
              <button className="btn-ghost h-9 w-9 p-0" disabled={i === order.length - 1} aria-label="Move down" onClick={() => { const o = [...order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; saveProfile({ dashboardCards: o }); }}><ArrowDown size={16} /></button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

function HeroStat({ label, value, prev, good, pace }: { label: string; value: number; prev: number; good: 'up' | 'down'; pace?: number }) {
  const fmt = useFmt();
  // Compare like with like: pro-rate last month when we're mid-month for spending.
  const cmp = pace ? Math.round(prev * pace) : prev;
  const diff = value - cmp;
  const better = good === 'up' ? diff >= 0 : diff <= 0;
  return (
    <div className="px-6 py-4 md:py-5 border-l md:border-l-0 md:border-b border-line/70 first:border-l-0">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <Money value={value} className="text-[26px] font-extrabold tracking-tight block" />
      {cmp > 0 && (
        <p className={`text-xs font-semibold flex items-center gap-1 ${better ? 'text-good' : 'text-bad'}`}>
          {diff >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}<span className="money num">{fmt(Math.abs(diff))}</span> <span title={pace ? 'Compared with the same point last month' : undefined}>vs last month</span>
        </p>
      )}
    </div>
  );
}

function Legend({ label, value, tone = '', hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className={`text-xl font-extrabold tracking-tight money num ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A simpler, encouraging home for teens and kids: allowance, jars and their own spending. */
function KidsHome({ data }: { data: Data }) {
  const m = data.viewer!;
  const now = new Date();
  const jars = data.goals.filter((g) => g.memberId === m.id);
  const spent = monthTotals(data.txs.filter((t) => t.categoryId !== 'pocket'), monthKey(now)).expense;
  const allowance = m.allowance ?? 0;
  const left = Math.max(0, allowance - spent);
  return (
    <div className="space-y-6 pt-2">
      <div>
        <p className="sub font-semibold">Hi {m.name} 👋</p>
        <h1 className="h1">Your money</h1>
      </div>
      <section className="panel p-6 flex items-center gap-6">
        <Ring value={allowance ? left / allowance : 0} size={120} stroke={12} colour="rgb(var(--good))">
          <span className="text-3xl">🪙</span>
        </Ring>
        <div>
          <p className="text-sm font-bold text-muted">Left from this month’s pocket money</p>
          <Money value={left} className="display text-[48px] block mt-1" />
          <p className="text-sm text-muted mt-1">You get <Money value={allowance} className="font-bold text-ink" /> each month.</p>
        </div>
      </section>
      <h2 className="h2">Savings jars</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {jars.map((g) => {
          const p = goalPlan(g, now);
          return (
            <div key={g.id} className="panel p-5">
              <div className="flex items-end gap-4">
                <Jar fill={p.progress} />
                <div>
                  <p className="text-2xl">{g.emoji}</p>
                  <p className="font-bold">{g.name}</p>
                  <p className="text-sm text-muted"><Money value={g.saved} className="font-bold text-ink" /> of <Money value={g.target} /></p>
                  <p className="text-xs text-muted mt-1">Save <Money value={p.needed} /> a month to get there.</p>
                </div>
              </div>
            </div>
          );
        })}
        {jars.length === 0 && <p className="sub">Ask a grown-up to set up a savings jar with you.</p>}
      </div>
    </div>
  );
}

function Jar({ fill }: { fill: number }) {
  const h = 88 * Math.max(0, Math.min(1, fill));
  return (
    <svg width="72" height="104" viewBox="0 0 72 104" aria-label={`${Math.round(fill * 100)}% full`}>
      <rect x="18" y="2" width="36" height="10" rx="3" fill="rgb(var(--line))" />
      <path d="M12 14h48a6 6 0 0 1 6 6v74a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V20a6 6 0 0 1 6-6z" fill="rgb(var(--sunk))" stroke="rgb(var(--line))" strokeWidth="2" />
      <clipPath id="jar"><path d="M12 14h48a6 6 0 0 1 6 6v74a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V20a6 6 0 0 1 6-6z" /></clipPath>
      <rect x="0" y={102 - h} width="72" height={h} fill="rgb(var(--good))" opacity=".85" clipPath="url(#jar)" style={{ transition: 'all .8s' }} />
    </svg>
  );
}
