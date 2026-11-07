/**
 * Daily financial tip & fact.
 *
 * A curated, currency-free library of practical tips and timeless facts, plus a
 * deterministic picker that gives one item per local day. When household
 * signals are supplied, roughly half of all days surface a tip chosen for the
 * household, with a short `personal` line explaining why.
 *
 * Content rules: no currency symbols or money amounts, no survey statistics,
 * no specific product interest rates, no country-specific laws or products, no
 * investment recommendations. Numbers in facts are maths examples.
 */

export type TipKind = 'tip' | 'fact';
export type TipTopic = 'budgeting' | 'saving' | 'debt' | 'investing' | 'spending' | 'family' | 'habits' | 'safety' | 'bills';
export interface Tip { id: string; kind: TipKind; topic: TipTopic; title: string; body: string; action?: { label: string; to: string } }

export interface TipSignals {
  savingsRate?: number;        // this month (income-expense)/income, may be negative; undefined if no income
  topCategoryName?: string;    // biggest spending category this month
  topCategoryShare?: number;   // 0..1 share of spending
  hasBudgets: boolean;
  overBudgetCount: number;
  hasEmergencyGoal: boolean;   // a goal whose name mentions emergency / rainy day
  hasGoals: boolean;
  billsDueSoon: number;        // bills in next 7 days
  hasDebt: boolean;            // loans or credit-card balance owed
  creditCardOwed: boolean;
  subscriptionsCount: number;  // detected subscriptions
  hasBackup: boolean;
  entriesLast7Days: number;
  daysSinceLastEntry?: number;
  isMonthStart: boolean;       // day 1..3
  isMonthEnd: boolean;         // last 4 days
  isWeekend: boolean;
}

const t = (id: string, topic: TipTopic, title: string, body: string, action?: Tip['action']): Tip =>
  (action ? { id, kind: 'tip', topic, title, body, action } : { id, kind: 'tip', topic, title, body });
const f = (id: string, topic: TipTopic, title: string, body: string, action?: Tip['action']): Tip =>
  (action ? { id, kind: 'fact', topic, title, body, action } : { id, kind: 'fact', topic, title, body });

const BUDGETS = { label: 'Open budgets', to: '/budgets' };
const GOALS = { label: 'Open goals', to: '/goals' };
const BILLS = { label: 'Open bills', to: '/bills' };
const DEBTS = { label: 'Open debts', to: '/debts' };
const INSIGHTS = { label: 'See insights', to: '/insights' };
const ACTIVITY = { label: 'Open activity', to: '/activity' };
const INBOX = { label: 'Open inbox', to: '/inbox' };

