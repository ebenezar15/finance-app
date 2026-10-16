import { useMemo, useState } from 'react';
import type { Data } from '../db/hooks';
import { addDays, isoDate } from '../lib/dates';
import { spendLines } from '../lib/finance';
import { APP_LOCALE } from '../lib/locale';
import { CatIcon, Panel, Stat, useFmt } from './ui';

const CELL = 13, GAP = 3;

/** A year of daily spending as a calendar heatmap, with streaks and a tap-to-inspect day. */
export function YearHeatmap({ data }: { data: Data }) {
  const fmt = useFmt();
  const today = useMemo(() => new Date(), []);
  const [picked, setPicked] = useState<string | null>(null);

  const { days, weeks, levels, stats } = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const t of data.txs) for (const l of spendLines(t)) byDay.set(isoDate(new Date(t.date)), (byDay.get(isoDate(new Date(t.date))) ?? 0) + l.amount);
    // 53 columns ending this week, Monday-first rows.
    const end = today;
    const startMon = addDays(end, -((end.getDay() + 6) % 7) - 52 * 7);
    const days: { key: string; date: Date; v: number; future: boolean }[] = [];
    for (let d = startMon; d <= addDays(end, 6 - ((end.getDay() + 6) % 7)); d = addDays(d, 1)) {
      const key = isoDate(d);
      days.push({ key, date: d, v: Math.max(0, byDay.get(key) ?? 0), future: d > end });
    }
    const vals = days.filter((d) => d.v > 0 && !d.future).map((d) => d.v).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
    const levels = [q(0.25), q(0.5), q(0.75), q(0.92)];
    // streaks of days with nothing spent (past only)
    let cur = 0, best = 0, run = 0, noSpend = 0;
    for (const d of days.filter((x) => !x.future)) {
      if (d.v === 0) { run++; noSpend++; best = Math.max(best, run); } else run = 0;
    }
    cur = run;
    const biggest = days.reduce((m, d) => (d.v > m.v ? d : m), days[0]);
    const weeks = Math.ceil(days.length / 7);
    return { days, weeks, levels, stats: { cur, best, noSpend, biggest } };
  }, [data.txs, today]);

  const level = (v: number) => (v <= 0 ? 0 : v <= levels[0] ? 1 : v <= levels[1] ? 2 : v <= levels[2] ? 3 : 4);
  const fill = ['rgb(var(--sunk))', 'rgb(var(--primary) / .22)', 'rgb(var(--primary) / .45)', 'rgb(var(--primary) / .7)', 'rgb(var(--primary))'];
  const W = weeks * (CELL + GAP), H = 7 * (CELL + GAP) + 18;
  const pickedDay = days.find((d) => d.key === picked);
  const pickedTx = picked ? data.txs.filter((t) => isoDate(new Date(t.date)) === picked && (t.type === 'expense' || t.type === 'refund')) : [];

  return (
    <Panel title="Your year in spending">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Stat label="No-spend streak" value={`${stats.cur} day${stats.cur === 1 ? '' : 's'}`} hint={stats.cur ? 'Keep it going' : 'Today counts if you spend nothing'} />
        <Stat label="Longest streak" value={`${stats.best} days`} />
        <Stat label="No-spend days" value={stats.noSpend} hint="in the last year" />
        <Stat label="Biggest day" value={<span className="money">{fmt(stats.biggest?.v ?? 0)}</span>} hint={stats.biggest?.date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })} />
      </div>
      <div className="overflow-x-auto -mx-1 px-1 pb-1" style={{ direction: 'rtl' }}>
        <svg width={W} height={H} role="grid" aria-label="Daily spending over the last year. Select a day to see its entries." style={{ direction: 'ltr' }}>
          {days.map((d, i) => {
            const col = Math.floor(i / 7), row = i % 7;
            const month = d.date.getDate() <= 7 && row === 0;
            return (
              <g key={d.key}>
                {month && <text x={col * (CELL + GAP)} y={10} className="fill-muted text-[10px]">{d.date.toLocaleDateString(APP_LOCALE, { month: 'short' })}</text>}
                {!d.future && (
                  <rect x={col * (CELL + GAP)} y={18 + row * (CELL + GAP)} width={CELL} height={CELL} rx={3}
                    fill={fill[level(d.v)]} stroke={picked === d.key ? 'rgb(var(--ink))' : 'none'} strokeWidth={2}
                    role="gridcell" tabIndex={0} aria-label={`${d.date.toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.v ? fmt(d.v) : 'nothing spent'}`}
                    onClick={() => setPicked(d.key)} onKeyDown={(e) => e.key === 'Enter' && setPicked(d.key)} style={{ cursor: 'pointer' }}>
                    <title>{`${d.date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })}: ${d.v ? fmt(d.v) : 'nothing spent'}`}</title>
                  </rect>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted mt-2" aria-hidden>
        Less {fill.map((f, i) => <span key={i} className="h-3 w-3 rounded-[3px] inline-block" style={{ background: f }} />)} More
      </div>
      {pickedDay && (
        <div className="mt-4 rounded-2xl bg-sunk/70 p-4 animate-rise">
          <p className="font-bold">{pickedDay.date.toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })} · <span className="money num">{fmt(pickedDay.v)}</span></p>
          {pickedTx.length === 0 ? <p className="sub mt-1">Nothing spent. Nice.</p> : (
            <ul className="mt-2 space-y-2">
              {pickedTx.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-3 text-sm">
                  <CatIcon c={data.cat(t.categoryId)} size={28} />
                  <span className="flex-1 min-w-0 truncate">{t.payee ?? data.cat(t.categoryId)?.name}{t.notes ? <span className="text-muted"> · {t.notes}</span> : null}</span>
                  <span className="num font-semibold money">{fmt(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
