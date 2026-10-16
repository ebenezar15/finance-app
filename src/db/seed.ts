import { addDays, addMonths, isoDate, startOfMonth } from '../lib/dates';
import { db, setSetting, uid } from './db';
import type {
  Account, Budget, Category, Goal, Holding, IOU, Loan, Member, Profile, RecurringRule, Transaction,
} from './types';

export const PALETTE = ['#0F4C5C', '#E8A33D', '#5B6CF0', '#D6455D', '#2BA37B', '#8A5CF6', '#3B9DD8', '#C76A2B', '#7C8798', '#B0478F'];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'housing', name: 'Housing', emoji: '🏠', colour: '#0F4C5C', kind: 'expense', need: 'essential' },
  { id: 'groceries', name: 'Groceries', emoji: '🛒', colour: '#2BA37B', kind: 'expense', need: 'essential' },
  { id: 'utilities', name: 'Utilities', emoji: '💡', colour: '#3B9DD8', kind: 'expense', need: 'essential' },
  { id: 'transport', name: 'Transport', emoji: '🚗', colour: '#7C8798', kind: 'expense', need: 'essential' },
  { id: 'health', name: 'Health', emoji: '🩺', colour: '#D6455D', kind: 'expense', need: 'essential' },
  { id: 'education', name: 'Education', emoji: '🎓', colour: '#5B6CF0', kind: 'expense', need: 'essential' },
  { id: 'insurance', name: 'Insurance', emoji: '🛡️', colour: '#46607A', kind: 'expense', need: 'essential' },
  { id: 'childcare', name: 'Childcare & help', emoji: '🧸', colour: '#B0478F', kind: 'expense', need: 'essential' },
  { id: 'dining', name: 'Dining out', emoji: '🍽️', colour: '#E8A33D', kind: 'expense', need: 'discretionary' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️', colour: '#8A5CF6', kind: 'expense', need: 'discretionary' },
  { id: 'entertainment', name: 'Entertainment', emoji: '🎬', colour: '#C76A2B', kind: 'expense', need: 'discretionary' },
  { id: 'subscriptions', name: 'Subscriptions', emoji: '🔁', colour: '#6C7BD9', kind: 'expense', need: 'discretionary' },
  { id: 'travel', name: 'Travel', emoji: '✈️', colour: '#1F8FA6', kind: 'expense', need: 'discretionary' },
  { id: 'gifts', name: 'Gifts & giving', emoji: '🎁', colour: '#D97A9A', kind: 'expense', need: 'discretionary' },
  { id: 'pocket', name: 'Pocket money', emoji: '🪙', colour: '#C9A227', kind: 'expense', need: 'discretionary' },
  { id: 'loan', name: 'Loan repayments', emoji: '🏦', colour: '#5E6B7D', kind: 'expense', need: 'essential' },
  { id: 'investing', name: 'Investing', emoji: '📈', colour: '#2BA37B', kind: 'expense', need: 'savings' },
  { id: 'salary', name: 'Salary', emoji: '💼', colour: '#2BA37B', kind: 'income', need: 'essential' },
  { id: 'freelance', name: 'Side income', emoji: '🧑‍💻', colour: '#5B6CF0', kind: 'income', need: 'essential' },
  { id: 'interest', name: 'Interest & dividends', emoji: '🌱', colour: '#1F8FA6', kind: 'income', need: 'essential' },
];

/** Rough cost-of-living multiplier per currency (relative to USD), so demo numbers feel local. */
const SCALE: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.8, INR: 30, AED: 3.6, SGD: 1.35, AUD: 1.5, CAD: 1.35, JPY: 150, CHF: 0.9, ZAR: 18, BRL: 5 };

export const defaultProfile = (currency = 'USD'): Profile => ({
  appName: 'Tandem',
  primaryUser: '',
  currency,
  budgetStyle: 'envelope',
  fyStartMonth: currency === 'INR' ? 3 : currency === 'GBP' ? 3 : 0,
  topGoals: [],
  onboarded: false,
  dashboardCards: ['flow', 'budgets', 'bills', 'goals', 'trend', 'networth', 'insights'].map((id) => ({ id, hidden: false })),
});

