import { Check, Eye, HandCoins, Lock, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar as RBar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Avatar, Empty, Money, Panel, Sheet, useFmt } from '../components/ui';
import { db, setSetting, uid } from '../db/db';
import { saveTransaction, useData, useProfile, type Data } from '../db/hooks';
import { PALETTE } from '../db/seed';
import type { AgeGroup, Member, Role } from '../db/types';
import { isoDate, monthKey, monthLabel } from '../lib/dates';
import { spendByCategory } from '../lib/finance';
import { splitEvenly, toMinor } from '../lib/money';
import { askConfirm, useUI } from '../store/ui';
import { APP_LOCALE } from '../lib/locale';

const tooltipStyle = { background: 'rgb(var(--surface))', borderRadius: 12, border: '1px solid rgb(var(--line))', fontSize: 13 };

const ROLES: { value: Role; label: string; help: string }[] = [
  { value: 'owner', label: 'Owner', help: 'Set up the household. Can change everything, including security and backups.' },
  { value: 'admin', label: 'Admin', help: 'Can change everything and manage members.' },
  { value: 'adult', label: 'Adult', help: 'Adds and edits entries, budgets and goals.' },
  { value: 'teen', label: 'Teen', help: 'Sees only their own pocket money, spending and savings jars.' },
  { value: 'child', label: 'Child', help: 'Sees only their own pocket money and savings jars, in a simpler view.' },
  { value: 'viewer', label: 'Viewer', help: 'Can look at everything but can’t change anything.' },
];
const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;
const ageFor = (r: Role): AgeGroup => (r === 'teen' ? 'teen' : r === 'child' ? 'child' : 'adult');

interface Chore { id: string; name: string; reward: number; done: boolean }

export default function Family() {
  const data = useData();
  const profile = useProfile();
  if (!data || !profile) return null;
  return <FamilyView data={data} currency={profile.currency} />;
}

function memberSpend(data: Data, mk: string, id: string) {
  let s = 0;
  for (const v of spendByCategory(data.txs, mk, id).values()) s += v;
  return s;
}

