import { useLiveQuery } from 'dexie-react-hooks';
import { CloudCog, Fingerprint, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db, getSetting } from '../db/db';
import { accountsEnabled, changePassword, checkPassword, deleteAccount, getAccount, signOut, useAccount, type AccountLink } from '../lib/account';
import { backupNow } from '../lib/autoBackup';
import { biometricAvailable, disableBiometric, enableBiometric, getPasskey } from '../lib/biometric';
import { askConfirm, useUI } from '../store/ui';
import { AuthFlow } from './AuthFlow';
import { DEFAULT_LOCK, type LockPrefs } from './Lock';
import { Panel, Segmented, Sheet } from './ui';

const toast = (t: string) => useUI.getState().toast(t);
const when = (t?: number) => {
  if (!t) return 'not yet';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

/** Settings → Account: sign-in, sync, fingerprint / Face ID and when to ask for it. */
export function AccountPanel() {
  const enabled = useLiveQuery(() => accountsEnabled(), []);
  const account = useLiveQuery(async () => (await getAccount()) ?? null, []) as AccountLink | null | undefined;
  const passkey = useLiveQuery(async () => (await getPasskey()) ?? null, []);
  const prefs = useLiveQuery(async () => (await getSetting<LockPrefs | null>('lockPrefs', null)) ?? DEFAULT_LOCK, []);
  const sync = useAccount();
  const [canBio, setCanBio] = useState(false);
  const [auth, setAuth] = useState<null | 'signin' | 'signup'>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState('');
  useEffect(() => { biometricAvailable().then(setCanBio); }, []);

  if (import.meta.env.VITE_EMBED === '1' || account === undefined) return null;

  return (
    <Panel title={<span className="flex items-center gap-2"><UserRound size={18} className="text-primary" /> Account & unlock</span>}>
      {account ? (
        <div className="space-y-1">
          <p className="text-sm">Signed in as <b className="break-all">{account.email}</b></p>
          <p className={`text-sm ${sync.status === 'error' ? 'text-warn' : 'text-muted'}`}>
            {sync.status === 'syncing' ? 'Syncing…' : sync.status === 'error' ? sync.message : `Synced to your account ${when(sync.at ?? account.syncedAt)}`} · encrypted on this phone before upload
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn-soft" disabled={!!busy} onClick={async () => { setBusy('sync'); try { await backupNow(true); toast('Synced'); } finally { setBusy(''); } }}>
              <RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} /> Sync now
            </button>
            <button className="btn-soft" onClick={() => setPwOpen(true)}>Change password</button>
            <button className="btn-ghost text-muted" onClick={async () => {
              if (!(await askConfirm('Sign out on this phone? Your data stays safe in your account. Choose whether to keep a copy on this phone next.', 'Sign out', false))) return;
              const removeLocal = await askConfirm('Also remove your household from this phone? Recommended if others use it.', 'Remove from this phone', true);
              await signOut();
              await disableBiometric();
              if (removeLocal) { const { wipeAll } = await import('../db/seed'); await wipeAll(); location.reload(); }
              else toast('Signed out');
            }}><LogOut size={16} /> Sign out</button>
          </div>
        </div>
      ) : enabled ? (
        <div className="space-y-3">
          <p className="sub">Create a free account to use this household on any phone or computer, synced and end-to-end encrypted. Your current data comes with you.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setAuth('signup')}>Create an account</button>
            <button className="btn-soft" onClick={() => setAuth('signin')}>Sign in</button>
          </div>
        </div>
      ) : (
        <p className="sub">Accounts aren’t switched on for this app yet. You can still lock it with fingerprint / Face ID below.</p>
      )}

      <div className="mt-5 pt-4 border-t border-line/70 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2"><Fingerprint size={16} className="text-primary" /> Unlock with fingerprint, Face ID or passcode</p>
            <p className="text-xs text-muted mt-0.5">{canBio ? 'Tandem asks every time it opens and when you come back to it.' : 'This phone or browser doesn’t offer it. Install Tandem on your home screen and use Chrome (Android) or Safari (iPhone).'}</p>
          </div>
          <button role="switch" aria-checked={!!passkey} disabled={!canBio || !!busy} aria-label="Unlock with fingerprint, Face ID or passcode"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${passkey ? 'bg-primary' : 'bg-line'}`}
            onClick={async () => {
              setBusy('bio');
              try {
                if (passkey) { await disableBiometric(); toast('Fingerprint / Face ID unlock is off'); }
                else { await enableBiometric(account?.email ?? 'Tandem'); toast('Fingerprint / Face ID unlock is on'); }
              } catch (e) { toast((e as Error).name === 'NotAllowedError' ? 'Setup was cancelled' : (e as Error).message); } finally { setBusy(''); }
            }}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition-all ${passkey ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        {(passkey || account) && prefs && (
          <div>
            <p className="label">Ask to unlock when I come back after</p>
            <Segmented<string> label="Lock after" value={String(prefs.after)} onChange={(v) => db.settings.put({ key: 'lockPrefs', value: { after: Number(v) } })}
              options={[{ value: '0', label: 'Any time' }, { value: '30', label: '30 sec' }, { value: '60', label: '1 min' }, { value: '300', label: '5 min' }]} />
            <p className="text-xs text-muted mt-1">It always asks when Tandem is opened fresh.</p>
          </div>
        )}
        {account && <button className="text-sm font-semibold text-bad" onClick={() => setDelOpen(true)}>Delete my account</button>}
      </div>

      <Sheet open={!!auth} onOpenChange={(o) => !o && setAuth(null)} title={auth === 'signup' ? 'Create an account' : 'Sign in'}>
        {auth && <AuthFlow start={auth} onDone={() => { setAuth(null); toast('You’re signed in'); }} />}
      </Sheet>
      <PasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
      <DeleteSheet open={delOpen} onClose={() => setDelOpen(false)} />
    </Panel>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [c, setC] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Change password">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const weak = checkPassword(b); if (weak) return setErr(weak);
        if (b !== c) return setErr('The new passwords don’t match.');
        setBusy(true); setErr('');
        try { await changePassword(a, b); toast('Password changed'); setA(''); setB(''); setC(''); onClose(); }
        catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
      }}>
        <label className="block"><span className="label">Current password</span><input type="password" className="field" autoComplete="current-password" value={a} onChange={(e) => setA(e.target.value)} /></label>
        <label className="block"><span className="label">New password</span><input type="password" className="field" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></label>
        <label className="block"><span className="label">New password again</span><input type="password" className="field" autoComplete="new-password" value={c} onChange={(e) => setC(e.target.value)} /></label>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <p className="text-xs text-muted">Your recovery key keeps working.</p>
        <button className="btn-primary w-full" disabled={busy || !a || !b}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </Sheet>
  );
}

function DeleteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Delete your account">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { await deleteAccount(pw); await disableBiometric(); toast('Account deleted. Your data is still on this phone.'); onClose(); }
        catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
      }}>
        <p className="text-sm">This permanently deletes your account and the encrypted copy of your data on the server. The data on this phone stays until you erase it in Settings.</p>
        <label className="block"><span className="label">Password</span><input type="password" className="field" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button className="btn w-full bg-bad text-white" disabled={busy || !pw}><CloudCog size={16} /> {busy ? 'Deleting…' : 'Delete my account'}</button>
      </form>
    </Sheet>
  );
}
