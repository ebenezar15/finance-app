import {
  Calculator, Car, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, CreditCard, GraduationCap, HandCoins, Handshake, House,
  Landmark, Mountain, Pencil, Plus, Snowflake, Trash2, User,
} from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bar, Empty, Money, Panel, Segmented, Sheet, Stat, useFmt } from '../components/ui';
import { db, uid } from '../db/db';
import { useData, type Data } from '../db/hooks';
import type { IOU, Loan } from '../db/types';
import { addMonths, isoDate } from '../lib/dates';
import { emi, payoffPlan, simulatePrepayment, type AmortRow, type DebtPlanItem } from '../lib/finance';
import { evalAmount, toMinor } from '../lib/money';
import { useUI } from '../store/ui';

const tipStyle = { background: 'rgb(var(--surface))', borderRadius: 12, border: '1px solid rgb(var(--line))', fontSize: 13 };
const localDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const monthYear = (s: string | Date) => (typeof s === 'string' ? localDate(s) : s).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const parseAmount = (s: string) => {
  const v = evalAmount(s);
  return v === null ? null : toMinor(v);
};
const duration = (months: number) => {
  if (months <= 0) return 'Paid off';
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} yr${y > 1 ? 's' : ''}`, m && `${m} mo`].filter(Boolean).join(' ');
};
const niceStep = (max: number) => Math.max(100, Math.pow(10, Math.max(2, Math.floor(Math.log10(Math.max(1, max))) - 2)));

const KIND: Record<Loan['kind'], { label: string; icon: ReactNode }> = {
  home: { label: 'Home loan', icon: <House size={18} /> },
  car: { label: 'Car loan', icon: <Car size={18} /> },
  personal: { label: 'Personal loan', icon: <User size={18} /> },
  education: { label: 'Education loan', icon: <GraduationCap size={18} /> },
  credit: { label: 'Credit line', icon: <CreditCard size={18} /> },
  informal: { label: 'Family or friend', icon: <Handshake size={18} /> },
};

type LoanOut = Data['loanOut'][number];

export default function Debts() {
  const data = useData();
  const [openId, setOpenId] = useState<string | null>(null);
  const [loanForm, setLoanFormState] = useState<{ open: boolean; loan?: Loan; n: number }>({ open: false, n: 0 });
  const setLoanForm = (f: { open: boolean; loan?: Loan }) => setLoanFormState((c) => ({ ...f, n: c.n + 1 }));
  if (!data) return null;
  const active = data.loanOut.filter((l) => l.outstanding > 0);
  const monthly = active.reduce((s, l) => s + l.emi, 0);
  const debtFree = active.reduce<string | null>((m, l) => (!m || l.payoffDate > m ? l.payoffDate : m), null);
  const open = data.loanOut.find((l) => l.loan.id === openId);

  return (
    <div className="space-y-6 pt-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="h1">Debts</h1>
          <p className="sub mt-1">Loans, card balances and money between friends, in one place.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setLoanForm({ open: true })}><Plus size={17} /> Add loan</button>
      </div>

      <section className="panel p-5 grid grid-cols-2 md:grid-cols-4 gap-5">
        <Stat label="Total owed" value={<Money value={data.liabilities} />} hint="Loans and credit cards" />
        <Stat label="Loan payments" value={<Money value={monthly} />} hint="Every month" />
        <Stat label="Active loans" value={active.length} />
        <Stat label="Loan-free by" value={debtFree ? monthYear(debtFree) : 'Now'} hint={debtFree ? 'At current payments' : undefined} />
      </section>

      <Panel title="Loans" pad={data.loanOut.length > 0}>
        {data.loanOut.length === 0 ? (
          <Empty icon={<Landmark size={22} />} title="No loans recorded" body="Add a mortgage, car or personal loan to see its payoff date, interest and what a prepayment would save."
            action={<button className="btn-primary" onClick={() => setLoanForm({ open: true })}><Plus size={17} /> Add a loan</button>} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.loanOut.map((l) => <li key={l.loan.id}><LoanCard l={l} onOpen={() => setOpenId(l.loan.id)} /></li>)}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <PayoffPlanner data={data} />
        <EmiCalculator />
      </div>

      <Ious data={data} />

      {open && <LoanDetail key={open.loan.id} l={open} onClose={() => setOpenId(null)} onEdit={() => setLoanForm({ open: true, loan: open.loan })} />}
      <LoanForm key={loanForm.n} open={loanForm.open} loan={loanForm.loan} onClose={() => setLoanForm({ open: false })} />
    </div>
  );
}

function LoanCard({ l, onOpen }: { l: LoanOut; onOpen: () => void }) {
  const repaid = l.loan.principal ? (l.loan.principal - l.outstanding) / l.loan.principal : 0;
  const k = KIND[l.loan.kind];
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl border border-line/70 hover:border-primary/40 p-4 transition-colors" aria-label={`${l.loan.name}. Open details`}>
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-xl bg-sunk grid place-items-center text-primary shrink-0" aria-hidden>{k.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate">{l.loan.name}</p>
          <p className="text-xs text-muted truncate">{l.loan.lender} · {k.label}</p>
        </div>
        <div className="text-right">
          <Money value={l.outstanding} className="font-extrabold" />
          <p className="text-xs text-muted">left to pay</p>
        </div>
      </div>
      <div className="mt-4">
        <Bar value={repaid} colour="rgb(var(--good))" />
        <p className="text-xs text-muted mt-1.5"><span className="font-semibold text-ink num">{Math.round(repaid * 100)}%</span> of principal repaid</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Def label="Monthly"><Money value={l.emi} /></Def>
        <Def label="Rate">{l.loan.annualRate}%</Def>
        <Def label="Time left">{duration(l.monthsLeft)}</Def>
        <Def label="Paid off">{monthYear(l.payoffDate)}</Def>
      </dl>
    </button>
  );
}

function Def({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold num">{children}</dd>
    </div>
  );
}

function LoanDetail({ l, onClose, onEdit }: { l: LoanOut; onClose: () => void; onEdit: () => void }) {
  const fmt = useFmt();
  const toast = useUI((s) => s.toast);
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState<'balance' | 'split'>('balance');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const step = niceStep(l.outstanding);
  const [prepay, setPrepay] = useState(() => Math.min(l.outstanding, Math.round(l.outstanding / 10 / step) * step));
  const [prepayText, setPrepayText] = useState<string | null>(null);
  const sim = useMemo(() => (prepay > 0 ? simulatePrepayment(l.loan, prepay, now) : null), [l.loan, prepay, now]);

  const years = useMemo(() => {
    const map = new Map<number, { year: number; rows: AmortRow[]; interest: number; principal: number; prepay: number; balance: number }>();
    for (const r of l.rows) {
      const y = localDate(r.date).getFullYear();
      const e = map.get(y) ?? { year: y, rows: [], interest: 0, principal: 0, prepay: 0, balance: 0 };
      e.rows.push(r); e.interest += r.interest; e.principal += r.principal; e.prepay += r.prepay; e.balance = r.balance;
      map.set(y, e);
    }
    return [...map.values()];
  }, [l.rows]);
  const chart = [{ year: String(localDate(l.loan.startDate).getFullYear()), balance: l.loan.principal, interest: 0, principal: 0 },
    ...years.map((y) => ({ year: String(y.year), balance: y.balance, interest: y.interest, principal: y.principal + y.prepay }))];
  const PER = 5;
  const pages = Math.ceil(years.length / PER);
  const thisYear = now.getFullYear();

  async function record() {
    if (!prepay) return;
    await db.loans.update(l.loan.id, { prepayments: [...l.loan.prepayments, { date: isoDate(now), amount: prepay }] });
    toast(`Recorded a ${fmt(prepay)} prepayment`);
  }
  async function remove() {
    await db.loans.delete(l.loan.id);
    toast(`Deleted ${l.loan.name}`, async () => { await db.loans.put(l.loan); });
    onClose();
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} wide title={l.loan.name} description={`${l.loan.lender} · ${l.loan.annualRate}% a year · ${duration(l.loan.tenureMonths)} term`}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Left to pay" value={<Money value={l.outstanding} />} />
          <Stat label="Monthly payment" value={<Money value={l.emi} />} />
          <Stat label="Total interest" value={<Money value={l.totalInterest} />} hint={l.interestSaved > 0 ? <>Saved <Money value={l.interestSaved} /> so far</> : 'Over the whole loan'} />
          <Stat label="Paid off" value={monthYear(l.payoffDate)} hint={`${duration(l.monthsLeft)} to go`} />
        </div>

        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="font-bold text-sm">Schedule</h3>
            <Segmented label="Chart view" value={view} onChange={setView} options={[{ value: 'balance', label: 'Balance' }, { value: 'split', label: 'Interest vs principal' }]} />
          </div>
          <div className="h-52 -mx-2">
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="lb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--primary))" stopOpacity={0.35} /><stop offset="1" stopColor="rgb(var(--primary))" stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} minTickGap={16} />
                <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(v) => fmt(Number(v), { compact: true })} />
                <Tooltip contentStyle={tipStyle} formatter={(v, n) => [fmt(Number(v ?? 0)), n === 'balance' ? 'Balance at year end' : n === 'interest' ? 'Interest' : 'Principal']} />
                {view === 'balance' ? (
                  <Area type="monotone" dataKey="balance" stroke="rgb(var(--primary))" strokeWidth={2.5} fill="url(#lb)" />
                ) : (
                  <>
                    <Area type="monotone" dataKey="principal" stackId="1" stroke="rgb(var(--good))" fill="rgb(var(--good))" fillOpacity={0.35} />
                    <Area type="monotone" dataKey="interest" stackId="1" stroke="rgb(var(--bad))" fill="rgb(var(--bad))" fillOpacity={0.3} />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {view === 'split' && (
            <div className="flex gap-4 text-xs text-muted mt-1">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-good/60" />Principal (bottom)</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-bad/50" />Interest (top)</span>
            </div>
          )}
        </section>

        <section>
          <h3 className="font-bold text-sm mb-2">Amortisation table</h3>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm num">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="font-semibold py-2 px-1">Year</th>
                  <th scope="col" className="font-semibold py-2 px-1 text-right">Principal</th>
                  <th scope="col" className="font-semibold py-2 px-1 text-right">Interest</th>
                  <th scope="col" className="font-semibold py-2 px-1 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {years.slice(page * PER, page * PER + PER).map((y) => (
                  <Fragment key={y.year}>
                    <tr className="border-t border-line/70">
                      <td className="py-2 px-1">
                        <button className="inline-flex items-center gap-1 font-semibold" aria-expanded={expanded === y.year} onClick={() => setExpanded(expanded === y.year ? null : y.year)}>
                          {expanded === y.year ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{y.year}
                          {y.year < thisYear && <span className="text-[11px] font-semibold text-muted bg-sunk rounded-md px-1.5 ml-1">Paid</span>}
                          {y.year === thisYear && <span className="text-[11px] font-semibold text-primary bg-primary/10 rounded-md px-1.5 ml-1">This year</span>}
                        </button>
                      </td>
                      <td className="py-2 px-1 text-right money">{fmt(y.principal + y.prepay)}</td>
                      <td className="py-2 px-1 text-right money">{fmt(y.interest)}</td>
                      <td className="py-2 px-1 text-right money font-semibold">{fmt(y.balance)}</td>
                    </tr>
                    {expanded === y.year && y.rows.map((r) => (
                      <tr key={r.n} className="text-xs text-muted bg-sunk/50">
                        <td className="py-1.5 px-1 pl-6">{localDate(r.date).toLocaleDateString(undefined, { month: 'short' })}{r.prepay > 0 && <span className="ml-1 text-good font-semibold">+ prepaid</span>}</td>
                        <td className="py-1.5 px-1 text-right money">{fmt(r.principal + r.prepay)}</td>
                        <td className="py-1.5 px-1 text-right money">{fmt(r.interest)}</td>
                        <td className="py-1.5 px-1 text-right money">{fmt(r.balance)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between mt-2">
              <button className="btn-ghost h-9 w-9 p-0" aria-label="Previous years" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button>
              <span className="text-xs text-muted">Page {page + 1} of {pages}</span>
              <button className="btn-ghost h-9 w-9 p-0" aria-label="Next years" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button>
            </div>
          )}
        </section>

        {l.outstanding > 0 && (
          <section className="rounded-2xl bg-sunk/60 p-4">
            <h3 className="font-bold text-sm">What if you prepay?</h3>
            <div className="flex items-center gap-3 mt-3">
              <label htmlFor="prepay" className="sr-only">One-time prepayment</label>
              <input id="prepay" type="range" min={0} max={l.outstanding} step={step} value={prepay} onChange={(e) => { setPrepay(Number(e.target.value)); setPrepayText(null); }}
                className="flex-1 accent-[rgb(var(--primary))]" aria-valuetext={fmt(prepay)} />
              <label htmlFor="prepay-amt" className="sr-only">Prepayment amount</label>
              <input id="prepay-amt" className="field num w-32 h-10" inputMode="decimal" value={prepayText ?? String(prepay / 100)}
                onChange={(e) => { setPrepayText(e.target.value); const v = parseAmount(e.target.value); if (v !== null) setPrepay(Math.max(0, Math.min(l.outstanding, v))); }} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4" aria-live="polite">
              <Stat label="Interest saved" value={<Money value={sim?.interestSaved ?? 0} className="text-good" />} />
              <Stat label="Time saved" value={sim ? (sim.monthsSaved > 0 ? duration(sim.monthsSaved) : 'Under a month') : '—'} />
              <Stat label="New payoff" value={sim ? monthYear(sim.newPayoff) : monthYear(l.payoffDate)} />
            </div>
            <button className="btn-primary w-full mt-4" disabled={!prepay} onClick={record}>Record this prepayment</button>
            <p className="text-xs text-muted mt-2">Your monthly payment stays the same and the loan ends sooner, which is how most lenders apply prepayments.</p>
          </section>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line/70 pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2 flex-wrap" role="alert">
              <span className="text-sm font-semibold">Delete this loan?</span>
              <button className="btn h-9 bg-bad text-white" onClick={remove}>Delete</button>
              <button className="btn-ghost h-9" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          ) : (
            <button className="btn-ghost h-9 text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete</button>
          )}
          <button className="btn-soft h-9" onClick={onEdit}><Pencil size={15} /> Edit loan</button>
        </div>
      </div>
    </Sheet>
  );
}

function LoanForm({ open, loan, onClose }: { open: boolean; loan?: Loan; onClose: () => void }) {
  const [name, setName] = useState(loan?.name ?? '');
  const [lender, setLender] = useState(loan?.lender ?? '');
  const [kind, setKind] = useState<Loan['kind']>(loan?.kind ?? 'personal');
  const [principal, setPrincipal] = useState(loan ? String(loan.principal / 100) : '');
  const [rate, setRate] = useState(loan ? String(loan.annualRate) : '');
  const [tenure, setTenure] = useState(loan ? String(loan.tenureMonths) : '60');
  const [start, setStart] = useState(loan?.startDate ?? isoDate(new Date()));
  const p = parseAmount(principal);
  const r = Number(rate);
  const t = Math.round(Number(tenure));
  const valid = name.trim() && p && p > 0 && rate !== '' && r >= 0 && r < 100 && t > 0 && t <= 600 && start;

  async function save() {
    if (!valid) return;
    await db.loans.put({ id: loan?.id ?? uid(), name: name.trim(), lender: lender.trim() || 'Lender', kind, principal: p!, annualRate: r, tenureMonths: t, startDate: start, prepayments: loan?.prepayments ?? [] });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={loan ? 'Edit loan' : 'Add loan'} description="Use the amount you originally borrowed. Tandem works out what is left.">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="l-name">Name</label>
          <input id="l-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Car loan" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="l-lender">Lender</label>
            <input id="l-lender" className="field" value={lender} onChange={(e) => setLender(e.target.value)} placeholder="Bank name" />
          </div>
          <div>
            <label className="label" htmlFor="l-kind">Type</label>
            <select id="l-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as Loan['kind'])}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="l-principal">Amount borrowed</label>
            <input id="l-principal" className="field num" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="20000" />
          </div>
          <div>
            <label className="label" htmlFor="l-rate">Rate (% a year)</label>
            <input id="l-rate" className="field num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="8.5" />
          </div>
          <div>
            <label className="label" htmlFor="l-tenure">Term (months)</label>
            <input id="l-tenure" className="field num" inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="l-start">First payment month starts</label>
          <input id="l-start" type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {valid && <p className="text-sm text-muted">Monthly payment about <Money value={emi(p!, r, t)} className="font-bold text-ink" />.</p>}
        <button className="btn-primary w-full" disabled={!valid} onClick={save}>{loan ? 'Save changes' : 'Add loan'}</button>
      </div>
    </Sheet>
  );
}

function EmiCalculator() {
  const fmt = useFmt();
  const [principal, setPrincipal] = useState(25_000_00);
  const [rate, setRate] = useState(8.5);
  const [months, setMonths] = useState(60);
  const pay = emi(principal, rate, months);
  const total = pay * months;
  const interest = Math.max(0, total - principal);
  const pie = [{ name: 'Principal', value: principal, colour: 'rgb(var(--primary))' }, { name: 'Interest', value: interest, colour: 'rgb(var(--warn))' }];
  const pStep = niceStep(principal);

  return (
    <Panel title={<span className="flex items-center gap-2"><Calculator size={18} className="text-primary" /> Loan payment calculator</span>}>
      <div className="space-y-4">
        <SliderRow id="emi-p" label="Amount" display={fmt(principal)} min={pStep} max={Math.max(principal * 2, 100_000_00)} step={pStep} value={principal} onChange={setPrincipal} />
        <SliderRow id="emi-r" label="Interest rate" display={`${rate.toFixed(1)}% a year`} min={0} max={30} step={0.1} value={rate} onChange={setRate} />
        <SliderRow id="emi-t" label="Term" display={duration(months)} min={6} max={360} step={6} value={months} onChange={setMonths} />
        <div className="flex items-center gap-5 pt-2">
          <div className="h-32 w-32 shrink-0" aria-hidden>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius={40} outerRadius={60} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {pie.map((p) => <Cell key={p.name} fill={p.colour} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 min-w-0" aria-live="polite">
            <div>
              <p className="text-[13px] font-semibold text-muted">Monthly payment</p>
              <Money value={pay} className="display text-[32px] block" />
            </div>
            <p className="text-sm flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary shrink-0" />Principal <Money value={principal} className="font-bold" /></p>
            <p className="text-sm flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-warn shrink-0" />Interest <Money value={interest} className="font-bold" /> ({total ? Math.round((interest / total) * 100) : 0}%)</p>
            <p className="text-xs text-muted">You would repay <Money value={total} /> in total.</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SliderRow({ id, label, display, min, max, step, value, onChange }: { id: string; label: string; display: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        <span className="font-bold num money">{display}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 accent-[rgb(var(--primary))]" aria-valuetext={display} />
    </div>
  );
}

function PayoffPlanner({ data }: { data: Data }) {
  const fmt = useFmt();
  const debts: DebtPlanItem[] = useMemo(() => [
    ...data.loanOut.filter((l) => l.outstanding > 0).map((l) => ({ id: l.loan.id, name: l.loan.name, balance: l.outstanding, rate: l.loan.annualRate, minPayment: l.emi })),
    ...data.accounts.filter((a) => a.type === 'credit' && !a.archived && (data.balances.get(a.id) ?? 0) < 0).map((a) => {
      const bal = -(data.balances.get(a.id) ?? 0);
      return { id: a.id, name: a.name, balance: bal, rate: 22, minPayment: Math.max(1, Math.round(bal * 0.03)) };
    }),
  ], [data.loanOut, data.accounts, data.balances]);
  const minimums = debts.reduce((s, d) => s + d.minPayment, 0);
  const step = niceStep(minimums);
  const [budget, setBudget] = useState<number | null>(null);
  const b = budget ?? Math.ceil((minimums * 1.1) / step) * step;
  const plans = useMemo(() => ({
    snowball: payoffPlan(debts, b, 'snowball'),
    avalanche: payoffPlan(debts, b, 'avalanche'),
  }), [debts, b]);
  const now = new Date();
  const name = (id: string) => debts.find((d) => d.id === id)?.name ?? id;

  if (debts.length === 0) {
    return (
      <Panel title="Snowball or avalanche">
        <p className="sub">When you have loans or card balances, this compares two ways to pay them off and shows which costs less.</p>
      </Panel>
    );
  }
  const diff = plans.snowball.interest - plans.avalanche.interest;
  const winner = diff > 0 ? 'avalanche' : diff < 0 ? 'snowball' : null;
  const unfinished = (m: number) => m >= 600;

  return (
    <Panel title="Snowball or avalanche">
      <div className="space-y-4">
        <SliderRow id="debt-budget" label="Monthly amount for debts" display={fmt(b)} min={minimums} max={Math.max(minimums * 3, minimums + step * 10)} step={step} value={b} onChange={setBudget} />
        <p className="text-xs text-muted -mt-2">Minimum payments add up to <Money value={minimums} className="font-semibold" />. Credit cards assume 22% interest and a 3% minimum.</p>
        <div className="grid grid-cols-2 gap-3">
          {(['snowball', 'avalanche'] as const).map((k) => {
            const p = plans[k];
            const best = winner === k;
            return (
              <div key={k} className={`rounded-2xl p-3.5 border ${best ? 'border-good bg-good/5' : 'border-line/70'}`}>
                <p className="font-bold text-sm flex items-center gap-1.5">
                  {k === 'snowball' ? <Snowflake size={15} aria-hidden /> : <Mountain size={15} aria-hidden />}
                  {k === 'snowball' ? 'Snowball' : 'Avalanche'}
                </p>
                <p className="text-xs text-muted">{k === 'snowball' ? 'Smallest balance first' : 'Highest rate first'}</p>
                {best && <p className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-good"><Check size={13} /> Costs less</p>}
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div><dt className="text-xs text-muted">Debt-free</dt><dd className="font-bold">{unfinished(p.months) ? 'Over 50 years' : `${monthYear(addMonths(now, p.months))} (${duration(p.months)})`}</dd></div>
                  <div><dt className="text-xs text-muted">Total interest</dt><dd className="font-bold"><Money value={p.interest} /></dd></div>
                </dl>
                <ol className="mt-2 text-xs space-y-0.5 list-decimal list-inside text-muted">
                  {p.payoffOrder.map((id) => <li key={id} className="truncate"><span className="text-ink">{name(id)}</span></li>)}
                </ol>
              </div>
            );
          })}
        </div>
        <p className="text-sm" aria-live="polite">
          {winner ? <>The <b>{winner}</b> method saves <Money value={Math.abs(diff)} className="font-bold" /> in interest
            {plans.snowball.months !== plans.avalanche.months && <> and finishes {Math.abs(plans.snowball.months - plans.avalanche.months)} month{Math.abs(plans.snowball.months - plans.avalanche.months) > 1 ? 's' : ''} {(winner === 'avalanche' ? plans.avalanche.months < plans.snowball.months : plans.snowball.months < plans.avalanche.months) ? 'sooner' : 'later'}</>}.
            {winner === 'avalanche' && ' Snowball still works well if quick wins keep you motivated.'}</>
            : 'Both methods cost the same with these debts.'}
        </p>
      </div>
    </Panel>
  );
}

function Ious({ data }: { data: Data }) {
  const fmt = useFmt();
  const toast = useUI((s) => s.toast);
  const [form, setFormState] = useState<{ open: boolean; iou?: IOU; n: number }>({ open: false, n: 0 });
  const setForm = (f: { open: boolean; iou?: IOU }) => setFormState((c) => ({ ...f, n: c.n + 1 }));
  const [showSettled, setShowSettled] = useState(false);
  const openIous = data.ious.filter((i) => !i.settled).sort((a, b) => b.date.localeCompare(a.date));
  const owed = openIous.filter((i) => i.amount > 0);
  const owe = openIous.filter((i) => i.amount < 0);
  const settled = data.ious.filter((i) => i.settled);

  async function copy(i: IOU) {
    const what = i.note ? ` for ${i.note.charAt(0).toLowerCase()}${i.note.slice(1)}` : '';
    const text = `Hi ${i.person}, just a reminder about the ${fmt(Math.abs(i.amount))}${what} 🙂`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Reminder copied. Paste it into a message.');
    } catch {
      toast('Could not copy. Your browser blocked the clipboard.');
    }
  }
  async function settle(i: IOU, v = true) {
    await db.ious.update(i.id, { settled: v });
    if (v) toast(`Marked as settled with ${i.person}`, async () => { await db.ious.update(i.id, { settled: false }); });
  }

  const Row = ({ i }: { i: IOU }) => (
    <li className="flex items-center gap-3 py-3">
      <span className="h-9 w-9 rounded-full bg-sunk grid place-items-center font-bold text-sm shrink-0" aria-hidden>{i.person.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate">{i.person}</p>
        <p className="text-xs text-muted truncate">{i.note || 'No note'} · {localDate(i.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
      </div>
      <Money value={Math.abs(i.amount)} className="font-bold text-sm" />
      <div className="flex">
        {i.amount > 0 && <button className="btn-ghost h-9 w-9 p-0" aria-label={`Copy a reminder for ${i.person}`} title="Copy reminder" onClick={() => copy(i)}><Copy size={16} /></button>}
        <button className="btn-ghost h-9 w-9 p-0" aria-label={`Edit entry for ${i.person}`} onClick={() => setForm({ open: true, iou: i })}><Pencil size={16} /></button>
        <button className="btn-ghost h-9 w-9 p-0" aria-label={`Mark ${i.person} as settled`} title="Settle" onClick={() => settle(i)}><Check size={16} /></button>
      </div>
    </li>
  );

  return (
    <Panel title={<span className="flex items-center gap-2"><HandCoins size={18} className="text-primary" /> Money lent and borrowed</span>}
      action={<button className="btn-soft h-9" onClick={() => setForm({ open: true })}><Plus size={16} /> Add</button>}>
      {openIous.length === 0 ? (
        <p className="sub">Nothing outstanding. When you cover someone’s ticket or borrow for a cab, add it here so nobody forgets.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between"><h3 className="font-bold text-sm">They owe you</h3><Money value={owed.reduce((s, i) => s + i.amount, 0)} className="font-bold text-good" /></div>
            {owed.length ? <ul className="divide-y divide-line/70">{owed.map((i) => <Row key={i.id} i={i} />)}</ul> : <p className="sub py-3">No one owes you right now.</p>}
          </div>
          <div>
            <div className="flex items-baseline justify-between"><h3 className="font-bold text-sm">You owe</h3><Money value={owe.reduce((s, i) => s - i.amount, 0)} className="font-bold" /></div>
            {owe.length ? <ul className="divide-y divide-line/70">{owe.map((i) => <Row key={i.id} i={i} />)}</ul> : <p className="sub py-3">You do not owe anyone.</p>}
          </div>
        </div>
      )}
      {settled.length > 0 && (
        <div className="mt-4 border-t border-line/70 pt-3">
          <button className="text-sm font-semibold text-muted inline-flex items-center gap-1" aria-expanded={showSettled} onClick={() => setShowSettled(!showSettled)}>
            {showSettled ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Settled ({settled.length})
          </button>
          {showSettled && (
            <ul className="mt-2 divide-y divide-line/70">
              {settled.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 truncate">{i.person} · <span className="text-muted">{i.note}</span> <span className="text-xs text-muted">({i.amount > 0 ? 'they paid you' : 'you paid'})</span></span>
                  <Money value={Math.abs(i.amount)} className="text-muted" />
                  <button className="btn-ghost h-8 px-2 text-[13px]" onClick={() => settle(i, false)}>Reopen</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <IouForm key={form.n} open={form.open} iou={form.iou} onClose={() => setForm({ open: false })} />
    </Panel>
  );
}

function IouForm({ open, iou, onClose }: { open: boolean; iou?: IOU; onClose: () => void }) {
  const [dir, setDir] = useState<'owed' | 'owe'>(iou && iou.amount < 0 ? 'owe' : 'owed');
  const [person, setPerson] = useState(iou?.person ?? '');
  const [amount, setAmount] = useState(iou ? String(Math.abs(iou.amount) / 100) : '');
  const [note, setNote] = useState(iou?.note ?? '');
  const [date, setDate] = useState(iou?.date ?? isoDate(new Date()));
  const a = parseAmount(amount);
  const valid = person.trim() && a && a > 0;

  async function save() {
    if (!valid) return;
    await db.ious.put({ id: iou?.id ?? uid(), person: person.trim(), amount: dir === 'owed' ? a! : -a!, note: note.trim(), date, settled: iou?.settled ?? false });
    onClose();
  }
  async function remove() {
    if (iou) await db.ious.delete(iou.id);
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={iou ? 'Edit entry' : 'Add money lent or borrowed'}>
      <div className="space-y-4">
        <Segmented label="Direction" value={dir} onChange={setDir} options={[{ value: 'owed', label: 'They owe me' }, { value: 'owe', label: 'I owe them' }]} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="i-person">Person</label>
            <input id="i-person" className="field" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <label className="label" htmlFor="i-amount">Amount</label>
            <input id="i-amount" className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="i-note">What for</label>
          <input id="i-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, concert tickets" />
        </div>
        <div>
          <label className="label" htmlFor="i-date">Date</label>
          <input id="i-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={!valid} onClick={save}>{iou ? 'Save changes' : 'Add'}</button>
        {iou && <button className="btn-ghost w-full text-bad" onClick={remove}><Trash2 size={16} /> Delete entry</button>}
      </div>
    </Sheet>
  );
}
