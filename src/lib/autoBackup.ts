/**
 * Automatic backups for the installed app: Google Drive (the person's Gmail account) and a
 * folder on the phone. Runs quietly after changes, when the app goes to the background, and at
 * least twice a day. Never uploads an empty or not-yet-set-up household, so a wiped phone can't
 * overwrite a good backup.
 */
import { create } from 'zustand';
import { LOCAL_ONLY_SETTINGS, deviceId, restore, snapshot, type Snapshot } from '../db/backup';
import { db } from '../db/db';
import { DriveError, downloadDriveBackup, getLink, listDriveBackups, uploadDriveBackup, type DriveFile } from './gdrive';
import { folderPermission, getFolder, writeToFolder } from './phoneBackup';
import { getAccount, pullVault, pushVault, vaultMeta } from './account';

type DriveStatus = 'off' | 'saving' | 'ok' | 'error' | 'signed_out' | 'offline';
type PhoneStatus = 'off' | 'saving' | 'ok' | 'needs_permission' | 'error';
/** Newer data saved by another device: in Google Drive, or in the person's Tandem account. */
export interface Newer { id: string; at: number; entries: number; source?: 'drive' | 'account' }

interface State {
  drive: { status: DriveStatus; email?: string; at?: number; message?: string };
  phone: { status: PhoneStatus; name?: string; at?: number; message?: string };
  newer?: Newer;
}
export const useBackup = create<State>(() => ({ drive: { status: 'off' }, phone: { status: 'off' } }));

interface Book { lastChange: number; driveAt?: number; phoneAt?: number; accountAt?: number; accountHash?: string; hash?: string; pulledAt?: number }
const getBook = async (): Promise<Book> => ((await db.settings.get('backupState'))?.value as Book | undefined) ?? { lastChange: 0 };
const putBook = async (patch: Partial<Book>) => db.settings.put({ key: 'backupState', value: { ...(await getBook()), ...patch } });

/** FNV-1a over the data (ignoring the export time) so unchanged data isn't uploaded again. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

async function hasHousehold() {
  const p = (await db.settings.get('profile'))?.value as { onboarded?: boolean } | undefined;
  return !!p?.onboarded && (await db.accounts.count()) > 0;
}

let timer: number | undefined;
let running: Promise<void> | null = null;
let again = false;
let started = false;

/** Backs up now to every place that's set up. `force` uploads even if nothing changed. */
export async function backupNow(force = false): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    if (!(await hasHousehold())) return;
    const snap = await snapshot();
    const json = JSON.stringify(snap);
    const h = hash(JSON.stringify(snap.tables));
    const book = await getBook();
    const unchanged = h === book.hash;
    const now = Date.now();

    // Tandem account (end-to-end encrypted). Sent whenever the data differs from what the account has.
    const acct = await getAccount();
    if (acct && (force || h !== book.accountHash)) {
      try {
        let r = await pushVault(json, { updatedAt: book.lastChange || now, device: deviceId() });
        if (r === 'conflict') {
          // Another device saved first. If its copy is newer than our last change, offer it; else ours wins.
          const meta = await vaultMeta();
          if ((meta.updatedAt ?? 0) > (book.lastChange || 0)) useBackup.setState({ newer: { id: 'account', at: meta.updatedAt!, entries: 0, source: 'account' } });
          else r = await pushVault(json, { updatedAt: book.lastChange || now, device: deviceId() }, true);
        }
        if (r === 'ok') await putBook({ accountAt: now, accountHash: h });
      } catch { /* offline or signed out: the account badge shows it; retried on the next change */ }
    }

    const link = await getLink();
    if (link && (force || !unchanged || !book.driveAt || now - book.driveAt > 12 * 3600_000)) {
      useBackup.setState((s) => ({ drive: { ...s.drive, status: 'saving', email: link.email } }));
      try {
        await uploadDriveBackup(json, { device: deviceId(), updatedAt: book.lastChange || now, transactions: snap.tables.transactions.length });
        await putBook({ driveAt: now, hash: h });
        useBackup.setState({ drive: { status: 'ok', email: link.email, at: now } });
      } catch (e) {
        const code = e instanceof DriveError ? e.code : 'failed';
        useBackup.setState({ drive: { status: code === 'signed_out' ? 'signed_out' : code === 'offline' ? 'offline' : 'error', email: link.email, at: book.driveAt, message: (e as Error).message } });
      }
    }

    const folder = await getFolder();
    if (folder && (force || !unchanged || !book.phoneAt || now - book.phoneAt > 12 * 3600_000)) {
      if ((await folderPermission(folder.handle)) !== 'granted') {
        useBackup.setState({ phone: { status: 'needs_permission', name: folder.name, at: book.phoneAt } });
      } else {
        useBackup.setState((s) => ({ phone: { ...s.phone, status: 'saving', name: folder.name } }));
        try {
          await writeToFolder(folder.handle, json);
          await putBook({ phoneAt: now, hash: h });
          useBackup.setState({ phone: { status: 'ok', name: folder.name, at: now } });
        } catch {
          useBackup.setState({ phone: { status: 'error', name: folder.name, at: book.phoneAt, message: 'Couldn’t write to the backup folder. Choose it again in Settings.' } });
        }
      }
    }
  })().finally(() => {
    running = null;
    if (again) { again = false; schedule(2000); }
  });
  return running;
}