/** Deterministic PRNG so demo data (and tests that use it) are stable. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(currency = 'USD', now = new Date()) {
  const k = SCALE[currency] ?? 1;
  const m = (usd: number) => Math.round(usd * k) * 100; // major USD → local minor units
  const r = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const jitter = (base: number, spread = 0.35) => Math.round(base * (1 - spread + r() * spread * 2));

  const members: Member[] = [
    { id: 'm-alex', name: 'Alex', role: 'owner', age: 'adult', colour: '#0F4C5C' },
    { id: 'm-sam', name: 'Sam', role: 'adult', age: 'adult', colour: '#E8A33D' },
    { id: 'm-maya', name: 'Maya', role: 'teen', age: 'teen', colour: '#5B6CF0', allowance: m(40) },
    { id: 'm-leo', name: 'Leo', role: 'child', age: 'child', colour: '#2BA37B', allowance: m(15) },
  ];
  const accounts: Account[] = [
    { id: 'a-checking', name: 'Everyday checking', type: 'bank', currency, openingBalance: m(4200), ownerIds: ['m-alex', 'm-sam'], shared: true, colour: '#0F4C5C', icon: 'landmark', archived: false, last4: '1234' },
    { id: 'a-savings', name: 'High-yield savings', type: 'bank', currency, openingBalance: m(9500), ownerIds: ['m-alex', 'm-sam'], shared: true, colour: '#2BA37B', icon: 'piggy-bank', archived: false, last4: '5521' },
    { id: 'a-card', name: 'Rewards credit card', type: 'credit', currency, openingBalance: 0, ownerIds: ['m-alex'], shared: false, colour: '#5B6CF0', icon: 'credit-card', archived: false, last4: '9876', creditLimit: m(8000), dueDay: 18 },
    { id: 'a-cash', name: 'Cash wallet', type: 'cash', currency, openingBalance: m(120), ownerIds: ['m-sam'], shared: true, colour: '#E8A33D', icon: 'wallet', archived: false },
    { id: 'a-home', name: 'Home (estimated)', type: 'asset', currency, openingBalance: m(310000), ownerIds: ['m-alex', 'm-sam'], shared: true, colour: '#7C8798', icon: 'home', archived: false },
  ];

  const start = addMonths(startOfMonth(now), -11);
  const rules: RecurringRule[] = [
    { id: 'r-salary-a', name: 'Salary — Alex', type: 'income', amount: m(5200), estimated: false, categoryId: 'salary', accountId: 'a-checking', freq: 'monthly', day: 1, startDate: isoDate(start), autoPost: true, isSubscription: false },
    { id: 'r-salary-s', name: 'Salary — Sam', type: 'income', amount: m(3400), estimated: false, categoryId: 'salary', accountId: 'a-checking', freq: 'monthly', day: 15, startDate: isoDate(start), autoPost: true, isSubscription: false },
    { id: 'r-mortgage', name: 'Mortgage payment', type: 'expense', amount: m(1650), estimated: false, categoryId: 'loan', accountId: 'a-checking', freq: 'monthly', day: 5, startDate: isoDate(start), autoPost: true, isSubscription: false },
    { id: 'r-power', name: 'City Power & Light', type: 'expense', amount: m(140), estimated: true, categoryId: 'utilities', accountId: 'a-checking', freq: 'monthly', day: 12, startDate: isoDate(start), autoPost: false, isSubscription: false },
    { id: 'r-internet', name: 'FiberNet broadband', type: 'expense', amount: m(65), estimated: false, categoryId: 'utilities', accountId: 'a-card', freq: 'monthly', day: 9, startDate: isoDate(start), autoPost: true, isSubscription: true },
    { id: 'r-netflix', name: 'Netflix', type: 'expense', amount: m(15.49), estimated: false, categoryId: 'subscriptions', accountId: 'a-card', freq: 'monthly', day: 21, startDate: isoDate(start), autoPost: true, isSubscription: true },
    { id: 'r-spotify', name: 'Spotify Family', type: 'expense', amount: m(16.99), estimated: false, categoryId: 'subscriptions', accountId: 'a-card', freq: 'monthly', day: 3, startDate: isoDate(start), autoPost: true, isSubscription: true },
    { id: 'r-gym', name: 'PulseFit gym', type: 'expense', amount: m(49), estimated: false, categoryId: 'health', accountId: 'a-card', freq: 'monthly', day: 26, startDate: isoDate(start), autoPost: true, isSubscription: true },
    { id: 'r-school', name: 'School fees', type: 'expense', amount: m(1200), estimated: false, categoryId: 'education', accountId: 'a-checking', freq: 'quarterly', day: 10, startDate: isoDate(start), autoPost: false, isSubscription: false },
    { id: 'r-insurance', name: 'Family health insurance', type: 'expense', amount: m(310), estimated: false, categoryId: 'insurance', accountId: 'a-checking', freq: 'monthly', day: 20, startDate: isoDate(start), autoPost: true, isSubscription: false },
    { id: 'r-invest', name: 'Index fund auto-invest', type: 'expense', amount: m(600), estimated: false, categoryId: 'investing', accountId: 'a-checking', freq: 'monthly', day: 2, startDate: isoDate(start), autoPost: true, isSubscription: false },
    { id: 'r-cloud', name: 'iCloud+ 2TB', type: 'expense', amount: m(9.99), estimated: false, categoryId: 'subscriptions', accountId: 'a-card', freq: 'monthly', day: 14, startDate: isoDate(start), autoPost: true, isSubscription: true },
  ];

  const txs: Transaction[] = [];
  const add = (t: Partial<Transaction> & Pick<Transaction, 'date' | 'amount' | 'type' | 'accountId'>) =>
    txs.push({
      id: uid(), currency, tags: [], source: 'manual', needsReview: false, createdAt: Date.now(), updatedAt: Date.now(), ...t,
    } as Transaction);

  const merchants: Record<string, [string, number, string[]][]> = {
    groceries: [['Whole Foods', 85, ['m-sam', 'm-alex']], ['Trader Joe’s', 60, ['m-sam']], ['Costco', 180, ['m-alex']], ['Corner market', 18, ['m-sam']]],
    dining: [['Blue Bottle Coffee', 7, ['m-alex']], ['Sushi Ko', 70, ['m-alex', 'm-sam']], ['Pizza Napoli', 38, ['m-sam']], ['Taco Loco', 24, ['m-maya']], ['Uber Eats', 32, ['m-alex']]],
    transport: [['Shell', 55, ['m-alex']], ['Uber', 19, ['m-sam']], ['Metro card', 30, ['m-maya']], ['City parking', 12, ['m-alex']]],
    shopping: [['Amazon', 45, ['m-alex', 'm-sam']], ['Target', 62, ['m-sam']], ['IKEA', 140, ['m-sam']], ['Zara', 75, ['m-maya']]],
    entertainment: [['AMC Cinemas', 42, ['m-sam']], ['Steam', 20, ['m-maya']], ['Bowling Lanes', 36, ['m-leo']]],
    health: [['CVS Pharmacy', 22, ['m-sam']], ['Dr. Patel clinic', 90, ['m-leo']]],
    childcare: [['After-school club', 160, ['m-leo']]],
    gifts: [['Etsy', 35, ['m-sam']], ['Charity: Water', 25, ['m-alex']]],
  };
  const perMonth: Record<string, number> = { groceries: 8, dining: 9, transport: 7, shopping: 4, entertainment: 2, health: 1, childcare: 2, gifts: 1 };

  for (let mo = 0; mo < 12; mo++) {
    const ms = addMonths(start, mo);
    const isCurrent = mo === 11;
    const lastDay = isCurrent ? now.getDate() : new Date(ms.getFullYear(), ms.getMonth() + 1, 0).getDate();
    const dayOf = () => new Date(ms.getFullYear(), ms.getMonth(), 1 + Math.floor(r() * lastDay), 8 + Math.floor(r() * 13), Math.floor(r() * 60));
    // seasonal bumps: December gifts, summer travel
    const month = ms.getMonth();
    for (const [cat, n] of Object.entries(perMonth)) {
      const count = Math.round((n * lastDay) / 30) + (cat === 'gifts' && month === 11 ? 5 : 0);
      for (let i = 0; i < count; i++) {
        const [payee, base, who] = pick(merchants[cat]);
        const spike = cat === 'dining' && isCurrent ? 1.5 : 1; // makes the "running hot" insight show up
        add({
          date: dayOf().toISOString(), amount: m(jitter(base * spike)), type: 'expense',
          accountId: pick(['a-card', 'a-card', 'a-checking', cat === 'groceries' ? 'a-cash' : 'a-card']),
          categoryId: cat, payee, memberId: pick(who), source: pick(['manual', 'sms', 'sms', 'import']),
        });
      }
    }
    if (month === 6 || month === 7) {
      add({ date: dayOf().toISOString(), amount: m(jitter(1400)), type: 'expense', accountId: 'a-card', categoryId: 'travel', payee: 'Lisbon trip — flights', memberId: 'm-alex', tags: ['trip'] });
      add({ date: dayOf().toISOString(), amount: m(jitter(900)), type: 'expense', accountId: 'a-card', categoryId: 'travel', payee: 'Airbnb', memberId: 'm-sam', tags: ['trip'] });
    }
    // pocket money
    for (const kid of members.filter((x) => x.allowance)) {
      add({ date: new Date(ms.getFullYear(), ms.getMonth(), 1, 9).toISOString(), amount: kid.allowance!, type: 'expense', accountId: 'a-cash', categoryId: 'pocket', payee: `Pocket money — ${kid.name}`, memberId: kid.id });
    }
    // side income every other month
    if (mo % 2 === 0) add({ date: dayOf().toISOString(), amount: m(jitter(700)), type: 'income', accountId: 'a-checking', categoryId: 'freelance', payee: 'Design consulting', memberId: 'm-sam' });
    add({ date: new Date(ms.getFullYear(), ms.getMonth(), 28 > lastDay ? lastDay : 28).toISOString(), amount: m(jitter(31, 0.1)), type: 'income', accountId: 'a-savings', categoryId: 'interest', payee: 'Savings interest' });
    // card bill paid from checking
    if (!isCurrent || now.getDate() > 18) {
      add({ date: new Date(ms.getFullYear(), ms.getMonth(), 18, 10).toISOString(), amount: m(jitter(1900, 0.2)), type: 'transfer', accountId: 'a-checking', toAccountId: 'a-card', payee: 'Card payment' });
    }
    add({ date: new Date(ms.getFullYear(), ms.getMonth(), Math.min(lastDay, 25), 10).toISOString(), amount: m(400), type: 'transfer', accountId: 'a-checking', toAccountId: 'a-savings', payee: 'Monthly savings sweep' });
    // recurring postings
    for (const rule of rules) {
      const stepOk = rule.freq === 'monthly' || (rule.freq === 'quarterly' && mo % 3 === 0);
      if (!stepOk || rule.day > lastDay) continue;
      const priceBump = rule.id === 'r-netflix' && mo >= 9 ? m(2.5) : 0; // price-change detection demo
      add({
        date: new Date(ms.getFullYear(), ms.getMonth(), rule.day, 7).toISOString(),
        amount: (rule.estimated ? m(jitter(rule.amount / 100 / k, 0.15)) : rule.amount) + priceBump,
        type: rule.type, accountId: rule.accountId, categoryId: rule.categoryId, payee: rule.name, source: 'recurring',
        memberId: rule.name.includes('Sam') ? 'm-sam' : rule.name.includes('Alex') ? 'm-alex' : undefined,
      });
    }
  }
  // A duplicate + one large item recently, so anomalies have something to show
  const dupDate = addDays(now, -2);
  add({ date: dupDate.toISOString(), amount: m(64), type: 'expense', accountId: 'a-card', categoryId: 'shopping', payee: 'Amazon', memberId: 'm-alex', source: 'sms' });
  add({ date: addDays(dupDate, 0).toISOString(), amount: m(64), type: 'expense', accountId: 'a-card', categoryId: 'shopping', payee: 'Amazon', memberId: 'm-alex', source: 'sms' });
  // Review inbox items
  add({ date: addDays(now, -1).toISOString(), amount: m(23.9), type: 'expense', accountId: 'a-card', payee: 'Sq *Greenleaf', source: 'sms', needsReview: true, confidence: 0.62, notes: 'Card ending 9876 charged 23.90 at SQ *GREENLEAF' });
  add({ date: now.toISOString(), amount: m(120), type: 'income', accountId: 'a-checking', payee: 'Zelle from J. Rivera', source: 'sms', needsReview: true, confidence: 0.55 });

  // Mark recurring rules as posted up to today
  for (const rule of rules) rule.lastPosted = isoDate(now);

  const budgets: Budget[] = [
    ['groceries', 720], ['dining', 380], ['transport', 300], ['shopping', 300], ['entertainment', 120], ['utilities', 260],
    ['subscriptions', 60], ['health', 160], ['childcare', 340], ['gifts', 80],
  ].map(([c, v]) => ({ id: `b-${c}`, categoryId: c as string, amount: m(v as number), rollover: c === 'gifts' || c === 'shopping' }));
  budgets.push({ id: 'b-maya-fun', categoryId: 'entertainment', amount: m(30), rollover: true, memberId: 'm-maya' });

  const goals: Goal[] = [
    { id: 'g-emergency', name: 'Emergency fund', emoji: '🛟', target: m(30000), saved: m(17800), targetDate: isoDate(addMonths(now, 14)), priority: 1, contributions: [0, 1, 2, 3].map((i) => ({ date: isoDate(addMonths(now, -i)), amount: m(400) })) },
    { id: 'g-college', name: 'College fund', emoji: '🎓', target: m(60000), saved: m(14200), targetDate: isoDate(addMonths(now, 96)), priority: 2, contributions: [0, 1, 2].map((i) => ({ date: isoDate(addMonths(now, -i)), amount: m(300) })) },
    { id: 'g-japan', name: 'Japan 2027', emoji: '🗻', target: m(7500), saved: m(2100), targetDate: isoDate(addMonths(now, 10)), priority: 3, contributions: [{ date: isoDate(addMonths(now, -1)), amount: m(250) }] },
    { id: 'g-maya-bike', name: 'New bike', emoji: '🚲', target: m(450), saved: m(180), targetDate: isoDate(addMonths(now, 6)), priority: 3, memberId: 'm-maya', contributions: [{ date: isoDate(addMonths(now, -1)), amount: m(20) }] },
    { id: 'g-leo-lego', name: 'Lego space set', emoji: '🚀', target: m(120), saved: m(74), targetDate: isoDate(addMonths(now, 3)), priority: 3, memberId: 'm-leo', contributions: [{ date: isoDate(addMonths(now, -1)), amount: m(10) }] },
  ];
  const loans: Loan[] = [
    { id: 'l-mortgage', name: 'Home mortgage', lender: 'Harbor Bank', principal: m(240000), annualRate: 6.1, tenureMonths: 240, startDate: isoDate(addMonths(now, -26)), prepayments: [], kind: 'home' },
    { id: 'l-car', name: 'Car loan', lender: 'AutoFin', principal: m(18000), annualRate: 7.9, tenureMonths: 48, startDate: isoDate(addMonths(now, -14)), prepayments: [], kind: 'car' },
  ];
  const holdings: Holding[] = [
    { id: 'h-index', name: 'Global index fund', kind: 'mf', invested: m(18000), value: m(22400), updatedAt: Date.now() },
    { id: 'h-stocks', name: 'Individual stocks', kind: 'stock', invested: m(4000), value: m(4650), updatedAt: Date.now() },
    { id: 'h-retire', name: 'Retirement account', kind: 'epf', invested: m(41000), value: m(52300), updatedAt: Date.now() },
    { id: 'h-cd', name: '12-month term deposit', kind: 'fd', invested: m(5000), value: m(5180), maturityDate: isoDate(addMonths(now, 2)), updatedAt: Date.now() },
    { id: 'h-gold', name: 'Gold', kind: 'gold', invested: m(2500), value: m(3350), updatedAt: Date.now() },
  ];
  const ious: IOU[] = [
    { id: 'i-1', person: 'Jordan', amount: m(85), note: 'Concert tickets', date: isoDate(addDays(now, -9)), settled: false },
    { id: 'i-2', person: 'Priya', amount: -m(40), note: 'Shared cab from airport', date: isoDate(addDays(now, -4)), settled: false },
  ];

  await db.transaction('rw', [db.members, db.accounts, db.transactions, db.categories, db.budgets, db.recurring, db.goals, db.loans, db.holdings, db.ious, db.settings], async () => {
    await db.members.bulkPut(members);
    await db.accounts.bulkPut(accounts);
    await db.categories.bulkPut(DEFAULT_CATEGORIES);
    await db.transactions.bulkPut(txs);
    await db.budgets.bulkPut(budgets);
    await db.recurring.bulkPut(rules);
    await db.goals.bulkPut(goals);
    await db.loans.bulkPut(loans);
    await db.holdings.bulkPut(holdings);
    await db.ious.bulkPut(ious);
    await setSetting('profile', { ...defaultProfile(currency), primaryUser: 'Alex', onboarded: true, topGoals: ['Emergency fund', 'College fund'] } satisfies Profile);
    await setSetting('demo', true);
  });
  return txs.length;
}

export async function wipeAll() {
  await Promise.all(db.tables.map((t) => t.clear()));
}
