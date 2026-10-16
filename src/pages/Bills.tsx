import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, BellOff, CalendarDays, ChevronLeft, ChevronRight, Plus, Repeat, Trash2, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Empty, Money, Panel, Segmented, Sheet, Stat, useFmt } from '../components/ui';
import { db, getSetting, setSetting, uid } from '../db/db';
import { useData, useProfile, type Data } from '../db/hooks';
import type { Freq, Minor, RecurringRule } from '../db/types';
import { addDays, addMonths, daysInMonth, endOfMonth, isoDate, monthKey, monthLabel, monthsBetween, relativeDay, startOfMonth } from '../lib/dates';
import { detectSubscriptions, occurrences, upcomingBills, yearlyCost, type Upcoming } from '../lib/finance';
import { evalAmount, formatMoney, toMajor, toMinor } from '../lib/money';
import { APP_LOCALE } from '../lib/locale';

/* ───────────────────────── Shared bits ───────────────────────── */

const FREQ_LABEL: Record<Freq, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_VALUE = [1, 2, 3, 4, 5, 6, 0]; // Date.getDay() values, Monday first

const parseAmount = (s: string): Minor | null => {
  const v = evalAmount(s);
  return v === null || v < 0 ? null : toMinor(v);
};

const nextDate = (r: RecurringRule, from: Date) => occurrences(r, from, addDays(from, 400))[0];
const occKey = (u: Upcoming) => `${u.rule.id}|${isoDate(u.date)}`;

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
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

function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warn' | 'primary' }) {
  const cls = { muted: 'text-muted bg-sunk', good: 'text-good bg-good/10', warn: 'text-warn bg-warn/10', primary: 'text-primary bg-primary/10' }[tone];
  return <span className={`text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap ${cls}`}>{children}</span>;
}

