/**
 * Tandem accounts: sign in with email + password, data end-to-end encrypted.
 *
 * Key design (same idea as zero-knowledge password managers):
 *   PBKDF2(password, email) → 512 bits → [authKey | passKey]
 *     authKey  is sent to the server, which stores only a scrypt hash of it (proves who you are)
 *     passKey  never leaves the phone; it unlocks the random dataKey
 *   dataKey (random AES-256) encrypts the household before it's uploaded.
 *   A recovery key (shown once at sign-up) unlocks the dataKey too, for a forgotten password.
 * The server can authenticate people but can never read their data or their password.
 */
import { create } from 'zustand';
import { db } from '../db/db';

const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_ITER = 310_000;

export interface Wrapped { iv: string; ct: string }
export interface AccountLink { email: string; name?: string; token: string; dataKey: string; wrappedByPass: Wrapped; version?: number; syncedAt?: number }

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
let iterations = PBKDF2_ITER;
/** Tests swap the network layer and use fewer PBKDF2 rounds. */
export function _setAccountFetch(f: Fetch, iter = PBKDF2_ITER) { fetchImpl = f; iterations = iter; }

export class AccountError extends Error { constructor(public code: string, message: string) { super(message); } }

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const normEmail = (e: string) => e.trim().toLowerCase();

async function derive(secret: string, email: string, iter = iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`tandem-account:v1:${normEmail(email)}`), iterations: iter }, base, 512));
  const wrapKey = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { authKey: b64(bits.slice(0, 32)), wrapKey };
}

async function wrap(key: CryptoKey, data: Uint8Array): Promise<Wrapped> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), ct: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource))) };
}
async function unwrap(key: CryptoKey, w: Wrapped): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) as BufferSource }, key, unb64(w.ct) as BufferSource));
}

/** 25 characters in 5 groups, from an alphabet without look-alikes (no 0/O, 1/I/L). */
export function makeRecoveryKey() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(25));
  const chars = Array.from(bytes, (b) => A[b % A.length]).join('');
  return chars.match(/.{5}/g)!.join('-');
}
const cleanRecovery = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function call<T>(body: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetchImpl('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new AccountError('offline', 'You’re offline. Connect to the internet and try again.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new AccountError(j.error ?? 'failed', j.message ?? 'Something went wrong. Try again.'), { status: r.status, detail: j });
  return j as T;
}

export async function accountsEnabled(): Promise<boolean> {
  try { return (await call<{ enabled: boolean }>({ action: 'status' })).enabled; } catch { return false; }
}

export async function getAccount(): Promise<AccountLink | null> {
  return ((await db.settings.get('account'))?.value as AccountLink | undefined) ?? null;
}
async function saveAccount(a: AccountLink | null) {
  if (a) await db.settings.put({ key: 'account', value: a }); else await db.settings.delete('account');
  useAccount.setState({ account: a });
}
export const useAccount = create<{ account: AccountLink | null | undefined; status: 'idle' | 'syncing' | 'ok' | 'error'; message?: string; at?: number }>(() => ({ account: undefined, status: 'idle' }));
export async function loadAccount() { useAccount.setState({ account: await getAccount() }); }

export function checkPassword(pw: string) {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (/^\d+$/.test(pw)) return 'Use letters as well as numbers.';
  return '';
}

/** Creates the account. Returns the recovery key, which must be shown to the person once. */
export async function signUp(email: string, password: string, name: string) {
  const e = normEmail(email);
  const pw = await derive(password, e);
  const recoveryKey = makeRecoveryKey();
  const rec = await derive(cleanRecovery(recoveryKey), e, Math.max(1000, Math.round(iterations / 3)));
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedByPass = await wrap(pw.wrapKey, dataKey);
  const wrappedByRecovery = await wrap(rec.wrapKey, dataKey);
  const { token } = await call<{ token: string }>({ action: 'signup', email: e, name, authKey: pw.authKey, recoveryAuth: rec.authKey, wrappedByPass, wrappedByRecovery });
  await saveAccount({ email: e, name, token, dataKey: b64(dataKey), wrappedByPass });
  return recoveryKey;
}

export async function signIn(email: string, password: string) {
  const e = normEmail(email);
  const pw = await derive(password, e);
  const r = await call<{ token: string; name?: string; wrappedByPass: Wrapped }>({ action: 'login', email: e, authKey: pw.authKey });
  const dataKey = await unwrap(pw.wrapKey, r.wrappedByPass);
  await saveAccount({ email: e, name: r.name, token: r.token, dataKey: b64(dataKey), wrappedByPass: r.wrappedByPass });
}

