import { BookOpen, Check, ChevronDown, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, log, uid } from '../db/db';
import { useProfile, type Data } from '../db/hooks';
import { PALETTE } from '../db/seed';
import type { Account, Category, Transaction } from '../db/types';
import {
  FIELD_LABEL, detectTable, modeToMethod, openingBalance, parseCashbook, totals, type CbColumns, type CbEntry, type CbField,
} from '../lib/cashbook';
import { suggestCategory } from '../lib/categorize';
import { parseCSV } from '../lib/csv';
import { isoDate } from '../lib/dates';
import { APP_LOCALE } from '../lib/locale';
import { methodInfo } from '../lib/payment';
import { readXlsx } from '../lib/xlsx';
import { useUI } from '../store/ui';
import { Panel, useFmt } from './ui';

const FIELDS: CbField[] = ['date', 'time', 'remark', 'category', 'mode', 'cashIn', 'cashOut', 'amount', 'type', 'balance', 'party', 'entryBy'];
const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b);

/**
 * Import a book exported from the CashBook app. Each CashBook book becomes a Tandem account,
 * with the opening balance worked out so the final balance matches CashBook exactly.
 */
export function CashbookImport({ data }: { data: Data }) {
  const fmt = useFmt();
  const profile = useProfile();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [cols, setCols] = useState<CbColumns>({});
  const [dayFirst, setDayFirst] = useState(true);
  const [target, setTarget] = useState<'new' | string>('new');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'cash' | 'bank'>('cash');
  const [showCols, setShowCols] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; account: string } | null>(null);

  async function onFile(f: File | undefined) {
    setError(''); setDone(null); setRows(null);
    if (!f) return;
    setFileName(f.name);
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith('.pdf')) throw new Error('PDF reports can’t be read reliably. In CashBook, download the report as Excel instead.');
      const grid = name.endsWith('.csv') || name.endsWith('.txt') ? parseCSV(await f.text()) : await readXlsx(f);
      const t = detectTable(grid);
      if (!t) throw new Error('Couldn’t find the entries table in this file. It should have a Date column and Cash In / Cash Out (or Amount) columns.');
      setRows(grid); setHeaderRow(t.headerRow); setCols(t.cols);
      setNewName(t.bookName || f.name.replace(/\.(xlsx|csv|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'CashBook');
      // Guess date order: any first part over 12 means day-first; any second part over 12 means month-first.
      const sample = grid.slice(t.headerRow + 1, t.headerRow + 40).map((r) => r[t.cols.date!] ?? '');
      const parts = sample.map((s) => /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(s)).filter(Boolean) as RegExpExecArray[];
      if (parts.some((m) => Number(m[2]) > 12)) setDayFirst(false);
      else if (parts.some((m) => Number(m[1]) > 12)) setDayFirst(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This file couldn’t be read.');
    }
  }

  const parsed = useMemo(() => (rows ? parseCashbook(rows, headerRow, cols, { dayFirst }) : null), [rows, headerRow, cols, dayFirst]);
  const entries = parsed?.entries ?? [];
  const sums = totals(entries);
  const opening = openingBalance(entries);
  const lastBalance = [...entries].reverse().find((e) => e.balance !== undefined)?.balance;

  // Duplicates: same day, amount and description already in the chosen account.
  const dupes = useMemo(() => {
    if (target === 'new') return new Set<number>();
    const existing = data.all.filter((t) => t.accountId === target);
    return new Set(entries.filter((e) => existing.some((t) => t.amount === e.amount && sameDay(new Date(t.date), e.date)
      && ((t.notes ?? '') === e.remark || (t.payee ?? '') === (e.party ?? e.remark)))).map((e) => e.row));
  }, [entries, target, data.all]);

  // Category names in the file → existing categories, or new ones to create.
  const catPlan = useMemo(() => {
    const map = new Map<string, { id?: string; create?: Category }>();
    for (const e of entries) {
      const key = (e.category ?? '').trim();
      if (!key || map.has(key.toLowerCase())) continue;
      const kind = e.direction === 'in' ? 'income' : 'expense';
      const exact = data.categories.find((c) => c.name.toLowerCase() === key.toLowerCase());
      const guess = exact ?? data.cat(suggestCategory(key, data.categories, [], [])?.categoryId);
      if (guess && guess.kind === kind) map.set(key.toLowerCase(), { id: guess.id });
      else map.set(key.toLowerCase(), { create: { id: `cb-${uid()}`, name: key, emoji: kind === 'income' ? '💰' : '🏷️', colour: PALETTE[map.size % PALETTE.length], kind, need: 'discretionary' } });
    }
    return map;
  }, [entries, data.categories, data]);
  const newCats = [...catPlan.values()].filter((v) => v.create).map((v) => v.create!.name);

  async function runImport() {
    if (!entries.length || !profile) return;
    setBusy(true);
    try {
      const now = Date.now();
      const owner = data.members.find((m) => m.role === 'owner') ?? data.members[0];
      let accountId = target;
      let account: Account | undefined;
      if (target === 'new') {
        account = {
          id: uid(), name: newName.trim() || 'CashBook', type: newType, currency: profile.currency, openingBalance: opening ?? 0,
          ownerIds: owner ? [owner.id] : [], shared: true, colour: PALETTE[data.accounts.length % PALETTE.length], icon: newType === 'cash' ? 'wallet' : 'landmark', archived: false,
        };
        accountId = account.id;
      }
      const memberByName = (n?: string) => (n ? data.members.find((m) => m.name.toLowerCase() === n.toLowerCase())?.id : undefined) ?? owner?.id;
      const fallbackCat = (e: CbEntry) => suggestCategory(e.remark, data.categories, data.rules, data.all)?.categoryId;
      const rowsToAdd: Transaction[] = entries.filter((e) => !dupes.has(e.row)).map((e) => {
        const plan = catPlan.get((e.category ?? '').toLowerCase());
        return {
          id: uid(), date: e.date.toISOString(), amount: e.amount, currency: profile.currency,
          type: e.direction === 'in' ? 'income' : 'expense', accountId,
          categoryId: plan?.id ?? plan?.create?.id ?? fallbackCat(e),
          payee: (e.party || e.remark || (e.direction === 'in' ? 'Cash in' : 'Cash out')).slice(0, 80),
          notes: e.party && e.remark ? e.remark : undefined,
          memberId: memberByName(e.entryBy), paymentMethod: modeToMethod(e.mode),
          tags: ['cashbook'], source: 'import', needsReview: false, createdAt: now, updatedAt: now,
        };
      });
      await db.transaction('rw', [db.accounts, db.categories, db.transactions, db.audit], async () => {
        if (account) await db.accounts.add(account);
        const creates = [...catPlan.values()].filter((v) => v.create).map((v) => v.create!);
        if (creates.length) await db.categories.bulkAdd(creates);
        await db.transactions.bulkAdd(rowsToAdd);
        await log('import', `CashBook: ${rowsToAdd.length} entries from ${fileName}`);
      });
      const accName = account?.name ?? data.acct(accountId)?.name ?? 'account';
      setDone({ count: rowsToAdd.length, account: accName });
      setRows(null);
      useUI.getState().toast(`Imported ${rowsToAdd.length} entries from CashBook into ${accName}`);
    } catch {
      setError('The import couldn’t be saved. Nothing was changed; try again.');
    } finally {
      setBusy(false);
    }
  }

  const header = rows?.[headerRow] ?? [];
  const range = entries.length ? `${entries[0].date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })} – ${entries[entries.length - 1].date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const finalHere = (opening ?? 0) + sums.net;

  return (
    <Panel title={<span className="flex items-center gap-2" id="cashbook"><BookOpen size={18} className="text-primary" /> Import from CashBook</span>}>
      {!rows && !done && (
        <div className="space-y-3">
          <ol className="text-sm space-y-1.5 list-decimal pl-5">
            <li>In the CashBook app, open the book you want to move.</li>
            <li>Tap <b>Reports</b> (or <b>Download</b>), choose <b>All entries</b> and the full date range, then pick <b>Excel</b>.</li>
            <li>Save or share the file to this phone, then choose it below. Repeat for each book.</li>
          </ol>
          <label className="block">
            <span className="label">CashBook file (.xlsx or .csv)</span>
            <input type="file" accept=".xlsx,.csv,.txt,.xls,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="field pt-2" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <p className="text-xs text-muted">The file is read on this device and never uploaded. Each book becomes its own account, with its balance carried over.</p>
        </div>
      )}

      {error && <p role="alert" className="mt-3 flex gap-2 text-sm text-bad"><TriangleAlert size={16} className="shrink-0 mt-0.5" />{error}</p>}

      {done && (
        <div className="rounded-2xl bg-good/10 p-4 space-y-2">
          <p className="font-bold flex items-center gap-2"><Check size={18} className="text-good" /> Imported {done.count} entries into {done.account}</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/activity" className="btn-primary h-10">See them in Activity</Link>
            <button className="btn-soft h-10" onClick={() => { setDone(null); setFileName(''); }}>Import another book</button>
          </div>
        </div>
      )}

      {rows && parsed && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm"><FileSpreadsheet size={16} className="text-primary" /><b className="truncate">{fileName}</b>
            <button className="ml-auto text-primary font-semibold" onClick={() => { setRows(null); setFileName(''); }}>Choose another file</button></div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-sunk/70 p-3"><p className="text-xs text-muted">Entries</p><p className="font-extrabold num text-lg">{entries.length}</p><p className="text-[11px] text-muted">{range}</p></div>
            <div className="rounded-xl bg-sunk/70 p-3"><p className="text-xs text-muted">Cash in</p><p className="font-extrabold num text-lg text-good money">{fmt(sums.cashIn)}</p></div>
            <div className="rounded-xl bg-sunk/70 p-3"><p className="text-xs text-muted">Cash out</p><p className="font-extrabold num text-lg money">{fmt(sums.cashOut)}</p></div>
            <div className="rounded-xl bg-sunk/70 p-3"><p className="text-xs text-muted">Balance after import</p><p className="font-extrabold num text-lg money">{fmt(finalHere)}</p>
              {lastBalance !== undefined && <p className={`text-[11px] font-semibold ${lastBalance === finalHere ? 'text-good' : 'text-warn'}`}>{lastBalance === finalHere ? '✓ Matches CashBook' : `CashBook shows ${fmt(lastBalance)}`}</p>}</div>
          </div>
          {parsed.skipped > 0 && <p className="text-xs text-muted">{parsed.skipped} row{parsed.skipped > 1 ? 's' : ''} without a date or amount (totals, blank lines) will be skipped.</p>}

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="label">Import into</span>
              <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">A new account for this book</option>
                {data.accounts.filter((a) => !a.archived && a.type !== 'asset').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            {target === 'new' ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="block"><span className="label">Account name</span><input className="field" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
                <label className="block"><span className="label">Type</span>
                  <select className="field w-28" value={newType} onChange={(e) => setNewType(e.target.value as 'cash' | 'bank')}><option value="cash">Cash</option><option value="bank">Bank</option></select></label>
                {opening !== undefined && <p className="col-span-2 text-xs text-muted">Starting balance <b className="money num text-ink">{fmt(opening)}</b>, worked out from the file so the final balance matches CashBook.</p>}
              </div>
            ) : (
              <p className="text-xs text-muted self-end pb-2">{dupes.size ? `${dupes.size} entr${dupes.size > 1 ? 'ies are' : 'y is'} already in this account and will be skipped.` : 'No duplicates found in this account.'}</p>
            )}
          </div>

          {newCats.length > 0 && <p className="text-xs text-muted">New categories from CashBook: <b className="text-ink">{newCats.slice(0, 8).join(', ')}{newCats.length > 8 ? '…' : ''}</b>. You can rename them later.</p>}

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[520px]">
              <thead><tr className="text-left text-xs text-muted">
                <th className="py-1.5 px-1 font-semibold">Date</th><th className="px-1 font-semibold">Remark</th><th className="px-1 font-semibold">Category</th><th className="px-1 font-semibold">Paid with</th><th className="px-1 font-semibold text-right">Amount</th>
              </tr></thead>
              <tbody>
                {[...entries].reverse().slice(0, 8).map((e) => (
                  <tr key={e.row} className={`border-t border-line/60 ${dupes.has(e.row) ? 'opacity-50' : ''}`}>
                    <td className="py-1.5 px-1 whitespace-nowrap num">{e.date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })}</td>
                    <td className="px-1 truncate max-w-[180px]">{e.remark || e.party || '—'}{dupes.has(e.row) ? ' (already here)' : ''}</td>
                    <td className="px-1">{e.category ?? '—'}</td>
                    <td className="px-1">{methodInfo(modeToMethod(e.mode))?.short}</td>
                    <td className={`px-1 text-right num font-semibold money ${e.direction === 'in' ? 'text-good' : ''}`}>{e.direction === 'in' ? '+' : '−'}{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length > 8 && <p className="text-xs text-muted mt-1 px-1">Showing the latest 8 of {entries.length}.</p>}
          </div>

          <button className="text-sm font-semibold text-primary flex items-center gap-1" aria-expanded={showCols} onClick={() => setShowCols((s) => !s)}>
            <ChevronDown size={16} className={showCols ? 'rotate-180' : ''} /> Columns and date format
          </button>
          {showCols && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {FIELDS.map((f) => (
                <label key={f} className="block"><span className="label">{FIELD_LABEL[f]}</span>
                  <select className="field h-10 text-sm" value={cols[f] ?? ''} onChange={(e) => setCols((c) => ({ ...c, [f]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                    <option value="">Not in file</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select></label>
              ))}
              <label className="block"><span className="label">Dates like 05/03/2026 mean</span>
                <select className="field h-10 text-sm" value={dayFirst ? 'd' : 'm'} onChange={(e) => setDayFirst(e.target.value === 'd')}>
                  <option value="d">5 March (day first)</option><option value="m">3 May (month first)</option>
                </select></label>
            </div>
          )}

          <button className="btn-primary w-full sm:w-auto h-12" disabled={busy || !entries.length || (target === 'new' && !newName.trim())} onClick={runImport}>
            {busy ? 'Importing…' : `Import ${entries.length - dupes.size} entries`}
          </button>
        </div>
      )}
    </Panel>
  );
}