function FamilyView({ data, currency }: { data: Data; currency: string }) {
  const now = useMemo(() => new Date(), []);
  const mk = monthKey(now);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Member | null>(null);
  const kids = data.members.filter((m) => m.role === 'teen' || m.role === 'child');

  const remove = async (m: Member) => {
    if (m.role === 'owner') return;
    if (!(await askConfirm(`Remove ${m.name} from the household? Their past entries stay in Activity.`, `Remove ${m.name}`))) return;
    await db.members.delete(m.id);
    useUI.getState().toast(`${m.name} removed`, async () => { await db.members.put(m); });
  };

  return (
    <div className="space-y-6 pt-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="sub font-semibold">{data.members.length} member{data.members.length === 1 ? '' : 's'}</p>
          <h1 className="h1">Family</h1>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ id: '', name: '', role: 'adult', age: 'adult', colour: PALETTE[data.members.length % PALETTE.length] })}>
          <UserPlus size={17} /> Add member
        </button>
      </div>

      <Panel title="Members">
        {data.members.length === 0 ? (
          <Empty icon={<Users />} title="No members yet" body="Add the people you share money with. Kids get their own simple view." />
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.members.map((m) => (
              <li key={m.id} className="rounded-2xl border border-line/70 p-4">
                <div className="flex items-center gap-3">
                  <Avatar m={m} size={44} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{m.name}</p>
                    <p className="text-xs text-muted">{roleLabel(m.role)}</p>
                  </div>
                  <button className="btn-ghost h-9 w-9 p-0" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil size={16} /></button>
                  {m.role !== 'owner' && <button className="btn-ghost h-9 w-9 p-0 text-muted" aria-label={`Remove ${m.name}`} onClick={() => remove(m)}><Trash2 size={16} /></button>}
                </div>
                <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div className="rounded-xl bg-sunk/60 px-3 py-2"><dt className="text-xs text-muted font-semibold">Spent this month</dt><dd className="font-bold"><Money value={memberSpend(data, mk, m.id)} /></dd></div>
                  <div className="rounded-xl bg-sunk/60 px-3 py-2"><dt className="text-xs text-muted font-semibold">Allowance</dt><dd className="font-bold">{m.allowance ? <Money value={m.allowance} /> : <span className="text-muted font-semibold">None</span>}</dd></div>
                </dl>
                {m.role !== 'owner' && (
                  <button className="btn-soft h-9 w-full mt-3 text-[13px]" onClick={() => { useUI.getState().setViewAs(m.id); navigate('/'); }}>
                    <Eye size={15} /> View as {m.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className="mt-4 rounded-2xl bg-sunk/60 p-4 text-sm">
          <summary className="font-semibold cursor-pointer">What each role can do</summary>
          <ul className="mt-3 space-y-1.5">
            {ROLES.map((r) => <li key={r.value}><b>{r.label}.</b> <span className="text-muted">{r.help}</span></li>)}
          </ul>
        </details>
        <p className="text-xs text-muted mt-3 flex items-start gap-1.5"><Lock size={13} className="mt-0.5 shrink-0" /> Anyone can mark an entry private in Activity. Private entries are hidden when viewing as another member.</p>
      </Panel>

      <WhoSpent data={data} mk={mk} />

      {kids.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-6">
          {kids.map((k) => <PocketMoney key={k.id} m={k} data={data} currency={currency} mk={mk} />)}
        </div>
      )}

      <SplitSettle data={data} now={now} />

      <MemberSheet member={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/* ───────────────────────── Member edit ───────────────────────── */

function MemberSheet({ member, onClose }: { member: Member | null; onClose: () => void }) {
  return (
    <Sheet open={!!member} onOpenChange={(o) => !o && onClose()} title={member?.id ? `Edit ${member.name}` : 'Add a member'} description="Roles decide what each person can see and change.">
      {member && <MemberForm key={member.id || 'new'} member={member} onDone={onClose} />}
    </Sheet>
  );
}

function MemberForm({ member, onDone }: { member: Member; onDone: () => void }) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<Role>(member.role);
  const [colour, setColour] = useState(member.colour);
  const [allowance, setAllowance] = useState(member.allowance ? String(member.allowance / 100) : '');
  const isOwner = member.role === 'owner';

  const save = async () => {
    if (!name.trim()) return;
    const row: Member = { ...member, id: member.id || uid(), name: name.trim(), role, age: ageFor(role), colour, allowance: allowance ? toMinor(allowance) : undefined };
    await db.members.put(row);
    useUI.getState().toast(member.id ? `${row.name} updated` : `${row.name} added`);
    onDone();
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div><label className="label" htmlFor="m-name">Name</label><input id="m-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></div>
      <div>
        <label className="label" htmlFor="m-role">Role</label>
        <select id="m-role" className="field" value={role} disabled={isOwner} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.filter((r) => isOwner || r.value !== 'owner').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <p className="text-xs text-muted mt-1.5">{ROLES.find((r) => r.value === role)?.help}</p>
      </div>
      <fieldset>
        <legend className="label">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c, i) => (
            <button type="button" key={c} aria-label={`Colour ${i + 1}`} aria-pressed={colour === c} onClick={() => setColour(c)}
              className="h-9 w-9 rounded-full grid place-items-center ring-offset-2 ring-offset-surface" style={{ background: c, boxShadow: colour === c ? '0 0 0 2px rgb(var(--surface)), 0 0 0 4px rgb(var(--ink))' : undefined }}>
              {colour === c && <Check size={16} className="text-white" />}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="m-allow">Monthly allowance (optional)</label>
        <input id="m-allow" className="field" inputMode="decimal" placeholder="0" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1">{member.id ? 'Save changes' : 'Add member'}</button>
        <button type="button" className="btn-soft" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/* ───────────────────────── Who spent what ───────────────────────── */

function WhoSpent({ data, mk }: { data: Data; mk: string }) {
  const fmt = useFmt();
  const per = data.members.map((m) => ({ m, cats: spendByCategory(data.txs, mk, m.id) }));
  const totals = new Map<string, number>();
  for (const p of per) for (const [k, v] of p.cats) totals.set(k, (totals.get(k) ?? 0) + v);
  const top = [...totals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const rows = per.map((p) => {
    const row: Record<string, number | string> = { name: p.m.name };
    let other = 0;
    for (const [k, v] of p.cats) { if (top.includes(k)) row[k] = v / 100; else other += v; }
    row.other = other / 100;
    return row;
  });
  const share = per.map((p) => ({ name: p.m.name, colour: p.m.colour, value: [...p.cats.values()].reduce((s, v) => s + v, 0) })).filter((x) => x.value > 0);
  const total = share.reduce((s, x) => s + x.value, 0);
  const keys = [...top, 'other'];
  const nameOf = (k: string) => (k === 'other' ? 'Everything else' : data.cat(k)?.name ?? 'Other');
  const colourOf = (k: string) => (k === 'other' ? '#8A94A6' : data.cat(k)?.colour ?? '#8A94A6');

  return (
    <Panel title={`Who spent what in ${monthLabel(new Date(mk + '-01T00:00'))}`}>
      {total === 0 ? <p className="sub">No spending linked to members this month. Pick a member when adding an entry to see it here.</p> : (
        <div className="grid md:grid-cols-[1.6fr_1fr] gap-6 items-center">
          <div className="h-64 -mx-2" role="img" aria-label="Stacked bar chart of this month's spending per member by category">
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} />
                <YAxis tickFormatter={(v) => fmt(Math.round(Number(v) * 100), { compact: true })} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} width={60} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--sunk))' }} formatter={(v, n) => [fmt(Math.round(Number(v) * 100)), nameOf(String(n))]} />
                <Legend formatter={(v) => nameOf(String(v))} wrapperStyle={{ fontSize: 12 }} />
                {keys.map((k, i) => <RBar key={k} dataKey={k} stackId="s" fill={colourOf(k)} radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="h-44" role="img" aria-label="Donut chart of each member's share of spending">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={share} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="rgb(var(--surface))" strokeWidth={2}>
                    {share.map((s) => <Cell key={s.name} fill={s.colour} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmt(Number(v)), String(n)]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-1.5 mt-2">
              {share.sort((a, b) => b.value - a.value).map((s) => (
                <li key={s.name} className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: s.colour }} aria-hidden />
                  <span className="flex-1 font-semibold">{s.name}</span>
                  <span className="num text-muted">{Math.round((s.value / total) * 100)}%</span>
                  <Money value={s.value} className="font-bold w-24 text-right" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── Pocket money ───────────────────────── */

function PocketMoney({ m, data, currency, mk }: { m: Member; data: Data; currency: string; mk: string }) {
  const fmt = useFmt();
  const key = `chores:${m.id}`;
  const chores = useLiveQuery(async () => ((await db.settings.get(key))?.value as Chore[] | undefined) ?? [], [key]) ?? [];
  const [choreName, setChoreName] = useState('');
  const [reward, setReward] = useState('');
  const paidThisMonth = data.all.find((t) => t.categoryId === 'pocket' && t.memberId === m.id && monthKey(t.date) === mk && t.payee === `Pocket money — ${m.name}`);
  const cash = data.accounts.find((a) => !a.archived && a.type === 'cash') ?? data.accounts.find((a) => !a.archived && (a.type === 'bank' || a.type === 'wallet'));

  const pay = async (amount: number, payee: string, note?: string) => {
    if (!cash) { useUI.getState().toast('Add a cash or bank account first.'); return; }
    const t = await saveTransaction({ amount, type: 'expense', accountId: cash.id, categoryId: 'pocket', payee, memberId: m.id, currency, notes: note });
    useUI.getState().toast(`Paid ${fmt(amount)} to ${m.name}`, async () => { await db.transactions.delete(t.id); });
  };
  const saveChores = (list: Chore[]) => setSetting(key, list);

  return (
    <Panel title={<span className="flex items-center gap-2"><Avatar m={m} size={26} /> {m.name}’s pocket money</span>}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[13px] font-semibold text-muted">Monthly allowance</p>
          {m.allowance ? <Money value={m.allowance} className="text-2xl font-extrabold" /> : <p className="text-sm text-muted">Not set. Edit {m.name} to add one.</p>}
          {paidThisMonth && <p className="text-xs text-good font-semibold mt-0.5 flex items-center gap-1"><Check size={13} /> Paid on {new Date(paidThisMonth.date).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })}</p>}
        </div>
        <button className="btn-primary" disabled={!m.allowance} onClick={() => pay(m.allowance!, `Pocket money — ${m.name}`)}><HandCoins size={17} /> Pay allowance now</button>
      </div>

      <div className="mt-5 border-t border-line/70 pt-4">
        <h3 className="font-bold text-sm mb-2">Chores (optional)</h3>
        {chores.length === 0 && <p className="sub mb-3">Add chores with a small reward. Tick one when it’s done to pay the reward.</p>}
        <ul className="space-y-2 mb-3">
          {chores.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl bg-sunk/60 px-3 py-2">
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={c.done} aria-label={`Mark ${c.name} as done`}
                onChange={() => saveChores(chores.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} />
              <span className={`flex-1 text-sm font-semibold ${c.done ? 'line-through text-muted' : ''}`}>{c.name}</span>
              <Money value={c.reward} className="text-sm text-muted" />
              {c.done && c.reward > 0 && (
                <button className="btn-soft h-8 text-[13px] px-3" onClick={async () => {
                  await pay(c.reward, `Pocket money — ${m.name}`, `Chore: ${c.name}`);
                  await saveChores(chores.map((x) => (x.id === c.id ? { ...x, done: false } : x)));
                }}>Pay reward</button>
              )}
              <button className="btn-ghost h-8 w-8 p-0 text-muted" aria-label={`Delete chore ${c.name}`} onClick={() => saveChores(chores.filter((x) => x.id !== c.id))}><X size={15} /></button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!choreName.trim()) return;
          saveChores([...chores, { id: uid(), name: choreName.trim(), reward: toMinor(reward || 0), done: false }]);
          setChoreName(''); setReward('');
        }}>
          <label className="sr-only" htmlFor={`chore-${m.id}`}>Chore name</label>
          <input id={`chore-${m.id}`} className="field flex-1" placeholder="e.g. Water the plants" value={choreName} onChange={(e) => setChoreName(e.target.value)} />
          <label className="sr-only" htmlFor={`reward-${m.id}`}>Reward</label>
          <input id={`reward-${m.id}`} className="field w-24" inputMode="decimal" placeholder="Reward" value={reward} onChange={(e) => setReward(e.target.value)} />
          <button type="submit" className="btn-soft px-3" aria-label="Add chore"><Plus size={17} /></button>
        </form>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Split & settle ───────────────────────── */

interface Person { key: string; name: string; household: boolean }

function SplitSettle({ data, now }: { data: Data; now: Date }) {
  const fmt = useFmt();
  const [total, setTotal] = useState('');
  const [note, setNote] = useState('');
  const [friends, setFriends] = useState<string[]>([]);
  const [friendName, setFriendName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(data.members.filter((m) => m.role === 'owner').map((m) => `m:${m.id}`)));
  const [payer, setPayer] = useState<string>(() => { const o = data.members.find((m) => m.role === 'owner'); return o ? `m:${o.id}` : ''; });

  const people: Person[] = [
    ...data.members.map((m) => ({ key: `m:${m.id}`, name: m.name, household: true })),
    ...friends.map((f) => ({ key: `f:${f}`, name: f, household: false })),
  ];
  const participants = people.filter((p) => picked.has(p.key));
  const amount = toMinor(total || 0);
  const shares = participants.length ? splitEvenly(amount, participants.length) : [];
  const payerP = people.find((p) => p.key === payer);
  const debts = payerP ? participants.map((p, i) => ({ p, share: shares[i] })).filter((x) => x.p.key !== payer && x.share > 0) : [];

  // IOUs record what's owed between the household and people outside it.
  const ious = payerP?.household
    ? debts.filter((d) => !d.p.household).map((d) => ({ person: d.p.name, amount: d.share }))
    : payerP ? [{ person: payerP.name, amount: -debts.filter((d) => d.p.household).reduce((s, d) => s + d.share, 0) }].filter((x) => x.amount !== 0) : [];

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const addFriend = () => {
    const f = friendName.trim();
    if (!f || friends.includes(f)) return;
    setFriends([...friends, f]);
    setPicked((s) => new Set(s).add(`f:${f}`));
    setFriendName('');
  };
  const saveIOUs = async () => {
    const rows = ious.map((x) => ({ id: uid(), person: x.person, amount: x.amount, note: note.trim() || 'Shared expense', date: isoDate(now), settled: false }));
    await db.ious.bulkAdd(rows);
    useUI.getState().toast(`Saved ${rows.length} IOU${rows.length > 1 ? 's' : ''}`, async () => { await db.ious.bulkDelete(rows.map((r) => r.id)); });
    setTotal(''); setNote('');
  };

  const open = data.ious.filter((i) => !i.settled);
  const byPerson = new Map<string, { net: number; items: typeof open }>();
  for (const i of open) {
    const e = byPerson.get(i.person) ?? { net: 0, items: [] };
    e.net += i.amount; e.items.push(i);
    byPerson.set(i.person, e);
  }
  const settle = async (person: string) => {
    const ids = byPerson.get(person)!.items.map((i) => i.id);
    await db.ious.where('id').anyOf(ids).modify({ settled: true });
    useUI.getState().toast(`Settled up with ${person}`, async () => { await db.ious.where('id').anyOf(ids).modify({ settled: false }); });
  };

  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6">
      <Panel title="Split a shared expense">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label" htmlFor="split-total">Total</label><input id="split-total" className="field" inputMode="decimal" placeholder="0" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
          <div><label className="label" htmlFor="split-note">What was it for?</label><input id="split-note" className="field" placeholder="e.g. Dinner at Lumi" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <fieldset className="mt-4">
          <legend className="label">Who shared it</legend>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => <button key={p.key} type="button" className="chip" aria-pressed={picked.has(p.key)} onClick={() => toggle(p.key)}>{picked.has(p.key) && <Check size={13} />}{p.name}{!p.household && <span className="opacity-70 font-normal">· friend</span>}</button>)}
          </div>
          <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); addFriend(); }}>
            <label className="sr-only" htmlFor="friend-name">Friend’s name</label>
            <input id="friend-name" className="field flex-1" placeholder="Add a friend by name" value={friendName} onChange={(e) => setFriendName(e.target.value)} />
            <button type="submit" className="btn-soft">Add</button>
          </form>
        </fieldset>
        <div className="mt-4">
          <label className="label" htmlFor="split-payer">Who paid</label>
          <select id="split-payer" className="field" value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="" disabled>Choose who paid</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}{p.household ? '' : ' (friend)'}</option>)}
          </select>
        </div>

        {amount > 0 && participants.length > 0 && (
          <div className="mt-5 rounded-2xl bg-sunk/60 p-4">
            <p className="text-sm font-semibold">Each share is about <Money value={shares[0]} className="font-extrabold" /> across {participants.length} {participants.length === 1 ? 'person' : 'people'}.</p>
            {!payerP ? <p className="sub mt-2">Choose who paid to see who owes whom.</p> : debts.length === 0 ? <p className="sub mt-2">Nobody owes anything.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {debts.map((d) => <li key={d.p.key}><b>{d.p.name}</b> owes <b>{payerP.name}</b> <Money value={d.share} className="font-bold" /></li>)}
              </ul>
            )}
            {payerP && ious.length > 0 && (
              <>
                <p className="text-xs text-muted mt-3">Household members share one pot, so only amounts between the household and friends are saved as IOUs.</p>
                <button className="btn-primary mt-3" onClick={saveIOUs}>Save as IOU</button>
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Settle up">
        {byPerson.size === 0 ? <p className="sub">You’re all square. Nobody owes anything.</p> : (
          <ul className="space-y-3">
            {[...byPerson].sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net)).map(([person, e]) => (
              <li key={person} className="rounded-2xl border border-line/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">{person}</p>
                    <p className={`text-sm font-semibold ${e.net > 0 ? 'text-good' : e.net < 0 ? 'text-warn' : 'text-muted'}`}>
                      {e.net > 0 ? <>Owes you <Money value={e.net} /></> : e.net < 0 ? <>You owe <Money value={-e.net} /></> : 'Even'}
                    </p>
                  </div>
                  <button className="btn-soft h-9 text-[13px]" onClick={() => settle(person)}>Mark settled</button>
                </div>
                <ul className="mt-2 text-xs text-muted space-y-0.5">
                  {e.items.map((i) => <li key={i.id}>{i.note} · <span className="money num">{fmt(i.amount, { sign: true })}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
