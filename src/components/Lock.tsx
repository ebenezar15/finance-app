import { Delete, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSetting } from '../db/db';
import { hashPin } from '../lib/crypto';
import { useUI } from '../store/ui';

export interface PinRecord { salt: string; hash: string; autoLockMin: number }

/** Locks the app after inactivity when a PIN is set. */
export function useAutoLock() {
  const setLocked = useUI((s) => s.setLocked);
  useEffect(() => {
    let timer: number | undefined;
    let mins = 0;
    getSetting<PinRecord | null>('pin', null).then((p) => {
      if (!p) return;
      mins = p.autoLockMin;
      setLocked(true);
      reset();
    });
    const reset = () => {
      if (!mins) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), mins * 60_000);
    };
    const onHide = () => { if (document.hidden && mins) setLocked(true); };
    ['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, reset));
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearTimeout(timer);
      ['pointerdown', 'keydown'].forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [setLocked]);
}

export function LockScreen() {
  const setLocked = useUI((s) => s.setLocked);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (pin.length < 4) return;
    getSetting<PinRecord | null>('pin', null).then(async (rec) => {
      if (!rec) return setLocked(false);
      const { hash } = await hashPin(pin, rec.salt);
      if (hash === rec.hash) setLocked(false);
      else if (pin.length >= 6) { setErr('That PIN didn’t match. Try again.'); setPin(''); }
    });
  }, [pin, setLocked]);

  return (
    <div className="min-h-screen grid place-items-center bg-bg px-6">
      <div className="w-full max-w-xs text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-onprimary grid place-items-center mb-4"><Lock /></div>
        <h1 className="text-2xl font-extrabold tracking-tight">Enter your PIN</h1>
        <p className="sub mt-1 h-5" role="alert">{err}</p>
        <div className="flex justify-center gap-3 my-6" aria-label={`${pin.length} digits entered`}>
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
      </div>
    </div>
  );
}