export const TIPS: Tip[] = [
  // ---------- Tips: budgeting ----------
  t('start-a-budget', 'budgeting', 'Start with one simple budget',
    'Pick your three biggest spending categories and set a monthly limit for each. You can add more later, once the habit sticks.',
    { label: 'Set up a budget', to: '/budgets' }),
  t('budget-recovery', 'budgeting', 'Back on track after going over',
    'Going over a budget is information, not failure. See what pushed it up, ease off another category for the rest of the month, and adjust the limit if it was unrealistic.',
    BUDGETS),
  t('give-every-unit-a-job', 'budgeting', 'Give all your income a job',
    'Before the month starts, assign all expected income to bills, spending, saving or goals. Money with a purpose is less likely to drift away.'),
  t('plan-the-month', 'budgeting', 'Plan the month ahead',
    'A new month is a fresh start. Check expected income, list fixed bills, then decide what is left for everyday spending and saving.',
    BUDGETS),
  t('review-the-month', 'budgeting', 'Review the month before it closes',
    'Look back at where your money went this month. Note one thing that went well and one thing you would like to change next month.',
    INSIGHTS),
  t('buffer-category', 'budgeting', 'Add a small buffer category',
    'A modest miscellaneous line catches the surprises every month brings, so one odd expense does not throw the whole budget off.'),
  t('irregular-expenses', 'budgeting', 'Plan for irregular expenses',
    'List the costs that come once or twice a year, like renewals or gifts. Divide each by 12 and set that much aside every month.'),
  t('realistic-limits', 'budgeting', 'Set limits you can actually keep',
    'Base each budget on what you really spent over the last few months, then trim gently. A budget you keep beats a perfect one you abandon.',
    BUDGETS),

  // ---------- Tips: saving ----------
  t('emergency-fund', 'saving', 'Start an emergency fund',
    'A savings pot for surprises keeps a broken appliance or a gap in income from turning into debt. Begin with a small target and build from there.',
    { label: 'Create a goal', to: '/goals' }),
  t('pay-yourself-first', 'saving', 'Pay yourself first',
    'Move money to savings as soon as income arrives, rather than saving whatever happens to be left at the end of the month.'),
  t('automate-savings', 'saving', 'Automate a regular transfer',
    'A standing transfer on payday takes the decision out of saving. Even a small amount builds momentum over time.'),
  t('name-your-goals', 'saving', 'Give your savings a name',
    'Saving for a holiday or a new laptop is more motivating than saving in general. Create a goal and watch it fill up.',
    GOALS),
  t('save-round-ups', 'saving', 'Save the round-ups',
    'Rounding each purchase up to a whole number and setting the difference aside is an easy, almost invisible way to save.'),
  t('split-windfalls', 'saving', 'Split windfalls before spending them',
    'When unexpected money arrives, decide a split up front, such as part for a goal, part for debt and part just for fun.'),
  t('save-part-of-raises', 'saving', 'Save part of every raise',
    'When your income goes up, move part of the increase to savings before you get used to spending it.'),
  t('nudge-savings-rate', 'saving', 'Nudge your savings rate up',
    'Try raising the share of income you save by one percentage point next month. Small steps are easier to keep than big leaps.',
    INSIGHTS),
  t('spent-more-than-earned', 'saving', 'When spending tops income',
    'It happens to everyone sometimes. Pause non-essential purchases for a week and check which category grew the most.',
    INSIGHTS),
  t('notice-what-works', 'saving', 'Notice what is working',
    'Saving a healthy share of your income is worth recognising. Pointing some of it at a named goal gives it a clear purpose.',
    GOALS),

  // ---------- Tips: debt ----------
  t('pay-card-in-full', 'debt', 'Pay the card in full when you can',
    'Clearing the full card balance each month usually avoids interest altogether. If that is not possible yet, pay more than the minimum.',
    DEBTS),
  t('debt-avalanche', 'debt', 'Target the highest rate first',
    'Make the minimum payment on every debt and put any extra on the one with the highest interest rate. This usually costs the least overall.',
    DEBTS),
  t('debt-snowball', 'debt', 'Or start with the smallest balance',
    'Clearing your smallest debt first gives a quick win, and that motivation can carry you through the bigger ones.',
    DEBTS),
  t('list-every-debt', 'debt', 'List every debt in one place',
    'Write down each balance, interest rate and due date. Seeing everything together is the first step to a payoff plan.',
    DEBTS),
  t('pause-new-borrowing', 'debt', 'Pause new borrowing while paying down',
    'While you are clearing debt, try not to add new balances, so every payment moves you forward.'),
  t('card-due-reminder', 'debt', 'Set a reminder before the card is due',
    'Late payments can bring fees. A reminder a few days before the due date gives you time to pay without stress.',
    BILLS),

  // ---------- Tips: investing (principles only, no recommendations) ----------
  t('time-not-timing', 'investing', 'Time matters more than timing',
    'Growth compounds over years, so starting early with small amounts can matter more than waiting for a perfect moment.'),
  t('understand-before-investing', 'investing', 'Only invest in what you understand',
    'Before putting money into anything, make sure you can explain what it is, how it makes money and what could go wrong.'),
  t('cushion-before-risk', 'investing', 'Build a cushion before taking risks',
    'Having emergency savings means you are less likely to be forced to sell an investment at a bad moment.',
    GOALS),
  t('check-the-fees', 'investing', 'Check the fees',
    'Small yearly fees compound just like returns do. Compare the total cost of any product before you commit.'),
  t('spread-the-risk', 'investing', 'Do not rely on a single bet',
    'Spreading money across different kinds of assets means one bad outcome hurts less. This idea is called diversification.'),
  t('promised-returns', 'investing', 'Be wary of promised high returns',
    'Higher potential returns come with higher risk. A guarantee of high, fast returns is a classic warning sign of a scam.'),

  // ---------- Tips: spending ----------
  t('top-category', 'spending', 'Look at your biggest category',
    'Your largest spending category is where small changes have the biggest effect. Pick one easy swap to try this week.',
    INSIGHTS),
  t('wait-a-day', 'spending', 'Sleep on unplanned purchases',
    'Waiting a day before buying something you had not planned lets the urge fade. If you still want it tomorrow, it is a clearer choice.'),
  t('subscription-audit', 'spending', 'Audit your subscriptions',
    'List every recurring charge and ask whether you used it last month. Cancel or pause the ones you would not sign up for again today.',
    INSIGHTS),
  t('shop-with-a-list', 'spending', 'Shop with a list',
    'Deciding what you need before you go makes impulse buys easier to resist, especially in the supermarket.'),
  t('cost-per-use', 'spending', 'Think in cost per use',
    'Divide a price by how often you will use something. A pricier item used every day can be better value than a cheap one used once.'),
  t('weekend-plan', 'spending', 'Set a weekend spending plan',
    'Spending often creeps up at weekends. Decide in advance what you are happy to spend on outings and treats, then enjoy it guilt-free.'),
  t('fewer-sale-emails', 'spending', 'Unsubscribe from sale emails',
    'Fewer promotional emails and notifications means fewer prompts to buy things you were not looking for.'),
  t('plan-meals', 'spending', 'Plan a few meals ahead',
    'Planning the week\'s meals cuts last-minute takeaways and food that goes to waste.'),

  // ---------- Tips: family ----------
  t('money-check-in', 'family', 'Hold a short money check-in',
    'A relaxed monthly chat with your partner or household about goals and upcoming costs keeps everyone on the same page.'),
  t('kids-practise', 'family', 'Let children practise with small amounts',
    'Giving children a little money of their own to manage teaches choices and patience better than any lecture.'),
  t('shared-goal', 'family', 'Agree on a shared goal',
    'Saving together for something you all want, like a trip, turns budgeting into a team effort.',
    GOALS),
  t('personal-allowance', 'family', 'Give each adult some free money',
    'A small personal allowance for everyone reduces friction. Each person spends theirs freely, without needing to explain.'),
  t('talk-without-blame', 'family', 'Talk about money without blame',
    'Focus conversations on plans and choices rather than past mistakes. People share more openly when they do not feel judged.'),

  // ---------- Tips: habits ----------
  t('log-as-you-go', 'habits', 'Log spending as it happens',
    'Recording an expense right away takes seconds and keeps your picture accurate. Wait too long and the small ones slip through.',
    ACTIVITY),
  t('catch-up-entries', 'habits', 'Catch up on recent entries',
    'Take a couple of minutes to add what you remember from the last few days, and check your inbox for anything waiting to be confirmed.',
    INBOX),
  t('weekly-review', 'habits', 'Try a five-minute weekly review',
    'Once a week, scan recent transactions, check your budgets and look at upcoming bills. Short and regular beats long and rare.',
    INSIGHTS),
  t('one-habit-at-a-time', 'habits', 'Change one habit at a time',
    'Pick a single money habit to work on this month. Once it feels automatic, move on to the next.'),
  t('celebrate-small-wins', 'habits', 'Celebrate small wins',
    'Clearing a bill, reaching a goal milestone or staying within a budget all deserve a moment of recognition. Progress fuels progress.'),
  t('keep-the-streak', 'habits', 'Keep the streak going',
    'Logging regularly builds a clear picture of your spending. Keep it up and patterns will start to stand out.',
    ACTIVITY),

  // ---------- Tips: safety ----------
  t('back-up-data', 'safety', 'Back up your data',
    'A recent backup means you will not lose your records if your phone is lost, broken or replaced. It only takes a moment.',
    { label: 'Back up now', to: '/settings' }),
  t('pause-before-clicking', 'safety', 'Pause before clicking money links',
    'Unexpected messages asking you to log in, pay or confirm details are a classic scam. Open the official app or website yourself instead.'),
  t('unique-passwords', 'safety', 'Use unique passwords for money accounts',
    'Reusing a password means one leak can unlock several accounts. A password manager makes unique ones easy to keep.'),
  t('two-step-verification', 'safety', 'Turn on two-step verification',
    'A second check, such as a code or an app approval, makes it much harder for anyone else to get into your accounts.'),
  t('scan-statements', 'safety', 'Scan statements for unfamiliar charges',
    'Small unknown charges are sometimes a test before bigger fraud. Report anything you do not recognise quickly.'),
  t('urgency-red-flag', 'safety', 'Treat urgency as a red flag',
    'Scammers often pressure you to act right now. A genuine organisation will always let you take time to check.'),

  // ---------- Tips: bills ----------
  t('bills-due-soon', 'bills', 'Get ahead of upcoming bills',
    'Check which bills are due this week and make sure the money is ready, so nothing slips past its date.',
    BILLS),
  t('one-bill-calendar', 'bills', 'Keep every bill on one calendar',
    'Seeing all due dates together shows the busy weeks of the month, so you can plan around them.',
    BILLS),
  t('review-bills-yearly', 'bills', 'Review regular bills once a year',
    'Prices for services can creep up over time. Comparing options at renewal time often turns up a better deal.'),
  t('align-with-payday', 'bills', 'Line bills up with payday',
    'Many providers let you change your due date. Moving bills to just after payday can make them easier to cover.'),
  t('automate-but-check', 'bills', 'Automate, but still check',
    'Automatic payments help avoid late fees, but glance at each amount so errors or price rises do not go unnoticed.',
    BILLS),

  // ---------- Facts: maths ----------
  f('rule-of-72', 'investing', 'The rule of 72',
    'Divide 72 by a yearly growth rate to estimate how many years it takes to double. At 7% a year, money roughly doubles in about 10 years (72 ÷ 7).'),
  f('compound-growth', 'saving', 'Growth on growth',
    'At 5% a year, 100 becomes 105 after one year and 110.25 after two. The second year earns growth on the first year\'s growth too.'),
  f('small-daily-amounts', 'saving', 'Small daily amounts add up',
    'An amount set aside every day adds up to 365 times that amount in a year. Put away 10 a day and you have 3,650 after a year, before any growth.'),
  f('inflation-halves-cash', 'saving', 'How inflation erodes cash',
    'If prices rise 3% a year, they roughly double in about 24 years (72 ÷ 3). Cash that earns nothing would then buy about half as much.'),
  f('debt-doubles-too', 'debt', 'The rule of 72 works on debt too',
    'An unpaid balance growing at 24% a year roughly doubles in about 3 years (72 ÷ 24). Compounding cuts both ways.',
    DEBTS),
  f('monthly-compounding', 'debt', 'Monthly rates compound',
    '1% a month is not 12% a year but about 12.7%, because each month\'s interest is charged on the previous month\'s interest as well.'),
  f('fall-and-recover', 'investing', 'Losses and gains are not symmetric',
    'A 50% fall needs a 100% rise to get back to where you started, because the rise is measured from the smaller amount.'),
  f('weeks-per-month', 'budgeting', 'A month is more than four weeks',
    'A year has 52 weeks, which is about 4.33 per month. Multiplying a weekly cost by 4 underestimates the monthly total.'),
  f('true-yearly-cost', 'bills', 'The yearly size of a small charge',
    'A monthly charge is paid 12 times a year and a weekly one 52 times. Multiplying by that count shows what a subscription really costs.'),
  f('cut-by-a-quarter', 'spending', 'Trimming a regular cost',
    'Cutting a weekly expense by a quarter frees up the equivalent of 13 weeks of it every year, since 52 ÷ 4 = 13.'),

  // ---------- Facts: behavioural finance ----------
  f('anchoring', 'spending', 'Anchoring',
    'The first number we see shapes how we judge the ones that follow. A crossed-out "was" price can make a sale price feel like a bargain even when it is not.'),
  f('loss-aversion', 'investing', 'Loss aversion',
    'Psychologists Daniel Kahneman and Amos Tversky showed that losses tend to feel stronger than gains of the same size, which can make us overly cautious or slow to cut losses.'),
  f('mental-accounting', 'budgeting', 'Mental accounting',
    'Economist Richard Thaler described how we treat money differently depending on where it came from or what we label it for, even though every unit spends the same.'),
  f('pain-of-paying', 'spending', 'The pain of paying',
    'Handing over cash tends to feel more painful than tapping a card, so people often spend more freely with cards. Researchers call this the pain of paying.'),
  f('decoy-effect', 'spending', 'The decoy effect',
    'Adding a third, clearly worse option can make one of the other two look like a better deal. It shows up often in menus and subscription plans.'),
  f('present-bias', 'saving', 'Present bias',
    'People tend to prefer a smaller reward now over a larger one later, even when waiting is clearly worth it. Automating savings helps sidestep it.'),
  f('default-effect', 'habits', 'The power of defaults',
    'People tend to stick with whatever option is already selected. That is why setting up an automatic transfer once can shape years of saving.'),
  f('sunk-cost', 'spending', 'The sunk cost fallacy',
    'It is tempting to keep spending because of what you have already spent. Past costs are gone either way; only future costs and benefits should decide.'),
  f('hedonic-adaptation', 'spending', 'Hedonic adaptation',
    'The thrill of a new purchase fades as we get used to it, while the cost stays. Knowing this makes it easier to pause before buying.'),
  f('ostrich-effect', 'habits', 'The ostrich effect',
    'People tend to avoid checking their finances when they expect bad news. Short, regular check-ins make looking feel less daunting.',
    INSIGHTS),
  f('fresh-start-effect', 'habits', 'The fresh start effect',
    'Researchers have found people are more likely to start on goals at landmarks like a new week, month or birthday. Any of them is a good moment to begin.'),
  f('habit-stacking', 'habits', 'Habit stacking',
    'Linking a new habit to something you already do every day, like logging spending after your morning coffee, makes it easier to remember.'),

  // ---------- Facts: history and words ----------
  f('lydian-coins', 'saving', 'Some of the first coins',
    'Some of the earliest known coins were made in Lydia, in what is now western Turkey, around the 7th century BCE, from electrum, a natural mix of gold and silver.'),
  f('chinese-paper-money', 'spending', 'The first paper money',
    'Paper money was first used widely in China. Merchants used paper notes under the Tang dynasty, and the Song dynasty began issuing official paper money in the 11th century.'),
  f('first-charge-card', 'debt', 'Where payment cards began',
    'Diners Club, launched in 1950, is often called the first general-purpose charge card. Members could pay at many restaurants with a single card.'),
  f('charge-vs-credit', 'debt', 'Charge cards came before credit',
    'Early charge cards had to be paid off in full each month. Revolving credit, which lets a balance carry over and gather interest, came later.'),
  f('word-budget', 'budgeting', 'Where the word budget comes from',
    'Budget comes from the Old French bougette, a small leather bag or purse. A budget was once, quite literally, the bag your money was kept in.'),
  f('word-bank', 'saving', 'Why it is called a bank',
    'The word bank comes from the Italian banco, meaning bench. Medieval money changers did business at benches in the market.'),
  f('word-economy', 'family', 'Economy began at home',
    'Economy comes from the Greek oikonomia, meaning management of a household. Running a home budget is economics in its original sense.'),
  f('word-mortgage', 'debt', 'A grim word for a home loan',
    'Mortgage comes from Old French for "death pledge": the agreement dies either when the debt is paid off or when the property is lost.'),
  f('word-phishing', 'safety', 'Why it is called phishing',
    'Phishing is a play on fishing: scammers cast out bait messages hoping someone will bite. The ph spelling nods to early phone hackers known as phreaks.'),
  f('two-factor-explained', 'safety', 'Why two-step checks work',
    'Two-factor checks combine something you know, like a password, with something you have, like your phone, so a stolen password alone is not enough.'),
];

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const BY_ID = new Map(TIPS.map((x) => [x.id, x]));

