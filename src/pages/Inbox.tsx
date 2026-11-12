import { AlertTriangle, Camera, Check, CheckCheck, FileUp, Inbox as InboxIcon, Mic, MicOff, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CatIcon, Empty, Money, Panel, Segmented, SourceBadge, useFmt } from '../components/ui';
import { db, getSetting, log, setSetting, uid } from '../db/db';
import { learn, saveTransaction, softDelete, useData, useProfile, type Data } from '../db/hooks';
import type { Category, Transaction } from '../db/types';
import { suggestCategory, type Suggestion } from '../lib/categorize';
import { guessColumns, parseCSV, parseDate, parseOFX, type ColumnMap } from '../lib/csv';
import { DAY, isoDate, relativeDay } from '../lib/dates';
import { toMinor } from '../lib/money';
import { useLocation } from 'react-router-dom';
import { REVIEW_THRESHOLD, parseAlert, type ParsedAlert } from '../lib/sms';
import { parseVoice } from '../lib/voice';
import { useUI } from '../store/ui';
import { CashbookImport } from '../components/CashbookImport';

export default function Inbox() {
  const data = useData();
  const { hash } = useLocation();
  const ready = !!data;
  // Links such as "Import from CashBook" land on their panel, not the top of the page.
  useEffect(() => {
    if (!ready || !hash) return;
    const t = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 350);
    return () => window.clearTimeout(t);
  }, [ready, hash]);
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="pt-2">
        <h1 className="h1">Inbox & import</h1>
        <p className="sub max-w-2xl">Check payments captured automatically, read a payment screenshot or message, and bring in statements or your CashBook. Everything is read on this device.</p>
      </div>
      {/* What needs a look comes first, then the quick ways to add a payment, then the bigger imports. */}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="lg:col-span-2 min-w-0"><ReviewInbox data={data} /></div>
        <ReceiptScan />
        <PasteAlert data={data} />
        <div className="lg:col-span-2 min-w-0"><CashbookImport data={data} /></div>
        <div className="lg:col-span-2 min-w-0"><StatementImport data={data} /></div>
        <VoiceEntry data={data} />
      </div>
    </div>
  );
}

/* ───────────────────────── Shared helpers ───────────────────────── */