function schedule(ms = 30_000) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = undefined; backupNow().catch(() => {}); }, ms);
}

function markChanged() {
  putBook({ lastChange: Date.now() }).catch(() => {});
  schedule();
}

/**
 * Account sync on open: if another device saved newer data and this phone has no changes of its
 * own since its last sync, update quietly; if both changed, ask (via the banner).
 */
export async function syncFromAccount(): Promise<'updated' | 'ask' | 'none'> {
  const acct = await getAccount();
  if (!acct) return 'none';
  const meta = await vaultMeta().catch(() => null);
  if (!meta?.exists || (meta.version ?? 0) <= (acct.version ?? 0)) return 'none';
  const book = await getBook();
  const localChanged = (book.lastChange || 0) > (acct.syncedAt || 0);
  if (localChanged) {
    useBackup.setState({ newer: { id: 'account', at: meta.updatedAt ?? Date.now(), entries: 0, source: 'account' } });
    return 'ask';
  }
  const pulled = await pullVault();
  if (pulled) await restoreSnapshot(pulled.snapshot as Snapshot);
  return 'updated';
}

/** Replaces this device's data with the copy in the person's account. */
export async function restoreFromAccount() {
  const pulled = await pullVault();
  if (!pulled) throw new Error('Your account doesn’t have any saved data yet.');
  await restoreSnapshot(pulled.snapshot as Snapshot);
}

/** Looks for a backup in Drive written by another device after this device's last change. */
export async function checkForNewer(): Promise<Newer | undefined> {
  if (useBackup.getState().newer?.source === 'account') return useBackup.getState().newer;
  const link = await getLink();
  if (!link) return undefined;
  const files = await listDriveBackups().catch(() => [] as DriveFile[]);
  const top = files[0];
  if (!top) return undefined;
  const at = Number(top.appProperties?.updatedAt ?? Date.parse(top.modifiedTime));
  const book = await getBook();
  const fromElsewhere = top.appProperties?.device && top.appProperties.device !== deviceId();
  if (fromElsewhere && at > (book.lastChange || 0) && at > (book.pulledAt || 0)) {
    const newer: Newer = { id: top.id, at, entries: Number(top.appProperties?.transactions ?? 0), source: 'drive' };
    useBackup.setState({ newer });
    return newer;
  }
  useBackup.setState({ newer: undefined });
  return undefined;
}

/** Replaces this device's data with a Drive backup (latest by default). */
export async function restoreFromDrive(id?: string): Promise<Snapshot> {
  const files = id ? [] : await listDriveBackups();
  const target = id ?? files[0]?.id;
  if (!target) throw new Error('No Tandem backups found in this Google Drive yet.');
  const snap = (await downloadDriveBackup(target)) as Snapshot;
  if (snap?.app !== 'tandem') throw new Error('That Drive file isn’t a Tandem backup.');
  await restoreSnapshot(snap);
  return snap;
}

/** Restores and records it, so the restore itself isn't mistaken for a fresh local change. */
export async function restoreSnapshot(snap: Snapshot) {
  pause = true;
  try {
    await restore(snap);
    const at = Date.parse(snap.exportedAt) || Date.now();
    const h = hash(JSON.stringify((await snapshot()).tables));
    await putBook({ lastChange: at, pulledAt: Date.now(), hash: h, accountHash: h });
    useBackup.setState({ newer: undefined });
  } finally { pause = false; }
}
let pause = false;

/** Starts watching for changes. Call once when the app opens (installed app only). */
export async function startAutoBackup() {
  if (started || import.meta.env.VITE_EMBED === '1') return;
  started = true;
  for (const t of db.tables) {
    if (t.name === 'audit') continue;
    const skip = (key: unknown) => pause || (t.name === 'settings' && LOCAL_ONLY_SETTINGS.includes(String(key)));
    t.hook('creating', (key, obj) => { if (!skip(t.name === 'settings' ? (obj as { key?: string }).key : key)) markChanged(); });
    t.hook('updating', (_m, key) => { if (!skip(key)) markChanged(); });
    t.hook('deleting', (key) => { if (!skip(key)) markChanged(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) { window.clearTimeout(timer); timer = undefined; backupNow().catch(() => {}); } });
  window.addEventListener('online', () => backupNow().catch(() => {}));

  const [link, folder, book] = await Promise.all([getLink(), getFolder(), getBook()]);
  useBackup.setState({
    drive: link ? { status: 'ok', email: link.email, at: book.driveAt } : { status: 'off' },
    phone: folder ? { status: (await folderPermission(folder.handle)) === 'granted' ? 'ok' : 'needs_permission', name: folder.name, at: book.phoneAt } : { status: 'off' },
  });
  if (await getAccount()) {
    const r = await syncFromAccount().catch(() => 'none');
    if (r === 'updated') (await import('../store/ui')).useUI.getState().toast('Updated with the latest data from your account');
  }
  if (link) await checkForNewer().catch(() => {});
  // Catch up if the last backup is older than 12 hours (or never happened).
  backupNow().catch(() => {});
}
