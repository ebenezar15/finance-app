import { ArrowLeft, Check, Copy, Eye, EyeOff, Fingerprint, KeyRound, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { snapshot, type Snapshot } from '../db/backup';
import { db } from '../db/db';
import { checkPassword, getAccount, pullVault, pushVault, recoverAccount, signIn, signUp } from '../lib/account';
import { restoreSnapshot } from '../lib/autoBackup';
import { biometricAvailable, enableBiometric } from '../lib/biometric';
import { deviceId } from '../db/backup';
import { saveFile } from '../lib/download';
import { useUI } from '../store/ui';

type Mode = 'signin' | 'signup' | 'recover' | 'recovery-key' | 'biometric' | 'choose-data';

/**
 * Sign in / create account / forgot password, then the follow-up steps: show the recovery key
 * once, offer fingerprint / Face ID, and decide what happens to the data on this phone.
 * `onDone(hasHousehold)` tells the caller whether a household is now on the phone.
 */
export function AuthFlow({ start = 'signin', onDone, onBack }: { start?: 'signin' | 'signup'; onDone: (hasHousehold: boolean) => void; onBack?: () => void }) {
  const [mode, setMode] = useState<Mode>(start);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [recovery, setRecovery] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [remote, setRemote] = useState<Snapshot | null>(null);
  const [canBio, setCanBio] = useState(false);
  useEffect(() => { biometricAvailable().then(setCanBio); }, []);

  const localHousehold = async () => !!((await db.settings.get('profile'))?.value as { onboarded?: boolean } | undefined)?.onboarded;
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  /** After any successful sign-in: fetch the account's data and reconcile with this phone. */
  async function afterSignIn() {
    const pulled = await pullVault();
    const hasLocal = await localHousehold();
    if (pulled && hasLocal) { setRemote(pulled.snapshot as Snapshot); setMode('choose-data'); return; }
    if (pulled) await restoreSnapshot(pulled.snapshot as Snapshot);
    else if (hasLocal) await pushVault(JSON.stringify(await snapshot()), { updatedAt: Date.now(), device: deviceId() });
    await nextAfterData();
  }
  async function nextAfterData() {
    if (canBio && !(await db.settings.get('passkey'))) setMode('biometric');
    else onDone(await localHousehold());
  }

  const field = 'field h-12 text-base';
  const header = (title: string, sub?: string) => (
    <div className="mb-5">
      {onBack && (mode === 'signin' || mode === 'signup') && <button className="btn-ghost h-9 -ml-3 mb-2 text-muted" onClick={onBack}><ArrowLeft size={16} /> Back</button>}
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      {sub && <p className="sub mt-1">{sub}</p>}
    </div>
  );
  const pwInput = (value: string, set: (v: string) => void, label: string, id: string, autoComplete: string) => (
    <label className="block" htmlFor={id}><span className="label">{label}</span>
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} className={`${field} pr-12`} value={value} onChange={(e) => set(e.target.value)} autoComplete={autoComplete} />
        <button type="button" className="absolute right-1 top-1 h-10 w-10 grid place-items-center text-muted" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div></label>
  );
  const error = err && <p role="alert" className="text-sm text-bad">{err}</p>;

  if (mode === 'signin') return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go(async () => { await signIn(email, password); await afterSignIn(); }); }}>
      {header('Sign in', 'Use the email and password of your Tandem account.')}
      <label className="block" htmlFor="au-email"><span className="label">Email</span><input id="au-email" type="email" inputMode="email" autoComplete="username" className={field} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {pwInput(password, setPassword, 'Password', 'au-pw', 'current-password')}
      {error}
      <button className="btn-primary w-full h-12 text-base" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="flex justify-between text-sm">
        <button type="button" className="font-semibold text-primary" onClick={() => { setErr(''); setMode('recover'); }}>Forgot password?</button>
        <button type="button" className="font-semibold text-primary" onClick={() => { setErr(''); setMode('signup'); }}>Create an account</button>
      </div>
    </form>
  );

  if (mode === 'signup') return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const weak = checkPassword(password);
      if (weak) return setErr(weak);
      if (password !== password2) return setErr('The passwords don’t match.');
      go(async () => { setRecovery(await signUp(email, password, name.trim())); setMode('recovery-key'); });
    }}>
      {header('Create your account', 'Sign in on any phone or computer with this email and password. Your data is encrypted on your phone, so not even the app’s server can read it.')}
      <label className="block" htmlFor="au-name"><span className="label">Your name</span><input id="au-name" autoComplete="name" className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block" htmlFor="au-email2"><span className="label">Email</span><input id="au-email2" type="email" inputMode="email" autoComplete="username" className={field} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {pwInput(password, setPassword, 'Password (at least 8 characters)', 'au-pw1', 'new-password')}
      {pwInput(password2, setPassword2, 'Type it again', 'au-pw2', 'new-password')}
      {error}
      <button className="btn-primary w-full h-12 text-base" disabled={busy || !email || !password}>{busy ? 'Creating your account…' : 'Create account'}</button>
      <p className="text-sm text-center">Already have one? <button type="button" className="font-semibold text-primary" onClick={() => { setErr(''); setMode('signin'); }}>Sign in</button></p>
    </form>
  );

  if (mode === 'recovery-key') return (
    <div className="space-y-4">
      {header('Save your recovery key', 'If you ever forget your password, this key is the only way back into your account. Nobody else can reset it for you, because your data is encrypted.')}
      <div className="rounded-2xl bg-sunk p-4 text-center">
        <p className="font-mono text-base sm:text-lg font-bold tracking-wide select-all" aria-label="Recovery key">{recovery}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-soft" onClick={async () => { try { await navigator.clipboard.writeText(recovery); useUI.getState().toast('Recovery key copied'); } catch { /* select the text instead */ } }}><Copy size={16} /> Copy</button>
        <button className="btn-soft" onClick={() => saveFile('tandem-recovery-key.txt', new Blob([`Tandem recovery key for ${email}\n\n${recovery}\n\nKeep this somewhere safe and private.\n`], { type: 'text/plain' }))}><KeyRound size={16} /> Save as a file</button>
      </div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="h-5 w-5 mt-0.5 accent-[rgb(var(--primary))]" checked={savedKey} onChange={(e) => setSavedKey(e.target.checked)} /> I’ve written it down or saved it somewhere safe.</label>
      {error}
      <button className="btn-primary w-full h-12 text-base" disabled={!savedKey || busy} onClick={() => go(async () => { await afterSignIn(); })}>Continue</button>
    </div>
  );

  if (mode === 'recover') return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const weak = checkPassword(password);
      if (weak) return setErr(weak);
      go(async () => { await recoverAccount(email, recovery, password); await afterSignIn(); });
    }}>
      {header('Forgot your password?', 'Enter the recovery key you saved when you created the account, then choose a new password.')}
      <label className="block" htmlFor="rc-email"><span className="label">Email</span><input id="rc-email" type="email" autoComplete="username" className={field} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="block" htmlFor="rc-key"><span className="label">Recovery key</span><input id="rc-key" className={`${field} font-mono uppercase`} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" value={recovery} onChange={(e) => setRecovery(e.target.value)} autoComplete="off" /></label>
      {pwInput(password, setPassword, 'New password', 'rc-pw', 'new-password')}
      {error}
      <button className="btn-primary w-full h-12 text-base" disabled={busy || !email || !recovery || !password}>{busy ? 'Checking…' : 'Set new password'}</button>
      <button type="button" className="text-sm font-semibold text-primary" onClick={() => { setErr(''); setMode('signin'); }}>Back to sign in</button>
    </form>
  );

  if (mode === 'choose-data') return (
    <div className="space-y-4">
      {header('Which data should this phone use?', 'Your account already has a household, and this phone has one too.')}
      <button className="w-full text-left rounded-2xl border-2 border-primary p-4" disabled={busy} onClick={() => go(async () => { await restoreSnapshot(remote!); await nextAfterData(); })}>
        <p className="font-bold">Use my account’s data</p><p className="sub">Replaces what’s on this phone with the copy saved in your account. Recommended.</p>
      </button>
      <button className="w-full text-left rounded-2xl border-2 border-line p-4" disabled={busy} onClick={() => go(async () => { await pushVault(JSON.stringify(await snapshot()), { updatedAt: Date.now(), device: deviceId() }, true); await nextAfterData(); })}>
        <p className="font-bold">Keep this phone’s data</p><p className="sub">Saves this phone’s household to your account, replacing the copy there.</p>
      </button>
      {error}
    </div>
  );

  // mode === 'biometric'
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 text-primary grid place-items-center"><Fingerprint size={34} /></div>
      {header('Unlock with fingerprint or Face ID?', 'Each time you open Tandem, unlock it with your phone’s fingerprint, Face ID or passcode instead of typing your password.')}
      {error}
      <button className="btn-primary w-full h-12 text-base" disabled={busy} onClick={() => go(async () => {
        const a = await getAccount();
        await enableBiometric(a?.email ?? name);
        useUI.getState().toast('Fingerprint / Face ID unlock is on');
        onDone(await localHousehold());
      })}><Check size={18} /> Turn on</button>
      <button className="btn-ghost w-full" onClick={async () => onDone(await localHousehold())}>Not now</button>
    </div>
  );
}

export function AccountBadge({ email }: { email: string }) {
  return <span className="inline-flex items-center gap-1.5 text-sm"><Mail size={14} className="text-primary" /> {email}</span>;
}
