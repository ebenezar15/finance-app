import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS server module
import { handleAccount, ingestCapture } from '../../../api/_account-lib.js';
import { db } from '../../db/db';
import { seedDemo, wipeAll } from '../../db/seed';
import { _setAccountFetch, captureDisable, captureEnable, capturePull, captureStatus, signIn, signOut, signUp } from '../account';
import { capturePayments } from '../capture';

function server() {
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    set: async (k: string, v: unknown) => { store.set(k, JSON.stringify(v)); },
    del: async (k: string) => { store.delete(k); },
    incr: async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
  };
  const f = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const out = await handleAccount(JSON.parse(String(init?.body)), { redis, ip: '1.2.3.4' });
    return new Response(JSON.stringify(out.body), { status: out.status });
  };
  const forward = (link: string, text: string, at?: number) => ingestCapture({ link, text, at }, { redis }) as Promise<{ status: number; body: { stored?: boolean } }>;
  return { store, redis, fetch: f as typeof fetch, forward };
}

const CAB = 'Sent Rs.180.00 From HDFC Bank A/C *4321 To CITY CABS On 12/11/26 Ref 431211112222';

describe('automatic payment capture', () => {
  let s: ReturnType<typeof server>;
  let link = '';
  beforeEach(async () => {
    s = server();
    _setAccountFetch(s.fetch, 2000);
    await wipeAll();
    await signUp('asha@example.com', 'correct horse 42', 'Asha');
    await seedDemo('INR');
    link = await captureEnable();
  });

  it('gives a private link, and the server keeps forwarded messages only in encrypted form', async () => {
    expect(link).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect((await s.forward(link, CAB)).body.stored).toBe(true);
    const everything = [...s.store.values()].join('\n');
    expect(everything).not.toContain('CITY CABS');
    expect(everything).not.toContain('431211112222');
    expect(everything).not.toContain(link); // only a hash of the link is kept
    expect(await captureStatus()).toMatchObject({ enabled: true, pending: 1 });
  });

  it('collects, decrypts and records a forwarded payment, then clears the queue', async () => {
    await s.forward(link, CAB, Date.now());
    await s.forward(link, 'You paid ₹60.00 to Tea Stall');
    const got = await capturePull();
    expect(got.items.map((i) => i.text)).toEqual([CAB, 'You paid ₹60.00 to Tea Stall']);

    const before = await db.transactions.count();
    const results = [];
    for (const m of got.items) results.push(...(await capturePayments(m.text, { receivedAt: m.at })));
    expect(results.map((r) => r.status)).toEqual(['added', 'added']); // cabs and a tea stall are recognised and filed
    expect(await db.transactions.count()).toBe(before + 2);
    const cab = await db.transactions.where('refNo').equals('431211112222').first();
    expect(cab).toMatchObject({ amount: 180_00, type: 'expense', payee: 'City Cabs', categoryId: 'transport', needsReview: false, source: 'sms', paymentMethod: 'online' });

    expect((await capturePull(got.items.map((i) => i.id))).items).toEqual([]);
    expect(await captureStatus()).toMatchObject({ pending: 0 });
  });

  it('works on a second phone signed in to the same account', async () => {
    await s.forward(link, CAB);
    await signOut();
    await signIn('asha@example.com', 'correct horse 42');
    expect((await capturePull()).items[0].text).toBe(CAB);
  });

  it('drops chatter, rejects unknown or replaced links, and stops when turned off', async () => {
    expect((await s.forward(link, 'Are we still on for dinner?')).body.stored).toBe(false);
    expect((await s.forward('not-a-real-link-0000000000000000', CAB)).status).toBe(404);
    const fresh = await captureEnable();
    expect((await s.forward(link, CAB)).status).toBe(404);
    expect((await s.forward(fresh, CAB)).status).toBe(200);
    await captureDisable();
    expect((await s.forward(fresh, CAB)).status).toBe(404);
    expect(await captureStatus()).toMatchObject({ enabled: false });
    expect([...s.store.keys()].filter((k) => k.startsWith('cap'))).toEqual([]);
  });

  it('caps message length and the rate of messages', async () => {
    await s.forward(link, `Paid ₹5 to X ${'y'.repeat(5000)}`);
    expect((await capturePull()).items[0].text.length).toBeLessThanOrEqual(1500);
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await s.forward(link, 'Paid ₹1 to A')).status;
    expect(last).toBe(429);
  });
});
