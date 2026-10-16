import { Cloud, Download, Mail, Smartphone, KeyRound, Lock, Shield, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { Panel } from '../components/ui';
import type { PinRecord } from '../components/Lock';
import { snapshot, exportEncrypted, importEncrypted } from '../db/backup';
import { db, setSetting } from '../db/db';
import { saveProfile, useData, useProfile } from '../db/hooks';
import { clearToFreshStart, seedDemo, wipeAll } from '../db/seed';
import type { BudgetStyle, Profile } from '../db/types';
import { hashPin, type Envelope } from '../lib/crypto';
import { toCSV } from '../lib/csv';
import { isoDate } from '../lib/dates';
import { CurrencySelect } from '../components/CurrencySelect';
import { AppearancePicker } from '../components/AppearancePicker';
import { InstallSteps } from '../components/InstallApp';
import { SyncBadge } from '../components/SyncBadge';
import { canShareFiles, saveFile, shareFile } from '../lib/download';
import { askConfirm, useUI } from '../store/ui';
import { APP_LOCALE } from '../lib/locale';

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(APP_LOCALE, { month: 'long' }));
const STYLES: { value: BudgetStyle; label: string }[] = [
  { value: 'envelope', label: 'Envelopes (a set amount per category)' },
  { value: 'zero-based', label: 'Zero-based (give every unit a job)' },
  { value: '50-30-20', label: '50/30/20 (needs, wants, savings)' },
  { value: 'caps', label: 'Spending caps (limits on a few categories)' },
];
interface Online { prices: boolean; ai: boolean; aiKey?: string }

const toast = (t: string) => useUI.getState().toast(t);

const download = (name: string, blob: Blob) => saveFile(name, blob);

