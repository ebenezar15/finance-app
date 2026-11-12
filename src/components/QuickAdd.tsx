import { useLiveQuery } from 'dexie-react-hooks';
import { Delete, Split, Star, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, defaultMethodFor, getSetting, setSetting } from '../db/db';
import { PAYMENT_METHODS } from '../lib/payment';
import { saveTransaction, useData, useProfile } from '../db/hooks';
import type { Minor, PaymentMethod, Transaction, TxType } from '../db/types';
import { allowanceLine, dailyGuide, type CategoryAllowance } from '../lib/allowance';
import { quickSuggestions, suggestCategory } from '../lib/categorize';
import { savedCheer, streaks } from '../lib/cheer';
import { DAY, isoDate } from '../lib/dates';
import { success } from '../lib/haptics';
import { prefersReducedMotion } from '../lib/motion';
import { evalAmount, splitEvenly, toMinor } from '../lib/money';
import { useUI } from '../store/ui';
import { celebrateOnce } from './Confetti';
import { CatIcon, Segmented, Sheet, useFmt } from './ui';
import '../styles/quickadd.css';

interface Fav { payee: string; amount: number; categoryId?: string }

/** How far back "Log again" looks for entries to repeat. */
const REPEAT_DAYS = 60;
const REPEAT_MAX = 6;

/**
 * Recent distinct expenses, de-duplicated by payee + category + amount, most frequent first and
 * then most recent. `txs` is newest first, so the first entry seen for a key is its latest.
 */
function recentRepeats(txs: Transaction[], now = new Date()): Transaction[] {
  const since = isoDate(new Date(now.getTime() - REPEAT_DAYS * DAY));
  const seen = new Map<string, { t: Transaction; n: number; order: number }>();
  for (const t of txs) {
    if (t.type !== 'expense' || t.date.slice(0, 10) < since) continue;
    const key = `${(t.payee ?? '').trim().toLowerCase()}|${t.categoryId ?? ''}|${t.amount}`;
    const hit = seen.get(key);
    if (hit) hit.n++;
    else seen.set(key, { t, n: 1, order: seen.size });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.order - b.order).slice(0, REPEAT_MAX).map((x) => x.t);
}

/** How long the check mark on Save plays before the sheet closes. */
const SAVED_MS = 450;
const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100];

export type HintTone = 'muted' | 'warn' | 'bad';
export interface AllowanceHint {
  text: string;
  tone: HintTone;
  /** Meter, in percent of the bar: what was already used, and what this entry adds on top. */
  used: number;
  adding: number;
}

/**
 * The line under the category picker. `before` is the category as it stands without this entry;
 * `after` is the same category with the typed amount counted (omit it while nothing is typed).
 * Everyday categories talk about today's share, bill-driven ones about the month only.
 */
export function allowanceHint(before: CategoryAllowance, after: CategoryAllowance | undefined, name: string, fmt: (m: Minor) => string): AllowanceHint {
  const a = after ?? before;
  const lead = after ? 'After this' : name;
  const overMonth = a.leftMonth < 0;
  let text: string;
  let tone: HintTone = 'muted';
  if (overMonth) {
    text = `${lead}: ${fmt(-a.leftMonth)} over this month’s budget`;
    tone = 'bad';
  } else if (a.fixed) {
    text = `${lead}: ${fmt(a.leftMonth)} left this month`;
    if (a.leftMonth === 0) tone = 'warn';
  } else if (a.leftToday > 0) {
    text = `${lead}: ${fmt(a.leftToday)} left for today`;
    if (a.spentToday >= a.today * 0.75) tone = 'warn';
  } else if (a.leftToday === 0 && a.today > 0) {
    text = `${lead}: today’s share is used · ${fmt(a.leftMonth)} left this month`;
    tone = 'warn';
  } else if (a.leftToday === 0) {
    // No share for today and nothing spent today.
    text = a.leftMonth > 0 ? `${lead}: ${fmt(a.leftMonth)} left this month` : `${lead}: this month’s budget is used`;
    tone = 'warn';
  } else {
    text = `${lead}: ${fmt(-a.leftToday)} over today’s share · ${fmt(a.leftMonth)} still left this month`;
    tone = 'bad';
  }

  // Meter: today's share for everyday categories, the month's budget for bill-driven ones.
  const [was, now, cap] = a.fixed ? [before.spentMonth, a.spentMonth, a.budget] : [before.spentToday, a.spentToday, a.today];
  const scale = Math.max(cap, now, 0);
  const pct = (m: Minor) => (scale > 0 ? Math.min(100, Math.max(0, (m / scale) * 100)) : overMonth || a.leftMonth === 0 ? 100 : 0);
  const total = pct(now);
  const used = Math.min(pct(was), total);
  return { text, tone, used, adding: total - used };
}

