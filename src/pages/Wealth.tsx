import {
  Archive, ArchiveRestore, ArrowDown, ArrowUp, Banknote, CalendarClock, ChevronDown, ChevronRight, CreditCard, HandCoins, House,
  Landmark, Pencil, PiggyBank, Plus, Scale, Trash2, TrendingUp, Wallet,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bar, Empty, Money, Panel, Sheet, useFmt } from '../components/ui';
import { db, uid } from '../db/db';
import { saveTransaction, useData, useProfile, type Data } from '../db/hooks';
import { PALETTE } from '../db/seed';
import type { Account, AccountType, Holding } from '../db/types';
import { DAY, addMonths, isoDate, monthKey, startOfMonth } from '../lib/dates';
import { monthTotals } from '../lib/finance';
import { evalAmount, toMinor } from '../lib/money';
import { useUI } from '../store/ui';

const tipStyle = { background: 'rgb(var(--surface))', borderRadius: 12, border: '1px solid rgb(var(--line))', fontSize: 13 };
const localDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const parseAmount = (s: string) => {
  const v = evalAmount(s);
  return v === null ? null : toMinor(v);
};
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const HOLDING_KIND: Record<Holding['kind'], string> = {
  fd: 'Fixed deposit', rd: 'Recurring deposit', mf: 'Mutual fund', stock: 'Stocks', gold: 'Gold', ppf: 'PPF',
  epf: 'Retirement', nps: 'Pension', property: 'Property', crypto: 'Crypto', other: 'Other',
};

const ACCOUNT_TYPE: Record<AccountType, { label: string; icon: ReactNode; iconName: string }> = {
  bank: { label: 'Bank account', icon: <Landmark size={18} />, iconName: 'landmark' },
  cash: { label: 'Cash', icon: <Banknote size={18} />, iconName: 'banknote' },
  wallet: { label: 'Digital wallet', icon: <Wallet size={18} />, iconName: 'wallet' },
  credit: { label: 'Credit card', icon: <CreditCard size={18} />, iconName: 'credit-card' },
  loan: { label: 'Loan account', icon: <HandCoins size={18} />, iconName: 'hand-coins' },
  investment: { label: 'Investment account', icon: <TrendingUp size={18} />, iconName: 'trending-up' },
  asset: { label: 'Property or asset', icon: <House size={18} />, iconName: 'home' },
};

const SLICE_COLOURS = ['rgb(var(--primary))', 'rgb(var(--indigo))', 'rgb(var(--good))', 'rgb(var(--warn))', '#B0478F', '#3B9DD8', '#C76A2B', '#8A5CF6', '#7C8798', 'rgb(var(--bad))', '#46607A', '#C9A227'];

const updatedLabel = (at: number) => {
  const d = Math.floor((Date.now() - at) / DAY);
  return d <= 0 ? 'Updated today' : d === 1 ? 'Updated yesterday' : d < 60 ? `Updated ${d} days ago` : `Updated ${Math.round(d / 30)} months ago`;
};

export default function Wealth() {
  const data = useData();
  if (!data) return null;
  return <WealthInner data={data} />;
}