function Toggle({ checked, onChange, label, hint, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; id: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p id={`${id}-l`} className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      <button role="switch" aria-checked={checked} aria-labelledby={`${id}-l`} onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-line'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

export default function Settings() {
  const profile = useProfile();
  if (!profile) return null;
  return (
    <div className="space-y-6 pt-2 max-w-3xl">
      <div>
        <p className="sub font-semibold">{import.meta.env.VITE_EMBED === '1' ? 'Private to your account' : 'Everything stays on this device'}</p>
        <h1 className="h1">Settings</h1>
      </div>
      <ProfilePanel key={JSON.stringify([profile.appName, profile.primaryUser, profile.currency, profile.fyStartMonth, profile.budgetStyle])} profile={profile} />
      <Appearance />
      <Security />
      <Backup currency={profile.currency} />
      <DemoData currency={profile.currency} />
      <Panel title={<span className="flex items-center gap-2"><Cloud size={18} /> Sync & sign-in</span>}>
        <SyncBadge detailed />
        <p className="sub mt-3">
          {import.meta.env.VITE_EMBED === '1'
            ? 'You’re signed in with your Claude account. Your household is saved privately to it, so it’s there on any phone or computer where you open this link. Nobody else, including whoever shared the link, can see it.'
            : 'This copy keeps everything on this device. To move it to a new phone, send yourself an encrypted backup (Data and backup) and restore it there.'}
        </p>
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><Smartphone size={18} /> Install on your phone</span>}>
        <InstallSteps />
      </Panel>
      <Privacy />
      <Panel title="About">
        <p className="text-sm"><b>Tandem</b> version 0.1.0</p>
        <p className="sub mt-1">Not professional financial advice.</p>
      </Panel>
    </div>
  );
}

/* ───────────────────────── Profile ───────────────────────── */

function ProfilePanel({ profile }: { profile: Profile }) {
  const [p, setP] = useState(profile);
  const dirty = (['appName', 'primaryUser', 'currency', 'fyStartMonth', 'budgetStyle'] as const).some((k) => p[k] !== profile[k]);
  return (
    <Panel title="Profile">
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={async (e) => {
        e.preventDefault();
        await saveProfile({ appName: p.appName.trim() || 'Tandem', primaryUser: p.primaryUser.trim(), currency: p.currency, fyStartMonth: p.fyStartMonth, budgetStyle: p.budgetStyle });
        toast('Profile saved');
      }}>
        <div><label className="label" htmlFor="s-app">App name</label><input id="s-app" className="field" value={p.appName} onChange={(e) => setP({ ...p, appName: e.target.value })} /></div>
        <div><label className="label" htmlFor="s-name">Your name</label><input id="s-name" className="field" value={p.primaryUser} onChange={(e) => setP({ ...p, primaryUser: e.target.value })} /></div>
        <div>
          <label className="label" htmlFor="s-cur">Currency</label>
          <CurrencySelect id="s-cur" value={p.currency} onChange={(c) => setP({ ...p, currency: c })} />
          <p className="text-xs text-muted mt-1">Changes how amounts are shown. Existing amounts are not converted.</p>
        </div>
        <div>
          <label className="label" htmlFor="s-fy">Financial year starts in</label>
          <select id="s-fy" className="field" value={p.fyStartMonth} onChange={(e) => setP({ ...p, fyStartMonth: Number(e.target.value) })}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="s-style">Budgeting style</label>
          <select id="s-style" className="field" value={p.budgetStyle} onChange={(e) => setP({ ...p, budgetStyle: e.target.value as BudgetStyle })}>
            {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><button type="submit" className="btn-primary" disabled={!dirty}>Save profile</button></div>
      </form>
    </Panel>
  );
}

/* ───────────────────────── Appearance ───────────────────────── */

function Appearance() {
  const { hideAmounts, toggleHide } = useUI();
  return (
    <Panel title="Appearance">
      <AppearancePicker />
      <div className="mt-3 divide-y divide-line/70">
        <Toggle id="hide" checked={hideAmounts} onChange={toggleHide} label="Hide amounts" hint="Blurs amounts until you hover or tap them. Handy in public." />
        <p className="text-xs text-muted py-3">Reduce motion: Tandem follows your device’s reduce-motion setting and turns animations off automatically.</p>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Security ───────────────────────── */

function Security() {
  const pin = useLiveQuery(async () => ((await db.settings.get('pin'))?.value as PinRecord | undefined) ?? null, []);
  const [editing, setEditing] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');

  const savePin = async () => {
    if (!/^\d{4,6}$/.test(a)) return setErr('Use 4 to 6 digits.');
    if (a !== b) return setErr('The two PINs don’t match.');
    const { salt, hash } = await hashPin(a);
    await setSetting<PinRecord>('pin', { salt, hash, autoLockMin: pin?.autoLockMin ?? 5 });
    setA(''); setB(''); setErr(''); setEditing(false);
    toast(pin ? 'PIN changed' : 'PIN set. Tandem will ask for it when it opens.');
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><Shield size={18} /> Security</span>}>
      <p className="text-sm">{pin ? 'A PIN protects Tandem on this device.' : 'Add a PIN so nobody else can open Tandem on this device.'}</p>
      {editing ? (
        <form className="grid sm:grid-cols-2 gap-3 mt-4" onSubmit={(e) => { e.preventDefault(); savePin(); }}>
          <div><label className="label" htmlFor="pin-a">New PIN (4–6 digits)</label><input id="pin-a" className="field num tracking-[0.3em]" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} /></div>
          <div><label className="label" htmlFor="pin-b">Enter it again</label><input id="pin-b" className="field num tracking-[0.3em]" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} /></div>
          {err && <p className="text-sm text-bad font-semibold sm:col-span-2" role="alert">{err}</p>}
          <div className="flex gap-2 sm:col-span-2"><button type="submit" className="btn-primary"><KeyRound size={16} /> Save PIN</button><button type="button" className="btn-soft" onClick={() => { setEditing(false); setErr(''); setA(''); setB(''); }}>Cancel</button></div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn-primary" onClick={() => setEditing(true)}><KeyRound size={16} /> {pin ? 'Change PIN' : 'Set a PIN'}</button>
          {pin && <button className="btn-soft" onClick={async () => { if (await askConfirm('Remove the PIN? Anyone with this device could then open Tandem.', 'Remove PIN')) { await db.settings.delete('pin'); toast('PIN removed'); } }}>Remove PIN</button>}
          {pin && <button className="btn-soft" onClick={() => useUI.getState().setLocked(true)}><Lock size={16} /> Lock now</button>}
        </div>
      )}
      {pin && (
        <div className="mt-4 max-w-xs">
          <label className="label" htmlFor="autolock">Lock automatically after</label>
          <select id="autolock" className="field" value={pin.autoLockMin} onChange={async (e) => { await setSetting<PinRecord>('pin', { ...pin, autoLockMin: Number(e.target.value) }); toast('Auto-lock updated'); }}>
            <option value={1}>1 minute of inactivity</option>
            <option value={5}>5 minutes of inactivity</option>
            <option value={15}>15 minutes of inactivity</option>
            <option value={0}>Never</option>
          </select>
        </div>
      )}
      <p className="text-xs text-muted mt-4">Fingerprint and face unlock come with the mobile app.</p>
    </Panel>
  );
}

/* ───────────────────────── Backup ───────────────────────── */

function Backup({ currency }: { currency: string }) {
  const data = useData();
  const last = useLiveQuery(async () => ((await db.settings.get('lastBackup'))?.value as number | undefined) ?? null, []);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rp, setRp] = useState('');
  const [rErr, setRErr] = useState('');
  const stale = last === null || (last !== undefined && Date.now() - last > 30 * 86400_000);

  const backup = async (via: 'download' | 'share' = 'download') => {
    if (p1.length < 8) return setErr('Use at least 8 characters.');
    if (p1 !== p2) return setErr('The passphrases don’t match.');
    setErr(''); setBusy(true);
    try {
      const env = await exportEncrypted(p1);
      const name = `tandem-${isoDate(new Date())}.tandem`;
      const blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
      const ok = via === 'share'
        ? await shareFile(name, blob, 'My Tandem backup. It’s encrypted; open it in Tandem → Settings → Restore with your passphrase.')
        : await download(name, blob);
      if (!ok) return;
      await setSetting('lastBackup', Date.now());
      setP1(''); setP2('');
      toast(via === 'share' ? 'Backup shared. Keep the passphrase somewhere safe.' : 'Encrypted backup downloaded. Keep the passphrase somewhere safe.');
    } catch { setErr('The backup could not be created on this device.'); }
    finally { setBusy(false); }
  };

  const doRestore = async () => {
    if (!file || !rp) return setRErr('Choose a file and enter its passphrase.');
    if (!(await askConfirm('Restoring replaces all the data on this device with the backup.', 'Replace my data'))) return;
    setRErr(''); setBusy(true);
    try {
      const env = JSON.parse(await file.text()) as Envelope;
      await importEncrypted(env, rp);
      setFile(null); setRp('');
      toast('Backup restored');
    } catch (e) {
      setRErr(e instanceof SyntaxError ? 'This file is not a Tandem backup.' : e instanceof Error ? e.message : 'Could not restore this file.');
    } finally { setBusy(false); }
  };

  const exportCSV = () => {
    if (!data) return;
    const rows: (string | number)[][] = [['Date', 'Type', 'Amount', 'Currency', 'Account', 'Category', 'Payee', 'Member', 'Tags', 'Notes']];
    for (const t of [...data.all].sort((x, y) => x.date.localeCompare(y.date))) {
      const sign = t.type === 'expense' ? -1 : 1;
      rows.push([t.date.slice(0, 10), t.type, ((sign * t.amount) / 100).toFixed(2), t.currency ?? currency, data.acct(t.accountId)?.name ?? '',
        data.cat(t.categoryId)?.name ?? '', t.payee ?? '', data.member(t.memberId)?.name ?? '', t.tags.join(' '), t.notes ?? '']);
    }
    download(`tandem-transactions-${isoDate(new Date())}.csv`, new Blob([toCSV(rows)], { type: 'text/csv' }));
  };

  const exportJSON = async () => {
    if (!(await askConfirm('This file is not encrypted. Anyone who gets it can read all your financial data.', 'Download anyway'))) return;
    download(`tandem-copy-${isoDate(new Date())}.json`, new Blob([JSON.stringify(await snapshot(), null, 2)], { type: 'application/json' }));
  };

  return (
    <Panel title="Data and backup">
      <p className={`text-sm rounded-2xl p-3 ${stale ? 'bg-warn/10' : 'bg-sunk/60'}`}>
        {last ? <>Last backup: <b>{new Date(last).toLocaleString(APP_LOCALE, { dateStyle: 'medium', timeStyle: 'short' })}</b>.</> : 'No backup yet.'}
        {stale && ' Your data lives only on this device, so a fresh backup is a good idea.'}
      </p>

      <h3 className="font-bold text-sm mt-5">Download an encrypted backup</h3>
      <p className="sub">Protected with a passphrase you choose. We can’t recover it if you forget it.</p>
      <form className="grid sm:grid-cols-2 gap-3 mt-3" onSubmit={(e) => { e.preventDefault(); backup(); }}>
        <div><label className="label" htmlFor="bk-1">Passphrase (at least 8 characters)</label><input id="bk-1" className="field" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></div>
        <div><label className="label" htmlFor="bk-2">Enter it again</label><input id="bk-2" className="field" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
        {err && <p className="text-sm text-bad font-semibold sm:col-span-2" role="alert">{err}</p>}
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy}><Download size={16} /> Download encrypted backup</button>
          {canShareFiles() && <button type="button" className="btn-soft" disabled={busy} onClick={() => backup('share')}><Mail size={16} /> Send to email or Drive</button>}
        </div>
      </form>

      <h3 className="font-bold text-sm mt-6">Restore from backup</h3>
      <form className="grid sm:grid-cols-2 gap-3 mt-3" onSubmit={(e) => { e.preventDefault(); doRestore(); }}>
        <div><label className="label" htmlFor="rs-file">Backup file</label><input id="rs-file" className="field pt-2" type="file" accept=".tandem,.json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        <div><label className="label" htmlFor="rs-pass">Passphrase</label><input id="rs-pass" className="field" type="password" autoComplete="current-password" value={rp} onChange={(e) => setRp(e.target.value)} /></div>
        {rErr && <p className="text-sm text-bad font-semibold sm:col-span-2" role="alert">{rErr}</p>}
        <div className="sm:col-span-2"><button type="submit" className="btn-soft" disabled={busy}><Upload size={16} /> Restore from backup</button></div>
      </form>

      <h3 className="font-bold text-sm mt-6">Export</h3>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="btn-soft" onClick={exportCSV} disabled={!data}><Download size={16} /> Export all transactions as CSV</button>
        <button className="btn-soft" onClick={exportJSON}><Download size={16} /> Export a JSON copy (unencrypted)</button>
      </div>
      <p className="text-xs text-muted mt-2">The JSON copy is readable by anyone who has the file. Use the encrypted backup for safekeeping.</p>
    </Panel>
  );
}