function CategorySelect({ id, value, onChange, categories, label = 'Category' }: { id: string; value: string; onChange: (v: string) => void; categories: Category[]; label?: string }) {
  return (
    <>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Uncategorised</option>
        <optgroup label="Spending">{categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
        <optgroup label="Income">{categories.filter((c) => c.kind === 'income').map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
      </select>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold text-muted">{label}</dt>
      <dd className="text-sm font-semibold truncate">{children}</dd>
    </div>
  );
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Loose payee match for duplicate detection: one contains the other, or the first word matches. */
function similarPayee(a?: string, b?: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x) || x.split(' ')[0] === y.split(' ')[0];
}

function extOf(name: string) {
  return name.toLowerCase().split('.').pop() ?? '';
}

/* ───────────────────────── Review inbox ───────────────────────── */

function ReviewInbox({ data }: { data: Data }) {
  const toast = useUI((s) => s.toast);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const items = useMemo(() => [...data.review].sort((a, b) => b.date.localeCompare(a.date)), [data.review]);
  const suggestions = useMemo(() => {
    const m = new Map<string, Suggestion | null>();
    for (const t of items) m.set(t.id, suggestCategory(t.payee || t.notes || '', data.categories, data.rules, data.all));
    return m;
  }, [items, data.categories, data.rules, data.all]);

  const catFor = (t: Transaction) => chosen[t.id] ?? t.categoryId ?? suggestions.get(t.id)?.categoryId ?? '';

  async function approve(t: Transaction, quiet = false) {
    const categoryId = catFor(t) || undefined;
    await saveTransaction({ ...t, categoryId, needsReview: false });
    // saveTransaction already learns from expenses; teach income payees too.
    if (t.payee && categoryId && t.type !== 'expense') await learn(t.payee, categoryId);
    if (!quiet) toast(`Approved ${t.payee ?? 'entry'}`);
  }

  async function approveAll() {
    const ready = items.filter((t) => catFor(t));
    for (const t of ready) await approve(t, true);
    toast(`Approved ${ready.length} ${ready.length === 1 ? 'entry' : 'entries'}`);
  }

  const withSuggestion = items.filter((t) => catFor(t)).length;

  return (
    <Panel title={<span className="flex items-center gap-2">Review inbox {items.length > 0 && <span className="num text-xs font-bold rounded-full bg-warn/15 text-warn px-2 py-0.5">{items.length} to check</span>}</span>}
      action={items.length > 1 && withSuggestion > 0 ? (
        <button className="btn-soft h-9" onClick={approveAll}><CheckCheck size={16} /> Approve all with suggestions</button>
      ) : undefined}>
      {items.length === 0 ? (
        <Empty icon={<InboxIcon size={20} />} title="You’re all caught up"
          body="Entries captured with low confidence land here for a quick check. Paste a bank alert or import a statement to add more." />
      ) : (
        <ul className="space-y-3">
          {items.map((t) => {
            const s = suggestions.get(t.id);
            const cat = catFor(t);
            const fromSuggestion = !chosen[t.id] && !t.categoryId && s && cat === s.categoryId;
            return (
              <li key={t.id} className="rounded-2xl border border-line/80 p-4">
                <div className="flex items-start gap-3">
                  <CatIcon c={data.cat(cat)} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{t.payee || 'Unknown payee'}</p>
                    <p className="text-[13px] text-muted flex flex-wrap items-center gap-1.5">
                      <span>{relativeDay(t.date)}</span><span aria-hidden>·</span><span>{data.acct(t.accountId)?.name ?? 'No account'}</span>
                      <SourceBadge s={t.source} />
                      {t.confidence !== undefined && <span className="num">{Math.round(t.confidence * 100)}% confident</span>}
                    </p>
                  </div>
                  <span className={`money num font-bold ${t.type === 'income' || t.type === 'refund' ? 'text-good' : ''}`}>
                    <Money value={t.type === 'expense' ? -t.amount : t.amount} sign={t.type === 'income' || t.type === 'refund'} />
                  </span>
                </div>
                {t.notes && <p className="mt-3 text-[13px] text-muted bg-sunk/70 rounded-xl px-3 py-2 break-words"><span className="sr-only">Original message: </span>{t.notes}</p>}
                <div className="mt-3">
                  <CategorySelect id={`rv-${t.id}`} value={cat} onChange={(v) => setChosen((c) => ({ ...c, [t.id]: v }))} categories={data.categories} />
                  {fromSuggestion && <p className="text-xs text-muted mt-1.5">Suggested: {s!.reason}</p>}
                </div>
                <div className="mt-3 flex gap-2 justify-end">
                  <button className="btn-ghost h-10 text-bad" onClick={() => softDelete([t.id])}><X size={16} /> Reject</button>
                  <button className="btn-primary h-10" onClick={() => approve(t)}><Check size={16} /> Approve</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── Paste an alert ───────────────────────── */

const SAMPLES: { label: string; text: string }[] = [
  { label: 'Card purchase', text: 'You spent $45.20 on your credit card ending 9876 at Whole Foods on Oct 14. Ref 88231XQ' },
  { label: 'Salary credit', text: 'Your account ending 5521 was credited with $2,400.00 from ACME PAYROLL on 15/10/2026.' },
  { label: 'Unclear message', text: 'Txn of $18.40 at CAFE NERO' },
];

function PasteAlert({ data }: { data: Data }) {
  const profile = useProfile();
  const toast = useUI((s) => s.toast);
  const [text, setText] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const parsed: ParsedAlert | null = useMemo(() => parseAlert(text, profile?.currency), [text, profile?.currency]);
  const matched = parsed?.last4 ? data.accounts.find((a) => a.last4 === parsed.last4) : undefined;
  const fallbackAcct = data.accounts.find((a) => a.type === 'bank') ?? data.accounts[0];
  const acctId = accountId || matched?.id || fallbackAcct?.id || '';
  const suggestion = useMemo(
    () => (parsed?.merchant ? suggestCategory(parsed.merchant, data.categories, data.rules, data.all) : null),
    [parsed?.merchant, data.categories, data.rules, data.all],
  );
  const cat = categoryId ?? suggestion?.categoryId ?? '';

  useEffect(() => { setAccountId(''); setCategoryId(null); }, [text]);

  // Duplicate check: same reference number, or same amount within ten minutes.
  useEffect(() => {
    let live = true;
    (async () => {
      if (!parsed) { setDup(null); return; }
      if (parsed.refNo) {
        const hit = await db.transactions.where('refNo').equals(parsed.refNo).filter((t) => !t.deletedAt).first();
        if (hit) { if (live) setDup(`An entry with reference ${parsed.refNo} already exists (${hit.payee ?? 'no payee'}, ${relativeDay(hit.date)}).`); return; }
      }
      const now = Date.now();
      const near = data.all.find((t) => t.amount === parsed.amount && Math.abs(new Date(t.date).getTime() - now) < 10 * 60_000);
      if (live) setDup(near ? `An entry for the same amount was added in the last ten minutes (${near.payee ?? 'no payee'}).` : null);
    })();
    return () => { live = false; };
  }, [parsed, data.all]);

  async function add() {
    if (!parsed) return;
    const review = parsed.confidence < REVIEW_THRESHOLD;
    const acct = data.acct(acctId);
    let date = new Date().toISOString();
    if (parsed.date) {
      const d = parseDate(parsed.date, true);
      if (d && d !== isoDate(new Date())) date = new Date(`${d}T12:00:00`).toISOString();
    }
    await saveTransaction({
      amount: parsed.amount, type: parsed.direction === 'debit' ? 'expense' : 'income', accountId: acctId,
      payee: parsed.merchant, categoryId: cat || undefined, currency: acct?.currency ?? profile?.currency,
      source: 'sms', confidence: parsed.confidence, needsReview: review, refNo: parsed.refNo, notes: text.trim(), date,
    });
    toast(review ? 'Saved to the review inbox — confidence was low, so please check it' : 'Added from bank alert');
    setText('');
  }

  const confident = parsed ? parsed.confidence >= REVIEW_THRESHOLD : false;

  return (
    <Panel title="Paste a bank alert">
      <p className="sub mb-3">Paste an SMS, email or notification from your bank. Tandem reads the amount, account and merchant.</p>
      <label htmlFor="alert-text" className="label">Message</label>
      <textarea id="alert-text" className="field h-auto min-h-[96px] py-2.5" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="e.g. You spent $12.50 on your card ending 9876 at Starbucks" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">Try a sample:</span>
        {SAMPLES.map((s) => <button key={s.label} className="chip" onClick={() => setText(s.text)}>{s.label}</button>)}
      </div>

      {text.trim() && !parsed && (
        <p className="mt-4 text-sm rounded-xl bg-sunk/70 p-3" role="status">
          This doesn’t look like a completed transaction. One-time passwords, offers, payment reminders and declined payments are ignored.
        </p>
      )}

      {parsed && (
        <div className="mt-4 rounded-2xl border border-line/80 p-4 space-y-4" aria-live="polite">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Amount"><Money value={parsed.amount} currency={parsed.currency} /></Field>
            <Field label="Direction">{parsed.direction === 'debit' ? 'Money out' : 'Money in'}</Field>
            <Field label="Merchant">{parsed.merchant ?? 'Not found'}</Field>
            <Field label="Card or account">{parsed.last4 ? `Ending ${parsed.last4}` : 'Not found'}</Field>
            <Field label="Reference">{parsed.refNo ?? 'None'}</Field>
            <Field label="Confidence"><span className="num">{Math.round(parsed.confidence * 100)}%</span> {confident ? '· high' : '· low'}</Field>
          </dl>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="alert-acct" className="label">Account</label>
              <select id="alert-acct" className="field" value={acctId} onChange={(e) => setAccountId(e.target.value)}>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` (${a.last4})` : ''}</option>)}
              </select>
              <p className="text-xs text-muted mt-1.5">{matched ? `Matched by the last four digits ${parsed.last4}.` : parsed.last4 ? `No account ends in ${parsed.last4} — choose one.` : 'Choose the account this came from.'}</p>
            </div>
            <div>
              <CategorySelect id="alert-cat" value={cat} onChange={setCategoryId} categories={data.categories} />
              {suggestion && categoryId === null && <p className="text-xs text-muted mt-1.5">Suggested: {suggestion.reason}</p>}
            </div>
          </div>
          {dup && (
            <p className="flex gap-2 items-start text-sm rounded-xl bg-warn/10 p-3" role="alert">
              <AlertTriangle size={17} className="text-warn shrink-0 mt-0.5" aria-hidden />
              <span><b>Looks like a duplicate.</b> {dup}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted max-w-xs">
              {confident ? 'Confidence is high, so this is added straight away.' : 'Confidence is low, so this goes to the review inbox first.'}
            </p>
            <button className="btn-primary" onClick={add} disabled={!acctId}>{confident ? 'Add' : 'Send to review'}</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── Statement import ───────────────────────── */

interface Row { date: string; amount: number; type: 'expense' | 'income'; payee: string; refNo?: string }
interface SavedMap { map: ColumnMap; dayFirst: boolean; negOut: boolean; mode: 'single' | 'split'; header: boolean }

/** "1,234.50", "(12.00)", "12.00 DR", "-5" → signed minor units. */
function parseAmount(raw: string): number | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bdr\.?$/i.test(s)) { sign = -1; s = s.replace(/\s*dr\.?$/i, ''); }
  else if (/\bcr\.?$/i.test(s)) s = s.replace(/\s*cr\.?$/i, '');
  s = s.replace(/[^0-9.,-]/g, '');
  if (s.startsWith('-')) { sign *= -1; s = s.slice(1); }
  // European format "1.234,56"
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && s ? sign * toMinor(n) : null;
}

function StatementImport({ data }: { data: Data }) {
  const profile = useProfile();
  const toast = useUI((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [kind, setKind] = useState<'csv' | 'ofx' | null>(null);
  const [notice, setNotice] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [ofxRows, setOfxRows] = useState<Row[]>([]);
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>({ date: 0, description: 1 });
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [dayFirst, setDayFirst] = useState(true);
  const [negOut, setNegOut] = useState(true);
  const [accountId, setAccountId] = useState(() => data.accounts.find((a) => a.type === 'bank')?.id ?? data.accounts[0]?.id ?? '');
  const [override, setOverride] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const cols = grid[0]?.length ?? 0;
  const colLabel = (i: number) => (header ? grid[0]?.[i]?.trim() || `Column ${i + 1}` : `Column ${i + 1}`);

  function reset() {
    setFileName(''); setKind(null); setGrid([]); setOfxRows([]); setOverride({}); setNotice('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onFile(file?: File) {
    setOverride({}); setNotice(''); setGrid([]); setOfxRows([]); setKind(null);
    if (!file) return;
    setFileName(file.name);
    const ext = extOf(file.name);
    if (ext === 'xlsx' || ext === 'xls') {
      setNotice('Excel files aren’t supported yet. Save as CSV from Excel/Sheets for now, then choose that file.');
      return;
    }
    const text = await file.text();
    if (ext === 'ofx' || ext === 'qfx' || /<OFX>/i.test(text.slice(0, 2000))) {
      const rows = parseOFX(text).map((r): Row => ({ date: r.date, amount: Math.abs(r.amount), type: r.amount < 0 ? 'expense' : 'income', payee: r.name, refNo: r.fitid }));
      if (!rows.length) { setNotice('No transactions were found in this file. Check that it is an OFX or QFX statement export.'); return; }
      setOfxRows(rows); setKind('ofx');
      return;
    }
    const g = parseCSV(text);
    if (g.length < 2) { setNotice('This file has no rows to import. Check that it is a CSV export from your bank.'); return; }
    setGrid(g); setKind('csv');
    const saved = await getSetting<SavedMap | null>(`csvmap:${accountId}`, null);
    if (saved && Math.max(saved.map.date, saved.map.description, saved.map.amount ?? 0, saved.map.debit ?? 0, saved.map.credit ?? 0) < g[0].length) {
      applySaved(saved);
    } else {
      const guess = guessColumns(g[0]);
      setHeader(true);
      setMap(guess);
      setMode(guess.amount === undefined && (guess.debit !== undefined || guess.credit !== undefined) ? 'split' : 'single');
    }
  }

  function applySaved(s: SavedMap) {
    setMap(s.map); setDayFirst(s.dayFirst); setNegOut(s.negOut); setMode(s.mode); setHeader(s.header);
  }

  // Changing account brings back the mapping you used for it last time.
  async function onAccount(id: string) {
    setAccountId(id);
    if (kind !== 'csv') return;
    const saved = await getSetting<SavedMap | null>(`csvmap:${id}`, null);
    if (saved && Math.max(saved.map.date, saved.map.description, saved.map.amount ?? 0, saved.map.debit ?? 0, saved.map.credit ?? 0) < cols) applySaved(saved);
  }

  const parsed = useMemo((): { rows: Row[]; bad: number } => {
    if (kind === 'ofx') return { rows: ofxRows, bad: 0 };
    if (kind !== 'csv') return { rows: [], bad: 0 };
    const body = header ? grid.slice(1) : grid;
    const rows: Row[] = [];
    let bad = 0;
    for (const r of body) {
      const date = parseDate(r[map.date] ?? '', dayFirst);
      let signed: number | null = null;
      if (mode === 'single') {
        const a = map.amount !== undefined ? parseAmount(r[map.amount]) : null;
        if (a !== null) signed = negOut ? a : -a;
      } else {
        const out = map.debit !== undefined ? parseAmount(r[map.debit]) : null;
        const inn = map.credit !== undefined ? parseAmount(r[map.credit]) : null;
        if (out) signed = -Math.abs(out);
        else if (inn) signed = Math.abs(inn);
      }
      if (!date || !signed) { bad++; continue; }
      rows.push({ date, amount: Math.abs(signed), type: signed < 0 ? 'expense' : 'income', payee: (r[map.description] ?? '').trim().replace(/\s+/g, ' ') || 'Imported' });
    }
    return { rows, bad };
  }, [kind, ofxRows, grid, header, map, mode, dayFirst, negOut]);

  // Duplicates: same reference, or same amount within a day either side with a similar payee.
  const dupFlags = useMemo(() => {
    const refs = new Set(data.all.map((t) => t.refNo).filter(Boolean));
    return parsed.rows.map((r) => {
      if (r.refNo && refs.has(r.refNo)) return true;
      const day = new Date(`${r.date}T12:00:00`).getTime();
      return data.all.some((t) => t.amount === r.amount && Math.abs(new Date(t.date).getTime() - day) <= 1.5 * DAY && similarPayee(t.payee, r.payee));
    });
  }, [parsed.rows, data.all]);

  const suggestions = useMemo(
    () => parsed.rows.map((r) => suggestCategory(r.payee, data.categories, data.rules, data.all)),
    [parsed.rows, data.categories, data.rules, data.all],
  );

  const include = (i: number) => override[i] ?? !dupFlags[i];
  const toImport = parsed.rows.filter((_, i) => include(i)).length;
  const dupCount = dupFlags.filter(Boolean).length;

  async function doImport() {
    if (!accountId) return;
    setBusy(true);
    try {
      const now = Date.now();
      const acct = data.acct(accountId);
      const rows: Transaction[] = [];
      parsed.rows.forEach((r, i) => {
        if (!include(i)) return;
        const s = suggestions[i];
        const cat = s && data.cat(s.categoryId)?.kind === (r.type === 'income' ? 'income' : 'expense') ? s.categoryId : undefined;
        rows.push({
          id: uid(), date: new Date(`${r.date}T12:00:00`).toISOString(), amount: r.amount, currency: profile?.currency ?? acct?.currency ?? 'USD',
          type: r.type, accountId, categoryId: cat, payee: r.payee, tags: [], source: 'import', needsReview: false, refNo: r.refNo,
          createdAt: now, updatedAt: now,
        });
      });
      await db.transactions.bulkAdd(rows);
      if (kind === 'csv') await setSetting<SavedMap>(`csvmap:${accountId}`, { map, dayFirst, negOut, mode, header });
      const skipped = parsed.rows.length - rows.length;
      await log('import', `${rows.length} rows from ${fileName}`);
      toast(`Imported ${rows.length}, skipped ${skipped} ${skipped === 1 ? 'duplicate' : 'duplicates'}`);
      reset();
    } finally {
      setBusy(false);
    }
  }

  const colSelect = (id: string, label: string, value: number | undefined, onChange: (v: number | undefined) => void, optional = false) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
        {optional && <option value="">Not used</option>}
        {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
      </select>
    </div>
  );

  return (
    <Panel title="Import a statement">
      <p className="sub mb-4">Download a statement from your bank as CSV, OFX or QFX and choose it here. Duplicates of entries you already have are skipped.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="stmt-file" className="label">Statement file</label>
          <input id="stmt-file" ref={fileRef} type="file" accept=".csv,.ofx,.qfx,.xlsx,.xls,text/csv"
            className="block w-full text-sm file:btn-soft file:mr-3 file:border-0 file:h-10 file:cursor-pointer"
            onChange={(e) => onFile(e.target.files?.[0])} />
          <p className="text-xs text-muted mt-1.5">CSV, OFX or QFX. Excel files: save as CSV from Excel/Sheets for now.</p>
        </div>
        <div className="min-w-[12rem]">
          <label htmlFor="stmt-acct" className="label">Import into</label>
          <select id="stmt-acct" className="field" value={accountId} onChange={(e) => onAccount(e.target.value)}>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {notice && <p className="mt-4 text-sm rounded-xl bg-sunk/70 p-3" role="status">{notice}</p>}

      {kind === 'csv' && (
        <fieldset className="mt-5 space-y-4">
          <legend className="font-bold mb-2">Match the columns</legend>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={header} onChange={(e) => setHeader(e.target.checked)} />
              First row holds column names
            </label>
            <Segmented label="Date format" value={dayFirst ? 'd' : 'm'} onChange={(v) => setDayFirst(v === 'd')}
              options={[{ value: 'd', label: 'Day first (31/12)' }, { value: 'm', label: 'Month first (12/31)' }]} />
            <Segmented label="Amount columns" value={mode} onChange={setMode}
              options={[{ value: 'single', label: 'One amount column' }, { value: 'split', label: 'Money out and in' }]} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {colSelect('map-date', 'Date', map.date, (v) => setMap((m) => ({ ...m, date: v ?? 0 })))}
            {colSelect('map-desc', 'Description', map.description, (v) => setMap((m) => ({ ...m, description: v ?? 0 })))}
            {mode === 'single' ? (
              <>
                {colSelect('map-amt', 'Amount', map.amount, (v) => setMap((m) => ({ ...m, amount: v })), true)}
                <div>
                  <label htmlFor="map-sign" className="label">Negative amounts are</label>
                  <select id="map-sign" className="field" value={negOut ? 'out' : 'in'} onChange={(e) => setNegOut(e.target.value === 'out')}>
                    <option value="out">Money out</option>
                    <option value="in">Money in</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                {colSelect('map-debit', 'Money out', map.debit, (v) => setMap((m) => ({ ...m, debit: v })), true)}
                {colSelect('map-credit', 'Money in', map.credit, (v) => setMap((m) => ({ ...m, credit: v })), true)}
              </>
            )}
          </div>
          <p className="text-xs text-muted">Tandem remembers this layout for the chosen account next time.</p>
        </fieldset>
      )}

      {kind && (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h3 className="font-bold">Preview</h3>
            <p className="text-sm text-muted num">
              {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'} read
              {dupCount > 0 && ` · ${dupCount} look like duplicates`}
              {parsed.bad > 0 && ` · ${parsed.bad} couldn’t be read`}
            </p>
          </div>
          {parsed.rows.length === 0 ? (
            <p className="text-sm rounded-xl bg-sunk/70 p-3">No rows could be read with these settings. Check the date, description and amount columns above.</p>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted border-b border-line/70">
                    <th scope="col" className="py-2 pr-2 font-semibold">Import</th>
                    <th scope="col" className="py-2 pr-2 font-semibold">Date</th>
                    <th scope="col" className="py-2 pr-2 font-semibold">Description</th>
                    <th scope="col" className="py-2 pr-2 font-semibold">Suggested category</th>
                    <th scope="col" className="py-2 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {parsed.rows.slice(0, 10).map((r, i) => {
                    const c = suggestions[i] ? data.cat(suggestions[i]!.categoryId) : undefined;
                    return (
                      <tr key={i} className={include(i) ? '' : 'opacity-60'}>
                        <td className="py-2 pr-2">
                          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={include(i)}
                            aria-label={`Import ${r.payee} on ${r.date}`} onChange={(e) => setOverride((o) => ({ ...o, [i]: e.target.checked }))} />
                        </td>
                        <td className="py-2 pr-2 num whitespace-nowrap">{r.date}</td>
                        <td className="py-2 pr-2">
                          <span className="block truncate max-w-[16rem]">{r.payee}</span>
                          {dupFlags[i] && <span className="text-[11px] font-semibold text-warn bg-warn/10 rounded-md px-1.5 py-0.5">Possible duplicate</span>}
                        </td>
                        <td className="py-2 pr-2 text-muted">{c ? `${c.emoji} ${c.name}` : 'None'}</td>
                        <td className={`py-2 text-right money num font-semibold whitespace-nowrap ${r.type === 'income' ? 'text-good' : ''}`}>
                          <Money value={r.type === 'expense' ? -r.amount : r.amount} sign={r.type === 'income'} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parsed.rows.length > 10 && <p className="text-xs text-muted mt-2">Showing the first 10 rows. Duplicates further down are skipped too.</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2 justify-end">
            <button className="btn-ghost" onClick={reset}>Cancel</button>
            <button className="btn-primary" disabled={!toImport || !accountId || busy} onClick={doImport}>
              <FileUp size={16} /> Import {toImport} {toImport === 1 ? 'entry' : 'entries'}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── Voice entry ───────────────────────── */

interface SpeechResultEvent { results: ArrayLike<ArrayLike<{ transcript: string }>> }
interface SpeechRec {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void;
}
type SpeechCtor = new () => SpeechRec;

function VoiceEntry({ data }: { data: Data }) {
  const fmt = useFmt();
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const recRef = useRef<SpeechRec | null>(null);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => () => recRef.current?.stop(), []);

  function toggleMic() {
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    setErr('');
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => setText(Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim());
    rec.onend = () => setListening(false);
    rec.onerror = (e) => { setListening(false); setErr(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser settings, or type instead.' : 'Didn’t catch that. Try again, or type the sentence.'); };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  const draft = useMemo(() => (text.trim() ? parseVoice(text) : null), [text]);
  const suggestion = useMemo(() => {
    if (!draft) return null;
    return (draft.payee && suggestCategory(draft.payee, data.categories, data.rules, data.all))
      || (draft.categoryHint && suggestCategory(draft.categoryHint, data.categories, data.rules, data.all)) || null;
  }, [draft, data.categories, data.rules, data.all]);

  function open() {
    if (!draft) return;
    useUI.getState().openQuickAdd(draft.type, { amount: draft.amount, payee: draft.payee, date: draft.date, source: 'voice', categoryId: suggestion?.categoryId });
    setText('');
  }

  return (
    <Panel title="Say it">
      <p className="sub mb-3">Describe a spend in one sentence, like “Spent 45 on groceries at Whole Foods yesterday”.</p>
      <label htmlFor="voice-text" className="label">Sentence</label>
      <div className="flex gap-2">
        <input id="voice-text" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Spent 12 on coffee at Starbucks" />
        {SR && (
          <button className={`${listening ? 'btn-primary' : 'btn-soft'} w-11 p-0 shrink-0`} onClick={toggleMic} aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Speak instead of typing'}>
            {listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>
      {listening && <p className="text-xs font-semibold text-primary mt-1.5" role="status">Listening… speak now.</p>}
      {!SR && <p className="text-xs text-muted mt-1.5">Voice isn’t available in this browser — type the sentence instead.</p>}
      {err && <p className="text-xs font-semibold text-bad mt-1.5" role="alert">{err}</p>}

      {draft && (
        <div className="mt-4 rounded-2xl border border-line/80 p-4">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Type">{draft.type === 'income' ? 'Income' : 'Expense'}</Field>
            <Field label="Amount">{draft.amount ? <span className="money num">{fmt(draft.amount)}</span> : 'Not heard'}</Field>
            <Field label="Payee">{draft.payee ?? 'Not heard'}</Field>
            <Field label="Date">{relativeDay(`${draft.date}T12:00:00`)}</Field>
            <Field label="Category">{suggestion ? `${data.cat(suggestion.categoryId)?.emoji ?? ''} ${data.cat(suggestion.categoryId)?.name ?? ''}` : 'Choose in quick add'}</Field>
          </dl>
          {suggestion && <p className="text-xs text-muted mt-2">Suggested: {suggestion.reason}</p>}
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" onClick={open}>Open in quick add</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── Receipt ───────────────────────── */

// Imports for ReceiptScan only, kept beside it. `ocr` is a thin wrapper: the OCR engine itself is
// fetched the first time a picture is read.
import { ImagePlus } from 'lucide-react';
import { capturePayments, captureSummary, type CaptureResult } from '../lib/capture';
import { ocrAvailable, readImageText } from '../lib/ocr';
import { readReceipt, type ReceiptRead } from '../lib/receiptText';

interface Shot {
  id: number;
  name: string;
  url: string;
  state: 'waiting' | 'reading' | 'read' | 'unreadable' | 'failed' | 'saved';
  progress: number;
  read?: ReceiptRead;
  /** Minor units, from the same parser the capture pipeline uses. */
  amount?: number;
  payee?: string;
  error?: string;
  outcome?: CaptureResult['status'];
}

const OUTCOME: Record<CaptureResult['status'], string> = {
  added: 'Added',
  review: 'In your review inbox to check',
  duplicate: 'Already recorded, so not added again',
  ignored: 'Not added',
};

let shotId = 0;

function ReceiptScan() {
  const fmt = useFmt();
  const currency = useProfile()?.currency ?? 'USD';
  const toast = useUI((s) => s.toast);
  const canRead = ocrAvailable();
  const [shots, setShots] = useState<Shot[]>([]);
  const [saving, setSaving] = useState(false);
  const run = useRef(0);
  const urls = useRef<string[]>([]);
  useEffect(() => () => { run.current++; urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const patch = (id: number, p: Partial<Shot>) => setShots((all) => all.map((s) => (s.id === id ? { ...s, ...p } : s)));

  async function choose(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || !f.type);
    if (!files.length) return;
    const mine = ++run.current;
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    const next: Shot[] = files.map((f) => ({ id: ++shotId, name: f.name, url: URL.createObjectURL(f), state: canRead ? 'waiting' : 'unreadable', progress: 0 }));
    urls.current = next.map((s) => s.url);
    setShots(next);
    if (!canRead) return;
    // One after another: a phone has the memory for one picture at a time.
    for (let i = 0; i < files.length; i++) {
      if (run.current !== mine) return;
      const id = next[i].id;
      patch(id, { state: 'reading' });
      try {
        const text = await readImageText(files[i], (p) => { if (run.current === mine) patch(id, { progress: p }); });
        if (run.current !== mine) return;
        const read = readReceipt(text);
        const parsed = read ? parseAlert(read.message, currency) : null;
        if (read && parsed) patch(id, { state: 'read', read, amount: parsed.amount, payee: parsed.merchant });
        else patch(id, { state: 'unreadable' });
      } catch (e) {
        if (run.current !== mine) return;
        patch(id, { state: 'failed', error: e instanceof Error ? e.message : 'This picture couldn’t be read.' });
      }
    }
  }

  async function add(targets: Shot[]) {
    if (saving || !targets.length) return;
    setSaving(true);
    const results: CaptureResult[] = [];
    try {
      for (const s of targets) {
        const r = await capturePayments(s.read!.message, { source: 'ocr' });
        results.push(...r);
        patch(s.id, { state: 'saved', outcome: r[0]?.status ?? 'ignored' });
      }
      toast(captureSummary(results, fmt));
    } catch {
      toast('That couldn’t be saved. Nothing else was changed; try again.');
    } finally { setSaving(false); }
  }

  function edit(s: Shot) {
    const r = s.read!;
    // dd-mm-yyyy from the screenshot → the entry sheet's yyyy-mm-dd, when it is a real, recent, past day.
    const [d, m, y] = (r.date ?? '').split('-');
    const iso = r.date ? `${y}-${m}-${d}` : '';
    const at = iso ? new Date(`${iso}T12:00:00`).getTime() : NaN;
    const date = at <= Date.now() && Date.now() - at < 45 * DAY ? iso : undefined;
    useUI.getState().openQuickAdd(r.direction === 'debit' ? 'expense' : 'income', { amount: s.amount, payee: s.payee, source: 'ocr', notes: r.message, ...(date ? { date } : {}) });
  }
  const enter = () => useUI.getState().openQuickAdd('expense', { source: 'ocr', notes: 'From receipt' });

  const solo = shots.length === 1;
  const reading = shots.some((s) => s.state === 'waiting' || s.state === 'reading');
  const ready = shots.filter((s) => s.state === 'read');
  const done = shots.filter((s) => s.state !== 'waiting' && s.state !== 'reading').length;
  const understood = shots.filter((s) => s.state === 'read' || s.state === 'saved').length;
  const pick = 'btn-soft cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary';

  return (
    <Panel title="Read a payment screenshot">
      <p className="sub mb-3">
        {canRead
          ? 'Choose a screenshot of a payment from Google Pay, PhonePe, Paytm or your bank app, and Tandem reads the amount and who it went to. The picture is read on this phone and never uploaded.'
          : 'Choose a picture of a receipt to keep in view while you enter it. It stays on this device and is never uploaded. Reading screenshots automatically isn’t available in this version.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <label className={pick}>
          <ImagePlus size={18} aria-hidden />
          <span>{canRead ? 'Choose screenshots' : 'Choose a picture'}</span>
          <input id="receipt-file" type="file" accept="image/*" multiple={canRead} className="sr-only"
            onChange={(e) => { void choose(e.target.files); e.target.value = ''; }} />
        </label>
        <label className={pick}>
          <Camera size={18} aria-hidden />
          <span>Take a photo</span>
          <input id="receipt-camera" type="file" accept="image/*" capture="environment" className="sr-only"
            onChange={(e) => { void choose(e.target.files); e.target.value = ''; }} />
        </label>
      </div>

      {!shots.length && (
        <div className="mt-4 rounded-2xl border border-dashed border-line p-6 text-center text-muted">
          <Camera size={22} className="mx-auto mb-2" aria-hidden />
          <p className="text-sm">{canRead ? 'What Tandem reads from your screenshot appears here.' : 'Your receipt preview appears here.'}</p>
        </div>
      )}

      {shots.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold" role="status">
            {reading ? `Reading screenshot ${Math.min(done + 1, shots.length)} of ${shots.length}…` : `Read a payment in ${understood} of ${shots.length} screenshots.`}
          </p>
          {ready.length > 1 && <button className="btn-primary" disabled={saving || reading} onClick={() => void add(ready)}>Add all {ready.length}</button>}
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {shots.map((s) => (
          <li key={s.id} className={solo ? 'space-y-3' : 'flex gap-3 rounded-2xl border border-line/80 p-3'} data-receipt={s.state}>
            <img src={s.url} alt={`Screenshot${s.name ? `: ${s.name}` : ''}`}
              className={solo ? 'max-h-72 w-full object-contain rounded-2xl bg-sunk' : 'h-20 w-14 shrink-0 object-cover object-top rounded-lg bg-sunk'} />
            <div className="min-w-0 flex-1">
              {s.state === 'waiting' && <p className="text-sm text-muted">Waiting its turn…</p>}
              {s.state === 'reading' && (
                <div role="status">
                  <p className="text-sm font-semibold">Reading the screenshot…</p>
                  <p className="text-xs text-muted mt-0.5">This can take several seconds{s.progress > 0 ? ` · ${Math.round(s.progress * 100)}%` : ''}. The first one takes longest.</p>
                </div>
              )}
              {(s.state === 'read' || s.state === 'saved') && s.read && (
                <div>
                  <p className="text-xs font-semibold text-muted">{s.read.direction === 'debit' ? 'Paid' : 'Received'}</p>
                  <p className="font-display text-2xl font-bold num break-words" data-receipt-amount>{fmt(s.amount ?? 0)}</p>
                  <p className="text-sm break-words" data-receipt-payee>
                    {s.payee ? <>{s.read.direction === 'debit' ? 'to' : 'from'} <span className="font-semibold">{s.payee}</span></> : <span className="text-muted">Couldn’t read who it was {s.read.direction === 'debit' ? 'paid to' : 'from'}</span>}
                  </p>
                  {(s.read.date || s.read.refNo) && (
                    <p className="text-xs text-muted mt-0.5 break-words">{[s.read.date && relativeDay(`${s.read.date.split('-').reverse().join('-')}T12:00:00`), s.read.refNo && `Ref ${s.read.refNo}`].filter(Boolean).join(' · ')}</p>
                  )}
                  {s.state === 'read' && s.read.unsure && <p className="text-xs font-semibold text-warn mt-1.5">The rupee sign wasn’t clear. Check the amount against the screenshot.</p>}
                  {s.state === 'saved'
                    ? <p className="text-sm font-semibold text-primary mt-2" role="status">{OUTCOME[s.outcome ?? 'ignored']}</p>
                    : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-primary" disabled={saving} onClick={() => void add([s])}>Add it</button>
                        <button className="btn-soft" disabled={saving} onClick={() => edit(s)}>Edit first</button>
                      </div>
                    )}
                </div>
              )}
              {(s.state === 'unreadable' || s.state === 'failed') && (
                <div>
                  {canRead && (
                    <p className="text-sm" role="status">
                      {s.state === 'failed' ? s.error : 'Couldn’t read a completed payment in this picture. It works best with the full “payment successful” screen.'}
                    </p>
                  )}
                  <div className={`flex ${canRead ? 'mt-3' : 'justify-end'}`}>
                    <button className={canRead ? 'btn-soft' : 'btn-primary'} onClick={enter}>Enter details</button>
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
