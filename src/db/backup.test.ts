import { describe, expect, it } from 'vitest';
import { exportEncrypted, importEncrypted, snapshot } from './backup';
import { db } from './db';
import { seedDemo, wipeAll } from './seed';

describe('backup → wipe → restore', () => {
  it('reproduces identical data', async () => {
    await wipeAll();
    await seedDemo('EUR', new Date(2026, 9, 16));
    const before = await snapshot();
    const env = await exportEncrypted('correct horse battery', 1000);
    expect(env.data).not.toContain('Whole Foods');
    await wipeAll();
    expect(await db.transactions.count()).toBe(0);
    await expect(importEncrypted(env, 'wrong pass')).rejects.toThrow(/passphrase/);
    await importEncrypted(env, 'correct horse battery');
    const after = await snapshot();
    expect(after.tables).toEqual(before.tables);
    expect(before.tables.transactions.length).toBeGreaterThan(500);
  });

  it('stores all money as integers', async () => {
    const txs = await db.transactions.toArray();
    expect(txs.every((t) => Number.isInteger(t.amount))).toBe(true);
  });
});
