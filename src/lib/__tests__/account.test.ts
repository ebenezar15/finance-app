import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS server module
import { handleAccount } from '../../../api/_account-lib.js';
import { db } from '../../db/db';
import { seedDemo, wipeAll } from '../../db/seed';
import { snapshot } from '../../db/backup';
import {
  _setAccountFetch, changePassword, getAccount, pullVault, pushVault, recoverAccount, signIn, signOut, signUp, verifyPasswordLocally,
} from '../account';
import { derToRaw, verifyAssertion, type PasskeyRecord } from '../biometric';

/** In-memory Redis + the real server handler, wired in as the app's fetch. */
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
  return { store, fetch: f as typeof fetch };
}

describe('accounts (zero-knowledge)', () => {
  let s: ReturnType<typeof server>;
  beforeEach(async () => {
    s = server();
    _setAccountFetch(s.fetch, 2000); // fewer PBKDF2 rounds to keep tests fast
    await wipeAll();
  });

  it('signs up, syncs encrypted data, and signs in on a new phone', async () => {
    const recovery = await signUp('Asha@Gmail.com', 'correct horse 42', 'Asha');
    expect(recovery).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/);
    expect((await getAccount())?.email).toBe('asha@gmail.com');

    await seedDemo('INR');
    const json = JSON.stringify(await snapshot());
    expect(await pushVault(json, { updatedAt: Date.now(), device: 'phone-A' })).toBe('ok');

    // The server never holds the password, the readable data or the data key.
    const everything = [...s.store.values()].join('\n');
    expect(everything).not.toContain('correct horse 42');
    expect(everything).not.toContain('Whole Foods');
    expect(everything).not.toContain((await getAccount())!.dataKey);

    // New phone: wipe, sign in, pull, restore.
    const count = await db.transactions.count();
    await wipeAll();
    await expect(signIn('asha@gmail.com', 'wrong password')).rejects.toThrow(/don’t match/);
    await signIn('asha@gmail.com', 'correct horse 42');
    const pulled = await pullVault();
    expect((pulled!.snapshot as { tables: { transactions: unknown[] } }).tables.transactions).toHaveLength(count);
  });

  it('refuses a second account for the same email', async () => {
    await signUp('ravi@gmail.com', 'password-one', 'Ravi');
    await signOut();
    await expect(signUp('RAVI@gmail.com', 'password-two', 'Ravi')).rejects.toThrow(/already exists/);
  });

  it('recovers a forgotten password with the recovery key and keeps the data readable', async () => {
    const recovery = await signUp('meena@gmail.com', 'first password', 'Meena');
    await seedDemo('USD');
    await pushVault(JSON.stringify(await snapshot()), { updatedAt: 1, device: 'a' });
    await signOut();
    await wipeAll();
    await expect(recoverAccount('meena@gmail.com', 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', 'new password 1')).rejects.toThrow(/recovery key/);
    await recoverAccount('meena@gmail.com', recovery.toLowerCase().replace(/-/g, ' '), 'new password 1');
    expect(await pullVault()).not.toBeNull();
    await signOut();
    await expect(signIn('meena@gmail.com', 'first password')).rejects.toThrow();
    await signIn('meena@gmail.com', 'new password 1');
  });

  it('changes the password; unlocks offline only with the right one', async () => {
    await signUp('kumar@gmail.com', 'old password 1', 'Kumar');
    expect(await verifyPasswordLocally('old password 1')).toBe(true);
    await expect(changePassword('not it', 'new password 2')).rejects.toThrow(/current password/);
    await changePassword('old password 1', 'new password 2');
    expect(await verifyPasswordLocally('old password 1')).toBe(false);
    expect(await verifyPasswordLocally('new password 2')).toBe(true);
    await signOut();
    await signIn('kumar@gmail.com', 'new password 2');
  });

  it('detects when another device saved a newer copy first', async () => {
    await signUp('family@gmail.com', 'shared pass 9', 'Family');
    await seedDemo('USD');
    const json = JSON.stringify(await snapshot());
    await pushVault(json, { updatedAt: 1, device: 'phone' });
    const me = (await getAccount())!;
    // Another device uploads (version moves on) …
    await db.settings.put({ key: 'account', value: { ...me, version: 1 } });
    await pushVault(json, { updatedAt: 2, device: 'laptop' });
    // … and this phone, still on version 1, is told rather than overwriting it.
    await db.settings.put({ key: 'account', value: { ...me, version: 1 } });
    expect(await pushVault(json, { updatedAt: 3, device: 'phone' })).toBe('conflict');
    expect(await pushVault(json, { updatedAt: 3, device: 'phone' }, true)).toBe('ok');
  });

  it('rate-limits password guessing', async () => {
    await signUp('target@gmail.com', 'real password 1', 'T');
    await signOut();
    for (let i = 0; i < 10; i++) await signIn('target@gmail.com', `guess ${i}`).catch(() => {});
    await expect(signIn('target@gmail.com', 'real password 1')).rejects.toThrow(/Too many attempts/);
  });
});

/** A simulated phone authenticator: signs like a real one (DER ECDSA over authData || hash(clientData)). */
async function fakeAuthenticator() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
  const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rawToDer = (raw: Uint8Array) => {
    const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.slice(i); if (v[0] & 0x80) v = Uint8Array.of(0, ...v); return Uint8Array.of(0x02, v.length, ...v); };
    const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
    return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
  };
  const rec: PasskeyRecord = { credentialId: 'cred', publicKey: b64u(spki), alg: -7, createdAt: 0 };
  const sign = async (challenge: Uint8Array, opts: { uv?: boolean; origin?: string; challengeOverride?: Uint8Array } = {}) => {
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: b64u(opts.challengeOverride ?? challenge), origin: opts.origin ?? 'https://tandem.test' }));
    const authenticatorData = new Uint8Array(37); authenticatorData[32] = 0x01 | (opts.uv === false ? 0 : 0x04);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
    const signed = Uint8Array.of(...authenticatorData, ...hash);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, signed));
    return { clientDataJSON: clientDataJSON.buffer, authenticatorData: authenticatorData.buffer, signature: rawToDer(raw).buffer };
  };
  return { rec, sign, rawToDer };
}

