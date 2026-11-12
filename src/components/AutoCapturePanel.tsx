import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, Copy, RefreshCw, Share2, ShieldCheck, Smartphone, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSetting } from '../db/db';
import { accountsEnabled, captureStatus, getAccount } from '../lib/account';
import { CAPTURE_SETTING, captureUrl, collectCaptured, sendCaptureTest, turnOffCapture, turnOnCapture, useCapture, type CaptureLink } from '../lib/autoCapture';
import { askConfirm, useUI } from '../store/ui';
import { Panel } from './ui';

const toast = (t: string) => useUI.getState().toast(t);
const ago = (t?: number | null) => {
  if (!t) return 'nothing yet';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Settings → Automatic payment capture: the private link, a test, and setup steps for each phone. */
export function AutoCapturePanel() {
  const enabled = useLiveQuery(() => accountsEnabled(), []);
  const account = useLiveQuery(async () => (await getAccount()) ?? null, []);
  const link = useLiveQuery(() => getSetting<CaptureLink | null>(CAPTURE_SETTING, null), []);
  const { lastResult } = useCapture();
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState<{ pending?: number; lastAt?: number | null }>({});
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<'android' | 'iphone' | null>(null);

  useEffect(() => { if (link) captureStatus().then(setStatus).catch(() => {}); }, [link, lastResult]);
  if (import.meta.env.VITE_EMBED === '1' || account === undefined || link === undefined) return null;

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast((e as Error).message || 'Something went wrong. Try again.'); } finally { setBusy(''); captureStatus().then(setStatus).catch(() => {}); }
  };
  const url = link ? captureUrl(link.link) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { toast('Select the link and copy it by hand.'); }
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><Zap size={18} className="text-primary" /> Automatic payment capture</span>}>
      <p className="sub">
        Google Pay, PhonePe and banks don’t let other apps read your payments, so Tandem can’t connect to them directly. Instead, your phone can pass each payment message to Tandem, which reads the amount, who it went to and the category, and updates your numbers.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Way icon={<Zap size={18} />} title="Automatic" body="An automation app on your phone forwards payment notifications and bank SMS in the background. Set up once, below." />
        <Way icon={<Share2 size={18} />} title="Share to Tandem" body="On Android, with Tandem installed: open the SMS or message, tap Share and choose Tandem." />
        <Way icon={<Smartphone size={18} />} title="Paste a message" body={<>Copy a payment message and paste it in <Link to="/inbox" className="font-semibold text-primary underline">Inbox &amp; import</Link>.</>} />
      </div>

      <div className="mt-5 pt-4 border-t border-line/70">
        {!account ? (
          <p className="text-sm">{enabled ? 'Automatic forwarding needs a Tandem account, so the messages have somewhere private to wait until you open the app. Sign in under Account & unlock above, then come back here.' : 'Automatic forwarding needs Tandem accounts, which aren’t switched on for this app yet. Sharing and pasting work without one.'}</p>
        ) : !link ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm flex-1 min-w-[14rem]">Turn this on to get your private capture link. You then give that link to an automation app on your phone.</p>
            <button className="btn-primary" disabled={!!busy} onClick={() => run('on', async () => { await turnOnCapture(); toast('Automatic capture is on. Follow the steps for your phone.'); })}>{busy === 'on' ? 'Turning on…' : 'Turn on'}</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="cap-link">Your private capture link</label>
              <div className="flex gap-2">
                <input id="cap-link" readOnly className="field font-mono text-[12px] min-w-0" value={url} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-soft shrink-0" onClick={copy} aria-label="Copy the link">{copied ? <Check size={16} className="text-good" /> : <Copy size={16} />} <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span></button>
              </div>
              <p className="text-xs text-muted mt-1.5">Keep it private: anyone who has it could send made-up payments to your Tandem. They could never read anything.</p>
            </div>
            <p className="text-sm text-muted">Last message received: <b className="text-ink">{ago(status.lastAt)}</b>{status.pending ? ` · ${status.pending} waiting` : ''}{lastResult ? <> · {lastResult}</> : null}</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-soft" disabled={!!busy} onClick={() => run('test', async () => { toast((await sendCaptureTest(link.link)) ? 'It works. Tandem received the test message.' : 'The test was sent but hasn’t arrived yet. Try “Check now” in a moment.'); })}>
                <Zap size={16} /> {busy === 'test' ? 'Testing…' : 'Send a test'}
              </button>
              <button className="btn-soft" disabled={!!busy} onClick={() => run('check', async () => { const r = await collectCaptured(); if (!r.some((x) => x.status === 'added' || x.status === 'review')) toast('Nothing new to add.'); })}>
                <RefreshCw size={16} className={busy === 'check' ? 'animate-spin' : ''} /> Check now
              </button>
              <button className="btn-ghost text-muted" disabled={!!busy} onClick={() => run('new', async () => {
                if (!(await askConfirm('Get a new link? The old one stops working, so you’ll need to paste the new one into your automation app.', 'Get a new link', false))) return;
                await turnOnCapture(); toast('New link ready. Update it in your automation app.');
              })}>Get a new link</button>
              <button className="btn-ghost text-bad" disabled={!!busy} onClick={() => run('off', async () => {
                if (!(await askConfirm('Turn off automatic capture? The link stops working and anything still waiting is deleted. Entries already added stay.', 'Turn off'))) return;
                await turnOffCapture(); toast('Automatic capture is off');
              })}>Turn off</button>
            </div>

            <Steps title="Set up on Android (Google Pay, PhonePe, Paytm, bank SMS)" open={open === 'android'} onToggle={() => setOpen(open === 'android' ? null : 'android')}>
              <li>Install <b>MacroDroid</b> (free) from the Play Store and open it. Tasker and similar apps work the same way.</li>
              <li>Tap <b>Add Macro</b>. For the <b>Trigger</b>, choose <b>Device Events → Notification → Notification Received</b>, and pick the apps to watch: Google Pay, PhonePe, Paytm, your bank’s app and your SMS app.</li>
              <li>For the <b>Action</b>, choose <b>Web Interactions → HTTP Request</b>. Set the method to <b>POST</b>, paste your capture link as the URL, set the content type to <b>text/plain</b>, and for the body use the “…” button to insert <b>Notification title</b> and <b>Notification text</b>.</li>
              <li>Save the macro. When MacroDroid asks, allow <b>notification access</b>, and turn off battery optimisation for it so it keeps running.</li>
              <li>Come back here and tap <b>Send a test</b>, then make a small payment. It appears in Tandem the next time you open the app.</li>
            </Steps>
            <Steps title="Set up on iPhone (bank SMS)" open={open === 'iphone'} onToggle={() => setOpen(open === 'iphone' ? null : 'iphone')}>
              <li>Open the <b>Shortcuts</b> app, go to <b>Automation</b> and tap <b>+</b>.</li>
              <li>Choose <b>Message</b>. Under <b>Message Contains</b> enter a word your bank always uses, such as <b>debited</b>. Choose <b>Run Immediately</b>.</li>
              <li>Add the action <b>Get Contents of URL</b>. Paste your capture link, set <b>Method</b> to <b>POST</b>, <b>Request Body</b> to <b>Form</b>, and add a field named <b>text</b> whose value is <b>Shortcut Input</b> (the message).</li>
              <li>Repeat for other words your bank uses, such as <b>credited</b> or <b>spent</b>.</li>
              <li>iPhone doesn’t let any app read Google Pay or PhonePe notifications, but your bank’s SMS covers the same payments. Menu names can differ slightly between iOS versions.</li>
            </Steps>
          </div>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck size={15} className="shrink-0 mt-0.5 text-primary" />
        <span>Forwarded messages are encrypted the moment they arrive, with a key only your signed-in devices hold, and deleted once Tandem has collected them (or after 30 days). Messages that aren’t payments, such as one-time passwords, offers and requests, are ignored. A payment Tandem isn’t sure about goes to your review inbox instead of being counted.</span>
      </p>
    </Panel>
  );
}

function Way({ icon, title, body }: { icon: ReactNode; title: string; body: ReactNode }) {
  return (
    <div className="rounded-2xl bg-sunk/60 p-3.5">
      <p className="font-semibold text-sm flex items-center gap-2"><span className="text-primary">{icon}</span>{title}</p>
      <p className="text-xs text-muted mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

function Steps({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line/70">
      <button className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold" aria-expanded={open} onClick={onToggle}>
        {title}<ChevronDown size={16} className="shrink-0 text-muted" style={{ rotate: open ? '180deg' : '0deg', transition: 'rotate .3s' }} />
      </button>
      {open && <ol className="px-4 pb-4 pl-9 list-decimal space-y-2 text-sm leading-relaxed">{children}</ol>}
    </div>
  );
}
