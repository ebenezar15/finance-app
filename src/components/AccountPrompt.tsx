import { useLiveQuery } from 'dexie-react-hooks';
import { CloudUpload, Fingerprint, LockKeyhole, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db, getSetting, setSetting } from '../db/db';
import { useProfile } from '../db/hooks';
import { accountsEnabled, getAccount } from '../lib/account';
import { useUI } from '../store/ui';
import { AuthFlow } from './AuthFlow';
import iconUrl from '../assets/icon.svg';
import { WaveBackdrop } from './WaveBackdrop';

/** Set once the person has signed in, created an account or chosen "Not now" on this phone. */
export const PROMPT_KEY = 'accountPromptDone';

/**
 * People who set up Tandem before accounts existed have a household on the phone but no
 * account. The first time they open the app after the update, ask them to sign in or create
 * one, once per phone. New households mark this done during setup, where the choice is offered.
 */
export function useAccountPrompt() {
  const profile = useProfile();
  const done = useLiveQuery(() => getSetting<boolean>(PROMPT_KEY, false), []);
  const [eligible, setEligible] = useState<boolean | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_EMBED === '1' || !profile?.onboarded || done !== false) { setEligible(false); return; }
    let live = true;
    (async () => {
      const demo = !!(await db.settings.get('demo'))?.value;
      if (demo || (await getAccount())) return live && setEligible(false);
      // Offline or accounts not set up on the server: don't block the app; ask next time.
      const on = await accountsEnabled();
      if (live) setEligible(on);
    })();
    return () => { live = false; };
  }, [profile?.onboarded, done]);
  return eligible === true;
}

export function AccountPrompt() {
  const profile = useProfile();
  const [auth, setAuth] = useState<null | 'signin' | 'signup'>(null);
  const finish = async (msg?: string) => {
    await setSetting(PROMPT_KEY, true);
    if (msg) useUI.getState().toast(msg);
  };

  return (
    <div className="relative isolate min-h-screen bg-bg px-5 py-8 grid place-items-center">
      {!auth && <WaveBackdrop />}
      <div className="relative w-full max-w-md page-enter">
        {auth ? (
          <>
            <div className="flex items-center gap-2.5 mb-8"><img src={iconUrl} alt="" className="h-9 w-9 rounded-xl" /><span className="font-display text-xl font-bold tracking-tight">Tandem</span></div>
            <AuthFlow start={auth} onBack={() => setAuth(null)} onDone={() => finish(auth === 'signup' ? 'Account created. Your household is now synced.' : 'You’re signed in')} />
          </>
        ) : (
          <>
            <img src={iconUrl} alt="" className="h-14 w-14 rounded-2xl mb-6" />
            <h1 className="h1">{profile?.primaryUser ? `Welcome back, ${profile.primaryUser}` : 'Welcome back'}</h1>
            <p className="text-[15px] text-muted mt-2 leading-relaxed">
              Sign in to keep your household safe and use it on any phone or computer. Everything already on this phone comes with you.
            </p>
            <ul className="mt-6 space-y-3">
              <Point icon={<CloudUpload size={19} />} title="Never lose your data" body="Your household is saved to your account, so a new or wiped phone gets it all back." />
              <Point icon={<LockKeyhole size={19} />} title="Private by design" body="It’s encrypted on this phone before upload. Not even Tandem’s server can read it." />
              <Point icon={<Fingerprint size={19} />} title="Quick to open" body="After signing in, unlock with fingerprint, Face ID or your phone’s passcode." />
              <Point icon={<Smartphone size={19} />} title="Share with your partner" body="Sign in on both phones with the same account and see the same household." />
            </ul>
            <div className="mt-8 grid gap-2">
              <button className="btn-primary h-14 text-base" onClick={() => setAuth('signup')}>Create an account</button>
              <button className="btn-soft h-14 text-base" onClick={() => setAuth('signin')}>I already have an account</button>
              <button className="btn-ghost h-12 text-muted" onClick={() => finish('You can sign in any time from Settings → Account & unlock.')}>Not now</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Point({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary">{icon}</span>
      <span><span className="block font-semibold text-[15px]">{title}</span><span className="block text-sm text-muted">{body}</span></span>
    </li>
  );
}
