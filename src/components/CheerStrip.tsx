import { Flame, Lock, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Data } from '../db/hooks';
import type { DailyGuide } from '../lib/allowance';
import { badges, cheer, streaks, type Badge } from '../lib/cheer';
import { addMonths, monthKey } from '../lib/dates';
import { spendByCategory } from '../lib/finance';
import { celebrateOnce } from './Confetti';
import { Sheet, useFmt } from './ui';

/** Did last month finish inside the total of today's household budgets? Undefined without data. */
function lastMonthWithin(data: Data, now: Date) {
  const household = data.budgets.filter((b) => !b.memberId && !b.eventId);
  if (!household.length) return undefined;
  const mk = monthKey(addMonths(now, -1));
  const spend = spendByCategory(data.txs, mk);
  const spent = household.reduce((s, b) => s + (spend.get(b.categoryId) ?? 0), 0);
  if (spent <= 0) return undefined;
  return spent <= household.reduce((s, b) => s + b.amount, 0);
}

/** The daily pat on the back, with the logging streak and the wins earned so far. */
export function CheerStrip({ data, guide, name }: { data: Data; guide: DailyGuide; name?: string }) {
  const fmt = useFmt();
  const now = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  const bubble = useRef<HTMLSpanElement>(null);
  const s = useMemo(() => streaks(data.txs, now), [data.txs, now]);
  const daily = guide.items.filter((i) => !i.fixed);
  const reached = daily.find((i) => i.state === 'over') ?? daily.find((i) => i.state === 'reached');
  const roomiest = [...daily].sort((a, b) => b.leftToday - a.leftToday)[0];
  const c = cheer({
    guide, streaks: s, now, fmt, name,
    reachedName: reached ? data.cat(reached.categoryId)?.name : undefined,
    roomiestName: roomiest && roomiest.leftToday > 0 ? data.cat(roomiest.categoryId)?.name : undefined,
  });
  const list = useMemo(
    () => badges({ txs: data.txs, goals: data.goals, streaks: s, budgetsCount: data.budgets.filter((b) => !b.memberId && !b.eventId).length, lastMonthWithinBudget: lastMonthWithin(data, now) }),
    [data, s, now],
  );
  const earned = list.filter((b) => b.earned).length;

  // Milestones get confetti, once each, from the emoji bubble.
  useEffect(() => {
    if (!c.milestone) return;
    const r = bubble.current?.getBoundingClientRect();
    const t = window.setTimeout(() => celebrateOnce(c.milestone!, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined), 500);
    return () => window.clearTimeout(t);
  }, [c.milestone]);

  const wash = c.tone === 'celebrate' ? 'bg-good/10 border-good/25' : c.tone === 'nudge' ? 'bg-warn/10 border-warn/25' : 'bg-primary/[.07] border-primary/20';
  return (
    <section className={`rounded-[22px] border ${wash} p-4 md:p-5 flex flex-wrap items-center gap-3 md:gap-4`} aria-live="polite">
      <span ref={bubble} key={c.id} className={`grid place-items-center h-12 w-12 md:h-14 md:w-14 shrink-0 rounded-2xl bg-surface text-[26px] md:text-[30px] shadow-sm animate-pop ${c.tone === 'celebrate' ? 'cheer-wiggle' : ''}`} aria-hidden>{c.emoji}</span>
      <div className="min-w-0 flex-1 basis-[12rem]">
        <p className="font-display text-[18px] md:text-[20px] font-bold leading-snug" style={{ fontStretch: '92%' }}>{c.title}</p>
        <p className="text-sm text-ink/80 mt-0.5 leading-relaxed">{c.body}</p>
      </div>
      <button onClick={() => setOpen(true)} aria-label={`${s.logging}-day streak, ${earned} of ${list.length} wins. See your wins`}
        className="shrink-0 rounded-2xl bg-surface border border-line/70 hover:border-primary/50 px-3 py-2 text-center transition-colors active:scale-95 max-[430px]:basis-full max-[430px]:flex max-[430px]:items-center max-[430px]:justify-center max-[430px]:gap-2 max-[430px]:py-1.5">
        <span className="flex items-center justify-center gap-1 font-display text-[22px] font-bold leading-none num">
          <Flame size={20} className={s.logging > 0 ? 'text-warn flame' : 'text-muted'} fill={s.logging > 0 ? 'currentColor' : 'none'} />{s.logging}
        </span>
        <span className="block text-[11px] max-[430px]:text-[13px] font-semibold text-muted mt-1 max-[430px]:mt-0 whitespace-nowrap">day{s.logging === 1 ? '' : 's'} in a row<span className="min-[431px]:hidden"> · see your wins</span></span>
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="Your wins" description="Earned from your own entries. Nothing to chase; they turn up as you go." wide>
        <div className="grid grid-cols-3 gap-2">
          <Num label="Current streak" value={s.logging} unit={s.logging === 1 ? 'day' : 'days'} hot={s.logging > 0} />
          <Num label="Best streak" value={s.bestLogging} unit={s.bestLogging === 1 ? 'day' : 'days'} />
          <Num label="No-spend days" value={s.noSpendDays} unit="this month" />
        </div>
        {!s.loggedToday && s.logging > 0 && <p className="text-sm text-warn font-semibold mt-3">Log one entry today to keep your {s.logging}-day streak.</p>}
        <h3 className="font-bold text-sm mt-5 mb-2 flex items-center gap-1.5"><Trophy size={15} className="text-primary" /> {earned} of {list.length} earned</h3>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {list.map((b) => <BadgeTile key={b.id} b={b} />)}
        </ul>
      </Sheet>
    </section>
  );
}

function Num({ label, value, unit, hot }: { label: string; value: number; unit: string; hot?: boolean }) {
  return (
    <div className="rounded-2xl bg-sunk/60 p-3 text-center">
      <p className={`font-display text-[30px] font-bold leading-none num ${hot ? 'text-warn' : ''}`}>{value}</p>
      <p className="text-[11px] text-muted mt-1">{unit}</p>
      <p className="text-xs font-semibold mt-1">{label}</p>
    </div>
  );
}

function BadgeTile({ b }: { b: Badge }) {
  return (
    <li className={`rounded-2xl border p-3 ${b.earned ? 'border-good/30 bg-good/[.06]' : 'border-line/70'}`}>
      <span className={`relative grid place-items-center h-11 w-11 rounded-xl text-[22px] ${b.earned ? 'bg-surface shadow-sm' : 'bg-sunk grayscale opacity-60'}`} aria-hidden>
        {b.emoji}
        {!b.earned && <span className="absolute -right-1 -bottom-1 grid place-items-center h-5 w-5 rounded-full bg-surface border border-line text-muted"><Lock size={10} /></span>}
      </span>
      <p className="font-semibold text-sm mt-2">{b.name}</p>
      <p className="text-xs text-muted mt-0.5">{b.earned ? 'Earned' : b.how}</p>
      {!b.earned && b.progress && <p className="text-[11px] font-semibold text-primary mt-1 num">{b.progress}</p>}
    </li>
  );
}
