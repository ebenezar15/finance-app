import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, Coins, Flag, LifeBuoy, PartyPopper, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Avatar, Bar, Empty, Money, Panel, Ring, Segmented, Sheet, useFmt } from '../components/ui';
import { db, getSetting, setSetting, uid } from '../db/db';
import { saveTransaction, useData, useProfile, type Data } from '../db/hooks';
import type { Goal } from '../db/types';
import { addMonths, daysInMonth, isoDate, monthKey, startOfMonth } from '../lib/dates';
import { goalPlan, spendByCategory, spendLines } from '../lib/finance';
import { evalAmount, toMinor } from '../lib/money';
import { useUI } from '../store/ui';

const tipStyle = { background: 'rgb(var(--surface))', borderRadius: 12, border: '1px solid rgb(var(--line))', fontSize: 13 };

/** Parses a YYYY-MM-DD string as a local date, so labels never slip a day across time zones. */
const localDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const parseAmount = (s: string) => {
  const v = evalAmount(s);
  return v === null ? null : toMinor(v);
};

/** When a goal completes at a given monthly contribution. */
function completion(goal: Goal, monthly: number, now: Date) {
  const remaining = Math.max(0, goal.target - goal.saved);
  if (remaining === 0) return { done: true as const, months: 0, date: now };
  if (monthly <= 0) return null;
  const months = Math.ceil(remaining / monthly);
  return { done: false as const, months, date: addMonths(now, months) };
}

function projection(goal: Goal, monthly: number, now: Date, minMonths = 0) {
  const plan = goalPlan(goal, now);
  const c = completion(goal, monthly, now);
  const horizon = Math.min(120, Math.max(3, minMonths, plan.monthsLeft, c ? c.months + 1 : plan.monthsLeft + 6));
  return Array.from({ length: horizon + 1 }, (_, k) => ({
    k,
    label: addMonths(now, k).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    pace: Math.min(goal.target, goal.saved + monthly * k),
    needed: k <= plan.monthsLeft ? Math.min(goal.target, goal.saved + plan.needed * k) : null,
  }));
}