describe('fingerprint / Face ID unlock verification', () => {
  it('accepts a genuine, user-verified signature over our challenge', async () => {
    const a = await fakeAuthenticator();
    const ch = crypto.getRandomValues(new Uint8Array(32));
    expect(await verifyAssertion(a.rec, ch, await a.sign(ch), 'https://tandem.test')).toBe(true);
  });
  it('rejects: no biometric/passcode check, wrong challenge (replay), other website, tampered signature', async () => {
    const a = await fakeAuthenticator();
    const ch = crypto.getRandomValues(new Uint8Array(32));
    expect(await verifyAssertion(a.rec, ch, await a.sign(ch, { uv: false }), 'https://tandem.test')).toBe(false);
    expect(await verifyAssertion(a.rec, ch, await a.sign(ch, { challengeOverride: new Uint8Array(32) }), 'https://tandem.test')).toBe(false);
    expect(await verifyAssertion(a.rec, ch, await a.sign(ch, { origin: 'https://evil.example' }), 'https://tandem.test')).toBe(false);
    const good = await a.sign(ch);
    const sig = new Uint8Array(good.signature); sig[sig.length - 1] ^= 1;
    expect(await verifyAssertion(a.rec, ch, { ...good, signature: sig.buffer }, 'https://tandem.test')).toBe(false);
  });
  it('converts DER signatures with leading zero bytes', () => {
    const der = Uint8Array.of(0x30, 0x46, 0x02, 0x21, 0x00, ...new Uint8Array(32).fill(0x81), 0x02, 0x21, 0x00, ...new Uint8Array(32).fill(0x92));
    const raw = derToRaw(der);
    expect(raw.length).toBe(64);
    expect(raw[0]).toBe(0x81);
    expect(raw[32]).toBe(0x92);
  });
});
