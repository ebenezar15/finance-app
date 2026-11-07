import { Delete, Fingerprint, Lock, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db, getSetting } from '../db/db';
import { getAccount, signOut, verifyPasswordLocally, type AccountLink } from '../lib/account';
import { getPasskey, unlockWithBiometric } from '../lib/biometric';
import { hashPin } from '../lib/crypto';
import { askConfirm, useUI } from '../store/ui';
import iconUrl from '../assets/icon.svg';

export interface PinRecord { salt: string; hash: string; autoLockMin: number }
/** How long Tandem may stay in the background before it asks to unlock again (seconds). */
export interface LockPrefs { after: number }
export const DEFAULT_LOCK: LockPrefs = { after: 30 };

/** Unlocking is required when fingerprint/Face ID is set up, an account is signed in, or a PIN exists. */
async function lockMethods() {
  const [passkey, account, pin] = await Promise.all([getPasskey(), getAccount(), getSetting<PinRecord | null>('pin', null)]);
  return { passkey, account, pin, required: !!(passkey || account || pin) };
}

/**
 * Locks when the app opens, and when it comes back after more than `after` seconds in the
 * background. A short grace period keeps file pickers and sign-in pop-ups from locking you out.
 */
export function useAutoLock() {
  const setLocked = useUI((s) => s.setLocked);
  useEffect(() => {
    let hiddenAt = 0;
    let after = DEFAULT_LOCK.after;
    let required = false;
    lockMethods().then(async (m) => {
      required = m.required;
      after = ((await getSetting<LockPrefs | null>('lockPrefs', null)) ?? DEFAULT_LOCK).after;
      if (required) setLocked(true);
    });
    const onVis = async () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (!hiddenAt) return;
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      const m = await lockMethods();
      after = ((await getSetting<LockPrefs | null>('lockPrefs', null)) ?? DEFAULT_LOCK).after;
      if (m.required && away >= after) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [setLocked]);
}

export function LockScreen() {
  const setLocked = useUI((s) => s.setLocked);
  const [m, setM] = useState<{ passkey: unknown; account: AccountLink | null; pin: PinRecord | null } | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'bio' | 'password' | 'pin'>('bio');
  const [pw, setPw] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    (async () => {
      const methods = await lockMethods();
      if (!methods.required) { setLocked(false); return; }
      setM(methods);
      const profile = (await db.settings.get('profile'))?.value as { primaryUser?: string } | undefined;
      setName(profile?.primaryUser || methods.account?.name || '');
      setMode(methods.passkey ? 'bio' : methods.account ? 'password' : 'pin');
    })();
  }, [setLocked]);

  const bio = async () => {
    setErr(''); setBusy(true);
    try {
      if (await unlockWithBiometric()) setLocked(false);
      else setErr('That didn’t work. Try again, or use your password.');
    } catch (e) {
      const n = (e as Error).name;
      setErr(n === 'NotAllowedError' ? 'Unlock was cancelled. Tap to try again.' : 'Fingerprint / Face ID isn’t available right now. Use your password.');
    } finally { setBusy(false); }
  };
  // Prompt straight away (some phones need a tap first; the button covers that).
  useEffect(() => { if (m?.passkey && mode === 'bio' && !tried.current) { tried.current = true; bio(); } }, [m, mode]);

  useEffect(() => {
    if (mode !== 'pin' || pin.length < 4 || !m?.pin) return;
    hashPin(pin, m.pin.salt).then(({ hash }) => {
      if (hash === m.pin!.hash) setLocked(false);
      else if (pin.length >= 6) { setErr('That PIN didn’t match. Try again.'); setPin(''); }
    });
  }, [pin, mode, m, setLocked]);

  if (!m) return <div className="min-h-screen bg-bg" />;
  return (
    <div className="min-h-screen grid place-items-center bg-bg px-6 py-10">
      <div className="w-full max-w-xs text-center">
        <img src={iconUrl} alt="" className="mx-auto h-14 w-14 rounded-2xl mb-4" />
        <h1 className="text-2xl font-extrabold tracking-tight">{name ? `Welcome back, ${name}` : 'Welcome back'}</h1>
        {m.account && <p className="sub mt-1 break-all">{m.account.email}</p>}

        {mode === 'bio' && (
          <div className="mt-8 space-y-4">
            <button className="mx-auto h-24 w-24 rounded-full bg-primary/10 text-primary grid place-items-center active:scale-95 transition-transform" onClick={bio} disabled={busy} aria-label="Unlock with fingerprint or Face ID">
              <Fingerprint size={52} />
            </button>
            <p className="font-semibold">{busy ? 'Waiting for your phone…' : 'Unlock with fingerprint, Face ID or passcode'}</p>
          </div>
        )}

        {mode === 'password' && (
          <form className="mt-8 space-y-3 text-left" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setErr('');
            if (await verifyPasswordLocally(pw)) setLocked(false); else setErr('That password isn’t right.');
            setBusy(false);
          }}>
            <label className="block" htmlFor="lk-pw"><span className="label">Password</span>
              <input id="lk-pw" type="password" autoFocus autoComplete="current-password" className="field h-12" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <button className="btn-primary w-full h-12" disabled={busy || !pw}><Lock size={16} /> {busy ? 'Checking…' : 'Unlock'}</button>
          </form>
        )}

        {mode === 'pin' && (
          <>
            <p className="font-semibold mt-6">Enter your PIN</p>
            <div className="flex justify-center gap-3 my-5" aria-label={`${pin.length} digits entered`}>
              {Array.from({ length: 6 }, (_, i) => <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? 'bg-primary' : 'bg-line'}`} />)}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k === '' ? <span key="x" /> : (
                <button key={k} className="h-16 rounded-2xl bg-surface border border-line text-2xl font-bold active:scale-95 transition-transform" aria-label={k === '⌫' ? 'Delete' : k}
                  onClick={() => { setErr(''); setPin((p) => (k === '⌫' ? p.slice(0, -1) : (p + k).slice(0, 6))); }}>
                  {k === '⌫' ? <Delete className="mx-auto" /> : k}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="text-sm text-bad mt-4 min-h-5" role="alert">{err}</p>

        <div className="mt-4 flex flex-col gap-2 text-sm font-semibold text-primary">
          {mode !== 'bio' && !!m.passkey && <button onClick={() => { setErr(''); setMode('bio'); bio(); }}>Use fingerprint / Face ID</button>}
          {mode !== 'password' && m.account && <button onClick={() => { setErr(''); setMode('password'); }}>Use my password instead</button>}
          {mode !== 'pin' && m.pin && <button onClick={() => { setErr(''); setMode('pin'); }}>Use my PIN</button>}
          {m.account && (
            <button className="text-muted inline-flex items-center justify-center gap-1.5" onClick={async () => {
              if (!(await askConfirm('Sign out and remove your data from this phone? It stays safe in your account; sign in again to get it back (use “Forgot password?” with your recovery key if needed).', 'Sign out'))) return;
              await signOut();
              await db.settings.delete('passkey');
              const { wipeAll } = await import('../db/seed');
              await wipeAll();
              location.reload();
            }}><LogOut size={14} /> Forgot it? Sign out</button>
          )}
        </div>
      </div>
    </div>
  );
}