/* ───────────────────────── Demo data ───────────────────────── */

function DemoData({ currency }: { currency: string }) {
  const navigate = useNavigate();
  const isDemo = useLiveQuery(async () => !!(await db.settings.get('demo'))?.value, []);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Demo data">
      {isDemo ? (
        <div className="rounded-2xl bg-warn/10 p-4 mb-4">
          <p className="text-sm"><b>You’re using the demo household.</b> Remove it to start with a clean app for your own entries.</p>
          <button className="btn-primary mt-3" disabled={busy} onClick={async () => {
            if (!(await askConfirm('This deletes all the demo data, including anything you added to it, so you can set up your own household.', 'Remove demo data'))) return;
            setBusy(true);
            await clearToFreshStart();
            useUI.getState().setViewAs(null);
            navigate('/'); // the setup screen appears right away; after setup you land on Home
          }}>Remove demo data and start fresh</button>
        </div>
      ) : null}
      <p className="sub">Try Tandem with a sample family of four and a year of entries.</p>
      <button className="btn-soft mt-3" disabled={busy} onClick={async () => {
        if (!(await askConfirm('Loading the demo family replaces all the data on this device.', 'Load demo family'))) return;
        setBusy(true);
        await wipeAll();
        await seedDemo(currency);
        useUI.getState().setViewAs(null);
        setBusy(false);
        toast('Demo family loaded');
      }}>Load demo family</button>

      <div className="mt-6 border-t border-line/70 pt-5">
        <h3 className="font-bold text-sm text-bad">Erase everything</h3>
        <p className="sub">Deletes every account, entry, goal and setting on this device. This can’t be undone, so download a backup first.</p>
        <form className="flex flex-wrap gap-2 mt-3 items-end" onSubmit={async (e) => {
          e.preventDefault();
          if (confirm !== 'ERASE') return;
          await wipeAll();
          await setSetting('skipDemo', true); // land on a clean setup screen, not the demo
          window.location.reload();
        }}>
          <div className="flex-1 min-w-[180px]"><label className="label" htmlFor="erase">Type ERASE to confirm</label><input id="erase" className="field" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <button type="submit" className="btn h-11 bg-bad text-white hover:brightness-110" disabled={confirm !== 'ERASE'}>Erase everything</button>
        </form>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Privacy ───────────────────────── */

function Privacy() {
  const online = useLiveQuery(async () => ((await db.settings.get('online'))?.value as Online | undefined) ?? { prices: false, ai: false }, []);
  const [key, setKey] = useState<string | null>(null);
  if (!online) return null;
  const set = (patch: Partial<Online>) => setSetting<Online>('online', { ...online, ...patch });
  const keyValue = key ?? online.aiKey ?? '';
  return (
    <Panel title="Privacy">
      <p className="text-sm">No analytics, no trackers. Tandem makes no network requests unless you turn on an online feature.</p>
      <h3 className="font-bold text-sm mt-5">Online features</h3>
      <div className="divide-y divide-line/70">
        <Toggle id="prices" checked={online.prices} onChange={(v) => set({ prices: v })} label={<>Refresh investment prices <span className="text-xs font-semibold text-muted">· online only</span></>} hint="Fetches public prices for your holdings. Your holdings are never sent." />
        <Toggle id="ai" checked={online.ai} onChange={(v) => set({ ai: v })} label={<>Ask about my money (uses your own AI key) <span className="text-xs font-semibold text-muted">· online only</span></>} hint="Off by default." />
      </div>
      {online.ai && (
        <div className="mt-2 rounded-2xl bg-sunk/60 p-4">
          <label className="label" htmlFor="ai-key">Your API key</label>
          <div className="flex gap-2">
            <input id="ai-key" className="field flex-1" type="password" autoComplete="off" value={keyValue} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
            <button className="btn-soft" disabled={key === null} onClick={async () => { await set({ aiKey: keyValue.trim() || undefined }); setKey(null); toast('Key saved on this device'); }}>Save</button>
          </div>
          <p className="text-xs text-muted mt-2">The key is stored only on this device. Only aggregated monthly totals are sent, and you’ll see exactly what before anything is sent.</p>
        </div>
      )}
    </Panel>
  );
}
