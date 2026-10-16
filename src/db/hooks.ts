import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { ruleKey } from '../lib/categorize';
import { isoDate } from '../lib/dates';
import { accountBalance, duePostings, loanSummary } from '../lib/finance';
import { db, log, uid } from './db';
import { defaultProfile } from './seed';
import type { Account, Profile, Transaction } from './types';
import { useUI } from '../store/ui';

export function useProfile(): Profile | undefined {
  return useLiveQuery(async () => ((await db.settings.get('profile'))?.value as Profile) ?? defaultProfile(), []);
}

export async function saveProfile(patch: Partial<Profile>) {
  const cur = ((await db.settings.get('profile'))?.value as Profile) ?? defaultProfile();
  await db.settings.put({ key: 'profile', value: { ...cur, ...patch } });
}

/**
 * One live snapshot of everything the screens need. A household's data is small (a few
 * thousand rows), so reading it whole keeps every screen consistent and simple.
 */
export function useData() {
  const viewAs = useUI((s) => s.viewAs);
  const raw = useLiveQuery(async () => {
    const [members, accounts, transactions, categories, budgets, recurring, goals, loans, holdings, ious, rules] = await Promise.all([
      db.members.toArray(), db.accounts.toArray(), db.transactions.toArray(), db.categories.toArray(),
      db.budgets.toArray(), db.recurring.toArray(), db.goals.toArray(), db.loans.toArray(),
      db.holdings.toArray(), db.ious.toArray(), db.merchantRules.toArray(),
    ]);
    return { members, accounts, transactions, categories, budgets, recurring, goals, loans, holdings, ious, rules };
  }, []);

  return useMemo(() => {
    if (!raw) return undefined;
    const all = raw.transactions.filter((t) => !t.deletedAt);
    const viewer = raw.members.find((m) => m.id === viewAs);
    const limited = viewer && (viewer.role === 'teen' || viewer.role === 'child');
    // Teens/children only ever see their own entries; private entries are hidden from others.
    const txs = all
      .filter((t) => (limited ? t.memberId === viewer!.id : !t.private || !viewer || t.memberId === viewer.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    const balances = new Map<string, number>(raw.accounts.map((a) => [a.id, accountBalance(a.id, a.openingBalance, all)]));
    const liquid = raw.accounts
      .filter((a) => !a.archived && (a.type === 'bank' || a.type === 'cash' || a.type === 'wallet'))
      .reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
    const spendable = raw.accounts
      .filter((a) => !a.archived && !a.savings && (a.type === 'bank' || a.type === 'cash' || a.type === 'wallet'))
      .reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
    const loanOut = raw.loans.map((l) => ({ loan: l, ...loanSummary(l) }));
    const assets = raw.accounts.filter((a) => !a.archived && a.type !== 'credit' && a.type !== 'loan').reduce((s, a) => s + Math.max(0, balances.get(a.id) ?? 0), 0)
      + raw.holdings.reduce((s, h) => s + h.value, 0);
    const cardDebt = raw.accounts.filter((a) => a.type === 'credit').reduce((s, a) => s + Math.max(0, -(balances.get(a.id) ?? 0)), 0);
    const liabilities = cardDebt + loanOut.reduce((s, l) => s + l.outstanding, 0);
    return {
      ...raw, all, txs, balances, liquid, spendable, assets, liabilities, netWorth: assets - liabilities, loanOut, viewer: limited ? viewer : undefined,
      review: all.filter((t) => t.needsReview),
      cat: (id?: string) => raw.categories.find((c) => c.id === id),
      acct: (id?: string) => raw.accounts.find((a) => a.id === id),
      member: (id?: string) => raw.members.find((m) => m.id === id),
    };
  }, [raw, viewAs]);
}
export type Data = NonNullable<ReturnType<typeof useData>>;

export const isLiquid = (a: Account) => a.type === 'bank' || a.type === 'cash' || a.type === 'wallet';

export async function saveTransaction(t: Partial<Transaction> & Pick<Transaction, 'amount' | 'type' | 'accountId'>) {
  const now = Date.now();
  const row: Transaction = {
    id: t.id ?? uid(), date: t.date ?? new Date().toISOString(), currency: t.currency ?? 'USD', tags: [], source: 'manual',
    needsReview: false, createdAt: now, ...t, updatedAt: now,
  } as Transaction;
  await db.transaction('rw', db.transactions, db.merchantRules, db.audit, async () => {
    await db.transactions.put(row);
    if (row.payee && row.categoryId && row.type === 'expense') await learn(row.payee, row.categoryId);
    await log(t.id ? 'update' : 'create', `${row.type} ${row.amount} ${row.payee ?? ''}`);
  });
  return row;
}

/** Remembers payee → category so the next one is filed automatically. */
export async function learn(payee: string, categoryId: string) {
  const pattern = ruleKey(payee);
  if (!pattern) return;
  const existing = await db.merchantRules.where('pattern').equals(pattern).first();
  if (existing) await db.merchantRules.update(existing.id, { categoryId, hits: existing.categoryId === categoryId ? existing.hits + 1 : 1 });
  else await db.merchantRules.add({ id: uid(), pattern, categoryId, hits: 1 });
}

export async function softDelete(ids: string[]) {
  const at = Date.now();
  await db.transactions.where('id').anyOf(ids).modify({ deletedAt: at });
  await log('delete', `${ids.length} transaction(s)`);
  useUI.getState().toast(`Moved ${ids.length > 1 ? `${ids.length} entries` : 'entry'} to trash`, async () => {
    await db.transactions.where('id').anyOf(ids).modify((t) => { delete t.deletedAt; });
  });
}

/** Posts any auto-post recurring rules that came due since the last run. Idempotent. */
export async function postDueRecurring(now = new Date()) {
  const rules = await db.recurring.toArray();
  const currency = (((await db.settings.get('profile'))?.value as Profile | undefined) ?? defaultProfile()).currency;
  let posted = 0;
  await db.transaction('rw', db.recurring, db.transactions, async () => {
    for (const r of rules) {
      if (!r.autoPost) continue;
      const due = duePostings(r, now);
      for (const d of due) {
        await db.transactions.add({
          id: uid(), date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7).toISOString(), amount: r.amount, currency,
          type: r.type, accountId: r.accountId, categoryId: r.categoryId, payee: r.name, tags: [], source: 'recurring',
          needsReview: r.estimated, createdAt: Date.now(), updatedAt: Date.now(),
        });
        posted++;
      }
      if (due.length) await db.recurring.update(r.id, { lastPosted: isoDate(now) });
    }
  });
  return posted;
}
