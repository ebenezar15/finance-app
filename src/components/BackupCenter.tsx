import { useLiveQuery } from 'dexie-react-hooks';
import { CloudUpload, FolderOpen, HardDrive, History, RefreshCw, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { describeSnapshot, folderSupported, chooseFolder, findNewestInFolder, folderPermission, forgetFolder, getFolder, readBackupFile } from '../lib/phoneBackup';
import { backupNow, checkForNewer, restoreFromDrive, restoreSnapshot, useBackup } from '../lib/autoBackup';
import { connectDrive, disconnectDrive, driveConfig, listDriveBackups, type DriveFile } from '../lib/gdrive';
import { decryptJSON } from '../lib/crypto';
import { asSnapshot, snapshot, type Snapshot } from '../db/backup';
import { db } from '../db/db';
import { APP_LOCALE } from '../lib/locale';
import { saveFile, shareFile, canShareFiles } from '../lib/download';
import { isIOS, isStandalone } from './InstallApp';
import { askConfirm, useUI } from '../store/ui';
import { Panel, Sheet } from './ui';

const when = (t?: number) => {
  if (!t) return 'not yet';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(t).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const toast = (t: string) => useUI.getState().toast(t);

/** Settings panel: automatic backups to Google Drive and to a folder on the phone, plus restore. */
export function BackupCenter() {
  const { drive, phone } = useBackup();
  const cfg = useLiveQuery(() => driveConfig(), []);
  const persisted = usePersisted();
  const [busy, setBusy] = useState('');
  const [list, setList] = useState<DriveFile[] | null>(null);
  const [err, setErr] = useState('');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setErr('');
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /> Automatic backup</span>}>
      <p className="sub mb-4">Your data lives in this browser, which phones sometimes clear. Keep automatic copies in your Google account and on the phone so you can always get it back.</p>

      {/* Google Drive */}
      <div className="rounded-2xl border border-line p-4 space-y-3">
        <div className="flex items-start gap-3">
          <CloudUpload size={20} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold">Google Drive (your Gmail account)</p>
            {drive.status === 'off' ? (
              <p className="sub">Backs up after every change into a private “Tandem backups” folder. Tandem can only see files it creates.</p>
            ) : (
              <p className="text-sm">
                {drive.email ? <>Backing up to <b className="break-all">{drive.email}</b></> : 'Connected'} · last backup {when(drive.at)}
                {drive.status === 'saving' && <span className="text-primary"> · saving…</span>}
              </p>
            )}
            {(drive.status === 'error' || drive.status === 'offline' || drive.status === 'signed_out') && <p className="text-sm text-warn mt-1">{drive.message}</p>}
          </div>
        </div>
        {cfg && !cfg.enabled && drive.status === 'off' ? (
          <p className="text-xs text-muted rounded-xl bg-sunk/70 p-3">Google Drive backup needs a one-time setup on the app’s website (a Google sign-in key). Until then, use the phone folder below.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(drive.status === 'off' || drive.status === 'signed_out') && (
              <button className="btn-primary" disabled={!!busy} onClick={() => run('connect', async () => {
                const email = await connectDrive();
                toast(`Connected ${email ?? 'Google Drive'}. Backing up now…`);
                useBackup.setState({ drive: { status: 'ok', email } });
                await backupNow(true);
              })}>{busy === 'connect' ? 'Connecting…' : drive.status === 'signed_out' ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>
            )}
            {drive.status !== 'off' && drive.status !== 'signed_out' && (
              <>
                <button className="btn-soft" disabled={!!busy} onClick={() => run('now', async () => { await backupNow(true); toast('Backed up to Google Drive'); })}>
                  <RefreshCw size={16} className={busy === 'now' ? 'animate-spin' : ''} /> Back up now
                </button>
                <button className="btn-soft" disabled={!!busy} onClick={() => run('list', async () => setList(await listDriveBackups()))}><History size={16} /> Restore…</button>
                <button className="btn-ghost text-muted" disabled={!!busy} onClick={async () => {
                  if (!(await askConfirm('Stop backing up to Google Drive on this phone? Backups already in Drive stay there.', 'Disconnect', false))) return;
                  await disconnectDrive(); useBackup.setState({ drive: { status: 'off' } });
                }}>Disconnect</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Phone folder */}
      <div className="rounded-2xl border border-line p-4 space-y-3 mt-3">
        <div className="flex items-start gap-3">
          <HardDrive size={20} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold">On this phone</p>
            {folderSupported() ? (
              phone.status === 'off'
                ? <p className="sub">Choose a folder (for example Documents) and Tandem saves a dated copy there automatically. A fresh install can find it and restore.</p>
                : <p className="text-sm">Saving to folder <b>{phone.name}</b> · last copy {when(phone.at)}</p>
            ) : (
              <p className="sub">This browser can’t write to a folder by itself, so save a copy from time to time. Tandem reminds you, and can read the file back.</p>
            )}
            {phone.status === 'needs_permission' && <p className="text-sm text-warn mt-1">Tap “Allow” so Tandem can keep saving to this folder.</p>}
            {phone.status === 'error' && <p className="text-sm text-warn mt-1">{phone.message}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {folderSupported() && phone.status === 'off' && (
            <button className="btn-primary" disabled={!!busy} onClick={() => run('folder', async () => {
              const name = await chooseFolder(); useBackup.setState({ phone: { status: 'ok', name } }); await backupNow(true); toast(`Saving backups to ${name}`);
            })}><FolderOpen size={16} /> Choose backup folder</button>
          )}
          {phone.status === 'needs_permission' && (
            <button className="btn-primary" onClick={() => run('allow', async () => {
              const f = await getFolder(); if (f && (await folderPermission(f.handle, true)) === 'granted') { useBackup.setState({ phone: { status: 'ok', name: f.name } }); await backupNow(true); }
            })}>Allow</button>
          )}
          {folderSupported() && phone.status !== 'off' && (
            <button className="btn-ghost text-muted" onClick={async () => { await forgetFolder(); useBackup.setState({ phone: { status: 'off' } }); }}>Stop saving here</button>
          )}
          <button className="btn-soft" disabled={!!busy} onClick={() => run('copy', async () => {
            const snap = await snapshot();
            const name = `tandem-backup-${new Date().toISOString().slice(0, 10)}.json`;
            const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
            const ok = canShareFiles() ? await shareFile(name, blob, 'Tandem backup') : await saveFile(name, blob);
            if (ok) { await db.settings.put({ key: 'lastBackup', value: Date.now() }); toast('Backup copy saved'); }
          })}><Upload size={16} /> Save a copy now</button>
        </div>
      </div>

      <RestoreFromPhone className="mt-3" />

      {err && <p role="alert" className="mt-3 flex gap-2 text-sm text-bad"><TriangleAlert size={16} className="shrink-0 mt-0.5" />{err}</p>}

      <div className="mt-4 rounded-xl bg-sunk/60 p-3 text-xs text-muted space-y-1">
        <p><b className="text-ink">Storage on this phone:</b> {persisted === null ? 'checking…' : persisted ? 'protected from automatic clean-up.' : 'the browser may clear it when space is low.'}</p>
        {isIOS && !isStandalone() && <p><b className="text-ink">iPhone:</b> Safari deletes website data after 7 days without opening it. Add Tandem to your Home Screen (Share → Add to Home Screen) to stop that.</p>}
      </div>

      <Sheet open={!!list} onOpenChange={(o) => !o && setList(null)} title="Restore from Google Drive" description="Pick a backup. This replaces the data on this phone.">
        {list?.length === 0 && <p className="sub">No backups in Drive yet. Tap “Back up now” first.</p>}
        <ul className="space-y-2">
          {list?.map((f) => (
            <li key={f.id}>
              <button className="w-full text-left rounded-xl bg-sunk/70 hover:bg-sunk px-4 py-3" onClick={async () => {
                if (!(await askConfirm(`Replace everything on this phone with the backup from ${new Date(f.modifiedTime).toLocaleString(APP_LOCALE)}?`, 'Restore'))) return;
                setList(null);
                await run('restore', async () => { await restoreFromDrive(f.id); toast('Restored from Google Drive'); });
              }}>
                <p className="font-semibold">{new Date(f.modifiedTime).toLocaleString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                <p className="text-xs text-muted">{f.appProperties?.transactions ?? '?'} entries · {f.name}</p>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </Panel>
  );
}

function usePersisted() {
  const [p, setP] = useState<boolean | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setP).catch(() => setP(false)); }, []);
  return p;
}

/** Restore from a backup file on the phone: pick the file, or (where possible) point at a folder. */
export function RestoreFromPhone({ className = '', compact = false, onDone }: { className?: string; compact?: boolean; onDone?: () => void }) {
  const [found, setFound] = useState<{ snap?: Snapshot; envelope?: unknown; name: string } | null>(null);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const take = async (file: File) => {
    setErr('');
    try {
      const r = await readBackupFile(file);
      setFound(r.kind === 'plain' ? { snap: r.snap, name: file.name } : { envelope: r.envelope, name: file.name });
    } catch (e) { setErr((e as Error).message); }
  };
  const doRestore = async () => {
    if (!found) return;
    setBusy(true); setErr('');
    try {
      const snap = found.snap ?? asSnapshot(await decryptJSON(found.envelope as never, pass));
      if (!(await askConfirm('Replace everything on this phone with this backup?', 'Restore'))) return;
      await restoreSnapshot(snap);
      useUI.getState().toast('Backup restored');
      setFound(null); setPass('');
      onDone?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const info = found?.snap ? describeSnapshot(found.snap) : null;

  return (
    <div className={`${compact ? '' : 'rounded-2xl border border-line p-4'} space-y-3 ${className}`}>
      {!compact && <p className="font-bold">Restore from a backup on this phone</p>}
      {!found ? (
        <div className="flex flex-wrap gap-2">
          <label className="btn-soft cursor-pointer">
            <Upload size={16} /> Pick a backup file
            <input type="file" className="sr-only" accept=".json,.tandem,application/json" onChange={(e) => e.target.files?.[0] && take(e.target.files[0])} />
          </label>
          {folderSupported() && (
            <button className="btn-soft" onClick={async () => {
              setErr('');
              try { const f = await findNewestInFolder(); if (f) await take(f.file); else setErr('No Tandem backups in that folder. Try your Downloads or Documents folder.'); }
              catch (e) { if ((e as Error).name !== 'AbortError') setErr('Couldn’t open that folder.'); }
            }}><FolderOpen size={16} /> Find the newest in a folder</button>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-sunk/70 p-3 space-y-2">
          <p className="text-sm"><b>{found.name}</b>{info && <> · {info.when.toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · {info.entries} entries, {info.accounts} accounts</>}</p>
          {found.envelope != null && (
            <label className="block"><span className="label">This backup has a password</span>
              <input type="password" className="field" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || (found.envelope != null && !pass)} onClick={doRestore}>{busy ? 'Restoring…' : 'Restore this backup'}</button>
            <button className="btn-ghost" onClick={() => { setFound(null); setPass(''); }}>Choose another</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
    </div>
  );
}

/** Banner shown when another device has saved newer data to Drive. */
export function NewerDataBanner() {
  const newer = useBackup((s) => s.newer);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onFocus = () => { if (!document.hidden) checkForNewer().catch(() => {}); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);
  if (!newer) return null;
  return (
    <div className="mb-4 md:mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-indigo/10 px-4 py-3 text-sm" role="status">
      <p className="flex-1 min-w-[14rem]"><b>Newer data from your other device</b> ({new Date(newer.at).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}). Update this phone to match?</p>
      <button className="btn-primary h-9" disabled={busy} onClick={async () => {
        if (!(await askConfirm('Replace the data on this phone with the newer copy from Google Drive?', 'Update', false))) return;
        setBusy(true);
        try { await restoreFromDrive(newer.id); toast('Updated from Google Drive'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? 'Updating…' : 'Update'}</button>
      <button className="btn-ghost h-9" onClick={() => useBackup.setState({ newer: undefined })}>Not now</button>
    </div>
  );
}

/** First-screen restore options for a fresh or wiped app. */
export function RestoreOnWelcome() {
  const cfg = useLiveQuery(() => driveConfig(), []);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (import.meta.env.VITE_EMBED === '1') return null;
  return (
    <div className="mt-2 rounded-2xl border border-line p-4 space-y-3">
      <p className="font-bold">Already have Tandem data?</p>
      {cfg?.enabled && (
        <button className="btn-soft w-full h-12" disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try {
            const email = await connectDrive();
            await restoreFromDrive();
            useBackup.setState({ drive: { status: 'ok', email } });
            toast(`Restored your data from ${email ?? 'Google Drive'}`);
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}><CloudUpload size={18} /> {busy ? 'Restoring…' : 'Restore from Google Drive'}</button>
      )}
      <RestoreFromPhone compact />
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
    </div>
  );
}