/** 'YYYY-MM-DD' in local time. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Days since 1970-01-01 for the local calendar date (DST-proof). */
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** FNV-1a with a murmur-style finaliser: small, fast, well mixed. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Fixed, seeded shuffle so the library order is scrambled but stable across releases of the same content. */
function shuffled<T extends { id: string }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => hash(seed + a.id) - hash(seed + b.id) || (a.id < b.id ? -1 : 1));
}

const TIP_ORDER = shuffled(TIPS.filter((x) => x.kind === 'tip'), 'tandem-tips');
const FACT_ORDER = shuffled(TIPS.filter((x) => x.kind === 'fact'), 'tandem-facts');

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The general rotation for a day: alternates tips and facts, each list advancing one step every two days. */
function generalOrder(day: number): Tip[] {
  const k = Math.floor(day / 2);
  const tips = TIP_ORDER.map((_, i) => TIP_ORDER[mod(k + i, TIP_ORDER.length)]);
  const facts = FACT_ORDER.map((_, i) => FACT_ORDER[mod(k + i, FACT_ORDER.length)]);
  const [first, second] = mod(day, 2) === 0 ? [tips, facts] : [facts, tips];
  const out: Tip[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (i < first.length) out.push(first[i]);
    if (i < second.length) out.push(second[i]);
  }
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Candidate { id: string; personal: string }

/** Signal → relevant tip, most pressing first. Never mentions money amounts. */
function personalCandidates(s: TipSignals, h: number): Candidate[] {
  const out: Candidate[] = [];
  const add = (id: string, personal: string) => { if (BY_ID.has(id)) out.push({ id, personal }); };

  if (s.overBudgetCount > 0) {
    add('budget-recovery', `You're over budget in ${plural(s.overBudgetCount, 'category', 'categories')} this month.`);
  }
  if (s.savingsRate !== undefined && s.savingsRate < 0) {
    add('spent-more-than-earned', 'You spent more than you earned so far this month.');
  }
  if (s.creditCardOwed) {
    add('pay-card-in-full', 'You have a credit card balance to clear.');
  }
  if (s.hasDebt) {
    const ids = ['debt-avalanche', 'debt-snowball', 'list-every-debt'];
    add(ids[h % ids.length], 'You have debts you are paying down.');
  }
  if (s.billsDueSoon > 0) {
    add('bills-due-soon', `You have ${plural(s.billsDueSoon, 'bill', 'bills')} due this week.`);
  }
  if (!s.hasBackup) {
    add('back-up-data', "There's no recent backup of your data.");
  }
  if (s.daysSinceLastEntry !== undefined && s.daysSinceLastEntry >= 3) {
    add('catch-up-entries', `It's been ${s.daysSinceLastEntry} days since your last entry.`);
  } else if (s.daysSinceLastEntry === undefined && s.entriesLast7Days === 0) {
    add('log-as-you-go', 'No entries in the last 7 days yet.');
  }
  if (!s.hasBudgets) {
    add('start-a-budget', "You haven't set up any budgets yet.");
  }
  if (!s.hasEmergencyGoal) {
    add('emergency-fund', s.hasGoals ? 'None of your goals is an emergency fund yet.' : "You don't have any savings goals yet.");
  }
  if (s.topCategoryName && s.topCategoryShare !== undefined && s.topCategoryShare >= 0.3) {
    add('top-category', `${s.topCategoryName} was ${pct(s.topCategoryShare)} of your spending this month.`);
  }
  if (s.subscriptionsCount >= 4) {
    add('subscription-audit', `We spotted ${s.subscriptionsCount} subscriptions in your spending.`);
  }
  if (s.savingsRate !== undefined && s.savingsRate >= 0 && s.savingsRate < 0.1) {
    add('nudge-savings-rate', `You've saved ${pct(s.savingsRate)} of your income so far this month.`);
  } else if (s.savingsRate !== undefined && s.savingsRate >= 0.2) {
    add('notice-what-works', `You've saved ${pct(s.savingsRate)} of your income so far this month.`);
  }
  if (s.isMonthStart) add('plan-the-month', "It's the start of a new month.");
  if (s.isMonthEnd) add('review-the-month', 'The month is almost over.');
  if (s.isWeekend) add('weekend-plan', "It's the weekend.");
  if (s.entriesLast7Days >= 7) {
    add('keep-the-streak', `You've logged ${s.entriesLast7Days} entries in the last 7 days.`);
  }
  return out;
}

interface Entry { tip: Tip; personal?: string }

/** Full ordered list of picks for a day (no duplicates, every tip exactly once). */
function daySequence(date: Date, signals: TipSignals | undefined, seen: ReadonlySet<string>): Entry[] {
  const key = dayKey(date);
  const h = hash(key);
  const general = generalOrder(dayNumber(date));

  let personal: Candidate[] = signals ? personalCandidates(signals, hash(key + '|debt')) : [];
  if (personal.length > 1) {
    // Rotate so different relevant tips take turns on personalised days.
    const r = hash(key + '|rot') % personal.length;
    personal = [...personal.slice(r), ...personal.slice(0, r)];
  }
  const personalised = personal.length > 0 && (h & 1) === 0;

  const raw: Entry[] = [];
  const pEntries = personal.map((c) => ({ tip: BY_ID.get(c.id)!, personal: c.personal }));
  const gEntries = general.map((tip) => ({ tip }));
  if (personalised) raw.push(...pEntries, ...gEntries);
  else raw.push(...gEntries.slice(0, 1), ...pEntries, ...gEntries.slice(1));

  const used = new Set<string>();
  const fresh: Entry[] = [];
  const stale: Entry[] = [];
  for (const e of raw) {
    if (used.has(e.tip.id)) continue;
    used.add(e.tip.id);
    (seen.has(e.tip.id) ? stale : fresh).push(e);
  }
  return [...fresh, ...stale];
}

/**
 * Today's tip: stable for the whole local day (same answer on every call that
 * day), different the next day.
 *
 * - `signals`: household signals; on about half of days a relevant tip is
 *   chosen and `personal` explains why.
 * - `opts.seen`: ids shown on *previous* days; they are avoided while
 *   alternatives remain. Do not include today's own pick, or today's answer
 *   will change on the next call.
 * - `opts.skip`: n gives the n-th alternative for the day ("Another"); no
 *   repeats until the whole library has been shown, then it wraps.
 */
export function tipOfTheDay(date: Date, signals?: TipSignals, opts?: { seen?: string[]; skip?: number }): { tip: Tip; personal?: string } {
  const seen = new Set(opts?.seen ?? []);
  const seq = daySequence(date, signals, seen);
  // Best effort "different from yesterday": if today's lead equals yesterday's, swap in the runner-up.
  const yesterday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 12);
  const prevLead = daySequence(yesterday, signals, seen)[0];
  if (seq.length > 1 && prevLead && seq[0].tip.id === prevLead.tip.id) [seq[0], seq[1]] = [seq[1], seq[0]];

  const skip = Math.max(0, Math.floor(opts?.skip ?? 0));
  const e = seq[skip % seq.length];
  return e.personal ? { tip: e.tip, personal: e.personal } : { tip: e.tip };
}
