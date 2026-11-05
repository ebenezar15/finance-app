/**
 * Google Drive backup. The person signs in once with Google (the account behind their Gmail);
 * Tandem then keeps a "Tandem backups" folder in their Drive up to date on its own.
 *
 * Scope is `drive.file`: Tandem can only see and change files it created itself, never the
 * rest of the person's Drive. The one-time sign-in code is exchanged for a refresh token by the
 * app's own server (/api/google/*), which holds the client secret; the refresh token is kept on
 * this device so later backups need no sign-in prompt.
 */
import { db } from '../db/db';

export const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';
const FOLDER = 'Tandem backups';
const FILE_PREFIX = 'tandem-backup-';
const KEEP_DAILY = 30;

export interface DriveLink { refreshToken: string; email?: string; folderId?: string; connectedAt: number }
export interface DriveFile { id: string; name: string; modifiedTime: string; size?: string; appProperties?: Record<string, string> }

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Tests swap the network layer. */
export function _setFetch(f: Fetch) { fetchImpl = f; access = null; }

export class DriveError extends Error {
  constructor(public code: 'not_configured' | 'not_connected' | 'signed_out' | 'offline' | 'failed', message: string) { super(message); }
}

/* ───────── configuration & sign-in ───────── */

let cfg: { enabled: boolean; clientId: string | null } | null = null;
export async function driveConfig() {
  if (cfg) return cfg;
  try {
    const r = await fetchImpl('/api/google/config', { cache: 'no-store' });
    cfg = r.ok ? await r.json() : { enabled: false, clientId: null };
  } catch {
    return { enabled: false, clientId: null }; // offline: try again next time
  }
  return cfg!;
}

export async function getLink(): Promise<DriveLink | null> {
  return ((await db.settings.get('gdrive'))?.value as DriveLink | undefined) ?? null;
}
async function saveLink(link: DriveLink | null) {
  if (link) await db.settings.put({ key: 'gdrive', value: link });
  else await db.settings.delete('gdrive');
}

