import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bookmark, BookmarkCheck, CalendarClock, Coins, HeartHandshake, Landmark, Lightbulb, PiggyBank, RefreshCw, Repeat, Share2, ShieldCheck, Sparkles, TrendingUp, Wallet, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, getSetting, setSetting } from '../db/db';
import type { Data } from '../db/hooks';
import { useAccount } from '../lib/account';
import { useBackup } from '../lib/autoBackup';
import { daysInMonth, monthKey } from '../lib/dates';
import { budgetStatus, detectSubscriptions, monthTotals, spendByCategory, upcomingBills } from '../lib/finance';
import { TIPS, dayKey, tipOfTheDay, type Tip, type TipSignals, type TipTopic } from '../lib/tips';
import { useUI } from '../store/ui';
import { Sheet } from './ui';

const TOPIC_ICON: Record<TipTopic, typeof Lightbulb> = {
  budgeting: Wallet, saving: PiggyBank, debt: Landmark, investing: TrendingUp, spending: Coins, family: HeartHandshake, habits: Repeat, safety: ShieldCheck, bills: CalendarClock,
};
const SEEN_KEY = 'tandem-tips-shown';
type Shown = { d: string; id: string };
const readShown = (): Shown[] => { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : []; } catch { return []; } };
/** Ids shown on earlier days only: counting today's own pick would change it on the next visit. */
const seenBefore = (today: string) => readShown().filter((x) => x.d !== today).map((x) => x.id);

function useSignals(data: Data): TipSignals {
  const account = useAccount((s) => s.account);
  const { drive, phone } = useBackup();
  return useMemo(() => {
    const now = new Date();
    const mk = monthKey(now);
    const t = monthTotals(data.txs, mk);
    const spend = [...spendByCategory(data.txs, mk)].sort((a, b) => b[1] - a[1]);
    const totalSpend = spend.reduce((s, [, v]) => s + v, 0);
    const top = spend[0];
    const weekAgo = Date.now() - 7 * 86400_000;
    const last = data.txs[0] ? Date.parse(data.txs[0].date) : undefined;
    const day = now.getDate();
    return {
      savingsRate: t.income > 0 ? (t.income - t.expense) / t.income : undefined,
      topCategoryName: top && totalSpend > 0 ? data.cat(top[0])?.name : undefined,
      topCategoryShare: top && totalSpend > 0 ? top[1] / totalSpend : undefined,
      hasBudgets: data.budgets.some((b) => !b.memberId && !b.eventId),
      overBudgetCount: data.budgets.filter((b) => !b.memberId && !b.eventId).map((b) => budgetStatus(b, data.txs, now)).filter((s) => s.state === 'over').length,
      hasEmergencyGoal: data.goals.some((g) => /emergency|rainy/i.test(g.name)),
      hasGoals: data.goals.length > 0,
      billsDueSoon: upcomingBills(data.recurring.filter((r) => r.type === 'expense'), now, 7).length,
      hasDebt: data.loanOut.some((l) => l.outstanding > 0) || data.accounts.some((a) => a.type === 'credit' && (data.balances.get(a.id) ?? 0) < 0),
      creditCardOwed: data.accounts.some((a) => a.type === 'credit' && (data.balances.get(a.id) ?? 0) < 0),
      subscriptionsCount: detectSubscriptions(data.txs).length,
      hasBackup: !!account || drive.status !== 'off' || phone.status !== 'off' || import.meta.env.VITE_EMBED === '1',
      entriesLast7Days: data.txs.filter((x) => Date.parse(x.date) >= weekAgo).length,
      daysSinceLastEntry: last ? Math.floor((Date.now() - last) / 86400_000) : undefined,
      isMonthStart: day <= 3,
      isMonthEnd: day > daysInMonth(now) - 4,
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
    };
  }, [data, account, drive.status, phone.status]);
}

