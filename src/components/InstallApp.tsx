import { Share, Smartphone, SquarePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; listeners.forEach((f) => f()); });
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
export const isAndroid = /Android/.test(ua);
export const isStandalone = () => {
  try { return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true; } catch { return false; }
};
const EMBED = import.meta.env.VITE_EMBED === '1';

function useInstallPrompt() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return deferred;
}

/** How to put Tandem on the home screen, tailored to the phone in hand. */
export function InstallSteps() {
  const prompt = useInstallPrompt();
  if (isStandalone()) return <p className="text-sm">Tandem is installed on this device. It opens full screen from your home screen and works offline.</p>;
  if (prompt) {
    return (
      <div className="space-y-2">
        <p className="text-sm">Add Tandem to your home screen. It opens full screen, works offline, and keeps your data on this phone.</p>
        <button className="btn-primary" onClick={async () => { await prompt.prompt(); deferred = null; }}><SquarePlus size={18} /> Install app</button>
      </div>
    );
  }
  const where = EMBED ? 'this page' : 'Tandem';
  return (
    <ol className="space-y-2.5 text-sm">
      {isIOS || !isAndroid ? (
        <>
          <li className="flex gap-3"><Step n={1} /><span><b>iPhone or iPad:</b> open {where} in <b>Safari</b>, then tap <Share size={15} className="inline -mt-1" aria-label="Share" /> <b>Share</b>.</span></li>
          <li className="flex gap-3"><Step n={2} /><span>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></li>
        </>
      ) : null}
      {isAndroid || !isIOS ? (
        <>
          <li className="flex gap-3"><Step n={isIOS || !isAndroid ? 3 : 1} /><span><b>Android:</b> open {where} in <b>Chrome</b>, tap the <b>⋮</b> menu, then <b>Install app</b> or <b>Add to Home screen</b>.</span></li>
        </>
      ) : null}
      <li className="text-xs text-muted pl-9">{EMBED ? 'Sign in with the same Claude account on each device and your household follows you.' : 'Your data stays on the device you install it on. Use an encrypted backup to move it.'}</li>
    </ol>
  );
}
const Step = ({ n }: { n: number }) => <span className="h-6 w-6 shrink-0 rounded-full bg-primary text-onprimary grid place-items-center text-xs font-bold">{n}</span>;

/** A one-time nudge on phones that aren't running Tandem from the home screen yet. */
export function InstallNudge() {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('tandem-install-dismissed') === '1'; } catch { return false; } });
  const phone = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches;
  if (hidden || !phone || isStandalone()) return null;
  const close = () => { setHidden(true); try { localStorage.setItem('tandem-install-dismissed', '1'); } catch { /* ignore */ } };
  return (
    <section className="panel p-4 relative">
      <button className="btn-ghost h-9 w-9 p-0 absolute right-2 top-2" aria-label="Dismiss" onClick={close}><X size={16} /></button>
      <p className="font-bold flex items-center gap-2 mb-3"><Smartphone size={18} className="text-primary" /> Put Tandem on your home screen</p>
      <InstallSteps />
    </section>
  );
}