function WealthInner({ data }: { data: Data }) {
  const fmt = useFmt();
  const now = useMemo(() => new Date(), []);
  const [editing, setEditing] = useState<{ open: boolean; h?: Holding; n: number }>({ open: false, n: 0 });
  const openHolding = (h?: Holding) => setEditing((c) => ({ open: true, h, n: c.n + 1 }));

  const series = useMemo(() => {
    const pts: { label: string; value: number }[] = [];
    let nw = data.netWorth;
    for (let i = 0; i < 12; i++) {
      const d = addMonths(startOfMonth(now), -i);
      pts.unshift({ label: d.toLocaleDateString(undefined, { month: 'short' }), value: nw });
      nw -= monthTotals(data.all, monthKey(d)).net;
    }
    return pts;
  }, [data.all, data.netWorth, now]);
  const change = series[series.length - 1].value - series[0].value;

  const allocation = useMemo(() => {
    const map = new Map<string, number>();
    const add = (k: string, v: number) => v > 0 && map.set(k, (map.get(k) ?? 0) + v);
    add('Cash', data.liquid);
    for (const a of data.accounts) {
      if (a.archived) continue;
      const b = data.balances.get(a.id) ?? 0;
      if (a.type === 'asset') add('Property', b);
      if (a.type === 'investment') add('Investment accounts', b);
    }
    for (const h of data.holdings) add(h.kind === 'property' ? 'Property' : HOLDING_KIND[h.kind], h.value);
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return { total, rows: [...map].sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({ name, value, pct: total ? value / total : 0, colour: SLICE_COLOURS[i % SLICE_COLOURS.length] })) };
  }, [data.liquid, data.accounts, data.balances, data.holdings]);

  const invested = data.holdings.reduce((s, h) => s + h.invested, 0);
  const value = data.holdings.reduce((s, h) => s + h.value, 0);
  const maturing = data.holdings
    .filter((h) => h.maturityDate)
    .map((h) => ({ h, days: Math.round((localDate(h.maturityDate!).getTime() - new Date(isoDate(now)).getTime()) / DAY) }))
    .filter((x) => x.days <= 90 && x.days >= -30)
    .sort((a, b) => a.days - b.days);

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="h1">Wealth</h1>
        <p className="sub mt-1">What you own, what you owe and how it is changing.</p>
      </div>

      <section className="panel overflow-hidden grid md:grid-cols-[1fr_1.4fr]">
        <div className="p-6">
          <p className="text-sm font-bold text-muted">Net worth</p>
          <Money value={data.netWorth} className="display text-[48px] md:text-[60px] block mt-2" />
          <p className={`text-sm font-semibold mt-2 flex items-center gap-1 ${change >= 0 ? 'text-good' : 'text-bad'}`}>
            {change >= 0 ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}
            <span className="money num">{fmt(change, { sign: true })}</span> <span className="text-muted font-medium">{change >= 0 ? 'up' : 'down'} over 12 months</span>
          </p>
          <div className="mt-5 flex h-3 rounded-full overflow-hidden gap-0.5" aria-hidden>
            <span style={{ flex: Math.max(1, data.assets) }} className="bg-good" />
            <span style={{ flex: data.liabilities }} className="bg-bad/70" />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div><p className="text-[13px] font-semibold text-muted flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-good" />Assets</p><Money value={data.assets} className="font-extrabold text-lg" /></div>
            <div><p className="text-[13px] font-semibold text-muted flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-bad/70" />Liabilities</p><Money value={data.liabilities} className="font-extrabold text-lg" /></div>
          </div>
        </div>
        <div className="p-4 md:p-6 border-t md:border-t-0 md:border-l border-line/70">
          <p className="text-sm font-bold text-muted mb-2 px-2 md:px-0">Last 12 months</p>
          <div className="h-48">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--primary))" stopOpacity={0.3} /><stop offset="1" stopColor="rgb(var(--primary))" stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(v) => fmt(Number(v), { compact: true })} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tipStyle} formatter={(v) => [fmt(Number(v ?? 0)), 'Net worth']} />
                <Area type="monotone" dataKey="value" stroke="rgb(var(--primary))" strokeWidth={2.5} fill="url(#nw)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted px-2 md:px-0">Estimated from your recorded income and spending. Changes in investment value are not back-dated.</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Asset allocation">
          {allocation.total === 0 ? <p className="sub">Add accounts or investments to see how your money is spread.</p> : (
            <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-5">
              <div className="relative h-40 w-40 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={allocation.rows} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={2} stroke="none">
                      {allocation.rows.map((r) => <Cell key={r.name} fill={r.colour} />)}
                    </Pie>
                    <Tooltip contentStyle={tipStyle} formatter={(v, n) => [fmt(Number(v ?? 0)), String(n)]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
                  <div><p className="text-[11px] text-muted font-semibold">Total</p><Money value={allocation.total} compact className="font-extrabold text-sm" /></div>
                </div>
              </div>
              <ul className="flex-1 w-full space-y-2">
                {allocation.rows.map((r) => (
                  <li key={r.name} className="flex items-center gap-2 text-sm">
                    <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: r.colour }} aria-hidden />
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="num text-muted w-12 text-right">{(r.pct * 100).toFixed(r.pct < 0.1 ? 1 : 0)}%</span>
                    <Money value={r.value} compact className="font-semibold w-20 text-right" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Investments" pad={data.holdings.length > 0} action={<button className="btn-soft h-9" onClick={() => openHolding()}><Plus size={16} /> Add holding</button>}>
          {data.holdings.length === 0 ? (
            <Empty icon={<PiggyBank size={22} />} title="No investments yet" body="Add funds, deposits, gold or retirement accounts. Enter today’s value and update it whenever you check."
              action={<button className="btn-primary" onClick={() => openHolding()}><Plus size={17} /> Add a holding</button>} />
          ) : (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                <span className="text-muted">Invested <Money value={invested} className="font-bold text-ink" /></span>
                <span className="text-muted">Worth <Money value={value} className="font-bold text-ink" /></span>
                <Gain gain={value - invested} base={invested} />
              </div>
              <ul className="divide-y divide-line/70 -mx-1">
                {[...data.holdings].sort((a, b) => b.value - a.value).map((h) => (
                  <li key={h.id}>
                    <button className="w-full text-left flex items-center gap-3 py-3 px-1 rounded-xl hover:bg-sunk/60" onClick={() => openHolding(h)} aria-label={`${h.name}. Update value`}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{h.name}</p>
                        <p className="text-xs text-muted truncate">{HOLDING_KIND[h.kind]} · {updatedLabel(h.updatedAt)}</p>
                      </div>
                      <div className="text-right">
                        <Money value={h.value} className="font-bold text-sm block" />
                        <Gain gain={h.value - h.invested} base={h.invested} small />
                      </div>
                      <Pencil size={15} className="text-muted shrink-0" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted mt-2">Prices are updated by you. Online price refresh is optional and off by default.</p>
            </>
          )}
        </Panel>
      </div>

      {maturing.length > 0 && (
        <Panel title={<span className="flex items-center gap-2"><CalendarClock size={18} className="text-warn" /> Maturing soon</span>}>
          <ul className="space-y-2">
            {maturing.map(({ h, days }) => (
              <li key={h.id} className="flex items-center gap-3 rounded-2xl bg-sunk/60 p-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{h.name}</p>
                  <p className="text-xs text-muted">
                    {days < 0 ? `Matured ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Matures today' : `Matures in ${days} day${days === 1 ? '' : 's'}`}
                    {' · '}{localDate(h.maturityDate!).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Money value={h.value} className="font-bold text-sm" />
                <button className="btn-ghost h-9 px-3 text-[13px]" onClick={() => openHolding(h)}>Update</button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-3">Decide whether to renew or move the money before the date, so it does not sit idle.</p>
        </Panel>
      )}

      <Accounts data={data} />

      <HoldingForm key={editing.n} open={editing.open} holding={editing.h} onClose={() => setEditing((c) => ({ ...c, open: false }))} />
    </div>
  );
}

function Gain({ gain, base, small }: { gain: number; base: number; small?: boolean }) {
  const fmt = useFmt();
  const pct = base ? (gain / base) * 100 : 0;
  const up = gain >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold num ${small ? 'text-xs' : 'text-sm'} ${up ? 'text-good' : 'text-bad'}`}>
      {up ? <ArrowUp size={small ? 11 : 13} aria-hidden /> : <ArrowDown size={small ? 11 : 13} aria-hidden />}
      <span className="sr-only">{up ? 'Gain' : 'Loss'}</span>
      <span className="money">{fmt(gain, { sign: true })}</span> ({up ? '+' : ''}{pct.toFixed(1)}%)
    </span>
  );
}

function HoldingForm({ open, holding, onClose }: { open: boolean; holding?: Holding; onClose: () => void }) {
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState(holding?.name ?? '');
  const [kind, setKind] = useState<Holding['kind']>(holding?.kind ?? 'mf');
  const [invested, setInvested] = useState(holding ? String(holding.invested / 100) : '');
  const [value, setValue] = useState(holding ? String(holding.value / 100) : '');
  const [maturity, setMaturity] = useState(holding?.maturityDate ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inv = parseAmount(invested);
  const val = parseAmount(value);
  const valid = name.trim() && inv !== null && inv >= 0 && val !== null && val >= 0;

  async function save() {
    if (!valid) return;
    await db.holdings.put({ id: holding?.id ?? uid(), name: name.trim(), kind, invested: inv!, value: val!, maturityDate: maturity || undefined, updatedAt: Date.now() });
    onClose();
  }
  async function remove() {
    if (!holding) return;
    await db.holdings.delete(holding.id);
    toast(`Deleted ${holding.name}`, async () => { await db.holdings.put(holding); });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={holding ? `Update ${holding.name}` : 'Add holding'}
      description="Prices are updated by you. Online price refresh is optional and off by default.">
      <div className="space-y-4">
        {holding && (
          <div>
            <label className="label" htmlFor="h-value-top">Current value</label>
            <input id="h-value-top" className="field num text-lg font-bold" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </div>
        )}
        <div>
          <label className="label" htmlFor="h-name">Name</label>
          <input id="h-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Global index fund" />
        </div>
        <div>
          <label className="label" htmlFor="h-kind">Type</label>
          <select id="h-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as Holding['kind'])}>
            {Object.entries(HOLDING_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="h-invested">Amount invested</label>
            <input id="h-invested" className="field num" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} placeholder="0" />
          </div>
          {!holding && (
            <div>
              <label className="label" htmlFor="h-value">Current value</label>
              <input id="h-value" className="field num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="h-maturity">Maturity date (optional)</label>
          <input id="h-maturity" type="date" className="field" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={!valid} onClick={save}>{holding ? 'Save value' : 'Add holding'}</button>
        {holding && (confirmDelete ? (
          <div className="flex items-center justify-center gap-2" role="alert">
            <span className="text-sm font-semibold">Delete this holding?</span>
            <button className="btn h-9 bg-bad text-white" onClick={remove}>Delete</button>
            <button className="btn-ghost h-9" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </div>
        ) : (
          <button className="btn-ghost w-full text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete holding</button>
        ))}
      </div>
    </Sheet>
  );
}

function Accounts({ data }: { data: Data }) {
  const toast = useUI((s) => s.toast);
  const [reconcile, setReconcile] = useState<Account | null>(null);
  const [form, setForm] = useState({ open: false, n: 0 });
  const [showArchived, setShowArchived] = useState(false);
  const active = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const order: AccountType[] = ['bank', 'cash', 'wallet', 'credit', 'investment', 'asset', 'loan'];
  const sorted = [...active].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  async function archive(a: Account, v: boolean) {
    await db.accounts.update(a.id, { archived: v });
    if (v) toast(`Archived ${a.name}`, async () => { await db.accounts.update(a.id, { archived: false }); });
  }

  return (
    <Panel title="Accounts" action={<button className="btn-soft h-9" onClick={() => setForm((f) => ({ open: true, n: f.n + 1 }))}><Plus size={16} /> Add account</button>}>
      {active.length === 0 ? (
        <p className="sub">Add your bank accounts, cards and cash so balances and net worth stay accurate.</p>
      ) : (
        <ul className="divide-y divide-line/70 -my-2">
          {sorted.map((a) => {
            const bal = data.balances.get(a.id) ?? 0;
            const t = ACCOUNT_TYPE[a.type];
            const owed = a.type === 'credit' ? Math.max(0, -bal) : 0;
            const util = a.type === 'credit' && a.creditLimit ? owed / a.creditLimit : null;
            return (
              <li key={a.id} className="py-3">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-xl grid place-items-center shrink-0" style={{ background: `${a.colour}1f`, color: a.colour }} aria-hidden>{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{a.name}{a.last4 && <span className="text-muted font-normal"> ·· {a.last4}</span>}</p>
                    <p className="text-xs text-muted truncate">{t.label}{a.shared ? ' · Shared' : ''}</p>
                  </div>
                  <div className="text-right">
                    <Money value={bal} className="font-bold text-sm" />
                    {a.type === 'credit' && <p className="text-xs text-muted">{owed > 0 ? 'owed' : 'nothing owed'}</p>}
                  </div>
                  <div className="flex">
                    <button className="btn-ghost h-9 w-9 p-0" aria-label={`Reconcile ${a.name}`} title="Reconcile" onClick={() => setReconcile(a)}><Scale size={16} /></button>
                    <button className="btn-ghost h-9 w-9 p-0" aria-label={`Archive ${a.name}`} title="Archive" onClick={() => archive(a, true)}><Archive size={16} /></button>
                  </div>
                </div>
                {util !== null && (
                  <div className="mt-2 pl-[52px] pr-[76px]">
                    <Bar value={util} colour={util > 0.3 ? 'rgb(var(--warn))' : 'rgb(var(--good))'} />
                    <p className="text-xs text-muted mt-1">
                      <span className="font-semibold text-ink num">{Math.round(util * 100)}%</span> of <Money value={a.creditLimit!} /> limit used{util > 0.3 ? ', above the 30% guide' : ''}
                      {a.dueDay ? ` · Due on the ${ordinal(a.dueDay)}` : ''}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <div className="mt-4 border-t border-line/70 pt-3">
          <button className="text-sm font-semibold text-muted inline-flex items-center gap-1" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 divide-y divide-line/70">
              {archived.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 truncate text-muted">{a.name}</span>
                  <Money value={data.balances.get(a.id) ?? 0} className="text-muted" />
                  <button className="btn-ghost h-8 px-2 text-[13px]" onClick={() => archive(a, false)}><ArchiveRestore size={14} /> Restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {reconcile && <Reconcile key={reconcile.id} account={reconcile} current={data.balances.get(reconcile.id) ?? 0} onClose={() => setReconcile(null)} />}
      <AccountForm key={form.n} open={form.open} data={data} onClose={() => setForm((f) => ({ ...f, open: false }))} />
    </Panel>
  );
}

function Reconcile({ account, current, onClose }: { account: Account; current: number; onClose: () => void }) {
  const fmt = useFmt();
  const profile = useProfile();
  const toast = useUI((s) => s.toast);
  const navigate = useNavigate();
  const [real, setReal] = useState('');
  const r = parseAmount(real);
  const diff = r === null || real.trim() === '' ? null : r - current;

  async function adjust() {
    if (!diff) return;
    await saveTransaction({ type: 'adjustment', amount: diff, accountId: account.id, payee: 'Balance adjustment', currency: profile?.currency ?? account.currency, notes: `Reconciled to ${fmt(r!)}` });
    toast(`${account.name} now matches your bank`);
    onClose();
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Reconcile ${account.name}`} description="Check Tandem against the balance your bank shows today.">
      <div className="space-y-4">
        <div className="rounded-2xl bg-sunk/60 p-4 flex justify-between items-center">
          <span className="text-sm font-semibold text-muted">Balance in Tandem</span>
          <Money value={current} className="font-extrabold text-lg" />
        </div>
        <div>
          <label className="label" htmlFor="rec-real">Balance your bank shows</label>
          <input id="rec-real" className="field num text-lg font-bold" inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} autoFocus placeholder={String(current / 100)} />
          {account.type === 'credit' && <p className="text-xs text-muted mt-1.5">For a card, enter what you owe as a negative number, for example -420.</p>}
        </div>
        {diff !== null && (
          diff === 0 ? (
            <p className="text-sm font-semibold text-good" role="status">All square. Tandem matches your bank.</p>
          ) : (
            <div className="space-y-3" role="status">
              <p className="text-sm">Tandem is <b className="money num">{fmt(Math.abs(diff))}</b> {diff > 0 ? 'lower' : 'higher'} than your bank. That is usually a missed or duplicated entry.</p>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-soft" onClick={() => { onClose(); navigate('/activity'); }}>Find missing entries</button>
                <button className="btn-primary" onClick={adjust}>Add adjustment</button>
              </div>
              <p className="text-xs text-muted">An adjustment of <span className="money num">{fmt(diff, { sign: true })}</span> brings the balance in line without changing your spending totals.</p>
            </div>
          )
        )}
      </div>
    </Sheet>
  );
}

function AccountForm({ open, data, onClose }: { open: boolean; data: Data; onClose: () => void }) {
  const profile = useProfile();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [opening, setOpening] = useState('');
  const [last4, setLast4] = useState('');
  const [limit, setLimit] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [shared, setShared] = useState(true);
  const o = parseAmount(opening || '0');
  const lim = parseAmount(limit || '0');
  const due = Number(dueDay);
  const valid = name.trim() && o !== null && (type !== 'credit' || (lim !== null && lim >= 0 && (!dueDay || (due >= 1 && due <= 31)))) && (!last4 || /^\d{4}$/.test(last4));

  async function save() {
    if (!valid) return;
    const adults = data.members.filter((m) => m.age === 'adult');
    const owner = adults.find((m) => m.role === 'owner') ?? adults[0];
    const isCredit = type === 'credit' || type === 'loan';
    await db.accounts.add({
      id: uid(), name: name.trim(), type, currency: profile?.currency ?? 'USD',
      openingBalance: isCredit ? -Math.abs(o!) : o!,
      ownerIds: shared ? adults.map((m) => m.id) : owner ? [owner.id] : [], shared,
      colour: PALETTE[data.accounts.length % PALETTE.length], icon: ACCOUNT_TYPE[type].iconName, archived: false,
      last4: last4 || undefined,
      creditLimit: type === 'credit' && lim ? lim : undefined,
      dueDay: type === 'credit' && dueDay ? due : undefined,
    });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Add account" description="Start with today’s balance. Past entries are optional.">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="a-name">Name</label>
          <input id="a-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Joint checking" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="a-type">Type</label>
            <select id="a-type" className="field" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {Object.entries(ACCOUNT_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="a-opening">{type === 'credit' || type === 'loan' ? 'Amount owed today' : 'Balance today'}</label>
            <input id="a-opening" className="field num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          </div>
        </div>
        {(type === 'bank' || type === 'credit') && (
          <div>
            <label className="label" htmlFor="a-last4">Last 4 digits (optional)</label>
            <input id="a-last4" className="field num" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
          </div>
        )}
        {type === 'credit' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="a-limit">Credit limit</label>
              <input id="a-limit" className="field num" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="label" htmlFor="a-due">Payment due day</label>
              <input id="a-due" className="field num" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, ''))} placeholder="1 to 31" />
            </div>
          </div>
        )}
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Shared with the household
        </label>
        <button className="btn-primary w-full" disabled={!valid} onClick={save}>Add account</button>
      </div>
    </Sheet>
  );
}
