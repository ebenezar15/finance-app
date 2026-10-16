import {
  AlertTriangle, CalendarClock, Copy, Download, Lightbulb, PiggyBank, Store, TrendingUp, TriangleAlert,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, Bar as RBar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Bar, CatIcon, Money, Panel, Segmented, useFmt } from '../components/ui';
import { db, uid } from '../db/db';
import { useData, useProfile, type Data } from '../db/hooks';
import { addMonths, isoDate, monthKey, startOfMonth } from '../lib/dates';
import {
  budgetStatus, detectAnomalies, detectSubscriptions, forecast, goalPlan, healthScore, monthTotals, monthlySeries,
  simulatePrepayment, spendByCategory, yearlyCost, type Anomaly,
} from '../lib/finance';
import { useUI } from '../store/ui';
import { APP_LOCALE } from '../lib/locale';
import { saveFile } from '../lib/download';

const tooltipStyle = { background: 'rgb(var(--surface))', borderRadius: 12, border: '1px solid rgb(var(--line))', fontSize: 13 };
const axisTick = { fontSize: 11, fill: 'rgb(var(--muted))' };

/** A round step for sliders so values land on tidy numbers (in minor units). */
function niceStep(max: number, parts = 50) {
  const raw = Math.max(100, max / parts);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 2 ? 1 : n < 5 ? 2 : 5) * p;
}
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export default function Insights() {
  const data = useData();
  const profile = useProfile();
  if (!data || !profile) return null;
  return <InsightsView data={data} />;
}

function InsightsView({ data }: { data: Data }) {
  const now = useMemo(() => new Date(), []);
  const mk = monthKey(now);
  const pastMonths = useMemo(() => [1, 2, 3].map((k) => monthKey(addMonths(startOfMonth(now), -k))), [now]);

  /* ── Baseline numbers: average of the last three full months ── */
  const base = useMemo(() => {
    const totals = pastMonths.map((m) => monthTotals(data.txs, m));
    const income = Math.round(totals.reduce((s, t) => s + t.income, 0) / 3);
    const expense = Math.round(totals.reduce((s, t) => s + t.expense, 0) / 3);
    const essentialIds = new Set(data.categories.filter((c) => c.need === 'essential').map((c) => c.id));
    const byCat = pastMonths.map((m) => spendByCategory(data.txs, m));
    const avgCat = new Map<string, number>();
    for (const map of byCat) for (const [k, v] of map) avgCat.set(k, (avgCat.get(k) ?? 0) + v / 3);
    const essential = Math.round([...avgCat].filter(([k]) => essentialIds.has(k)).reduce((s, [, v]) => s + v, 0));
    const dining = Math.round(avgCat.get('dining') ?? 0);
    // Non-recurring spend, measured the same way the forecast measures it, so the dining cut maps to a spend factor.
    const from = addMonths(startOfMonth(now), -3);
    const recurringNames = new Set(data.recurring.map((r) => r.name.toLowerCase()));
    let flexible = 0;
    for (const t of data.txs) {
      if (t.type !== 'expense' || t.source === 'recurring') continue;
      const d = new Date(t.date);
      if (d < from || d >= startOfMonth(now)) continue;
      if (t.payee && recurringNames.has(t.payee.toLowerCase())) continue;
      flexible += t.amount;
    }
    return { income, expense, essential, dining, flexible: Math.round(flexible / 3), avgCat };
  }, [data.txs, data.categories, data.recurring, pastMonths, now]);

  const debtPayments = data.loanOut.reduce((s, l) => s + l.emi, 0);
  const statuses = data.budgets.filter((b) => !b.memberId).map((b) => budgetStatus(b, data.txs, now));
  const health = healthScore({
    monthlyIncome: base.income, monthlyExpense: base.expense, essentialMonthly: base.essential, liquid: data.liquid,
    monthlyDebtPayments: debtPayments, budgetsOnTrack: statuses.filter((s) => s.state !== 'over').length, budgetsTotal: statuses.length,
    billsOnTime: 1, billsTotal: 1,
  });

  return (
    <div className="space-y-6 pt-2">
      <div>
        <p className="sub font-semibold">Based on the last three full months</p>
        <h1 className="h1">Insights</h1>
      </div>

      <HealthPanel total={health.total} parts={health.parts} />
      <ForecastPanel data={data} now={now} base={base} />
      <div className="grid lg:grid-cols-2 gap-6">
        <AnomaliesPanel anomalies={detectAnomalies(data.txs, data.categories, now)} />
        <SuggestionsPanel data={data} now={now} base={base} />
      </div>
      <TrendsPanel data={data} now={now} mk={mk} avgCat={base.avgCat} />
      <StoryPanel data={data} now={now} />

      <p className="text-xs text-muted text-center pb-4">Insights are calculated on this device. This is not professional financial advice.</p>
    </div>
  );
}

/* ───────────────────────── Health score ───────────────────────── */