export default function Goals() {
  const data = useData();
  const profile = useProfile();
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setFormState] = useState<{ open: boolean; goal?: Goal; n: number }>({ open: false, n: 0 });
  const setForm = (f: { open: boolean; goal?: Goal }) => setFormState((cur) => ({ ...f, n: cur.n + 1 }));
  if (!data || !profile) return null;
  const now = new Date();
  const household = data.goals.filter((g) => !g.memberId).sort((a, b) => a.priority - b.priority);
  const jars = data.goals.filter((g) => g.memberId);
  const totalSaved = household.reduce((s, g) => s + g.saved, 0);
  const totalTarget = household.reduce((s, g) => s + g.target, 0);
  const monthlyNeeded = household.reduce((s, g) => s + goalPlan(g, now).needed, 0);
  const open = data.goals.find((g) => g.id === openId);

  return (
    <div className="space-y-6 pt-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="h1">Goals</h1>
          <p className="sub mt-1">
            {household.length
              ? <>You have saved <Money value={totalSaved} className="font-bold text-ink" /> of <Money value={totalTarget} />. Put aside <Money value={monthlyNeeded} className="font-bold text-ink" /> a month to stay on schedule.</>
              : 'Name what you are saving for and Tandem works out the monthly amount.'}
          </p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setForm({ open: true })}><Plus size={17} /> Add goal</button>
      </div>

      {household.length === 0 ? (
        <Panel>
          <Empty icon={<Flag size={22} />} title="No household goals yet" body="Add a goal such as a holiday, a new car or an emergency fund. You will see the monthly amount needed to reach it on time."
            action={<button className="btn-primary" onClick={() => setForm({ open: true })}><Plus size={17} /> Add your first goal</button>} />
        </Panel>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {household.map((g) => <li key={g.id}><GoalCard goal={g} now={now} onOpen={() => setOpenId(g.id)} /></li>)}
        </ul>
      )}

      <Panel title="Kids’ savings jars" action={<button className="btn-soft h-9" onClick={() => { const kid = data.members.find((m) => m.age !== 'adult'); setForm({ open: true, goal: kid ? { id: '', name: '', emoji: '🚲', target: 0, saved: 0, targetDate: isoDate(addMonths(now, 6)), priority: 3, memberId: kid.id, contributions: [] } : undefined }); }}><Plus size={16} /> Add jar</button>}>
        {jars.length === 0 ? (
          <p className="sub">Set up a jar for a child’s goal, like a bike or a game. Pick their name under “Who is it for” when you add a goal.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {jars.map((g) => {
              const p = goalPlan(g, now);
              const m = data.member(g.memberId);
              return (
                <li key={g.id}>
                  <button onClick={() => setOpenId(g.id)} className="w-full text-left rounded-2xl bg-sunk/60 hover:bg-sunk p-4 flex items-center gap-4 transition-colors">
                    <Jar fill={p.progress} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><Avatar m={m} size={24} /><span className="text-sm font-semibold text-muted">{m?.name ?? 'Child'}</span></div>
                      <p className="font-bold mt-1 truncate">{g.emoji} {g.name}</p>
                      <p className="text-sm text-muted"><Money value={g.saved} className="font-bold text-ink" /> of <Money value={g.target} /></p>
                      <p className="text-xs text-muted mt-0.5">{p.progress >= 1 ? 'Jar is full. Well done!' : <>Save <Money value={p.needed} /> a month</>}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <EmergencyFund data={data} now={now} onCreateGoal={(target) => setForm({ open: true, goal: { id: '', name: 'Emergency fund', emoji: '🛟', target, saved: 0, targetDate: isoDate(addMonths(now, 12)), priority: 1, contributions: [] } })} />
        <Challenges data={data} now={now} currency={profile.currency} />
      </div>

      {open && <GoalDetail key={open.id} goal={open} data={data} currency={profile.currency} onClose={() => setOpenId(null)} onEdit={() => setForm({ open: true, goal: open })} />}
      <GoalForm key={form.n} open={form.open} goal={form.goal} data={data} onClose={() => setForm({ open: false })} />
    </div>
  );
}

function GoalCard({ goal, now, onOpen }: { goal: Goal; now: Date; onOpen: () => void }) {
  const p = goalPlan(goal, now);
  const done = p.progress >= 1;
  const series = useMemo(() => projection(goal, p.pace, now, 0).slice(0, Math.min(25, p.monthsLeft + 2)), [goal, p.pace, p.monthsLeft, now]);
  const tone = done || p.onTrack ? 'rgb(var(--good))' : 'rgb(var(--warn))';
  return (
    <button onClick={onOpen} className="panel p-5 w-full text-left hover:border-primary/40 transition-colors" aria-label={`${goal.name}, ${Math.round(p.progress * 100)}% saved. Open details`}>
      <div className="flex items-start gap-4">
        <Ring value={p.progress} size={64} stroke={6} colour={tone}>
          <span className={`text-2xl ${done ? 'animate-pop' : ''}`} aria-hidden>{done ? '🎉' : goal.emoji}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate">{goal.name}</p>
          <p className="text-sm text-muted"><Money value={goal.saved} className="font-bold text-ink" /> of <Money value={goal.target} /></p>
          <p className="text-xs text-muted mt-0.5">By {monthYear(localDate(goal.targetDate))} · {Math.round(p.progress * 100)}%</p>
        </div>
      </div>
      <div className="mt-3 h-14 -mx-1" aria-hidden>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <YAxis hide domain={[0, goal.target]} />
            <Line type="monotone" dataKey="needed" stroke="rgb(var(--muted))" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="pace" stroke={tone} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        {done ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-good animate-pop"><PartyPopper size={15} /> Goal reached</span>
        ) : p.onTrack ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-good"><CheckCircle2 size={15} /> On track</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-warn"><AlertTriangle size={15} /> Behind</span>
        )}
        {!done && <span className="text-muted">Needs <Money value={p.needed} className="font-bold text-ink" />/mo</span>}
      </div>
    </button>
  );
}

function GoalDetail({ goal, data, currency, onClose, onEdit }: { goal: Goal; data: Data; currency: string; onClose: () => void; onEdit: () => void }) {
  const fmt = useFmt();
  const toast = useUI((s) => s.toast);
  const now = useMemo(() => new Date(), []);
  const p = goalPlan(goal, now);
  const remaining = Math.max(0, goal.target - goal.saved);
  const sliderMax = Math.max(p.needed * 2, p.pace * 2, Math.ceil(remaining / 3), 1000);
  const step = Math.max(100, Math.pow(10, Math.max(2, Math.floor(Math.log10(sliderMax)) - 2)));
  const [monthly, setMonthly] = useState(() => Math.round((p.pace || p.needed) / step) * step);
  const [amount, setAmount] = useState('');
  const banks = data.accounts.filter((a) => a.type === 'bank' && !a.archived);
  const [alsoTransfer, setAlsoTransfer] = useState(false);
  const [fromId, setFromId] = useState(banks[0]?.id ?? '');
  const [toId, setToId] = useState(banks.find((a) => /sav/i.test(a.name))?.id ?? banks[1]?.id ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const c = completion(goal, monthly, now);
  const target = localDate(goal.targetDate);
  const series = projection(goal, monthly, now);
  const lateBy = c && !c.done ? c.months - p.monthsLeft : 0;
  const amt = parseAmount(amount);
  const transferInvalid = alsoTransfer && (!fromId || !toId || fromId === toId);
  const member = data.member(goal.memberId);

  async function addMoney() {
    if (!amt || amt <= 0 || transferInvalid) return;
    const before = goal.saved;
    await db.goals.update(goal.id, { saved: goal.saved + amt, contributions: [...goal.contributions, { date: isoDate(new Date()), amount: amt }] });
    if (alsoTransfer) {
      await saveTransaction({ type: 'transfer', amount: amt, accountId: fromId, toAccountId: toId, currency, payee: `Saved for ${goal.name}`, categoryId: undefined, memberId: goal.memberId });
    }
    setAmount('');
    if (before < goal.target && before + amt >= goal.target) setCelebrate(true);
    toast(`Added ${fmt(amt)} to ${goal.name}`);
  }

  async function remove() {
    await db.goals.delete(goal.id);
    toast(`Deleted ${goal.name}`, async () => { await db.goals.put(goal); });
    onClose();
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${goal.emoji} ${goal.name}`} wide
      description={member ? `${member.name}’s savings jar` : `Target ${fmt(goal.target)} by ${target.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`}>
      <div className="space-y-5">
        {(celebrate || p.progress >= 1) && (
          <div className="animate-pop rounded-2xl bg-good/10 p-4 flex items-center gap-3" role="status">
            <PartyPopper className="text-good shrink-0" />
            <p className="text-sm"><b>You reached this goal.</b> Every contribution got you here. Time to celebrate, then pick the next one.</p>
          </div>
        )}
        <div className="flex items-center gap-4">
          <Ring value={p.progress} size={84} stroke={8} colour={p.onTrack ? 'rgb(var(--good))' : 'rgb(var(--warn))'}>
            <span className="text-sm font-extrabold num">{Math.round(p.progress * 100)}%</span>
          </Ring>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 flex-1">
            <Stat2 label="Saved" value={fmt(goal.saved)} />
            <Stat2 label="Still to save" value={fmt(remaining)} />
            <Stat2 label="Needed per month" value={fmt(p.needed)} />
            <Stat2 label="Recent pace" value={`${fmt(p.pace)}/mo`} />
          </div>
        </div>

        <section aria-label="Projection">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm">Projection</h3>
            <div className="flex gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" />Your plan</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-muted" />Needed to hit the date</span>
            </div>
          </div>
          <div className="h-52 -mx-2">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(v) => fmt(Number(v), { compact: true })} domain={[0, goal.target]} />
                <Tooltip contentStyle={tipStyle} formatter={(v, n) => [fmt(Number(v ?? 0)), n === 'pace' ? 'Your plan' : 'Needed pace']} />
                <ReferenceLine y={goal.target} stroke="rgb(var(--good))" strokeDasharray="2 4" label={{ value: 'Target', position: 'insideTopLeft', fontSize: 11, fill: 'rgb(var(--muted))' }} />
                {p.monthsLeft <= series.length && <ReferenceLine x={series[Math.min(p.monthsLeft, series.length - 1)].label} stroke="rgb(var(--line))" />}
                <Line type="monotone" dataKey="needed" stroke="rgb(var(--muted))" strokeDasharray="5 5" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="pace" stroke="rgb(var(--primary))" strokeWidth={3} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {remaining > 0 && (
          <section className="rounded-2xl bg-sunk/60 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="goal-monthly" className="font-bold text-sm">Monthly contribution</label>
              <Money value={monthly} className="font-extrabold text-lg" />
            </div>
            <input id="goal-monthly" type="range" min={0} max={sliderMax} step={step} value={monthly} onChange={(e) => setMonthly(Number(e.target.value))}
              className="w-full mt-2 accent-[rgb(var(--primary))]" aria-valuetext={fmt(monthly)} />
            <p className="text-sm mt-2" aria-live="polite">
              {!c ? 'Choose an amount above zero to see when you will get there.' : (
                <>You would reach it in <b>{monthYear(c.date)}</b>
                  {lateBy > 0 ? <>, <span className="text-warn font-semibold">{lateBy} month{lateBy > 1 ? 's' : ''} after</span> your target date.</>
                    : lateBy < 0 ? <>, <span className="text-good font-semibold">{-lateBy} month{lateBy < -1 ? 's' : ''} early</span>.</> : <>, right on time.</>}
                </>
              )}
            </p>
            <button className="btn-ghost h-8 px-2 mt-1 text-primary text-[13px]" onClick={() => setMonthly(p.needed)}>Use the needed amount ({fmt(p.needed)})</button>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="font-bold text-sm">Add money</h3>
          <div className="flex gap-2">
            <label htmlFor="goal-add" className="sr-only">Amount to add</label>
            <input id="goal-add" className="field num" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMoney()} />
            <button className="btn-primary shrink-0" disabled={!amt || amt <= 0 || transferInvalid} onClick={addMoney}><Coins size={16} /> Add money</button>
          </div>
          {banks.length >= 2 && (
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={alsoTransfer} onChange={(e) => setAlsoTransfer(e.target.checked)} />
              Also record as a transfer to savings
            </label>
          )}
          {alsoTransfer && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="goal-from">From</label>
                <select id="goal-from" className="field" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                  {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="goal-to">To</label>
                <select id="goal-to" className="field" value={toId} onChange={(e) => setToId(e.target.value)}>
                  {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {fromId === toId && <p className="col-span-2 text-xs text-bad">Pick two different accounts.</p>}
            </div>
          )}
          {goal.contributions.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-muted">Contribution history ({goal.contributions.length})</summary>
              <ul className="mt-2 divide-y divide-line/70">
                {[...goal.contributions].reverse().slice(0, 12).map((c, i) => (
                  <li key={i} className="flex justify-between py-2"><span>{localDate(c.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span><Money value={c.amount} className="font-semibold" /></li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <div className="flex items-center justify-between gap-2 border-t border-line/70 pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2 flex-wrap" role="alert">
              <span className="text-sm font-semibold">Delete this goal?</span>
              <button className="btn h-9 bg-bad text-white" onClick={remove}>Delete</button>
              <button className="btn-ghost h-9" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          ) : (
            <button className="btn-ghost h-9 text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete</button>
          )}
          <button className="btn-soft h-9" onClick={onEdit}><Pencil size={15} /> Edit goal</button>
        </div>
      </div>
    </Sheet>
  );
}

function Stat2({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="font-extrabold num money">{value}</p>
    </div>
  );
}

function GoalForm({ open, goal, data, onClose }: { open: boolean; goal?: Goal; data: Data; onClose: () => void }) {
  const editing = !!goal?.id;
  const now = new Date();
  const [name, setName] = useState(goal?.name ?? '');
  const [emoji, setEmoji] = useState(goal?.emoji ?? '🎯');
  const [target, setTarget] = useState(goal?.target ? String(goal.target / 100) : '');
  const [saved, setSaved] = useState(goal && goal.saved ? String(goal.saved / 100) : '');
  const [date, setDate] = useState(goal?.targetDate ?? isoDate(addMonths(now, 12)));
  const [priority, setPriority] = useState<'1' | '2' | '3'>(String(goal?.priority ?? 2) as '1' | '2' | '3');
  const [memberId, setMemberId] = useState(goal?.memberId ?? '');
  const kids = data.members.filter((m) => m.age !== 'adult');
  const t = parseAmount(target);
  const s = parseAmount(saved || '0');
  const valid = name.trim() && t && t > 0 && s !== null && s >= 0 && date;
  const EMOJIS = ['🎯', '🛟', '🏖️', '🚗', '🏠', '🎓', '💍', '👶', '💻', '🚲', '🎮', '🗻'];

  async function save() {
    if (!valid) return;
    const row: Goal = {
      id: goal?.id || uid(), name: name.trim(), emoji, target: t!, saved: s!, targetDate: date, priority: Number(priority) as 1 | 2 | 3,
      memberId: memberId || undefined, contributions: goal?.contributions ?? [],
    };
    await db.goals.put(row);
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={editing ? 'Edit goal' : 'Add goal'} description="Set a target and a date. Tandem works out the monthly amount.">
      <div className="space-y-4">
        <div>
          <span className="label" id="emoji-label">Icon</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="emoji-label">
            {EMOJIS.map((e) => (
              <button key={e} role="radio" aria-checked={emoji === e} aria-label={e} onClick={() => setEmoji(e)}
                className={`h-10 w-10 rounded-xl text-xl grid place-items-center ${emoji === e ? 'bg-primary/15 ring-2 ring-primary' : 'bg-sunk'}`}>{e}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="g-name">Name</label>
          <input id="g-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Summer holiday" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="g-target">Target amount</label>
            <input id="g-target" className="field num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="5000" />
          </div>
          <div>
            <label className="label" htmlFor="g-saved">Already saved</label>
            <input id="g-saved" className="field num" inputMode="decimal" value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="g-date">Target date</label>
            <input id="g-date" type="date" className="field" value={date} min={isoDate(now)} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="g-member">Who is it for</label>
            <select id="g-member" className="field" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Household</option>
              {kids.map((m) => <option key={m.id} value={m.id}>{m.name}’s jar</option>)}
            </select>
          </div>
        </div>
        <div>
          <span className="label">Priority</span>
          <Segmented label="Priority" value={priority} onChange={setPriority} options={[{ value: '1', label: 'High' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Low' }]} />
        </div>
        <button className="btn-primary w-full" disabled={!valid} onClick={save}>{editing ? 'Save changes' : 'Add goal'}</button>
      </div>
    </Sheet>
  );
}

function EmergencyFund({ data, now, onCreateGoal }: { data: Data; now: Date; onCreateGoal: (target: number) => void }) {
  const fmt = useFmt();
  const [months, setMonths] = useState<'3' | '6' | '9' | '12'>('6');
  const essentials = new Set(data.categories.filter((c) => c.need === 'essential' && c.kind === 'expense').map((c) => c.id));
  const monthly = [1, 2, 3].map((k) => {
    const map = spendByCategory(data.txs, monthKey(addMonths(startOfMonth(now), -k)));
    let s = 0;
    for (const [id, v] of map) if (essentials.has(id)) s += v;
    return s;
  });
  const withData = monthly.filter((v) => v > 0);
  const essential = withData.length ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : 0;
  const covered = essential ? data.liquid / essential : 0;
  const n = Number(months);
  const target = essential * n;
  const shortfall = Math.max(0, target - data.liquid);
  const hasGoal = data.goals.some((g) => /emergency/i.test(g.name));

  return (
    <Panel title={<span className="flex items-center gap-2"><LifeBuoy size={18} className="text-primary" /> Emergency fund</span>}>
      {essential === 0 ? (
        <p className="sub">Record a few months of essential spending, such as rent, groceries and utilities, to see how long your cash would last.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-muted">Your cash covers</p>
              <p className="display text-[44px]">{covered.toFixed(1)}<span className="text-lg font-bold text-muted ml-1.5 tracking-normal">months</span></p>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-semibold text-muted">Essentials a month</p>
              <Money value={essential} className="font-extrabold text-lg" />
              <p className="text-xs text-muted">3-month average</p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-sm font-semibold" id="ef-target">Target</span>
              <Segmented label="Months of essentials to keep" value={months} onChange={setMonths}
                options={(['3', '6', '9', '12'] as const).map((v) => ({ value: v, label: `${v} mo` }))} />
            </div>
            <Bar value={target ? data.liquid / target : 0} colour={shortfall === 0 ? 'rgb(var(--good))' : 'rgb(var(--primary))'} />
            <div className="flex justify-between text-xs text-muted mt-1.5">
              <span>Cash <Money value={data.liquid} className="font-bold text-ink" /></span>
              <span>Target <Money value={target} className="font-bold text-ink" /></span>
            </div>
          </div>
          {shortfall === 0 ? (
            <p className="text-sm flex items-center gap-2"><CheckCircle2 size={16} className="text-good shrink-0" />You have {n} months covered. Keep it somewhere easy to reach.</p>
          ) : (
            <div className="rounded-2xl bg-sunk/60 p-3 flex items-center justify-between gap-3">
              <p className="text-sm">You are <Money value={shortfall} className="font-bold" /> short of {n} months.</p>
              {!hasGoal && <button className="btn-soft h-9 shrink-0" onClick={() => onCreateGoal(target)}>Make it a goal</button>}
            </div>
          )}
          <p className="text-xs text-muted">Counts bank, cash and wallet balances against spending in essential categories. {fmt(essential)} is what a basic month costs you.</p>
        </div>
      )}
    </Panel>
  );
}

interface ChallengeSettings { noSpend: boolean; roundUps: boolean }

function Challenges({ data, now, currency }: { data: Data; now: Date; currency: string }) {
  const fmt = useFmt();
  const settings = useLiveQuery(() => getSetting<ChallengeSettings>('challenges', { noSpend: false, roundUps: false }), []) ?? { noSpend: false, roundUps: false };
  const toggle = (k: keyof ChallengeSettings) => setSetting('challenges', { ...settings, [k]: !settings[k] });
  const mk = monthKey(now);
  const dim = daysInMonth(now);
  const today = now.getDate();

  const { days, count } = useMemo(() => {
    const disc = new Set(data.categories.filter((c) => c.need === 'discretionary').map((c) => c.id));
    const spent = new Array(dim + 1).fill(0);
    for (const t of data.txs) {
      if (monthKey(t.date) !== mk) continue;
      const d = new Date(t.date).getDate();
      for (const l of spendLines(t)) if (disc.has(l.categoryId)) spent[d] += l.amount;
    }
    const days = Array.from({ length: dim }, (_, i) => ({ day: i + 1, future: i + 1 > today, free: spent[i + 1] <= 0 }));
    return { days, count: days.filter((d) => !d.future && d.free).length };
  }, [data.txs, data.categories, mk, dim, today]);

  const roundUps = useMemo(() => {
    const unit = (currency === 'INR' || currency === 'JPY' ? 10 : 1) * 100;
    let total = 0, n = 0;
    for (const t of data.txs) {
      if (t.type !== 'expense' || monthKey(t.date) !== mk) continue;
      const r = (unit - (t.amount % unit)) % unit;
      if (r > 0) { total += r; n++; }
    }
    return { total, n, unit, yearly: Math.round((total / Math.max(1, today)) * 365) };
  }, [data.txs, mk, currency, today]);

  return (
    <Panel title="Challenges" action={<span className="text-xs text-muted">Optional</span>}>
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">No-spend days</p>
              <p className="text-xs text-muted">Days without dining out, shopping or other treats.</p>
            </div>
            <Switch checked={settings.noSpend} onChange={() => toggle('noSpend')} label="No-spend days challenge" />
          </div>
          {settings.noSpend && (
            <div className="mt-3 animate-rise">
              <p className="text-sm mb-2"><b className="num">{count}</b> of {today} days so far this month.</p>
              <ol className="flex gap-1 overflow-x-auto no-scrollbar pb-1" aria-label="This month’s days">
                {days.map((d) => (
                  <li key={d.day} aria-label={`Day ${d.day}: ${d.future ? 'still to come' : d.free ? 'no-spend day' : 'spent on treats'}`}
                    className={`shrink-0 h-9 w-7 rounded-lg grid place-items-center text-[11px] font-bold num
                      ${d.future ? 'text-muted/50 bg-sunk/40' : d.free ? 'bg-good/15 text-good' : 'bg-sunk text-muted'}
                      ${d.day === today ? 'ring-2 ring-primary' : ''}`}>
                    {!d.future && d.free ? <CheckCircle2 size={14} aria-hidden /> : d.day}
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted mt-1">A tick marks a no-spend day. Numbered days had some discretionary spending.</p>
            </div>
          )}
        </div>
        <div className="border-t border-line/70 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">Round-ups</p>
              <p className="text-xs text-muted">Round every purchase up to the next {fmt(roundUps.unit)} and save the change.</p>
            </div>
            <Switch checked={settings.roundUps} onChange={() => toggle('roundUps')} label="Round-ups challenge" />
          </div>
          {settings.roundUps && (
            <div className="mt-3 animate-rise rounded-2xl bg-sunk/60 p-4">
              <p className="text-[13px] font-semibold text-muted">This month you would have saved</p>
              <Money value={roundUps.total} className="display text-[34px] block mt-1" />
              <p className="text-sm text-muted mt-1">From {roundUps.n} purchase{roundUps.n === 1 ? '' : 's'}. About <Money value={roundUps.yearly} className="font-bold text-ink" /> a year at this rate.</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

function Jar({ fill }: { fill: number }) {
  const h = 70 * Math.max(0, Math.min(1, fill));
  const id = useMemo(() => `jar-${Math.random().toString(36).slice(2)}`, []);
  const body = 'M10 12h36a5 5 0 0 1 5 5v58a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6V17a5 5 0 0 1 5-5z';
  return (
    <svg width="56" height="84" viewBox="0 0 56 84" role="img" aria-label={`${Math.round(fill * 100)}% full`} className={fill >= 1 ? 'animate-pop shrink-0' : 'shrink-0'}>
      <rect x="14" y="2" width="28" height="8" rx="3" fill="rgb(var(--line))" />
      <path d={body} fill="rgb(var(--surface))" stroke="rgb(var(--line))" strokeWidth="2" />
      <clipPath id={id}><path d={body} /></clipPath>
      <rect x="0" y={81 - h} width="56" height={h} fill="rgb(var(--good))" opacity=".85" clipPath={`url(#${id})`} style={{ transition: 'all .8s' }} />
    </svg>
  );
}
