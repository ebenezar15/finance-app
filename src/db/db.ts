import Dexie, { type Table } from 'dexie';
import type {
  Account, AuditEntry, Budget, Category, Goal, Holding, IOU, Loan, Member, MerchantRule,
  RecurringRule, Setting, Transaction,
} from './types';

export class TandemDB extends Dexie {
  members!: Table<Member, string>;
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  budgets!: Table<Budget, string>;
  recurring!: Table<RecurringRule, string>;
  goals!: Table<Goal, string>;
  loans!: Table<Loan, string>;
  holdings!: Table<Holding, string>;
  ious!: Table<IOU, string>;
  merchantRules!: Table<MerchantRule, string>;
  settings!: Table<Setting, string>;
  audit!: Table<AuditEntry, number>;

  constructor(name = 'tandem') {
    super(name);
    // Every schema change gets a new version() with an upgrade() — never edit an old one.
    this.version(1).stores({
      members: 'id',
      accounts: 'id, type',
      transactions: 'id, date, accountId, categoryId, memberId, type, source, needsReview, deletedAt, refNo',
      categories: 'id, kind',
      budgets: 'id, categoryId, memberId',
      recurring: 'id',
      goals: 'id, memberId',
      loans: 'id',
      holdings: 'id',
      ious: 'id',
      merchantRules: 'id, &pattern',
      settings: 'key',
      audit: '++id, at',
    });
  }
}

export const db = new TandemDB();

export const ALL_TABLES = [
  'members', 'accounts', 'transactions', 'categories', 'budgets', 'recurring',
  'goals', 'loans', 'holdings', 'ious', 'merchantRules', 'settings', 'audit',
] as const;

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting<T>(key: string, value: T) {
  await db.settings.put({ key, value });
}

export async function log(action: string, detail: string) {
  await db.audit.add({ at: Date.now(), action, detail });
}

/** Empties trash entries older than 30 days. */
export async function purgeTrash(now = Date.now()) {
  const cutoff = now - 30 * 86400_000;
  const old = await db.transactions.filter((t) => !!t.deletedAt && t.deletedAt < cutoff).primaryKeys();
  await db.transactions.bulkDelete(old);
  return old.length;
}