/** Forgotten password: the recovery key unlocks the data key, then a new password replaces the old one. */
export async function recoverAccount(email: string, recoveryKey: string, newPassword: string) {
  const e = normEmail(email);
  const rec = await derive(cleanRecovery(recoveryKey), e, Math.max(1000, Math.round(iterations / 3)));
  const { wrappedByRecovery } = await call<{ wrappedByRecovery: Wrapped }>({ action: 'recover-start', email: e, recoveryAuth: rec.authKey });
  const dataKey = await unwrap(rec.wrapKey, wrappedByRecovery);
  const pw = await derive(newPassword, e);
  const newWrappedByPass = await wrap(pw.wrapKey, dataKey);
  const r = await call<{ token: string; name?: string }>({ action: 'recover-finish', email: e, recoveryAuth: rec.authKey, newAuthKey: pw.authKey, newWrappedByPass });
  await saveAccount({ email: e, name: r.name, token: r.token, dataKey: b64(dataKey), wrappedByPass: newWrappedByPass });
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const a = await getAccount();
  if (!a) throw new AccountError('signed_out', 'Sign in first.');
  const old = await derive(oldPassword, a.email);
  await unwrap(old.wrapKey, a.wrappedByPass).catch(() => { throw new AccountError('bad_credentials', 'Your current password isn’t right.'); });
  const pw = await derive(newPassword, a.email);
  const newWrappedByPass = await wrap(pw.wrapKey, unb64(a.dataKey));
  await call({ action: 'change-password', token: a.token, oldAuthKey: old.authKey, newAuthKey: pw.authKey, newWrappedByPass });
  await saveAccount({ ...a, wrappedByPass: newWrappedByPass });
}

/** Offline unlock with the password: succeeds if it opens this device's copy of the data key. */
export async function verifyPasswordLocally(password: string) {
  const a = await getAccount();
  if (!a) return false;
  try { await unwrap((await derive(password, a.email)).wrapKey, a.wrappedByPass); return true; } catch { return false; }
}

export async function signOut() {
  const a = await getAccount();
  if (a) await call({ action: 'logout', token: a.token }).catch(() => {});
  await saveAccount(null);
}

export async function deleteAccount(password: string) {
  const a = await getAccount();
  if (!a) return;
  const pw = await derive(password, a.email);
  await call({ action: 'delete-account', token: a.token, authKey: pw.authKey });
  await saveAccount(null);
}

/* ───────── encrypted sync of the household ───────── */

async function dataKeyOf(a: AccountLink) { return crypto.subtle.importKey('raw', unb64(a.dataKey) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']); }

async function gzip(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return enc.encode(text);
  return new Uint8Array(await new Response(new Response(enc.encode(text)).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return dec.decode(bytes);
  return new Response(new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function sealVault(a: AccountLink, json: string) {
  const w = await wrap(await dataKeyOf(a), await gzip(json));
  return `${w.iv}.${w.ct}`;
}
export async function openVault(a: AccountLink, blob: string) {
  const [iv, ct] = blob.split('.');
  return JSON.parse(await gunzip(await unwrap(await dataKeyOf(a), { iv, ct })));
}

export interface VaultMeta { exists: boolean; version?: number; updatedAt?: number; device?: string }

export async function vaultMeta(): Promise<VaultMeta> {
  const a = await getAccount();
  if (!a) return { exists: false };
  return call<VaultMeta>({ action: 'vault-meta', token: a.token });
}

/** Downloads and decrypts the account's household; null if nothing has been saved yet. */
export async function pullVault(): Promise<{ snapshot: unknown; meta: VaultMeta } | null> {
  const a = await getAccount();
  if (!a) return null;
  const r = await call<VaultMeta & { blob?: string }>({ action: 'vault-get', token: a.token });
  if (!r.exists || !r.blob) return null;
  const snapshot = await openVault(a, r.blob);
  await saveAccount({ ...a, version: r.version, syncedAt: Date.now() });
  return { snapshot, meta: r };
}

/** Encrypts and uploads. Returns 'conflict' when another device saved a newer copy first. */
export async function pushVault(json: string, meta: { updatedAt: number; device: string }, force = false): Promise<'ok' | 'conflict'> {
  const a = await getAccount();
  if (!a) return 'ok';
  useAccount.setState({ status: 'syncing' });
  try {
    const blob = await sealVault(a, json);
    const r = await call<{ version: number }>({ action: 'vault-put', token: a.token, blob, updatedAt: meta.updatedAt, device: meta.device, baseVersion: a.version ?? 0, force });
    await saveAccount({ ...a, version: r.version, syncedAt: Date.now() });
    useAccount.setState({ status: 'ok', at: Date.now(), message: undefined });
    return 'ok';
  } catch (e) {
    if ((e as { status?: number }).status === 409) { useAccount.setState({ status: 'idle' }); return 'conflict'; }
    useAccount.setState({ status: 'error', message: (e as Error).message });
    throw e;
  }
}