const HINT_TEXT: Record<HintTone, string> = { muted: 'text-muted', warn: 'text-warn', bad: 'text-bad' };
const HINT_BAR: Record<HintTone, [string, string]> = {
  muted: ['bg-primary', 'bg-primary/40'],
  warn: ['bg-warn', 'bg-warn/40'],
  bad: ['bg-bad', 'bg-bad/40'],
};

/** The chosen day at the current time of day, so entries logged today sort in the order they were made. */
const entryDate = (day: string) => new Date(`${day}T${new Date().toTimeString().slice(0, 5)}`);

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '.', '0', '⌫', '+'];

export function QuickAdd() {
  const { quickAdd, closeQuickAdd, toast } = useUI();
  const data = useData();
  const profile = useProfile();
  const fmt = useFmt();
  const favs = useLiveQuery(() => getSetting<Fav[]>('favourites', []), []) ?? [];

  const [type, setType] = useState<TxType>('expense');
  const [expr, setExpr] = useState('');
  const [payee, setPayee] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [autoCat, setAutoCat] = useState<{ id: string; reason: string } | null>(null);
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [memberId, setMemberId] = useState<string | undefined>();
  const [date, setDate] = useState(isoDate(new Date()));
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('debit');
  const [tags, setTags] = useState('');
  const [splitMembers, setSplitMembers] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [done, setDone] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    if (!quickAdd.open) return;
    const d = quickAdd.draft ?? {};
    setType((quickAdd.type as TxType) ?? 'expense');
    setExpr(d.amount ? String((d.amount as number) / 100) : '');
    setPayee((d.payee as string) ?? '');
    setCategoryId(d.categoryId as string | undefined);
    setDate((d.date as string) ?? isoDate(new Date()));
    setNotes((d.notes as string) ?? '');
    setTags('');
    if (d.paymentMethod) setMethod(d.paymentMethod as PaymentMethod);
    setSplitMembers([]); setShowMore(false); setDone(false); setAutoCat(null);
    saving.current = false;
  }, [quickAdd.open, quickAdd.type, quickAdd.draft]);

  useEffect(() => {
    if (!data || accountId) return;
    const first = data.accounts.find((a) => a.type === 'credit') ?? data.accounts[0];
    setAccountId(first?.id ?? '');
    setMethod(defaultMethodFor(first?.type));
    setToAccountId(data.accounts.find((a) => a.type === 'bank')?.id ?? '');
    setMemberId(data.viewer?.id ?? data.members[0]?.id);
  }, [data, accountId]);

  // Auto-categorise as the payee is typed, and explain why.
  useEffect(() => {
    if (!data || !payee || categoryId) { setAutoCat(null); return; }
    const s = suggestCategory(payee, data.categories, data.rules, data.all);
    setAutoCat(s ? { id: s.categoryId, reason: s.reason } : null);
  }, [payee, categoryId, data]);

  const value = evalAmount(expr);
  const isExpr = /[+\-*/×÷−]/.test(expr.slice(1));
  const sugg = useMemo(() => (data ? quickSuggestions(data.all, new Date()) : []), [data]);
  const repeats = useMemo(() => (data ? recentRepeats(data.txs) : []), [data]);
  // Most-used categories first, so the usual choice is one tap away.
  const cats = useMemo(() => {
    if (!data) return [];
    const uses = new Map<string, number>();
    for (const t of data.all) if (t.categoryId) uses.set(t.categoryId, (uses.get(t.categoryId) ?? 0) + 1);
    return data.categories
      .filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'))
      .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));
  }, [data, type]);
  const chosenCat = categoryId ?? autoCat?.id;

  // Where the chosen category stands today, and where it would stand with this entry saved.
  const amountNow = value && value > 0 ? toMinor(value) : 0;
  const editingId = quickAdd.draft?.id as string | undefined;
  const liveHint = useMemo(() => {
    if (!data || !quickAdd.open || type !== 'expense' || !chosenCat) return null;
    const now = new Date();
    // An entry being edited is left out of the "before" figures, so it isn't counted twice.
    const txs = editingId ? data.txs.filter((t) => t.id !== editingId) : data.txs;
    const guide = (list: Transaction[]) => dailyGuide({ budgets: data.budgets, txs: list, recurring: data.recurring, categories: data.categories, now })
      .items.find((i) => i.categoryId === chosenCat);
    const before = guide(txs);
    if (!before) return null;
    const preview = { id: 'qa-preview', type: 'expense', amount: amountNow, categoryId: chosenCat, date: entryDate(date).toISOString() } as Transaction;
    const after = amountNow > 0 ? guide([preview, ...txs]) : undefined;
    return allowanceHint(before, after, data.cat(chosenCat)?.name ?? 'This category', fmt);
  }, [data, quickAdd.open, type, chosenCat, amountNow, date, editingId, fmt]);
  // Once saving starts the entry lands in `data`, so hold the line as it was rather than count it twice.
  const heldHint = useRef(liveHint);
  if (!saving.current) heldHint.current = liveHint;
  const hint = heldHint.current;

  // Keep the payment method and the account in step: paying cash moves the entry to the cash
  // wallet, picking a credit card account sets "Credit card", and so on. Either can be overridden.
  const pickMethod = (m: PaymentMethod) => {
    setMethod(m);
    if (!data) return;
    const cur = data.acct(accountId);
    const want = m === 'cash' ? 'cash' : m === 'credit' ? 'credit' : m === 'wallet' ? 'wallet' : 'bank';
    if (cur?.type === want) return;
    const match = data.accounts.find((a) => !a.archived && a.type === want && !a.savings) ?? data.accounts.find((a) => !a.archived && a.type === want);
    if (match) setAccountId(match.id);
  };
  const pickAccount = (id: string) => {
    setAccountId(id);
    const next = defaultMethodFor(data?.acct(id)?.type);
    // A bank account can pay by card, online or transfer, so only change the method when it no longer fits.
    if (!(next === 'debit' && ['debit', 'online', 'transfer', 'cheque'].includes(method))) setMethod(next);
  };

  const press = (k: string) => {
    if (k === '⌫') return setExpr((e) => e.slice(0, -1));
    setExpr((e) => (e + k).slice(0, 32));
  };

  useEffect(() => {
    if (!quickAdd.open) return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return;
      if (/^[0-9.+\-*/]$/.test(e.key)) { e.preventDefault(); press(e.key === '*' ? '×' : e.key === '/' ? '÷' : e.key === '-' ? '−' : e.key); }
      if (e.key === 'Backspace') press('⌫');
      if (e.key === 'Enter') save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save() {
    if (!value || value <= 0 || !accountId || !data || saving.current) return;
    saving.current = true;
    const amount = toMinor(value);
    const splits = splitMembers.length > 1 && chosenCat
      ? splitEvenly(amount, splitMembers.length).map((a, i) => ({ categoryId: chosenCat, memberId: splitMembers[i], amount: a }))
      : undefined;
    const when = entryDate(date);
    let row: Transaction;
    try {
      row = await saveTransaction({
        amount, type, accountId, toAccountId: type === 'transfer' ? toAccountId : undefined,
        categoryId: type === 'transfer' ? undefined : chosenCat, payee: payee || undefined, memberId, notes: notes.trim() || undefined,
        paymentMethod: type === 'transfer' ? undefined : method,
        tags: tags.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean),
        date: when.toISOString(), currency: profile?.currency, splits, source: (quickAdd.draft?.source as 'voice') ?? 'manual',
      });
    } catch (e) {
      saving.current = false;
      throw e;
    }
    success();

    // Work out what to say from the entries as they are now, the new one included.
    const now = new Date();
    const txs = [row, ...data.txs.filter((t) => t.id !== row.id)];
    const before = streaks(data.txs, now);
    const run = streaks(txs, now);
    const firstToday = !before.loggedToday && run.loggedToday;
    let text = `Saved ${fmt(amount)}${payee ? ` · ${payee}` : ''}`;
    if (type === 'expense') {
      const item = row.categoryId
        ? dailyGuide({ budgets: data.budgets, txs, recurring: data.recurring, categories: data.categories, now }).items.find((i) => i.categoryId === row.categoryId)
        : undefined;
      const line = item ? allowanceLine(item, data.cat(item.categoryId)?.name ?? 'This category', fmt) : undefined;
      // Unbudgeted categories only get the streak and first-entry phrases.
      const kind = savedCheer({ state: item?.state ?? 'fresh', streak: run.logging, firstToday });
      // Two short sentences at most after "Saved …": the allowance, then a kind word if there's room.
      const twoAlready = !!line && /\.\s/.test(line);
      const extra = [line, twoAlready ? undefined : kind].filter(Boolean).join(' ');
      if (extra) text += `. ${extra}`;
    }
    const milestone = firstToday && STREAK_MILESTONES.includes(run.logging) ? run.logging : 0;

    const finish = () => {
      closeQuickAdd();
      toast(text, async () => { await db.transactions.delete(row.id); });
      if (milestone) celebrateOnce(`streak-${milestone}-${isoDate(now)}`);
    };
    if (prefersReducedMotion()) return finish();
    setDone(true);
    setTimeout(finish, SAVED_MS);
  }

  async function addFav() {
    if (!value || !payee) return;
    const next = [...favs.filter((f) => f.payee !== payee), { payee, amount: toMinor(value), categoryId: chosenCat }].slice(-8);
    await setSetting('favourites', next);
    toast(`Added “${payee}” to favourites`);
  }

  const applyQuick = (p: { payee: string; amount: number; categoryId?: string }) => {
    setPayee(p.payee);
    setCategoryId(p.categoryId);
    if (!expr) setExpr(String(p.amount / 100));
  };

  // Fills the form from a past entry without saving, so the date or amount can still change.
  const repeat = (t: Transaction) => {
    if (!data) return;
    setExpr(String(t.amount / 100));
    setCategoryId(t.categoryId);
    setPayee(t.payee ?? '');
    setNotes(t.notes ?? '');
    const acct = data.acct(t.accountId);
    if (acct && !acct.archived) setAccountId(acct.id);
    setMethod(t.paymentMethod ?? defaultMethodFor(acct?.type));
  };

  if (!data) return null;
  return (
    <Sheet open={quickAdd.open} onOpenChange={(o) => !o && closeQuickAdd()} title={type === 'income' ? 'Add income' : type === 'transfer' ? 'Move money' : 'Add expense'}>
      <div className="space-y-4">
        <Segmented label="Entry type" value={type as 'expense'} onChange={(v) => { setType(v); setCategoryId(undefined); }}
          options={[{ value: 'expense', label: 'Expense' }, { value: 'income' as 'expense', label: 'Income' }, { value: 'transfer' as 'expense', label: 'Transfer' }]} />

        <div className="rounded-2xl bg-sunk px-4 py-3 relative overflow-hidden" aria-live="polite">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`display text-[44px] ${value === null && expr ? 'text-bad' : ''}`}>
              {value !== null ? fmt(toMinor(value)) : expr ? 'Check the sum' : fmt(0)}
            </span>
          </div>
          <p className="text-[13px] text-muted num h-5">{isExpr ? expr : expr ? ' ' : 'Type an amount — sums like 250+120×2 work too'}</p>
        </div>

        {type === 'expense' && !expr && repeats.length > 0 && (
          <div role="group" aria-labelledby="qa-repeat">
            <span className="label" id="qa-repeat">Log again</span>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {repeats.map((t) => {
                const c = data.cat(t.categoryId);
                const name = t.payee || c?.name || 'Expense';
                return (
                  <button key={t.id} className="chip shrink-0" onClick={() => repeat(t)} aria-label={`Log again: ${name}, ${fmt(t.amount)}`}>
                    <span aria-hidden>{c?.emoji ?? '•'}</span>{name} <span className="text-muted num money">{fmt(t.amount)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {type !== 'transfer' && (sugg.length > 0 || favs.length > 0) && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" aria-label="Suggestions">
            {favs.map((f) => (
              <button key={`f-${f.payee}`} className="chip shrink-0" onClick={() => applyQuick(f)}>
                <Star size={13} className="text-warn" fill="currentColor" />{f.payee} <span className="text-muted num">{fmt(f.amount)}</span>
              </button>
            ))}
            {sugg.filter((s) => !favs.some((f) => f.payee === s.payee)).map((s) => (
              <button key={s.payee} className="chip shrink-0" onClick={() => applyQuick(s)}>
                <span aria-hidden>{data.cat(s.categoryId)?.emoji}</span>{s.payee}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2" aria-label="Keypad">
          {KEYS.map((k) => (
            <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k}
              className={`h-12 rounded-xl text-lg font-bold num transition-transform active:scale-95 ${/[÷×−+]/.test(k) ? 'bg-sunk text-primary' : 'bg-sunk/60 hover:bg-sunk'}`}>
              {k === '⌫' ? <Delete size={20} className="mx-auto" /> : k}
            </button>
          ))}
        </div>

        {type === 'transfer' ? (
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">From</span>
              <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            <label><span className="label">To</span>
              <select className="field" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {data.accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            <p className="col-span-2 text-xs text-muted">Transfers move money between your accounts and never count as income or spending.</p>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="label">{type === 'income' ? 'From' : 'Paid to'}</span>
              <input className="field" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={type === 'income' ? 'Employer, client…' : 'Shop, person, service…'} list="payees" />
              <datalist id="payees">{[...new Set(data.all.map((t) => t.payee).filter(Boolean))].slice(0, 80).map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            {autoCat && !categoryId && (
              <p className="flex items-center gap-1.5 text-xs text-muted -mt-2"><Sparkles size={13} className="text-primary" />
                Filed under <b className="text-ink">{data.cat(autoCat.id)?.name}</b> — {autoCat.reason}</p>
            )}
            <div>
              <span className="label">Category</span>
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                {cats.map((c) => (
                  <button key={c.id} aria-pressed={chosenCat === c.id} onClick={() => setCategoryId(c.id)}
                    className={`shrink-0 flex flex-col items-center gap-1 w-[72px] py-2 rounded-xl border transition-colors ${chosenCat === c.id ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-sunk'}`}>
                    <CatIcon c={c} size={36} />
                    <span className="text-[11px] font-semibold leading-tight text-center line-clamp-2">{c.name}</span>
                  </button>
                ))}
              </div>
              {type === 'expense' && (
                <div aria-live="polite" data-testid="qa-hint">
                  {hint && (
                    <div className="mt-2 min-w-0">
                      <p className={`text-[13px] font-semibold leading-snug break-words num ${HINT_TEXT[hint.tone]}`}>{hint.text}</p>
                      <div className="qa-meter mt-1.5 bg-sunk" aria-hidden>
                        <span className={HINT_BAR[hint.tone][0]} style={{ width: `${hint.used}%` }} />
                        <span className={HINT_BAR[hint.tone][1]} style={{ width: `${hint.adding}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <label className="block">
              <span className="label">For what?</span>
              <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200}
                placeholder={type === 'income' ? 'e.g. September invoice, birthday gift' : 'e.g. Leo’s birthday cake, school trip fee'} />
            </label>
            <div>
              <span className="label" id="qa-method">{type === 'income' ? 'Received as' : 'Paid with'}</span>
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" role="radiogroup" aria-labelledby="qa-method">
                {PAYMENT_METHODS.filter((m) => type !== 'income' || !['credit', 'debit'].includes(m.id)).map(({ id, short, label, icon: Icon }) => (
                  <button key={id} role="radio" aria-checked={method === id} aria-label={label} onClick={() => pickMethod(id)} className="chip shrink-0">
                    <Icon size={14} aria-hidden />{short}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-1.5">From <b className="text-ink">{data.acct(accountId)?.name ?? 'no account'}</b> · change under more details</p>
            </div>
          </>
        )}

        <button className="text-sm font-semibold text-primary" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore}>
          {showMore ? 'Fewer details' : 'More details: account, date, person, tags, split'}
        </button>
        {showMore && (
          <div className="grid grid-cols-2 gap-3 animate-rise">
            {type !== 'transfer' && (
              <label><span className="label">Account</span>
                <select className="field" value={accountId} onChange={(e) => pickAccount(e.target.value)}>
                  {data.accounts.filter((a) => a.type !== 'asset' && !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select></label>
            )}
            <label><span className="label">Date</span><input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label><span className="label">Who</span>
              <select className="field" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
            <label className="col-span-2"><span className="label">Tags</span><input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. holiday, school, tax — separate with commas" /></label>
            {type === 'expense' && (
              <div className="col-span-2">
                <span className="label flex items-center gap-1.5"><Split size={14} /> Split evenly between</span>
                <div className="flex flex-wrap gap-2">
                  {data.members.map((m) => (
                    <button key={m.id} className="chip" aria-pressed={splitMembers.includes(m.id)}
                      onClick={() => setSplitMembers((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))}>{m.name}</button>
                  ))}
                </div>
                {splitMembers.length > 1 && value && (
                  <p className="text-xs text-muted mt-2 num">{splitEvenly(toMinor(value), splitMembers.length).map((a, i) => `${data.member(splitMembers[i])?.name} ${fmt(a)}`).join(' / ')}</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="sticky -bottom-5 -mx-5 px-5 pt-3 pb-5 -mb-5 bg-surface flex gap-2 border-t border-line/60">
          {type !== 'transfer' && <button className="btn-soft w-11 p-0" onClick={addFav} aria-label="Save as favourite" title="Save as favourite"><Star size={18} /></button>}
          <button className={`btn-primary flex-1 h-12 text-base ${done ? 'qa-save-done' : ''}`} disabled={!value || value <= 0} onClick={save}>
            {done ? (
              <>
                <svg className="qa-check" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                <span className="sr-only" role="status">Saved</span>
              </>
            ) : <>Save {value ? fmt(toMinor(value)) : ''}</>}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
