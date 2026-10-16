import { describe, expect, it } from 'vitest';
import { db, setSetting } from './db';
import { saveTransaction } from './hooks';
import { clearToFreshStart, demoUntouched, seedDemo, wipeAll } from './seed';

/** Simulates a demo auto-loaded by an earlier version: same data, but no demoSeededAt record. */
async function legacyDemo() {
  await wipeAll();
  await seedDemo('USD');
  await db.settings.delete('demoSeededAt');
}

describe('demo data removal', () => {
  it('auto-removes an untouched demo that an earlier version loaded', async () => {
    await legacyDemo();
    expect(await demoUntouched()).toBe(true);
    await clearToFreshStart();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect((await db.settings.get('profile'))?.value).toBeUndefined();
  });

  it('never auto-removes a demo the person has added entries to', async () => {
    await legacyDemo();
    const later = Date.now() + 5 * 60_000;
    await db.transactions.add({ id: 'mine', date: new Date().toISOString(), amount: 500, currency: 'USD', type: 'expense', accountId: 'a-cash', tags: [], source: 'manual', needsReview: false, createdAt: later, updatedAt: later });
    expect(await demoUntouched()).toBe(false);
  });

  it('never auto-removes when the person used the app (activity log) or renamed the household', async () => {
    await legacyDemo();
    await saveTransaction({ amount: 100, type: 'expense', accountId: 'a-cash' });
    expect(await demoUntouched()).toBe(false);
    await legacyDemo();
    const p = (await db.settings.get('profile'))!.value as Record<string, unknown>;
    await setSetting('profile', { ...p, primaryUser: 'Ebenezar' });
    expect(await demoUntouched()).toBe(false);
  });

  it('never auto-removes a demo chosen on purpose in this version', async () => {
    await wipeAll();
    await seedDemo('USD');
    expect(await demoUntouched()).toBe(false);
  });
});