function RuleAmount({ r, className = '' }: { r: RecurringRule; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${r.type === 'income' ? 'text-good' : ''} ${className}`}>
      {r.estimated && <span title="Estimated" aria-label="about">≈</span>}
      <Money value={r.amount} sign={r.type === 'income'} />
    </span>
  );
}

function DateTile({ d }: { d: Date }) {
  return (
    <div className="w-11 text-center shrink-0 rounded-xl bg-sunk py-1" aria-hidden>
      <p className="text-[10px] font-bold text-muted">{d.toLocaleDateString(APP_LOCALE, { month: 'short' })}</p>
      <p className="text-[17px] font-extrabold leading-none num">{d.getDate()}</p>
    </div>
  );
}

/** Income is an outlined ring, a bill a filled dot, so shape carries meaning as well as colour. */
function Dot({ income }: { income: boolean }) {
  return income
    ? <span className="h-2 w-2 rounded-full border-2 border-good" aria-hidden />
    : <span className="h-2 w-2 rounded-full bg-ink/80" aria-hidden />;
}

/* ───────────────────────── Page ───────────────────────── */

export default function Bills() {
  const data = useData();
  const profile = useProfile();
  if (!data || !profile) return null;
  return <BillsView data={data} />;
}

function BillsView({ data }: { data: Data }) {
  const fmt = useFmt();
  const now = useMemo(() => new Date(), []);
  const today = isoDate(now);
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null);

  const subsKept = useLiveQuery(() => getSetting<string[]>('subs-kept', []), []) ?? [];
  const reminders = useLiveQuery(() => getSetting<string[]>('reminders', []), []) ?? [];
  const billReminders = useLiveQuery(() => getSetting<boolean>('billReminders', false), []);

  useBillNotifications(billReminders === true, data.recurring, now, fmt);

  const groups = useMemo(() => {
    const sortNext = (a: RecurringRule, b: RecurringRule) => (nextDate(a, new Date(today))?.getTime() ?? Infinity) - (nextDate(b, new Date(today))?.getTime() ?? Infinity);
    return [
      { key: 'income', title: 'Income', rules: data.recurring.filter((r) => r.type === 'income').sort(sortNext) },
      { key: 'bills', title: 'Bills', rules: data.recurring.filter((r) => r.type === 'expense' && !r.isSubscription).sort(sortNext) },
      { key: 'subs', title: 'Subscriptions', rules: data.recurring.filter((r) => r.type === 'expense' && r.isSubscription).sort(sortNext) },
    ];
  }, [data.recurring, today]);

  return (
    <div className="space-y-6">
      <header className="pt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="sub font-semibold">Bills, subscriptions and reminders</p>
          <h1 className="h1">Bills</h1>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Add recurring</button>
      </header>

      <CalendarPanel data={data} now={now} />

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6 items-start">
        <Panel title="Recurring" pad={false}>
          {data.recurring.length === 0 ? (
            <Empty icon={<Repeat size={20} />} title="Nothing recurring yet"
              body="Add your salary, rent, phone bill and subscriptions. We’ll put them on the calendar and remind you before they’re due."
              action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Add recurring</button>} />
          ) : (
            <div className="pb-2">
              {groups.filter((g) => g.rules.length).map((g) => {
                const monthly = g.rules.reduce((s, r) => s + Math.round(yearlyCost(r) / 12), 0);
                return (
                  <section key={g.key} aria-labelledby={`grp-${g.key}`}>
                    <div className="flex items-baseline justify-between px-5 pt-3 pb-1">
                      <h3 id={`grp-${g.key}`} className="text-[13px] font-bold text-muted">{g.title} · {g.rules.length}</h3>
                      <span className="text-xs text-muted">about <Money value={monthly} className="font-bold text-ink" /> a month</span>
                    </div>
                    <ul>
                      {g.rules.map((r) => <RuleRow key={r.id} r={r} data={data} from={new Date(today)} onOpen={() => setEditing(r)} />)}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="space-y-6">
          <SubscriptionsPanel data={data} kept={subsKept} reminders={reminders} />
          <RemindersPanel enabled={billReminders === true} reminders={reminders} />
        </div>
      </div>

      {editing && (
        <RuleSheet key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} data={data}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/* ───────────────────────── Calendar ───────────────────────── */

function CalendarPanel({ data, now }: { data: Data; now: Date }) {
  const fmt = useFmt();
  const today = isoDate(now);
  const [selected, setSelected] = useState(today);
  const focusNext = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const sel = new Date(`${selected}T00:00:00`);
  const viewMonth = startOfMonth(sel);
  const offset = monthsBetween(startOfMonth(now), viewMonth);
  const mk = monthKey(viewMonth);
  const dim = daysInMonth(viewMonth);
  const lead = (viewMonth.getDay() + 6) % 7; // Monday-first

  const occ = useMemo(() => {
    const items = data.recurring.flatMap((rule) => occurrences(rule, viewMonth, endOfMonth(viewMonth)).map((date) => ({ rule, date })));
    const byDay = new Map<string, Upcoming[]>();
    for (const it of items) {
      const k = isoDate(it.date);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(it);
    }
    return { items, byDay };
  }, [data.recurring, mk]);

  // Totals for the shown month
  const due = occ.items.filter((i) => i.rule.type === 'expense').reduce((s, i) => s + i.rule.amount, 0);
  const ruleNames = new Set(data.recurring.filter((r) => r.type === 'expense').map((r) => r.name.trim().toLowerCase()));
  const paid = data.txs
    .filter((t) => t.type === 'expense' && monthKey(t.date) === mk && (t.source === 'recurring' || (t.payee && ruleNames.has(t.payee.trim().toLowerCase()))))
    .reduce((s, t) => s + t.amount, 0);
  const incomeDue = occ.items.filter((i) => i.rule.type === 'income').reduce((s, i) => s + i.rule.amount, 0);
  const still = Math.max(0, due - paid);

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${selected}"]`)?.focus();
  }, [selected]);

  const move = (days: number) => {
    focusNext.current = true;
    setSelected(isoDate(addDays(sel, days)));
  };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) { e.preventDefault(); move(map[e.key]); return; }
    if (e.key === 'Home') { e.preventDefault(); move(-((sel.getDay() + 6) % 7)); }
    if (e.key === 'End') { e.preventDefault(); move(6 - ((sel.getDay() + 6) % 7)); }
    if (e.key === 'PageUp') { e.preventDefault(); focusNext.current = true; setSelected(isoDate(addMonths(sel, -1))); }
    if (e.key === 'PageDown') { e.preventDefault(); focusNext.current = true; setSelected(isoDate(addMonths(sel, 1))); }
  };
  const goMonth = (n: number) => {
    const target = addMonths(viewMonth, n);
    setSelected(monthKey(target) === monthKey(now) ? today : isoDate(target));
  };

  const dayItems = occ.byDay.get(selected) ?? [];
  const next30 = upcomingBills(data.recurring, now, 30);

  return (
    <section className="panel overflow-hidden">
      <div className="grid grid-cols-3 gap-3 sm:gap-4 p-5 border-b border-line/70">
        <Stat label={`Due in ${viewMonth.toLocaleDateString(APP_LOCALE, { month: 'long' })}`} value={<Money value={due} />}
          hint={incomeDue ? <>Income expected <Money value={incomeDue} className="text-good font-semibold" /></> : undefined} />
        <Stat label="Already paid" value={<Money value={paid} className="text-good" />} hint={due ? `${Math.min(100, Math.round((paid / due) * 100))}% of the month’s bills` : undefined} />
        <Stat label="Still to pay" value={<Money value={still} />} hint={offset === 0 ? 'Before the month ends' : offset < 0 ? 'Past month' : 'Planned'} />
        {due > 0 && (
          <div className="sm:col-span-3 flex h-2 rounded-full overflow-hidden bg-sunk" role="img" aria-label={`${fmt(paid)} paid of ${fmt(due)} due`}>
            <span className="bg-good h-full" style={{ width: `${Math.min(100, (paid / due) * 100)}%`, transition: 'width .6s' }} />
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr]">
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <button className="btn-ghost h-9 w-9 p-0" aria-label="Previous month" onClick={() => goMonth(-1)}><ChevronLeft size={18} /></button>
            <h2 className="h2" aria-live="polite">{monthLabel(viewMonth)}</h2>
            <div className="flex items-center gap-1">
              {offset !== 0 && <button className="btn-ghost h-9 px-2.5 text-[13px]" onClick={() => setSelected(today)}>Today</button>}
              <button className="btn-ghost h-9 w-9 p-0" aria-label="Next month" onClick={() => goMonth(1)}><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted mb-1" aria-hidden>
            {WEEKDAYS.map((w) => <span key={w}>{w.slice(0, 3)}</span>)}
          </div>
          <div ref={gridRef} className="grid grid-cols-7 gap-1" role="group" aria-label={`${monthLabel(viewMonth)} calendar. Use arrow keys to move between days.`} onKeyDown={onKey}>
            {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden />)}
            {Array.from({ length: dim }, (_, i) => {
              const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1);
              const k = isoDate(d);
              const items = occ.byDay.get(k) ?? [];
              const bills = items.filter((x) => x.rule.type === 'expense');
              const inc = items.filter((x) => x.rule.type === 'income');
              const isToday = k === today;
              const isSel = k === selected;
              const label = [
                d.toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
                isToday ? 'today' : '',
                bills.length ? `${bills.length} bill${bills.length > 1 ? 's' : ''} totalling ${fmt(bills.reduce((s, b) => s + b.rule.amount, 0))}` : '',
                inc.length ? `${inc.length} income` : '',
              ].filter(Boolean).join(', ');
              return (
                <button key={k} data-day={k} tabIndex={isSel ? 0 : -1} aria-pressed={isSel} aria-current={isToday ? 'date' : undefined} aria-label={label}
                  onClick={() => setSelected(k)}
                  className={`relative min-h-[52px] sm:min-h-[68px] rounded-xl p-1 sm:p-1.5 flex flex-col items-center sm:items-stretch text-left transition-colors
                    ${isSel ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-sunk'} ${items.length && !isSel ? 'bg-sunk/50' : ''}`}>
                  <span className={`text-[13px] num font-bold h-6 min-w-6 px-1 grid place-items-center rounded-full self-center sm:self-start ${isToday ? 'bg-primary text-onprimary' : ''}`}>{i + 1}</span>
                  {/* Phone: dots. Wider: short labels. */}
                  {items.length > 0 && (
                    <span className="flex gap-0.5 mt-1 sm:hidden" aria-hidden>
                      {inc.slice(0, 2).map((x) => <Dot key={x.rule.id} income />)}
                      {bills.slice(0, 3 - Math.min(2, inc.length)).map((x) => <Dot key={x.rule.id} income={false} />)}
                    </span>
                  )}
                  <span className="hidden sm:flex flex-col gap-0.5 mt-1 min-w-0" aria-hidden>
                    {items.slice(0, 2).map((x) => (
                      <span key={x.rule.id} className={`truncate rounded px-1 text-[10px] font-semibold leading-4 ${x.rule.type === 'income' ? 'bg-good/15 text-good' : 'bg-ink/[.08] text-ink'}`}>
                        {x.rule.type === 'income' ? '+ ' : ''}{x.rule.name}
                      </span>
                    ))}
                    {items.length > 2 && <span className="text-[10px] text-muted font-semibold px-1">+{items.length - 2} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted" aria-hidden>
            <span className="flex items-center gap-1.5"><Dot income={false} /> Bill</span>
            <span className="flex items-center gap-1.5"><Dot income /> Income</span>
            <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded-full bg-primary" /> Today</span>
          </div>
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-line/70 p-5 space-y-6">
          <div aria-live="polite">
            <h2 className="h2 mb-2">{relativeDay(sel.toISOString(), now) === 'Today' ? 'Today' : sel.toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            {dayItems.length === 0 ? <p className="sub">Nothing due on this day.</p> : (
              <ul className="space-y-2">
                {dayItems.map((x) => (
                  <li key={x.rule.id} className="flex items-center gap-3 rounded-xl bg-sunk/60 px-3 py-2.5">
                    <Dot income={x.rule.type === 'income'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{x.rule.name}</p>
                      <p className="text-xs text-muted">{x.rule.type === 'income' ? 'Income' : x.rule.isSubscription ? 'Subscription' : 'Bill'} · {x.rule.autoPost ? 'posts automatically' : 'reminder only'}</p>
                    </div>
                    <RuleAmount r={x.rule} className="text-sm font-bold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="h2 mb-2">Next 30 days</h2>
            {next30.length === 0 ? <p className="sub">Nothing scheduled in the next 30 days. Add a recurring bill or income to see it here.</p> : (
              <ul className="divide-y divide-line/70 -my-1 max-h-[380px] overflow-y-auto pr-1">
                {next30.map((u) => (
                  <li key={occKey(u)}>
                    <button className="w-full flex items-center gap-3 py-2 text-left hover:bg-sunk/50 rounded-xl" onClick={() => setSelected(isoDate(u.date))}
                      aria-label={`${u.rule.name}, ${u.rule.type === 'income' ? 'income' : 'bill'}, ${relativeDay(u.date.toISOString(), now)}, ${fmt(u.rule.amount)}. Show on calendar.`}>
                      <DateTile d={u.date} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{u.rule.name}</p>
                        <p className="text-xs text-muted">{relativeDay(u.date.toISOString(), now)}{u.rule.type === 'income' ? ' · income' : u.rule.autoPost ? ' · auto-pay' : ''}</p>
                      </div>
                      <RuleAmount r={u.rule} className="text-sm font-bold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Recurring rules ───────────────────────── */

function RuleRow({ r, data, from, onOpen }: { r: RecurringRule; data: Data; from: Date; onOpen: () => void }) {
  const next = nextDate(r, from);
  const c = data.cat(r.categoryId);
  return (
    <li>
      <button onClick={onOpen} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-sunk/50" aria-label={`Edit ${r.name}`}>
        <span className="grid place-items-center h-10 w-10 rounded-[12px] shrink-0 text-[18px]" style={{ background: `${c?.colour ?? '#7C8798'}1f` }} aria-hidden>
          {c?.emoji ?? (r.type === 'income' ? '💼' : '🧾')}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{r.name}</p>
          <p className="text-xs text-muted truncate">
            {FREQ_LABEL[r.freq]} · {next ? `next ${relativeDay(next.toISOString(), from).replace(/^In /, 'in ').replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase())}` : 'no upcoming date'}
          </p>
        </div>
        <div className="text-right shrink-0 space-y-1">
          <RuleAmount r={r} className="text-sm font-bold block" />
          {r.autoPost ? <Badge tone="primary">Auto-posts</Badge> : <Badge>Reminder</Badge>}
        </div>
      </button>
    </li>
  );
}

function RuleSheet({ initial, data, onClose }: { initial?: RecurringRule; data: Data; onClose: () => void }) {
  const accounts = data.accounts.filter((a) => !a.archived);
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<RecurringRule['type']>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial ? String(toMajor(initial.amount)) : '');
  const [estimated, setEstimated] = useState(initial?.estimated ?? false);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '');
  const [freq, setFreq] = useState<Freq>(initial?.freq ?? 'monthly');
  const [day, setDay] = useState(initial?.day ?? new Date().getDate());
  const [autoPost, setAutoPost] = useState(initial?.autoPost ?? false);
  const [isSub, setIsSub] = useState(initial?.isSubscription ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const parsed = parseAmount(amount);
  const cats = data.categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'));
  const valid = name.trim() && parsed && accountId && (freq === 'weekly' ? day >= 0 && day <= 6 : day >= 1 && day <= 31);
  const amountBad = amount.trim() !== '' && parsed === null;

  const changeFreq = (f: Freq) => {
    if (f === 'weekly' && freq !== 'weekly') setDay(1);
    if (f !== 'weekly' && freq === 'weekly') setDay(new Date().getDate());
    setFreq(f);
  };
  const changeType = (t: RecurringRule['type']) => {
    setType(t);
    if (!data.categories.some((c) => c.id === categoryId && c.kind === (t === 'income' ? 'income' : 'expense'))) setCategoryId('');
    if (t === 'income') setIsSub(false);
  };

  const save = async () => {
    if (!valid) return;
    const rule: RecurringRule = {
      ...(initial ?? { id: uid(), startDate: isoDate(new Date()) }),
      name: name.trim(), type, amount: parsed!, estimated, categoryId: categoryId || undefined, accountId, freq, day,
      autoPost, isSubscription: type === 'expense' && isSub,
    } as RecurringRule;
    await db.recurring.put(rule);
    onClose();
  };
  const remove = async () => { if (initial) await db.recurring.delete(initial.id); onClose(); };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={initial ? `Edit ${initial.name}` : 'Add recurring'}
      description="Bills, subscriptions and income that repeat on a schedule.">
      <div className="space-y-4">
        <Segmented label="Type" value={type} onChange={changeType} options={[{ value: 'expense', label: 'Bill or subscription' }, { value: 'income', label: 'Income' }]} />
        <div>
          <label className="label" htmlFor="r-name">Name</label>
          <input id="r-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'income' ? 'e.g. Salary' : 'e.g. Electricity'} />
        </div>
        <div>
          <label className="label" htmlFor="r-amount">Amount</label>
          <input id="r-amount" inputMode="decimal" className="field num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
            aria-invalid={amountBad} aria-describedby={amountBad ? 'r-amount-err' : undefined} />
          {amountBad && <p id="r-amount-err" className="text-xs text-bad font-semibold mt-1.5">Enter a number, for example 49.99</p>}
        </div>
        <Toggle checked={estimated} onChange={setEstimated} label="The amount changes" hint="For bills like electricity. We show it as an estimate (≈) and ask you to check each one." />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="r-cat">Category</label>
            <select id="r-cat" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="r-acct">{type === 'income' ? 'Paid into' : 'Paid from'}</label>
            <select id="r-acct" className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.length === 0 && <option value="">Add an account first</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="r-freq">How often</label>
            <select id="r-freq" className="field" value={freq} onChange={(e) => changeFreq(e.target.value as Freq)}>
              {(Object.keys(FREQ_LABEL) as Freq[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
            </select>
          </div>
          <div>
            {freq === 'weekly' ? (
              <>
                <label className="label" htmlFor="r-day">On</label>
                <select id="r-day" className="field" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => <option key={w} value={WEEKDAY_VALUE[i]}>{w}</option>)}
                </select>
              </>
            ) : (
              <>
                <label className="label" htmlFor="r-day">Day of month</label>
                <input id="r-day" type="number" min={1} max={31} inputMode="numeric" className="field num" value={day}
                  onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} aria-describedby="r-day-hint" />
                <p id="r-day-hint" className="text-[11px] text-muted mt-1">Short months use their last day.</p>
              </>
            )}
          </div>
        </div>
        <Toggle checked={autoPost} onChange={setAutoPost} label="Record it automatically"
          hint={autoPost ? 'We add the entry on the due date.' : 'We only remind you. You record it when it’s paid.'} />
        {type === 'expense' && <Toggle checked={isSub} onChange={setIsSub} label="This is a subscription" hint="Counts towards your yearly subscription cost." />}
        <button className="btn-primary w-full" disabled={!valid} onClick={save}>{initial ? 'Save changes' : 'Add recurring'}</button>
        {initial && (confirmDelete ? (
          <div className="rounded-xl bg-bad/10 p-3 flex flex-wrap items-center gap-2" role="alert">
            <span className="text-sm font-semibold flex-1">Delete {initial.name}? Past entries stay.</span>
            <button className="btn-ghost h-9" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn h-9 bg-bad text-white" onClick={remove}>Delete</button>
          </div>
        ) : (
          <button className="btn-ghost w-full text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete</button>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────────────────────── Subscriptions ───────────────────────── */

function SubscriptionsPanel({ data, kept, reminders }: { data: Data; kept: string[]; reminders: string[] }) {
  const fmt = useFmt();
  const billNames = new Set(data.recurring.filter((r) => r.type === 'expense' && !r.isSubscription).map((r) => r.name.trim().toLowerCase()));
  // Leave out regular bills (rent, utilities) you already track: they repeat monthly but aren't subscriptions.
  const detected = useMemo(() => detectSubscriptions(data.txs), [data.txs]).filter((d) => !billNames.has(d.payee.trim().toLowerCase()));
  const ruleSubs = data.recurring.filter((r) => r.type === 'expense' && r.isSubscription);
  const ruleNames = new Set(ruleSubs.map((r) => r.name.trim().toLowerCase()));
  const untracked = detected.filter((d) => !ruleNames.has(d.payee.trim().toLowerCase()));
  const yearly = ruleSubs.reduce((s, r) => s + yearlyCost(r), 0) + untracked.reduce((s, d) => s + d.yearly, 0);
  const count = ruleSubs.length + untracked.length;
  const reminderFor = (payee: string, amount: Minor) => `Cancel ${payee} (${fmt(amount)} a month)`;

  const keep = (payee: string) => setSetting('subs-kept', [...new Set([...kept, payee.trim().toLowerCase()])]);
  const unkeep = (payee: string) => setSetting('subs-kept', kept.filter((k) => k !== payee.trim().toLowerCase()));
  const remind = (payee: string, amount: Minor) => setSetting('reminders', [...new Set([...reminders, reminderFor(payee, amount)])]);

  return (
    <Panel title={<span className="flex items-center gap-2"><Repeat size={17} aria-hidden /> Subscriptions</span>}>
      {count === 0 ? (
        <p className="sub">No subscriptions found yet. When the same payee charges you about the same amount each month, it shows up here.</p>
      ) : (
        <>
          <div className="rounded-2xl bg-primary/[.07] p-4 mb-4">
            <p className="text-sm font-semibold text-muted">Your subscriptions cost</p>
            <p className="mt-1"><Money value={yearly} className="display text-[38px] text-primary" /> <span className="text-sm font-bold text-muted">a year</span></p>
            <p className="text-xs text-muted mt-1">That’s about <Money value={Math.round(yearly / 12)} className="font-bold text-ink" /> a month across {count} subscription{count === 1 ? '' : 's'}.</p>
          </div>
          {detected.length > 0 && (
            <>
              <h3 className="text-[13px] font-bold text-muted mb-2">Found in your spending</h3>
              <ul className="space-y-3">
                {detected.map((d) => {
                  const k = d.payee.trim().toLowerCase();
                  const isKept = kept.includes(k);
                  const hasReminder = reminders.includes(reminderFor(d.payee, d.amount));
                  const up = d.priceChange && d.priceChange.to > d.priceChange.from;
                  return (
                    <li key={k} className="rounded-2xl border border-line/80 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{d.payee}</p>
                          <p className="text-xs text-muted">{d.count} charges · last {relativeDay(d.lastDate)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold"><Money value={d.amount} /><span className="text-muted font-semibold"> /mo</span></p>
                          <p className="text-xs text-muted"><Money value={d.yearly} /> a year</p>
                        </div>
                      </div>
                      {d.priceChange && (
                        <p className={`mt-2 text-xs font-semibold flex items-center gap-1.5 ${up ? 'text-warn' : 'text-good'}`}>
                          <TrendingUp size={13} aria-hidden className={up ? '' : 'rotate-180'} />
                          Price went {up ? 'up' : 'down'} from <span className="money num">{fmt(d.priceChange.from)}</span> to <span className="money num">{fmt(d.priceChange.to)}</span>
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {isKept ? (
                          <><Badge tone="good">Keeping it</Badge><button className="text-xs font-semibold text-primary underline" onClick={() => unkeep(d.payee)}>Change</button></>
                        ) : hasReminder ? (
                          <Badge tone="warn">Reminder set to cancel</Badge>
                        ) : (
                          <>
                            <span className="text-xs font-semibold mr-auto">Still using it?</span>
                            <button className="btn-soft h-8 px-3 text-[13px]" onClick={() => keep(d.payee)}>Yes, keep</button>
                            <button className="btn-soft h-8 px-3 text-[13px]" onClick={() => remind(d.payee, d.amount)}>Remind me to cancel</button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/* ───────────────────────── Reminders ───────────────────────── */

function readPermission(): NotificationPermission | 'unsupported' {
  try {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

function RemindersPanel({ enabled, reminders }: { enabled: boolean; reminders: string[] }) {
  const [perm, setPerm] = useState(readPermission);

  const toggle = async (on: boolean) => {
    if (on) {
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          const p = await Notification.requestPermission();
          setPerm(p);
        }
      } catch { /* some browsers throw on the promise form; the setting still saves */ }
      setPerm(readPermission());
    }
    await setSetting('billReminders', on);
  };
  const done = (r: string) => setSetting('reminders', reminders.filter((x) => x !== r));

  return (
    <Panel title={<span className="flex items-center gap-2">{enabled ? <Bell size={17} aria-hidden /> : <BellOff size={17} aria-hidden />} Reminders</span>}>
      <Toggle checked={enabled} onChange={toggle} label="Remind me 3 days before bills"
        hint={enabled ? (perm === 'denied' ? 'Notifications are blocked. Allow them for this site in your browser settings.' : perm === 'unsupported' ? 'This browser can’t show notifications, so reminders appear in the app.' : 'On') : 'Off'} />
      <p className="text-xs text-muted mt-3">
        On the web, reminders appear when Tandem is open. In the Android app they arrive even when the app is closed.
      </p>
      <h3 className="text-[13px] font-bold text-muted mt-5 mb-2">Your to-dos</h3>
      {reminders.length === 0 ? (
        <p className="sub">No reminders. Choose “Remind me to cancel” on a subscription to add one.</p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => (
            <li key={r} className="flex items-center gap-3 rounded-xl bg-sunk/60 px-3 py-2">
              <CalendarDays size={16} className="text-muted shrink-0" aria-hidden />
              <span className="text-sm flex-1">{r}</span>
              <button className="btn-ghost h-8 px-2.5 text-[13px]" onClick={() => done(r)} aria-label={`Mark done: ${r}`}>Done</button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** On load, notify once a day for bills due within 3 days. Fails quietly where storage or notifications are unavailable. */
function useBillNotifications(enabled: boolean, rules: RecurringRule[], now: Date, fmt: (v: number) => string) {
  const profile = useProfile();
  useEffect(() => {
    if (!enabled) return;
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
    } catch {
      return;
    }
    const key = `notified-${isoDate(now)}`;
    let done: string[] = [];
    try { done = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { done = []; }
    const due = upcomingBills(rules.filter((r) => r.type === 'expense'), now, 3).filter((u) => !done.includes(occKey(u)));
    if (!due.length) return;
    const sent: string[] = [];
    for (const u of due) {
      try {
        const when = relativeDay(u.date.toISOString(), now);
        const amount = profile ? formatMoney(u.rule.amount, profile.currency) : fmt(u.rule.amount);
        new Notification(`${u.rule.name} is due ${when === 'Today' || when === 'Tomorrow' ? when.toLowerCase() : when.startsWith('In ') ? when.replace('In', 'in') : `on ${when}`}`, {
          body: `${u.rule.estimated ? 'About ' : ''}${amount}${u.rule.autoPost ? '. It will be recorded automatically.' : ''}`,
          tag: occKey(u),
        });
        sent.push(occKey(u));
      } catch { /* notification failed; try again next load */ }
    }
    try { localStorage.setItem(key, JSON.stringify([...done, ...sent])); } catch { /* storage unavailable */ }
  }, [enabled, rules, profile?.currency]);
}
