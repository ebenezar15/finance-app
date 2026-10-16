/** All money is stored as integer minor units (paise / cents). Never floats. */
export type Minor = number;

export type Role = 'owner' | 'admin' | 'adult' | 'teen' | 'child' | 'viewer';
export type AgeGroup = 'adult' | 'teen' | 'child';
export type BudgetStyle = 'envelope' | 'zero-based' | '50-30-20' | 'caps';

export interface Member {
  id: string;
  name: string;
  role: Role;
  age: AgeGroup;
  colour: string;
  allowance?: Minor; // monthly pocket money for kids/teens
}

export type AccountType = 'bank' | 'cash' | 'wallet' | 'credit' | 'loan' | 'investment' | 'asset';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: Minor;
  ownerIds: string[];
  shared: boolean;
  colour: string;
  icon: string;
  archived: boolean;
  last4?: string;
  savings?: boolean; // excluded from safe-to-spend
  creditLimit?: Minor;
  dueDay?: number;
}

export type TxType = 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment';
export type TxSource = 'manual' | 'sms' | 'ocr' | 'import' | 'recurring' | 'voice' | 'share';

export interface SplitLine {
  categoryId: string;
  memberId?: string;
  amount: Minor;
}

export interface Transaction {
  id: string;
  date: string; // ISO datetime
  amount: Minor; // always positive; type decides the sign
  currency: string;
  type: TxType;
  accountId: string;
  toAccountId?: string; // transfers
  categoryId?: string;
  payee?: string;
  memberId?: string;
  tags: string[];
  notes?: string;
  source: TxSource;
  confidence?: number; // 0..1 for auto sources
  needsReview: boolean;
  splits?: SplitLine[];
  refNo?: string;
  private?: boolean;
  taxSection?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number; // soft delete → trash for 30 days
}

export type CategoryKind = 'expense' | 'income';
export type Need = 'essential' | 'discretionary' | 'savings';

export interface Category {
  id: string;
  name: string;
  emoji: string;
  colour: string;
  kind: CategoryKind;
  need: Need;
  parentId?: string;
  defaultBudget?: Minor;
}

export interface Budget {
  id: string;
  categoryId: string;
  amount: Minor; // per month
  rollover: boolean;
  memberId?: string; // per-member allowance; undefined = household pool
  eventId?: string;
}

export type Freq = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
  id: string;
  name: string;
  type: 'income' | 'expense';
  amount: Minor;
  estimated: boolean;
  categoryId?: string;
  accountId: string;
  freq: Freq;
  day: number; // day of month (or weekday for weekly)
  startDate: string;
  autoPost: boolean;
  isSubscription: boolean;
  lastPosted?: string; // ISO date of last posting
  lastUsedPrompt?: string;
}

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  target: Minor;
  saved: Minor;
  targetDate: string;
  priority: 1 | 2 | 3;
  memberId?: string; // kids' savings jars
  contributions: { date: string; amount: Minor }[];
}

export interface Loan {
  id: string;
  name: string;
  lender: string;
  principal: Minor;
  annualRate: number; // percent, e.g. 8.5
  tenureMonths: number;
  startDate: string;
  prepayments: { date: string; amount: Minor }[];
  kind: 'home' | 'car' | 'personal' | 'education' | 'credit' | 'informal';
}

export interface Holding {
  id: string;
  name: string;
  kind: 'fd' | 'rd' | 'mf' | 'stock' | 'gold' | 'ppf' | 'epf' | 'nps' | 'property' | 'crypto' | 'other';
  invested: Minor;
  value: Minor;
  maturityDate?: string;
  updatedAt: number;
}

export interface IOU {
  id: string;
  person: string;
  amount: Minor; // positive = they owe us; negative = we owe them
  note: string;
  date: string;
  settled: boolean;
}

export interface MerchantRule {
  id: string;
  pattern: string; // lowercase merchant/keyword
  categoryId: string;
  hits: number;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
}

export interface AuditEntry {
  id?: number;
  at: number;
  action: string;
  detail: string;
}

export interface Profile {
  appName: string;
  primaryUser: string;
  currency: string;
  budgetStyle: BudgetStyle;
  fyStartMonth: number; // 0-11
  topGoals: string[];
  onboarded: boolean;
  dashboardCards: { id: string; hidden: boolean }[];
}
