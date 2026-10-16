/**
 * Account sync for the shared (embedded) build. The viewer's household is stored privately
 * under their own claude.ai account (the host's per-viewer `data/users/<id>/` space, which
 * nobody else, the page owner included, can read). That gives a login with no passwords to
 * manage, keeps data across browsers and devices, and survives cleared site data.
 *
 * Format: the full local snapshot, gzip-compressed and base64-encoded, split across chunk
 * documents (`c0`, `c1`, …) below 256 KiB each, plus a `meta` document written last.
 * Last writer wins at whole-household granularity, which suits one family editing.
 */
import { create } from 'zustand';
import { db as local } from '../db/db';
import { restore, snapshot, type Snapshot } from '../db/backup';

type DocRef = {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: { exists: boolean; data(): Record<string, unknown> | undefined }) => void, err?: (e: unknown) => void): () => void;
};
type DbNs = { doc(path: string): DocRef };
type UserNs = { id(): Promise<string | null>; me(): Promise<{ name?: string }> };
type Host = { use?: (name: string) => Promise<unknown> };

export type SyncStatus = 'off' | 'signed-out' | 'connecting' | 'synced' | 'saving' | 'error';
interface SyncState { status: SyncStatus; who?: string; at?: number; ready: boolean; message?: string }
export const useSync = create<SyncState>(() => ({ status: 'off', ready: import.meta.env.VITE_EMBED !== '1' }));

const CHUNK = 180_000; // characters per chunk document; well under the 256 KiB document cap
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const deviceId = ls.get('tandem-device') ?? (() => { const d = Math.random().toString(36).slice(2, 10); ls.set('tandem-device', d); return d; })();

async function pack(snap: Snapshot): Promise<{ enc: string; text: string }> {
  const json = JSON.stringify(snap);
  if (typeof CompressionStream === 'undefined') return { enc: 'json', text: json };
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const bytes = new Uint8Array(gz);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { enc: 'gz64', text: btoa(bin) };
}

async function unpack(enc: string, text: string): Promise<Snapshot> {
  if (enc === 'json') return JSON.parse(text);
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(json);
}

let store: DbNs | null = null;
let base = '';
let suppress = false;
let timer: number | undefined;
let pushing: Promise<void> | null = null;
let pending = false;

async function pull(meta: Record<string, unknown>) {
  const n = Number(meta.chunks) || 0;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await store!.doc(`${base}/c${i}`).get();
    if (!c.exists) throw new Error('Cloud copy is incomplete; keeping this device’s data.');
    parts.push(String(c.data()!.s ?? ''));
  }
  const snap = await unpack(String(meta.enc), parts.join(''));
  suppress = true;
  try { await restore(snap); } finally { suppress = false; }
  ls.set('tandem-sync-at', String(meta.updatedAt));
  useSync.setState({ status: 'synced', at: Number(meta.updatedAt) });
}

async function push() {
  if (!store) return;
  useSync.setState({ status: 'saving' });
  try {
    const { enc, text } = await pack(await snapshot());
    const prev = await store.doc(`${base}/meta`).get();
    const prevChunks = prev.exists ? Number(prev.data()!.chunks) || 0 : 0;
    const n = Math.max(1, Math.ceil(text.length / CHUNK));
    for (let i = 0; i < n; i++) await store.doc(`${base}/c${i}`).set({ s: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    const updatedAt = Date.now();
    await store.doc(`${base}/meta`).set({ updatedAt, chunks: n, enc, device: deviceId, size: text.length });
    for (let i = n; i < prevChunks; i++) await store.doc(`${base}/c${i}`).delete().catch(() => {});
    ls.set('tandem-sync-at', String(updatedAt));
    ls.set('tandem-dirty', '0');
    useSync.setState({ status: 'synced', at: updatedAt, message: undefined });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    useSync.setState({
      status: 'error',
      message: code === 'quota_exceeded' ? 'Your cloud space is full.' : code === 'invalid_argument' ? 'This account can’t save here. Ask the owner for Contributor access.' : 'Couldn’t save to your account. Changes are safe on this device and will retry.',
    });
    if (code !== 'invalid_argument' && code !== 'quota_exceeded') schedulePush(15_000);
  }
}

function schedulePush(delay = 2500) {
  if (!store || suppress) return;
  ls.set('tandem-dirty', String(Date.now()));
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (pushing) { pending = true; return; }
    pushing = push().finally(() => { pushing = null; if (pending) { pending = false; schedulePush(500); } });
  }, delay);
}

/** Connects to the viewer's account. Resolves once local data reflects the cloud copy. */
export async function startCloudSync() {
  if (import.meta.env.VITE_EMBED !== '1') return;
  const host = (window as unknown as { claude?: Host }).claude;
  const done = (s: Partial<SyncState>) => useSync.setState({ ready: true, ...s });
  useSync.setState({ status: 'connecting' });
  try {
    const [dbNs, user] = await Promise.all([host?.use?.('db'), host?.use?.('user')]) as [DbNs | null, UserNs | null];
    const id = user ? await user.id() : null;
    if (!dbNs || !id) return done({ status: 'signed-out' });
    store = dbNs;
    base = `data/users/${id}`;
    const who = (await user!.me().catch(() => ({ name: '' }))).name || undefined;
    useSync.setState({ who });

    const metaRef = store.doc(`${base}/meta`);
    const remote = await metaRef.get();
    const lastApplied = Number(ls.get('tandem-sync-at') ?? 0);
    const dirtyAt = Number(ls.get('tandem-dirty') ?? 0);
    const localHasData = !!(await local.settings.get('profile'));
    if (remote.exists) {
      const meta = remote.data()!;
      // Local edits made offline after the last sync win; otherwise the account copy wins.
      if (dirtyAt > Number(meta.updatedAt) && localHasData) await push();
      else if (Number(meta.updatedAt) > lastApplied || !localHasData) await pull(meta);
      else useSync.setState({ status: 'synced', at: Number(meta.updatedAt) });
    } else if (localHasData) {
      await push();
    } else {
      useSync.setState({ status: 'synced' });
    }

    // Every local change schedules a save; changes from the user's other devices are pulled in.
    for (const t of local.tables) {
      if (t.name === 'audit') continue;
      t.hook('creating', () => { schedulePush(); });
      t.hook('updating', () => { schedulePush(); });
      t.hook('deleting', () => { schedulePush(); });
    }
    metaRef.onSnapshot((s) => {
      if (!s.exists) return;
      const meta = s.data()!;
      const newer = Number(meta.updatedAt) > Number(ls.get('tandem-sync-at') ?? 0);
      if (newer && meta.device !== deviceId && !pushing && !timer) pull(meta).catch(() => {});
    });
    done({});
  } catch {
    done({ status: 'error', message: 'Couldn’t reach your account. Your data is still saved on this device.' });
  }
}