function band(v: number) {
  return v >= 80 ? 'Strong' : v >= 60 ? 'Steady' : v >= 40 ? 'Building' : 'Getting started';
}

function Gauge({ value }: { value: number }) {
  const r = 92, cx = 110, cy = 110;
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const v = Math.max(0, Math.min(100, value));
  const angle = Math.PI * (1 - v / 100);
  const kx = cx + r * Math.cos(angle), ky = cy - r * Math.sin(angle);
  return (
    <svg viewBox="0 0 220 128" className="w-full max-w-[300px]" role="img" aria-label={`Financial health score ${v} out of 100: ${band(v)}`}>
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgb(var(--indigo))" />
          <stop offset="1" stopColor="rgb(var(--good))" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="rgb(var(--sunk))" strokeWidth={18} strokeLinecap="round" />
      <path d={d} fill="none" stroke="url(#hg)" strokeWidth={18} strokeLinecap="round" pathLength={100}
        strokeDasharray="100 200" strokeDashoffset={100 - v} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)' }} />
      {[0, 25, 50, 75, 100].map((t) => {
        const a = Math.PI * (1 - t / 100);
        return <line key={t} x1={cx + (r - 15) * Math.cos(a)} y1={cy - (r - 15) * Math.sin(a)} x2={cx + (r - 11) * Math.cos(a)} y2={cy - (r - 11) * Math.sin(a)} stroke="rgb(var(--line))" strokeWidth={2} />;
      })}
      {v > 0 && <circle cx={kx} cy={ky} r={6} fill="rgb(var(--surface))" stroke="rgb(var(--ink))" strokeWidth={2} />}
      <text x={cx} y={cy - 18} textAnchor="middle" className="num" style={{ fontSize: 48, fontWeight: 800, fill: 'rgb(var(--ink))', letterSpacing: '-0.03em' }}>{v}</text>
      <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: 'rgb(var(--muted))' }}>{band(v)} · out of 100</text>
    </svg>
  );
}

