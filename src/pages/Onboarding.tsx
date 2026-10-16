import { ArrowLeft, Plus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { db, uid } from '../db/db';
import { saveProfile } from '../db/hooks';
import { DEFAULT_CATEGORIES, PALETTE, defaultProfile, seedDemo } from '../db/seed';
import type { Account, BudgetStyle, Member, Role } from '../db/types';
import { fiftyThirtyTwenty } from '../lib/finance';
import { CurrencySelect, guessCurrency } from '../components/CurrencySelect';
import { formatMoney, toMinor } from '../lib/money';
import iconUrl from '../assets/icon.svg';

const STYLES: { id: BudgetStyle; name: string; body: string }[] = [
  { id: 'envelope', name: 'Envelopes', body: 'Give each category a monthly amount. Unused money can roll over.' },
  { id: 'zero-based', name: 'Zero-based', body: 'Assign every unit of income a job until nothing is left unplanned.' },
  { id: '50-30-20', name: '50 / 30 / 20', body: 'Half on needs, 30% on wants, 20% to savings. Least effort.' },
  { id: 'caps', name: 'Simple caps', body: 'Only set limits on the few categories you want to watch.' },
];
const GOALS = ['Emergency fund', 'Pay off debt', 'Buy a home', 'Kids’ education', 'Retirement', 'Travel', 'New car', 'Start investing'];
const STEPS = ['You', 'Household', 'Money', 'Style', 'Goals'];

/** Default monthly envelope split as a share of income, per category. */
const SHARE: Record<string, number> = { housing: 0.28, groceries: 0.1, utilities: 0.05, transport: 0.06, health: 0.03, dining: 0.05, shopping: 0.05, entertainment: 0.03, subscriptions: 0.01, gifts: 0.02 };

export default function Onboarding() {
  const guessCur = guessCurrency();
  const [step, setStep] = useState(-1);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<{ name: string; role: Role }[]>([]);
  const [currency, setCurrency] = useState(guessCur);
  const [income, setIncome] = useState('');
  const [bank, setBank] = useState('');
  const [card, setCard] = useState(true);
  const [style, setStyle] = useState<BudgetStyle>('envelope');
  const [goals, setGoals] = useState<string[]>(['Emergency fund']);
  const [busy, setBusy] = useState(false);

  async function demo() {
    setBusy(true);
    await seedDemo(currency);
  }

  async function finish() {
    setBusy(true);
    const all: Member[] = [
      { id: uid(), name: name || 'Me', role: 'owner', age: 'adult', colour: PALETTE[0] },
      ...members.filter((m) => m.name.trim()).map((m, i) => ({
        id: uid(), name: m.name.trim(), role: m.role, age: (m.role === 'child' ? 'child' : m.role === 'teen' ? 'teen' : 'adult') as Member['age'], colour: PALETTE[(i + 1) % PALETTE.length],
      })),
    ];
    const owners = all.filter((m) => m.age === 'adult').map((m) => m.id);
    const accounts: Account[] = [
      { id: uid(), name: 'Main account', type: 'bank', currency, openingBalance: toMinor(bank || 0), ownerIds: owners, shared: true, colour: PALETTE[0], icon: 'landmark', archived: false },
      { id: uid(), name: 'Cash', type: 'cash', currency, openingBalance: 0, ownerIds: owners, shared: true, colour: PALETTE[1], icon: 'wallet', archived: false },
    ];
    if (card) accounts.push({ id: uid(), name: 'Credit card', type: 'credit', currency, openingBalance: 0, ownerIds: owners, shared: false, colour: PALETTE[2], icon: 'credit-card', archived: false });
    const inc = toMinor(income || 0);
    const split = fiftyThirtyTwenty(inc);
    const budgets = style === 'caps'
      ? ['dining', 'shopping', 'entertainment'].map((c) => ({ id: uid(), categoryId: c, amount: Math.round(inc * SHARE[c]), rollover: false }))
      : Object.entries(SHARE).map(([c, s]) => ({ id: uid(), categoryId: c, amount: Math.round(inc * s), rollover: style === 'envelope' }));
    await db.transaction('rw', [db.members, db.accounts, db.categories, db.budgets, db.goals, db.settings], async () => {
      await db.members.bulkPut(all);
      await db.accounts.bulkPut(accounts);
      await db.categories.bulkPut(DEFAULT_CATEGORIES);
      if (inc) await db.budgets.bulkPut(budgets);
      await db.goals.bulkPut(goals.map((g, i) => ({
        id: uid(), name: g, emoji: ['🛟', '🏦', '🏡', '🎓', '🌅', '✈️', '🚗', '📈'][GOALS.indexOf(g)] ?? '🎯',
        target: g === 'Emergency fund' ? split.needs * 6 : inc * 6, saved: 0,
        targetDate: new Date(new Date().getFullYear() + 1 + i, new Date().getMonth(), 1).toISOString().slice(0, 10), priority: (Math.min(3, i + 1)) as 1, contributions: [],
      })));
    });
    await saveProfile({ ...defaultProfile(currency), primaryUser: name, budgetStyle: style, topGoals: goals, onboarded: true });
  }

  const sample = (v: string) => formatMoney(toMinor(v || 0), currency);

  if (step === -1) {
    return (
      <div className="min-h-screen bg-bg grid lg:grid-cols-[1.1fr_1fr]">
        <div className="relative overflow-hidden bg-primary text-onprimary p-8 md:p-14 flex flex-col justify-between min-h-[46vh]">
          <WelcomeArt />
          <div className="relative flex items-center gap-2.5"><img src={iconUrl} alt="" className="h-9 w-9 rounded-xl ring-1 ring-white/20" /><span className="text-xl font-extrabold tracking-tight">Tandem</span></div>
          <div className="relative max-w-lg">
            <h1 className="text-[40px] md:text-[56px] font-extrabold tracking-[-0.04em] leading-[0.98]">Run the household’s money together.</h1>
            <p className="mt-4 text-[17px] opacity-80 max-w-md">Budgets, bills, goals and the whole family’s spending in one place. Private by default — your data never leaves this device unless you turn on sync.</p>
          </div>
        </div>
        <div className="p-8 md:p-14 flex flex-col justify-center gap-4 max-w-lg w-full mx-auto">
          <h2 className="text-2xl font-extrabold tracking-tight">Get started</h2>
          <p className="sub -mt-2">Setup takes about two minutes. You can change everything later.</p>
          <button className="btn-primary h-14 text-base" onClick={() => setStep(0)}>Set up my household</button>
          <button className="btn-soft h-14 text-base" onClick={demo} disabled={busy}><Sparkles size={18} /> {busy ? 'Building a demo family…' : 'Explore with demo data'}</button>
          <label className="mt-2 flex items-center gap-3 text-sm text-muted">Currency
            <CurrencySelect className="field h-10 flex-1 min-w-0" value={currency} onChange={setCurrency} />
          </label>
          <p className="text-xs text-muted">Works offline. No accounts, no ads, no trackers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg px-5 py-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <button className="btn-ghost h-10 w-10 p-0" onClick={() => setStep((s) => s - 1)} aria-label="Back"><ArrowLeft size={18} /></button>
          <ol className="flex-1 grid grid-cols-5 gap-1.5" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-col gap-1.5">
                <span className={`h-1.5 rounded-full ${i <= step ? 'bg-primary' : 'bg-line'}`} />
                <span className={`text-[11px] font-semibold ${i === step ? 'text-ink' : 'text-muted'}`} aria-current={i === step ? 'step' : undefined}>{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div key={step} className="animate-rise space-y-5">
          {step === 0 && (<>
            <h1 className="h1">What should we call you?</h1>
            <input autoFocus className="field h-14 text-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" onKeyDown={(e) => e.key === 'Enter' && setStep(1)} />
          </>)}
          {step === 1 && (<>
            <h1 className="h1">Who shares the money?</h1>
            <p className="sub -mt-3">Add a partner, kids or anyone else. Teens and kids get a simple view of just their own allowance and savings jars.</p>
            {members.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input className="field" value={m.name} placeholder="Name" onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <select className="field w-36" value={m.role} onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)))}>
                  <option value="adult">Partner / adult</option><option value="teen">Teen</option><option value="child">Child</option><option value="viewer">View only</option>
                </select>
                <button className="btn-ghost w-11 p-0" aria-label="Remove" onClick={() => setMembers((xs) => xs.filter((_, j) => j !== i))}><X size={18} /></button>
              </div>
            ))}
            <button className="btn-soft" onClick={() => setMembers((xs) => [...xs, { name: '', role: xs.length ? 'child' : 'adult' }])}><Plus size={18} /> Add someone</button>
          </>)}
          {step === 2 && (<>
            <h1 className="h1">A rough picture of your money</h1>
            <p className="sub -mt-3">Ballpark numbers are fine — they set up your starter budget.</p>
            <label className="block"><span className="label">Currency</span>
              <CurrencySelect value={currency} onChange={setCurrency} /></label>
            <label className="block"><span className="label">Household take-home pay per month</span>
              <input inputMode="decimal" className="field num" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="e.g. 6500" />
              {income && <span className="text-xs text-muted num">{sample(income)} a month</span>}</label>
            <label className="block"><span className="label">Balance in your main bank account today</span>
              <input inputMode="decimal" className="field num" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. 3200" /></label>
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={card} onChange={(e) => setCard(e.target.checked)} /> I use a credit card</label>
          </>)}
          {step === 3 && (<>
            <h1 className="h1">How do you like to budget?</h1>
            <div className="grid gap-2" role="radiogroup" aria-label="Budgeting style">
              {STYLES.map((s) => (
                <button key={s.id} role="radio" aria-checked={style === s.id} onClick={() => setStyle(s.id)}
                  className={`text-left rounded-2xl border-2 p-4 transition-colors ${style === s.id ? 'border-primary bg-primary/5' : 'border-line bg-surface hover:border-muted/40'}`}>
                  <p className="font-bold">{s.name}</p><p className="sub">{s.body}</p>
                </button>
              ))}
            </div>
          </>)}
          {step === 4 && (<>
            <h1 className="h1">What are you working towards?</h1>
            <div className="flex flex-wrap gap-2">
              {GOALS.map((g) => <button key={g} className="chip h-10 px-4 text-sm" aria-pressed={goals.includes(g)} onClick={() => setGoals((xs) => (xs.includes(g) ? xs.filter((x) => x !== g) : [...xs, g]))}>{g}</button>)}
            </div>
          </>)}
        </div>

        <div className="mt-10 flex justify-end">
          {step < 4
            ? <button className="btn-primary h-12 px-8" onClick={() => setStep((s) => s + 1)}>Continue</button>
            : <button className="btn-primary h-12 px-8" onClick={finish} disabled={busy}>{busy ? 'Setting up…' : 'Create my household'}</button>}
        </div>
      </div>
    </div>
  );
}

/** Two interweaving streams — the brand motif, echoing the cash-flow river on the home screen. */
function WelcomeArt() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-90" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d={`M-50 ${120 + i * 38} C 200 ${40 + i * 50}, 420 ${420 - i * 22}, 860 ${180 + i * 30}`} fill="none"
          stroke={i % 3 === 0 ? '#F2B45A' : '#7FD1B9'} strokeOpacity={0.12 + (i % 3) * 0.08} strokeWidth={14 - i} strokeLinecap="round" />
      ))}
    </svg>
  );
}