function loadGis(): Promise<GoogleOAuth> {
  const g = (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts?.oauth2;
  if (g) return Promise.resolve(g);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      const o = (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts?.oauth2;
      if (o) resolve(o); else reject(new DriveError('failed', 'Google sign-in didn’t load. Check your connection and try again.'));
    };
    s.onerror = () => reject(new DriveError('offline', 'Couldn’t reach Google. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}
interface GoogleOAuth {
  initCodeClient(o: { client_id: string; scope: string; ux_mode: 'popup'; prompt?: string; login_hint?: string; callback: (r: { code?: string; error?: string }) => void; error_callback?: (e: { type?: string }) => void }): { requestCode(): void };
}

function emailFromIdToken(idToken?: string) {
  try {
    const payload = JSON.parse(atob(idToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch { return undefined; }
}

/** Opens Google's sign-in, stores the long-lived link on this device and returns the email. */
export async function connectDrive(loginHint?: string): Promise<string | undefined> {
  const c = await driveConfig();
  if (!c.enabled || !c.clientId) throw new DriveError('not_configured', 'Google Drive backup hasn’t been switched on for this app yet.');
  const oauth = await loadGis();
  const code = await new Promise<string>((resolve, reject) => {
    oauth.initCodeClient({
      // 'select_account' always shows Google's account chooser, so each person picks their own
      // account (even on a phone signed in to several); 'consent' makes Google return a refresh token.
      client_id: c.clientId!, scope: SCOPES, ux_mode: 'popup', prompt: 'select_account consent', login_hint: loginHint,
      callback: (r) => (r.code ? resolve(r.code) : reject(new DriveError('failed', 'Google sign-in was cancelled.'))),
      error_callback: () => reject(new DriveError('failed', 'Google sign-in was closed before it finished.')),
    }).requestCode();
  });
  const r = await fetchImpl('/api/google/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new DriveError('failed', 'Google didn’t grant access. Try connecting again and tick the Drive permission.');
  access = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  const email = emailFromIdToken(j.id_token);
  await saveLink({ refreshToken: j.refresh_token, email, connectedAt: Date.now() });
  return email;
}

/**
 * Signs this device out of Google Drive and asks Google to revoke Tandem's access for that
 * account (best effort: if offline, the token is still forgotten on this device).
 */
export async function disconnectDrive() {
  const link = await getLink();
  access = null;
  await saveLink(null);
  if (link?.refreshToken) {
    await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(link.refreshToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {});
  }
}

/** Signs out of the current Google account and opens the chooser for another one. */
export async function switchDriveAccount() {
  await disconnectDrive();
  return connectDrive();
}

let access: { token: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (access && access.until > Date.now()) return access.token;
  const link = await getLink();
  if (!link) throw new DriveError('not_connected', 'Google Drive isn’t connected on this device.');
  let r: Response;
  try {
    r = await fetchImpl('/api/google/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: link.refreshToken }) });
  } catch {
    throw new DriveError('offline', 'You’re offline. Backups will catch up when you’re back online.');
  }
  if (r.status === 401) throw new DriveError('signed_out', 'Google signed this device out. Connect Google Drive again to keep backing up.');
  if (!r.ok) throw new DriveError('failed', 'Google Drive didn’t respond. Backups will retry shortly.');
  const j = await r.json();
  access = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return access.token;
}

async function api(path: string, init: RequestInit = {}, base = 'https://www.googleapis.com/drive/v3') {
  const token = await accessToken();
  let r: Response;
  try {
    r = await fetchImpl(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError('offline', 'You’re offline. Backups will catch up when you’re back online.');
  }
  if (r.status === 401) { access = null; throw new DriveError('signed_out', 'Google signed this device out. Connect Google Drive again.'); }
  if (!r.ok) throw new DriveError('failed', `Google Drive returned an error (${r.status}).`);
  return r;
}

/* ───────── folder & files ───────── */

async function folderId(): Promise<string> {
  const link = await getLink();
  if (link?.folderId) return link.folderId;
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await api(`/files?q=${q}&fields=files(id,name)&spaces=drive`)).json();
  let id: string | undefined = found.files?.[0]?.id;
  if (!id) {
    const made = await (await api('/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    id = made.id;
  }
  if (link) await saveLink({ ...link, folderId: id });
  return id!;
}

export async function listDriveBackups(): Promise<DriveFile[]> {
  const parent = await folderId();
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false and name contains '${FILE_PREFIX}'`);
  const j = await (await api(`/files?q=${q}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,modifiedTime,size,appProperties)`)).json();
  return j.files ?? [];
}

/**
 * Writes today's backup file (one per day, updated in place through the day) and trims the
 * history to the last 30 days.
 */
export async function uploadDriveBackup(json: string, meta: { device: string; updatedAt: number; transactions: number }, today = new Date()) {
  const parent = await folderId();
  const name = `${FILE_PREFIX}${today.toISOString().slice(0, 10)}.json`;
  const files = await listDriveBackups();
  const existing = files.find((f) => f.name === name);
  const appProperties = { tandem: '1', device: meta.device, updatedAt: String(meta.updatedAt), transactions: String(meta.transactions) };
  const boundary = `tandem${Math.random().toString(36).slice(2)}`;
  const metadata = existing ? { appProperties } : { name, parents: [parent], mimeType: 'application/json', appProperties };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const path = existing ? `/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime` : '/files?uploadType=multipart&fields=id,modifiedTime';
  const saved = await (await api(path, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, 'https://www.googleapis.com/upload/drive/v3')).json();
  // Keep a month of daily copies; older ones are removed (only files Tandem created).
  const old = files.filter((f) => f.name !== name).slice(KEEP_DAILY - 1);
  for (const f of old) await api(`/files/${f.id}`, { method: 'DELETE' }).catch(() => {});
  return saved as { id: string; modifiedTime: string };
}

export async function downloadDriveBackup(id: string): Promise<unknown> {
  return (await api(`/files/${id}?alt=media`)).json();
}