function HealthPanel({ total, parts }: { total: number; parts: ReturnType<typeof healthScore>['parts'] }) {
  const weakest = [...parts].sort((a, b) => a.score / a.max - b.score / b.max)[0];
  return (
    <Panel title="Financial health score">
      <div className="grid md:grid-cols-[minmax(240px,320px)_1fr] gap-6 items-start">
        <div className="flex flex-col items-center text-center">
          <Gauge value={total} />
          <p className="sub mt-2 max-w-xs">
            Five plain measures, each with a clear weight. {weakest && weakest.score < weakest.max ? <>The quickest gain is <b className="text-ink">{weakest.label.toLowerCase()}</b>.</> : 'Every measure is at full marks.'}
          </p>
        </div>
        <ul className="space-y-4">
          {parts.map((p) => (
            <li key={p.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm mb-1.5">
                <span className="font-semibold">{p.label} <span className="text-muted font-normal">· {p.value}</span></span>
                <span className="num font-bold">{p.score}<span className="text-muted font-semibold">/{p.max}</span></span>
              </div>
              <Bar value={p.score / p.max} colour={p.score === p.max ? 'rgb(var(--good))' : 'rgb(var(--primary))'} />
              {p.score < p.max && <p className="text-xs text-muted mt-1.5">{p.tip}</p>}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Forecast + what-if ───────────────────────── */

interface Base { income: number; expense: number; essential: number; dining: number; flexible: number; avgCat: Map<string, number> }

function Slider({ id, label, value, min, max, step, onChange, display }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        <span className="text-sm font-bold num">{display}</span>
      </div>
      <input id={id} type="range" min={min} max={Math.max(min + step, max)} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[rgb(var(--primary))] h-6" />
    </div>
  );
}

function ForecastPanel({ data, now, base }: { data: Data; now: Date; base: Base }) {
  const fmt = useFmt();
  const [days, setDays] = useState<'30' | '60' | '90'>('60');
  const n = Number(days);
  const baseRun0 = useMemo(() => forecast(data.liquid, data.recurring, data.all, now, 90), [data.liquid, data.recurring, data.all, now]);
  const peak = Math.max(data.liquid, ...baseRun0.map((p) => p.balance), 100_00);
  const thStep = niceStep(peak);
  const [threshold, setThreshold] = useState(() => roundTo(Math.min(peak / 2, base.essential > 0 ? base.essential / 2 : peak / 10), thStep));

  const loanEntry = data.loanOut[0];
  const [cut, setCut] = useState(0);
  const extraMax = Math.max(500_00, roundTo(base.income * 0.3, niceStep(base.income * 0.3)));
  const extraStep = niceStep(extraMax);
  const [extra, setExtra] = useState(0);
  const prepayMax = loanEntry ? Math.max(1000_00, Math.min(loanEntry.outstanding, Math.max(data.liquid, 0))) : 0;
  const prepayStep = niceStep(prepayMax);
  const [prepay, setPrepay] = useState(0);

  const spendFactor = base.flexible > 0 ? Math.max(0, 1 - (base.dining * (cut / 100)) / base.flexible) : 1;
  const baseline = useMemo(() => forecast(data.liquid, data.recurring, data.all, now, n, { lowThreshold: threshold }), [data.liquid, data.recurring, data.all, now, n, threshold]);
  const whatIf = useMemo(
    () => forecast(data.liquid - prepay, data.recurring, data.all, now, n, { lowThreshold: threshold, spendFactor, extraMonthly: extra }),
    [data.liquid, data.recurring, data.all, now, n, threshold, spendFactor, extra, prepay],
  );
  const active = cut > 0 || extra > 0 || prepay > 0;
  const chart = baseline.map((p, i) => ({ date: p.date, base: p.balance / 100, whatif: whatIf[i]?.balance / 100 }));
  const endBase = baseline[baseline.length - 1]?.balance ?? data.liquid;
  const endWhat = whatIf[whatIf.length - 1]?.balance ?? data.liquid;
  const yearlyCut = Math.round(base.dining * 12 * (cut / 100));
  const prepaySim = loanEntry && prepay > 0 ? simulatePrepayment(loanEntry.loan, prepay, now) : undefined;

  const lowDays = baseline.filter((p) => p.low);
  const firstLow = lowDays[0];
  const byName = new Map(data.recurring.map((r) => [r.name, r]));
  const bigCut = Math.max(base.income * 0.1, 1);
  const events = baseline.flatMap((p) => p.events.map((e) => ({ date: p.date, rule: byName.get(e), balance: p.balance })))
    .filter((e) => e.rule && e.rule.amount >= bigCut)
    .slice(0, 8);
  const dLabel = (iso: string) => new Date(iso).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });

  return (
    <Panel title="Cash-flow forecast" action={<Segmented label="Forecast length" value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} />}>
      <p className="sub -mt-2 mb-4">Scheduled bills and income on their dates, plus your usual day-to-day spending spread evenly.</p>
      <div className="flex flex-wrap gap-x-8 gap-y-3 mb-4">
        <div><p className="text-[13px] font-semibold text-muted">Cash today</p><Money value={data.liquid} className="text-xl font-extrabold" /></div>
        <div><p className="text-[13px] font-semibold text-muted">In {n} days</p><Money value={endBase} className="text-xl font-extrabold" /></div>
        {active && (
          <div>
            <p className="text-[13px] font-semibold text-muted">With your changes</p>
            <p className="text-xl font-extrabold num"><span className="money">{fmt(endWhat)}</span> <span className={`text-sm ${endWhat >= endBase ? 'text-good' : 'text-bad'}`}>(<span className="money">{fmt(endWhat - endBase, { sign: true })}</span>)</span></p>
          </div>
        )}
      </div>

      <div className="h-64 -mx-2" aria-label={`Forecast chart for ${n} days`} role="img">
        <ResponsiveContainer>
          <ComposedChart data={chart} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--primary))" stopOpacity={0.28} /><stop offset="1" stopColor="rgb(var(--primary))" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={dLabel} axisLine={false} tickLine={false} tick={axisTick} minTickGap={28} />
            <YAxis tickFormatter={(v) => fmt(Math.round(Number(v) * 100), { compact: true })} axisLine={false} tickLine={false} tick={axisTick} width={64} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => new Date(String(l)).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })}
              formatter={(v, name) => [fmt(Math.round(Number(v) * 100)), name === 'base' ? 'Forecast' : 'With your changes']} />
            <ReferenceLine y={threshold / 100} stroke="rgb(var(--warn))" strokeDasharray="5 4" label={{ value: 'Low-balance line', position: 'insideTopLeft', fill: 'rgb(var(--warn))', fontSize: 11 }} />
            <Area type="monotone" dataKey="base" stroke="rgb(var(--primary))" strokeWidth={2.5} fill="url(#fc)" isAnimationActive={false} />
            {active && <Line type="monotone" dataKey="whatif" stroke="rgb(var(--indigo))" strokeWidth={2.5} strokeDasharray="6 5" dot={false} isAnimationActive={false} />}
            {firstLow && <ReferenceDot x={firstLow.date} y={firstLow.balance / 100} r={6} fill="rgb(var(--bad))" stroke="rgb(var(--surface))" strokeWidth={2} />}
            {events.map((e) => <ReferenceDot key={e.date + e.rule!.id} x={e.date} y={e.balance / 100} r={4} fill={e.rule!.type === 'income' ? 'rgb(var(--good))' : 'rgb(var(--indigo))'} stroke="rgb(var(--surface))" strokeWidth={1.5} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted mt-2">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-primary rounded" aria-hidden /> Forecast</span>
        {active && <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-indigo" style={{ borderColor: 'rgb(var(--indigo))' }} aria-hidden /> With your changes (dashed)</span>}
        <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: 'rgb(var(--warn))' }} aria-hidden /> Low-balance line</span>
      </div>

      <div className="mt-5 max-w-md">
        <Slider id="threshold" label="Warn me below" value={threshold} min={0} max={roundTo(peak, thStep)} step={thStep} onChange={setThreshold} display={<span className="money">{fmt(threshold)}</span>} />
      </div>

      <div className="grid md:grid-cols-2 gap-5 mt-5">
        <div className="rounded-2xl bg-sunk/60 p-4">
          <p className="font-bold text-sm flex items-center gap-2"><TriangleAlert size={16} className="text-warn" /> Low days ahead</p>
          {firstLow ? (
            <p className="text-sm mt-1.5">Your balance may dip below <b className="money">{fmt(threshold)}</b> on <b>{dLabel(firstLow.date)}</b>, for {lowDays.length} day{lowDays.length > 1 ? 's' : ''} in the next {n}. Lowest point: <b className="money">{fmt(Math.min(...lowDays.map((d) => d.balance)))}</b>.</p>
          ) : (
            <p className="text-sm mt-1.5 text-muted">No days below <span className="money">{fmt(threshold)}</span> in the next {n} days.</p>
          )}
        </div>
        <div className="rounded-2xl bg-sunk/60 p-4">
          <p className="font-bold text-sm flex items-center gap-2"><CalendarClock size={16} className="text-primary" /> Big scheduled moments</p>
          {events.length === 0 ? <p className="text-sm mt-1.5 text-muted">Nothing large scheduled.</p> : (
            <ul className="mt-1.5 space-y-1">
              {events.map((e) => (
                <li key={e.date + e.rule!.id} className="flex justify-between gap-3 text-sm">
                  <span className="truncate"><span className="text-muted num">{dLabel(e.date)}</span> · {e.rule!.name}</span>
                  <span className={`money num font-semibold ${e.rule!.type === 'income' ? 'text-good' : ''}`}>{fmt(e.rule!.type === 'income' ? e.rule!.amount : -e.rule!.amount, { sign: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-line/70 pt-5">
        <h3 className="font-bold">What if…</h3>
        <p className="sub mb-4">Move the sliders. The dashed line on the chart updates as you go.</p>
        <div className="grid md:grid-cols-[1fr_1fr] gap-6">
          <div className="space-y-5">
            <Slider id="cut" label="Cut dining by" value={cut} min={0} max={50} step={5} onChange={setCut} display={`${cut}%`} />
            <Slider id="extra" label="Raise monthly savings by" value={extra} min={0} max={extraMax} step={extraStep} onChange={setExtra} display={<span className="money">{fmt(extra)}</span>} />
            {loanEntry ? (
              <Slider id="prepay" label={`One-time prepayment on ${loanEntry.loan.name}`} value={prepay} min={0} max={roundTo(prepayMax, prepayStep)} step={prepayStep} onChange={setPrepay} display={<span className="money">{fmt(prepay)}</span>} />
            ) : <p className="text-sm text-muted">Add a loan in Debts to test a prepayment.</p>}
          </div>
          <ul className="grid grid-cols-2 gap-3 content-start">
            <WhatIfStat label={`Balance in ${n} days`} value={<span className="money">{fmt(endWhat - endBase, { sign: true })}</span>} hint="vs the forecast" />
            <WhatIfStat label="Yearly savings from the cut" value={<span className="money">{fmt(yearlyCut)}</span>} hint={`From about ${fmt(base.dining)} a month on dining`} />
            <WhatIfStat label="Interest saved" value={<span className="money">{fmt(prepaySim?.interestSaved ?? 0)}</span>} hint={loanEntry ? `On ${loanEntry.loan.name}` : 'No loan added'} />
            <WhatIfStat label="Loan paid off sooner" value={`${prepaySim?.monthsSaved ?? 0} months`} hint={prepaySim ? `New payoff ${new Date(prepaySim.newPayoff).toLocaleDateString(APP_LOCALE, { month: 'short', year: 'numeric' })}` : undefined} />
          </ul>
        </div>
        {active && <button className="btn-ghost mt-4 text-muted" onClick={() => { setCut(0); setExtra(0); setPrepay(0); }}>Reset what-if</button>}
      </div>
    </Panel>
  );
}

function WhatIfStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <li className="rounded-2xl border border-line/70 p-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="text-lg font-extrabold num mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-muted mt-0.5">{hint}</p>}
    </li>
  );
}

/* ───────────────────────── Trends ───────────────────────── */

function TrendsPanel({ data, now, mk, avgCat }: { data: Data; now: Date; mk: string; avgCat: Map<string, number> }) {
  const fmt = useFmt();
  const series = monthlySeries(data.txs, now, 12).map((s) => ({ ...s, income: s.income / 100, expense: s.expense / 100 }));
  const cur = spendByCategory(data.txs, mk);
  const rows = data.categories
    .filter((c) => c.kind === 'expense')
    .map((c) => ({ c, now: cur.get(c.id) ?? 0, avg: Math.round(avgCat.get(c.id) ?? 0) }))
    .filter((r) => r.now > 0 || r.avg > 0)
    .sort((a, b) => Math.max(b.now, b.avg) - Math.max(a.now, a.avg))
    .slice(0, 10);

  return (
    <Panel title="Trends">
      <p className="text-sm font-semibold text-muted mb-2">Income and spending, last 12 months</p>
      <div className="h-56 -mx-2">
        <ResponsiveContainer>
          <BarChart data={series} margin={{ top: 6, right: 8, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" strokeDasharray="3 3" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} />
            <YAxis tickFormatter={(v) => fmt(Math.round(Number(v) * 100), { compact: true })} axisLine={false} tickLine={false} tick={axisTick} width={64} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--sunk))' }} formatter={(v, name) => [fmt(Math.round(Number(v) * 100)), name === 'income' ? 'Income' : 'Spending']} />
            <Legend formatter={(v) => (v === 'income' ? 'Income' : 'Spending')} wrapperStyle={{ fontSize: 12 }} />
            <RBar dataKey="income" fill="rgb(var(--good))" radius={[4, 4, 0, 0]} />
            <RBar dataKey="expense" fill="rgb(var(--indigo))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="text-left text-sm font-semibold text-muted mb-2">This month so far compared with your 3-month average</caption>
          <thead>
            <tr className="text-xs text-muted text-left">
              <th scope="col" className="font-semibold py-2">Category</th>
              <th scope="col" className="font-semibold py-2 text-right">This month</th>
              <th scope="col" className="font-semibold py-2 text-right hidden sm:table-cell">3-month average</th>
              <th scope="col" className="font-semibold py-2 text-right">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((r) => {
              const pct = r.avg > 0 ? Math.round((r.now / r.avg - 1) * 100) : null;
              return (
                <tr key={r.c.id}>
                  <td className="py-2.5"><span className="flex items-center gap-2.5"><CatIcon c={r.c} size={28} /><span className="font-semibold truncate">{r.c.name}</span></span></td>
                  <td className="py-2.5 text-right num"><span className="money">{fmt(r.now)}</span></td>
                  <td className="py-2.5 text-right num text-muted hidden sm:table-cell"><span className="money">{fmt(r.avg)}</span></td>
                  <td className={`py-2.5 text-right num font-semibold ${pct === null ? 'text-muted' : pct > 10 ? 'text-bad' : pct < -10 ? 'text-good' : 'text-muted'}`}>
                    {pct === null ? 'New' : pct === 0 ? 'Same' : <>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%<span className="sr-only">{pct > 0 ? ' higher' : ' lower'}</span></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="sub py-4">Add a few months of spending to see trends.</p>}
      </div>
    </Panel>
  );
}

/* ───────────────────────── Anomalies ───────────────────────── */

const ANOMALY_ICON: Record<Anomaly['kind'], ReactNode> = {
  large: <AlertTriangle size={18} />, duplicate: <Copy size={18} />, 'new-merchant': <Store size={18} />, spike: <TrendingUp size={18} />,
};
const ANOMALY_KIND: Record<Anomaly['kind'], string> = { large: 'Large payment', duplicate: 'Possible duplicate', 'new-merchant': 'New places', spike: 'Category spike' };

function AnomaliesPanel({ anomalies }: { anomalies: Anomaly[] }) {
  return (
    <Panel title="Worth a second look">
      {anomalies.length === 0 ? <p className="sub">Nothing unusual in the last 30 days.</p> : (
        <ul className="space-y-3">
          {anomalies.map((a) => (
            <li key={a.id} className="flex gap-3 items-start rounded-2xl bg-sunk/60 p-3">
              <span className="h-9 w-9 rounded-xl bg-surface grid place-items-center text-primary shrink-0" aria-hidden>{ANOMALY_ICON[a.kind]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-muted">{ANOMALY_KIND[a.kind]}</p>
                <p className="text-sm font-bold">{a.title}</p>
                <p className="text-sm text-muted">{a.detail}</p>
                <div className="mt-2">
                  {a.kind === 'spike' ? <Link to="/budgets" className="btn-soft h-9 text-[13px]">Set a budget</Link>
                    : a.kind === 'new-merchant' ? <Link to="/activity" className="btn-soft h-9 text-[13px]">See them</Link>
                      : <Link to="/activity" className="btn-soft h-9 text-[13px]">Review it</Link>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── Suggestions ───────────────────────── */

interface Suggestion { id: string; icon: ReactNode; title: ReactNode; detail: string; action: ReactNode }

function SuggestionsPanel({ data, now, base }: { data: Data; now: Date; base: Base }) {
  const fmt = useFmt();
  const toast = useUI((s) => s.toast);
  const list: Suggestion[] = [];
  const surplus = base.income - base.expense;

  const ef = data.goals.find((g) => !g.memberId && /emergency/i.test(g.name));
  if (ef && surplus > 0 && ef.saved < ef.target) {
    const amt = Math.min(ef.target - ef.saved, roundTo(surplus / 2, 100_00) || surplus);
    list.push({
      id: 'ef', icon: <PiggyBank size={18} />,
      title: <>Move <span className="money">{fmt(amt)}</span> to {ef.name}</>,
      detail: `You've kept about ${fmt(surplus)} a month lately. Half of it gets ${ef.name} to ${Math.round(Math.min(1, (ef.saved + amt) / ef.target) * 100)}%.`,
      action: (
        <button className="btn-primary h-9 text-[13px]" onClick={async () => {
          const prev = { saved: ef.saved, contributions: ef.contributions };
          await db.goals.update(ef.id, { saved: ef.saved + amt, contributions: [...ef.contributions, { date: isoDate(now), amount: amt }] });
          toast(`Added ${fmt(amt)} to ${ef.name}`, async () => { await db.goals.update(ef.id, prev); });
        }}>Move it</button>
      ),
    });
  }

  const dining = data.categories.find((c) => c.id === 'dining');
  const diningBudget = data.budgets.find((b) => b.categoryId === 'dining' && !b.memberId);
  if (dining && !diningBudget && base.dining > 0) {
    const amt = Math.max(100_00, roundTo(base.dining * 0.9, 1000));
    list.push({
      id: 'dining', icon: <Lightbulb size={18} />,
      title: <>Set a {dining.name} budget of <span className="money">{fmt(amt)}</span></>,
      detail: `You've averaged ${fmt(base.dining)} a month. A budget 10% lower frees up ${fmt((base.dining - amt) * 12)} a year.`,
      action: (
        <button className="btn-primary h-9 text-[13px]" onClick={async () => {
          const id = uid();
          await db.budgets.add({ id, categoryId: 'dining', amount: amt, rollover: false });
          toast(`${dining.name} budget set`, async () => { await db.budgets.delete(id); });
        }}>Create budget</button>
      ),
    });
  }

  const subs = data.recurring.filter((r) => r.isSubscription && r.type === 'expense');
  const detected = detectSubscriptions(data.txs).filter((d) => !subs.some((s) => s.name.toLowerCase() === d.payee.toLowerCase()));
  const subsYearly = subs.reduce((s, r) => s + yearlyCost(r), 0) + detected.reduce((s, d) => s + d.yearly, 0);
  const subCount = subs.length + detected.length;
  if (subCount > 0) {
    const smallest = Math.min(...subs.map(yearlyCost), ...detected.map((d) => d.yearly));
    list.push({
      id: 'subs', icon: <Copy size={18} />,
      title: <>Your {subCount} subscription{subCount > 1 ? 's' : ''} cost <span className="money">{fmt(subsYearly)}</span> a year</>,
      detail: `Cancelling even the smallest one you no longer use saves ${fmt(smallest)} a year.`,
      action: <Link to="/bills" className="btn-soft h-9 text-[13px]">Review subscriptions</Link>,
    });
  }

  if (base.essential > 0) {
    const months = data.liquid / base.essential;
    if (months < 3) {
      const gap = Math.max(0, base.essential * 3 - data.liquid);
      list.push({
        id: 'cushion', icon: <PiggyBank size={18} />,
        title: <>Your cash covers {months.toFixed(1)} months of essentials</>,
        detail: `Three months is a solid first milestone. Putting aside ${fmt(Math.ceil(gap / 12))} a month gets you there within a year.`,
        action: <Link to="/goals" className="btn-soft h-9 text-[13px]">Plan it in Goals</Link>,
      });
    }
  }

  const loanEntry = data.loanOut[0];
  if (loanEntry && surplus > 0) {
    const amt = roundTo(surplus, 100_00) || surplus;
    const sim = simulatePrepayment(loanEntry.loan, amt, now);
    if (sim.interestSaved > 0) {
      list.push({
        id: 'loan', icon: <TrendingUp size={18} />,
        title: <>A one-time <span className="money">{fmt(amt)}</span> prepayment saves <span className="money">{fmt(sim.interestSaved)}</span></>,
        detail: `That's interest on ${loanEntry.loan.name}, and ${sim.monthsSaved} fewer month${sim.monthsSaved === 1 ? '' : 's'} of payments.`,
        action: <Link to="/debts" className="btn-soft h-9 text-[13px]">See the loan</Link>,
      });
    }
  }

  const behind = data.goals.filter((g) => !g.memberId).map((g) => ({ g, p: goalPlan(g, now) })).find((x) => !x.p.onTrack);
  if (behind && list.length < 5) {
    list.push({
      id: 'goal', icon: <Lightbulb size={18} />,
      title: <>{behind.g.name} needs <span className="money">{fmt(behind.p.needed)}</span> a month</>,
      detail: `You've been adding about ${fmt(behind.p.pace)} a month. A small automatic transfer on payday closes the gap.`,
      action: <Link to="/goals" className="btn-soft h-9 text-[13px]">Adjust the goal</Link>,
    });
  }

  return (
    <Panel title="Suggestions">
      {list.length === 0 ? <p className="sub">No suggestions right now. You're on a steady path.</p> : (
        <ul className="space-y-3">
          {list.slice(0, 5).map((s) => (
            <li key={s.id} className="flex gap-3 items-start rounded-2xl border border-line/70 p-3">
              <span className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center text-primary shrink-0" aria-hidden>{s.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{s.title}</p>
                <p className="text-sm text-muted">{s.detail}</p>
                <div className="mt-2">{s.action}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── Monthly money story ───────────────────────── */

function useStory(data: Data, now: Date) {
  return useMemo(() => {
    const series = monthlySeries(data.txs, now, 13).slice(0, -1); // 12 full months, oldest first
    const withRate = series.map((s) => ({ ...s, rate: s.income > 0 ? (s.income - s.expense) / s.income : null }));
    const last = withRate[withRate.length - 1];
    const monthDate = addMonths(startOfMonth(now), -1);
    const monthName = monthDate.toLocaleDateString(APP_LOCALE, { month: 'long' });
    const ratePct = last.rate === null ? null : Math.round(last.rate * 100);
    let headline: string;
    if (ratePct === null) headline = `Not much income was recorded in ${monthName}. Add it to see your story.`;
    else if (ratePct < 0) headline = `${monthName} cost a little more than came in. A good moment to look at the plan together.`;
    else {
      const earlier = withRate.slice(0, -1).filter((m) => m.rate !== null);
      let since: string | null = null;
      let best = earlier.length >= 2;
      for (let i = earlier.length - 1; i >= 0; i--) {
        if ((earlier[i].rate ?? 0) >= last.rate!) {
          best = false;
          if (i < earlier.length - 1) since = new Date(earlier[i].month + '-01T00:00').toLocaleDateString(APP_LOCALE, { month: 'long' });
          break;
        }
      }
      headline = `You kept ${ratePct}% of your income in ${monthName}`
        + (since ? ` — your best since ${since}.` : best ? ' — your best in a year.' : '. Steady and on your side.');
    }
    const mk = last.month;
    const prevKeys = [1, 2, 3].map((k) => monthKey(addMonths(monthDate, -k)));
    const cur = spendByCategory(data.txs, mk);
    const prev = prevKeys.map((k) => spendByCategory(data.txs, k));
    const avg = (id: string) => prev.reduce((s, m) => s + (m.get(id) ?? 0), 0) / 3;
    const expenseCats = data.categories.filter((c) => c.kind === 'expense');
    const improvements = expenseCats.map((c) => ({ c, drop: avg(c.id) - (cur.get(c.id) ?? 0), avg: avg(c.id) })).filter((x) => x.avg > 0 && x.drop > 0).sort((a, b) => b.drop - a.drop);
    const top = [...cur].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    return {
      monthName, year: monthDate.getFullYear(), ratePct, headline, kept: last.income - last.expense, income: last.income,
      improvement: improvements[0] ? { name: improvements[0].c.name, drop: Math.round(improvements[0].drop), pct: Math.round((improvements[0].drop / improvements[0].avg) * 100) } : null,
      top: top ? { name: data.cat(top[0])?.name ?? 'Other', amount: top[1] } : null,
      spark: withRate.slice(-6).map((m) => ({ label: m.label, v: m.rate === null ? 0 : Math.round(m.rate * 100) })),
    };
  }, [data, now]);
}

function sparkPath(vals: number[], w: number, h: number) {
  if (vals.length < 2) return '';
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  return vals.map((v, i) => `${i ? 'L' : 'M'} ${(i / (vals.length - 1)) * w} ${h - ((v - min) / (max - min)) * h}`).join(' ');
}

function StoryPanel({ data, now }: { data: Data; now: Date }) {
  const fmt = useFmt();
  const story = useStory(data, now);
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const money = (v: number) => (hide ? '•••' : fmt(v));

  const savePng = async () => {
    setBusy(true);
    try {
      await document.fonts?.ready;
      const W = 1080, H = 1350;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      const css = getComputedStyle(document.documentElement);
      const col = (n: string, a = 1) => `rgba(${css.getPropertyValue(`--${n}`).trim().split(/\s+/).join(',')},${a})`;
      const font = (w: number, s: number) => `${w} ${s}px "Manrope Variable", Manrope, system-ui, sans-serif`;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, col('primary')); g.addColorStop(1, col('indigo'));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(0, 0, W, H, 64); ctx.fill();
      // soft decorative circles
      ctx.fillStyle = col('onprimary', 0.07);
      ctx.beginPath(); ctx.arc(W - 120, 160, 260, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(80, H - 120, 200, 0, Math.PI * 2); ctx.fill();

      const ink = col('onprimary'), soft = col('onprimary', 0.75);
      ctx.fillStyle = soft; ctx.font = font(700, 36);
      ctx.fillText(`${story.monthName} ${story.year} · Money story`, 88, 140);
      ctx.fillStyle = ink; ctx.font = font(800, 260);
      ctx.fillText(story.ratePct === null ? '—' : `${story.ratePct}%`, 76, 420);
      ctx.fillStyle = soft; ctx.font = font(700, 40);
      ctx.fillText('of income kept', 88, 490);

      ctx.fillStyle = ink; ctx.font = font(700, 46);
      wrap(ctx, story.headline, 88, 600, W - 176, 60);

      const rows: [string, string][] = [];
      rows.push(['Kept', money(story.kept)]);
      if (story.improvement) rows.push([`Best improvement`, `${story.improvement.name}, ${story.improvement.pct}% lower`]);
      if (story.top) rows.push(['Top category', `${story.top.name}${hide ? '' : `, ${fmt(story.top.amount)}`}`]);
      let y = 860;
      for (const [k, v] of rows) {
        ctx.fillStyle = soft; ctx.font = font(600, 32); ctx.fillText(k, 88, y);
        ctx.fillStyle = ink; ctx.font = font(800, 40); ctx.fillText(v, 88, y + 50);
        y += 120;
      }
      // sparkline
      const vals = story.spark.map((s) => s.v);
      if (vals.length > 1) {
        const sx = 620, sy = 880, sw = 372, sh = 200;
        const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
        ctx.strokeStyle = ink; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        vals.forEach((v, i) => {
          const px = sx + (i / (vals.length - 1)) * sw, py = sy + sh - ((v - min) / (max - min)) * sh;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        ctx.stroke();
        ctx.fillStyle = soft; ctx.font = font(600, 28);
        ctx.fillText('Savings rate, last 6 months', sx, sy + sh + 56);
      }
      ctx.fillStyle = soft; ctx.font = font(700, 30);
      ctx.fillText('Made with Tandem', 88, H - 80);

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('no blob');
      await saveFile(`tandem-story-${story.monthName.toLowerCase()}-${story.year}.png`, blob);
    } catch {
      useUI.getState().toast('Could not create the image on this device.');
    } finally {
      setBusy(false);
    }
  };

  const vals = story.spark.map((s) => s.v);
  return (
    <Panel title="Your monthly money story" action={
      <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
        <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={hide} onChange={(e) => setHide(e.target.checked)} />
        Hide amounts when sharing
      </label>
    }>
      <div ref={cardRef} className="relative overflow-hidden rounded-[28px] p-6 md:p-8 max-w-xl mx-auto"
        style={{ background: 'linear-gradient(135deg, rgb(var(--primary)), rgb(var(--indigo)))', color: 'rgb(var(--onprimary))' }}>
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-10" style={{ background: 'rgb(var(--onprimary))' }} aria-hidden />
        <p className="text-sm font-bold opacity-80">{story.monthName} {story.year} · Money story</p>
        <p className="display text-[84px] md:text-[104px] mt-3">{story.ratePct === null ? '—' : `${story.ratePct}%`}</p>
        <p className="text-sm font-bold opacity-80 mt-1">of income kept</p>
        <p className="text-lg font-bold mt-4 leading-snug">{story.headline}</p>
        <div className="grid grid-cols-2 gap-4 mt-6 items-end">
          <dl className="space-y-3 text-sm">
            <div><dt className="opacity-75 font-semibold">Kept</dt><dd className="font-extrabold text-base num">{money(story.kept)}</dd></div>
            {story.improvement && <div><dt className="opacity-75 font-semibold">Best improvement</dt><dd className="font-extrabold text-base">{story.improvement.name}, {story.improvement.pct}% lower</dd></div>}
            {story.top && <div><dt className="opacity-75 font-semibold">Top category</dt><dd className="font-extrabold text-base">{story.top.name}{hide ? '' : <span className="num">, {fmt(story.top.amount)}</span>}</dd></div>}
          </dl>
          <div>
            <svg viewBox="-4 -4 168 88" className="w-full" role="img" aria-label={`Savings rate over the last 6 months: ${story.spark.map((s) => `${s.label} ${s.v}%`).join(', ')}`}>
              <path d={sparkPath(vals, 160, 80)} fill="none" stroke="currentColor" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <p className="text-xs opacity-75 font-semibold mt-1">Savings rate, last 6 months</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-center mt-4">
        <button className="btn-primary" onClick={savePng} disabled={busy}><Download size={16} /> {busy ? 'Creating image…' : 'Save as image'}</button>
      </div>
      <p className="text-xs text-muted text-center mt-2">The image is made on this device. Nothing is uploaded.</p>
    </Panel>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w; y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}