/** Today's tip or fact on Home: one a day, with another on request, and a list of the ones you saved. */
export function DailyTip({ data }: { data: Data }) {
  const hidden = useLiveQuery(() => getSetting<boolean>('tipsHidden', false), []);
  const saved = useLiveQuery(() => getSetting<string[]>('savedTips', []), []) ?? [];
  const signals = useSignals(data);
  const [skip, setSkip] = useState(0);
  const [spin, setSpin] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const today = dayKey(new Date());
  const seen = useMemo(() => seenBefore(today), [today]);
  const { tip, personal } = useMemo(() => tipOfTheDay(new Date(), signals, { seen, skip }), [signals, seen, skip]);

  useEffect(() => {
    if (skip !== 0) return; // only the day's own tip counts towards "recently shown"
    try {
      const rest = readShown().filter((x) => x.d !== today);
      localStorage.setItem(SEEN_KEY, JSON.stringify([{ d: today, id: tip.id }, ...rest].slice(0, 20)));
    } catch { /* storage blocked: tips still rotate by date */ }
  }, [tip.id, skip, today]);

  if (hidden === undefined || hidden) return null;
  const Icon = TOPIC_ICON[tip.topic] ?? Lightbulb;
  const isSaved = saved.includes(tip.id);
  const toggleSave = async () => {
    await setSetting('savedTips', isSaved ? saved.filter((x) => x !== tip.id) : [tip.id, ...saved]);
    useUI.getState().toast(isSaved ? 'Removed from saved tips' : 'Saved to your tips');
  };
  const share = async () => {
    const text = `${tip.title}\n\n${tip.body}`;
    try {
      if (navigator.share) await navigator.share({ title: tip.title, text });
      else { await navigator.clipboard.writeText(text); useUI.getState().toast('Copied'); }
    } catch { /* cancelled */ }
  };

  return (
    <section className="panel relative overflow-hidden p-5 md:p-6" aria-labelledby="tip-title">
      <div key={tip.id} className="flip-in relative flex gap-4">
        <span className="grid place-items-center h-12 w-12 md:h-14 md:w-14 shrink-0 rounded-2xl bg-primary/10 text-primary"><Icon size={24} strokeWidth={2.1} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-muted">{tip.kind === 'fact' ? 'Money fact of the day' : 'Tip of the day'}{skip > 0 ? ` · ${skip + 1}` : ''}</p>
          <h2 id="tip-title" className="font-display text-[20px] md:text-[22px] font-bold leading-snug mt-0.5" style={{ fontStretch: '92%' }}>{tip.title}</h2>
          <p className="text-[15px] leading-relaxed text-ink/85 mt-1.5 max-w-prose">{tip.body}</p>
          {personal && <p className="mt-2.5 inline-flex items-start gap-1.5 text-sm font-semibold text-primary"><Sparkles size={15} className="mt-0.5 shrink-0" />{personal}</p>}
        </div>
      </div>
      <div className="relative flex flex-wrap items-center gap-2 mt-4 md:pl-[72px]">
        {tip.action && <Link to={tip.action.to} className="btn-primary h-10">{tip.action.label}</Link>}
        <button className="btn-soft h-10" onClick={() => { setSkip((s) => s + 1); setSpin((n) => n + 1); }}>
          <RefreshCw size={15} style={{ rotate: `${spin * 180}deg`, transition: 'rotate .45s cubic-bezier(.2,.8,.2,1)' }} /> Another
        </button>
        <button className="btn-ghost h-10 w-10 p-0" aria-pressed={isSaved} aria-label={isSaved ? 'Remove from saved tips' : 'Save this tip'} onClick={toggleSave}>
          {isSaved ? <BookmarkCheck size={18} className="text-primary animate-pop" /> : <Bookmark size={18} />}
        </button>
        <button className="btn-ghost h-10 w-10 p-0" aria-label="Share this tip" onClick={share}><Share2 size={17} /></button>
        <div className="ml-auto flex items-center gap-1">
          {saved.length > 0 && <button className="btn-ghost h-10 text-muted text-[13px]" onClick={() => setListOpen(true)}>Saved ({saved.length})</button>}
          <button className="btn-ghost h-10 w-10 p-0 text-muted" aria-label="Hide daily tips" title="Hide daily tips (turn back on in Customise)"
            onClick={async () => { await setSetting('tipsHidden', true); useUI.getState().toast('Daily tips hidden. Turn them back on in Customise.'); }}><X size={17} /></button>
        </div>
      </div>
      <SavedTips open={listOpen} onClose={() => setListOpen(false)} ids={saved} />
    </section>
  );
}

function SavedTips({ open, onClose, ids }: { open: boolean; onClose: () => void; ids: string[] }) {
  const list = ids.map((id) => TIPS.find((t) => t.id === id)).filter(Boolean) as Tip[];
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Saved tips" description="Tips and facts you kept. They sync with your data.">
      <ul className="space-y-3">
        {list.map((t) => {
          const Icon = TOPIC_ICON[t.topic] ?? Lightbulb;
          return (
            <li key={t.id} className="rounded-2xl bg-sunk/60 p-4 flex gap-3">
              <Icon size={20} className="text-primary shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{t.title}</p>
                <p className="text-sm text-muted mt-0.5">{t.body}</p>
              </div>
              <button className="btn-ghost h-9 w-9 p-0 shrink-0 text-muted" aria-label={`Remove ${t.title}`}
                onClick={() => setSetting('savedTips', ids.filter((x) => x !== t.id))}><X size={16} /></button>
            </li>
          );
        })}
        {list.length === 0 && <li className="sub">No saved tips yet.</li>}
      </ul>
    </Sheet>
  );
}

/** For the Customise sheet: bring daily tips back after hiding them. */
export function useTipsHidden() {
  const hidden = useLiveQuery(() => getSetting<boolean>('tipsHidden', false), []) ?? false;
  return [hidden, (v: boolean) => db.settings.put({ key: 'tipsHidden', value: v })] as const;
}
