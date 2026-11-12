import { Check, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Data } from '../db/hooks';
import type { CategoryAllowance, DailyGuide } from '../lib/allowance';
import { useMounted } from '../lib/motion';
import { useUI } from '../store/ui';
import { Money, useFmt } from './ui';

/**
 * Today's spending guide: one vessel per budgeted category. The water in each is what's left of
 * today's share; it drains as spending is logged. Tapping a vessel opens a new entry for it.
 */
export function TodayGuide({ guide, data }: { guide: DailyGuide; data: Data }) {
  const fmt = useFmt();
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const [all, setAll] = useState(false);
  const daily = guide.items.filter((i) => !i.fixed);
  const fixed = guide.items.filter((i) => i.fixed);

  if (guide.items.length === 0) {
    return (
      <section className="panel p-5 md:p-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[14rem]">
          <h2 className="h2">See what’s fine to spend on each thing today</h2>
          <p className="sub mt-1">Set a monthly budget for a few categories, like groceries or cabs. Tandem then works out each one’s share for today and keeps count as you spend.</p>
        </div>
        <Link to="/budgets" className="btn-primary">Set budgets</Link>
      </section>
    );
  }

  const shown = all ? daily : daily.slice(0, 6);
  const used = guide.today > 0 ? Math.min(1, guide.spentToday / guide.today) : 0;
  return (
    <section className="panel p-5 md:p-6" aria-labelledby="guide-title">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id="guide-title" className="h2">Today, by category</h2>
          <p className="sub mt-0.5">{guide.daysLeft} day{guide.daysLeft === 1 ? '' : 's'} left this month, today included. Tap one to log a spend.</p>
        </div>
        {daily.length > 0 && (
          <div className="text-right ml-auto">
            <p className="font-display text-[26px] font-bold leading-none num" style={{ fontStretch: '88%' }}><Money value={guide.leftToday} animate /> <span className="text-sm font-semibold text-muted font-sans">left today</span></p>
            <p className="text-xs text-muted mt-1 num"><span className="money">{fmt(guide.spentToday)}</span> spent of <span className="money">{fmt(guide.today)}</span></p>
          </div>
        )}
      </div>
      {daily.length > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-sunk overflow-hidden" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${used * 100}%`, background: guide.spentToday > guide.today ? 'rgb(var(--warn))' : 'rgb(var(--primary))', transition: 'width .8s cubic-bezier(.2,.8,.2,1)' }} />
        </div>
      )}

      <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((a, i) => <VesselRow key={a.categoryId} a={a} data={data} index={i} onLog={() => openQuickAdd('expense', { categoryId: a.categoryId })} />)}
      </ul>
      {daily.length > 6 && (
        <button className="btn-ghost h-10 mt-3 text-muted" aria-expanded={all} onClick={() => setAll(!all)}>
          <ChevronDown size={16} style={{ rotate: all ? '180deg' : '0deg', transition: 'rotate .3s' }} /> {all ? 'Show fewer' : `Show all ${daily.length}`}
        </button>
      )}

      {fixed.length > 0 && (
        <div className="mt-5 pt-4 border-t border-line/70">
          <p className="text-[13px] font-semibold text-muted mb-2">Bills and fixed costs this month</p>
          <ul className="flex flex-wrap gap-2">
            {fixed.map((a) => {
              const c = data.cat(a.categoryId);
              const paid = a.budget > 0 && a.spentMonth >= a.budget * 0.98;
              return (
                <li key={a.categoryId} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 h-9 text-[13px]">
                  <span aria-hidden>{c?.emoji}</span><span className="font-semibold">{c?.name}</span>
                  {a.leftMonth < 0
                    ? <span className="text-bad font-semibold num"><span className="money">{fmt(-a.leftMonth)}</span> over</span>
                    : paid ? <span className="text-good font-semibold inline-flex items-center gap-0.5"><Check size={13} /> paid</span>
                      : <span className="text-muted num"><span className="money">{fmt(a.leftMonth)}</span> to go</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

const TONE: Record<CategoryAllowance['state'], { text: string; colour: string }> = {
  fresh: { text: 'text-ink', colour: 'rgb(var(--primary))' },
  ok: { text: 'text-ink', colour: 'rgb(var(--primary))' },
  near: { text: 'text-warn', colour: 'rgb(var(--warn))' },
  reached: { text: 'text-good', colour: 'rgb(var(--good))' },
  over: { text: 'text-bad', colour: 'rgb(var(--bad))' },
  'spent-out': { text: 'text-bad', colour: 'rgb(var(--bad))' },
};

function VesselRow({ a, data, index, onLog }: { a: CategoryAllowance; data: Data; index: number; onLog: () => void }) {
  const fmt = useFmt();
  const c = data.cat(a.categoryId);
  const tone = TONE[a.state];
  const level = a.today > 0 ? Math.max(0, Math.min(1, a.leftToday / a.today)) : 0;
  const monthUsed = a.budget > 0 ? Math.min(1, a.spentMonth / a.budget) : 1;

  const headline =
    a.state === 'spent-out' ? (a.leftMonth < 0 ? <><span className="money">{fmt(-a.leftMonth)}</span> over this month</> : <>This month’s budget is used</>)
    : a.state === 'over' ? <><span className="money">{fmt(-a.leftToday)}</span> over today’s share</>
    : a.state === 'reached' ? <>Done for today</>
    : a.state === 'fresh' ? <><span className="money">{fmt(a.today)}</span> for today</>
    : <><span className="money">{fmt(a.leftToday)}</span> left today</>;
  const detail = a.spentToday > 0
    ? <>Spent <span className="money">{fmt(a.spentToday)}</span>{a.today > 0 && <> of <span className="money">{fmt(a.today)}</span></>} today</>
    : a.state === 'spent-out' ? 'Back next month' : null;

  return (
    <li>
      <button onClick={onLog} aria-label={`${c?.name ?? 'Category'}. Log a spend`}
        className="group w-full text-left rounded-2xl border border-line/70 bg-surface hover:border-primary/50 px-3 py-2.5 flex items-center gap-3 transition-colors active:scale-[.985]" style={{ transitionProperty: 'border-color, scale', transitionDuration: '.15s' }}>
        <Vessel level={level} colour={tone.colour} emoji={c?.emoji ?? '•'} done={a.state === 'reached'} delay={index * 70} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm truncate">{c?.name}</span>
            <Plus size={15} className="shrink-0 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" aria-hidden />
          </span>
          <span className={`block font-display text-[19px] font-bold leading-tight num ${tone.text}`} style={{ fontStretch: '90%' }}>{headline}</span>
          {detail && <span className="block text-xs text-muted num mt-0.5">{detail}</span>}
          <span className="mt-1.5 flex items-center gap-2" aria-hidden>
            <span className="relative flex-1 h-1 rounded-full bg-sunk overflow-hidden"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${monthUsed * 100}%`, background: a.leftMonth < 0 ? 'rgb(var(--bad))' : 'rgb(var(--ink) / .35)' }} /></span>
          </span>
          <span className="block text-[11px] text-muted num mt-1">
            {a.leftMonth >= 0 ? <><span className="money">{fmt(a.leftMonth)}</span> left of <span className="money">{fmt(a.budget)}</span> this month</> : <><span className="money">{fmt(a.spentMonth)}</span> spent of <span className="money">{fmt(a.budget)}</span> this month</>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** A small glass. Water height is what's left of today's share; a crest drifts across the top. */
function Vessel({ level, colour, emoji, done, delay }: { level: number; colour: string; emoji: string; done: boolean; delay: number }) {
  const mounted = useMounted();
  const h = mounted ? level : 0;
  return (
    <span className="relative shrink-0 h-[60px] w-[46px] rounded-b-[16px] rounded-t-[9px] border-2 overflow-hidden bg-sunk/50" style={{ borderColor: `color-mix(in srgb, ${colour} 45%, rgb(var(--line)))` }} aria-hidden>
      <span className="absolute inset-x-0 bottom-0" style={{ height: `${h * 100}%`, transition: `height 1.1s cubic-bezier(.2,.8,.2,1) ${delay}ms` }}>
        <span className="wave absolute left-0 -top-[5px] w-[200%] h-[6px]" style={{ ['--d' as string]: '5s' }}>
          <svg viewBox="0 0 120 6" preserveAspectRatio="none" className="w-full h-full block"><path d="M0 3 Q 7.5 0 15 3 T 30 3 T 45 3 T 60 3 T 75 3 T 90 3 T 105 3 T 120 3 V 6 H 0 Z" fill={colour} opacity=".55" /></svg>
        </span>
        <span className="absolute inset-0" style={{ background: colour, opacity: 0.55 }} />
      </span>
      <span className="absolute inset-0 grid place-items-center text-[22px] leading-none">
        {done ? <span className="grid place-items-center h-7 w-7 rounded-full bg-good text-white animate-pop"><Check size={16} strokeWidth={3} /></span> : emoji}
      </span>
    </span>
  );
}
