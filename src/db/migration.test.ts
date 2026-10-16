import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { TandemDB } from './db';

describe('schema migrations', () => {
  it('v1 → v2 backfills payment method from the account type and keeps every row', async () => {
    const name = 'tandem-migration-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({ accounts: 'id, type', transactions: 'id, date, accountId, categoryId, memberId, type, source, needsReview, deletedAt, refNo' });
    await v1.table('accounts').bulkAdd([{ id: 'cash', type: 'cash' }, { id: 'card', type: 'credit' }, { id: 'bank', type: 'bank' }]);
    await v1.table('transactions').bulkAdd([
      { id: 't1', accountId: 'cash', type: 'expense', amount: 500 },
      { id: 't2', accountId: 'card', type: 'expense', amount: 900 },
      { id: 't3', accountId: 'bank', type: 'income', amount: 10000 },
      { id: 't4', accountId: 'bank', type: 'transfer', amount: 100, toAccountId: 'cash' },
      { id: 't5', accountId: 'bank', type: 'expense', amount: 300, paymentMethod: 'cheque' },
    ]);
    v1.close();

    const v2 = new TandemDB(name);
    await v2.open();
    const rows = Object.fromEntries((await v2.transactions.toArray()).map((t) => [t.id, t.paymentMethod]));
    expect(rows).toEqual({ t1: 'cash', t2: 'credit', t3: 'debit', t4: undefined, t5: 'cheque' });
    expect(await v2.transactions.where('paymentMethod').equals('cash').count()).toBe(1);
    v2.close();
  });
});
