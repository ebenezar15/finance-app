import { useLiveQuery } from 'dexie-react-hooks';
import { CheckSquare, Copy, Download, Filter, ListChecks, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar, CatIcon, Empty, Money, SOURCE_LABEL, Segmented, Sheet, SourceBadge, useFmt } from '../components/ui';
import { db, log } from '../db/db';
import { saveTransaction, softDelete, useData, useProfile, type Data } from '../db/hooks';
import type { Transaction, TxType } from '../db/types';
import { toCSV } from '../lib/csv';
import { isoDate, monthKey, monthLabel, relativeDay } from '../lib/dates';
import { evalAmount, formatMoney, toMinor } from '../lib/money';
import { useUI } from '../store/ui';
import { APP_LOCALE } from '../lib/locale';
import { saveFile } from '../lib/download';

const PAGE = 150;

type TypeFilter = '' | 'expense' | 'income' | 'transfer';

interface Filters {
  month: string; // '' = all time
  type: TypeFilter;
  cat: string;
  acct: string;
  member: string;
  source: string;
  min: string;
  max: string;
}

const EMPTY: Filters = { month: '', type: '', cat: '', acct: '', member: '', source: '', min: '', max: '' };

const TAX_SECTIONS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'investment', label: 'Investment' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'medical', label: 'Medical' },
  { value: 'donation', label: 'Donation' },
  { value: 'home-loan-interest', label: 'Home loan interest' },
  { value: 'rent', label: 'Rent' },
  { value: 'education', label: 'Education' },
];

const TYPE_LABEL: Record<TxType, string> = {
  expense: 'Expense', income: 'Income', transfer: 'Transfer', refund: 'Refund', adjustment: 'Adjustment',
};

const monthName = (mk: string) => {
  const [y, m] = mk.split('-').map(Number);
  return monthLabel(new Date(y, m - 1, 1));
};

/** Net effect for summaries: in is positive, out is negative, transfers are neutral. */
function net(t: Transaction) {
  if (t.type === 'income' || t.type === 'refund') return t.amount;
  if (t.type === 'expense') return -t.amount;
  if (t.type === 'adjustment') return t.amount;
  return 0;
}

function AmountText({ t, className = '' }: { t: Transaction; className?: string }) {
  const fmt = useFmt();
  if (t.type === 'expense') return <span className={`money num font-bold text-ink ${className}`}>{fmt(-t.amount)}</span>;
  if (t.type === 'income' || t.type === 'refund') return <span className={`money num font-bold text-good ${className}`}>{fmt(t.amount, { sign: true })}</span>;
  return <span className={`money num font-semibold text-muted ${className}`}>{fmt(t.amount)}</span>;
}

export default function Activity() {
  const data = useData();
  if (!data) return null;
  return <ActivityList data={data} />;
}

function ActivityList({ data }: { data: Data }) {
  const [params] = useSearchParams();
  const fmt = useFmt();
  const currency = useProfile()?.currency ?? 'USD';
  const toast = useUI((s) => s.toast);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filters>(() => ({ ...EMPTY, cat: params.get('cat') ?? '', month: params.get('month') ?? '' }));
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const [trashOpen, setTrashOpen] = useState(false);

  // The Sankey on Home and the "/" shortcut link here with query params.
  const focus = params.get('focus');
  const pCat = params.get('cat');
  const pMonth = params.get('month');
  useEffect(() => { if (focus === '1') searchRef.current?.focus(); }, [focus]);
  useEffect(() => {
    if (pCat !== null || pMonth !== null) setF((x) => ({ ...x, cat: pCat ?? x.cat, month: pMonth ?? x.month }));
  }, [pCat, pMonth]);
  useEffect(() => { setLimit(PAGE); }, [q, f]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  const months = useMemo(() => {
    const s = new Set(data.txs.map((t) => monthKey(t.date)));
    if (f.month) s.add(f.month);
    return [...s].sort().reverse();
  }, [data.txs, f.month]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const min = f.min ? toMinor(f.min) : undefined;
    const max = f.max ? toMinor(f.max) : undefined;
    const catName = new Map(data.categories.map((c) => [c.id, c.name.toLowerCase()]));
    return data.txs.filter((t) => {
      if (f.month && monthKey(t.date) !== f.month) return false;
      if (f.type === 'expense' && t.type !== 'expense') return false;
      if (f.type === 'income' && t.type !== 'income' && t.type !== 'refund') return false;
      if (f.type === 'transfer' && t.type !== 'transfer') return false;
      if (f.cat && t.categoryId !== f.cat && !t.splits?.some((s) => s.categoryId === f.cat)) return false;
      if (f.acct && t.accountId !== f.acct && t.toAccountId !== f.acct) return false;
      if (f.member && t.memberId !== f.member) return false;
      if (f.source && t.source !== f.source) return false;
      if (min !== undefined && t.amount < min) return false;
      if (max !== undefined && t.amount > max) return false;
      if (!needle) return true;
      const major = (t.amount / 100).toFixed(2);
      const hay = [
        t.payee, t.notes, catName.get(t.categoryId ?? ''), t.tags.join(' '), major, major.replace(/\.00$/, ''), formatMoney(t.amount, currency),
      ].join(' ').toLowerCase();
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [data.txs, data.categories, q, f, currency]);

  const summary = useMemo(() => {
    let out = 0, inn = 0;
    for (const t of filtered) {
      if (t.type === 'expense') out += t.amount;
      else if (t.type === 'income' || t.type === 'refund') inn += t.amount;
    }
    return { out, inn };
  }, [filtered]);

  const groups = useMemo(() => {
    const shown = filtered.slice(0, limit);
    const out: { day: string; items: Transaction[]; net: number }[] = [];
    for (const t of shown) {
      const day = isoDate(new Date(t.date));
      let g = out[out.length - 1];
      if (!g || g.day !== day) { g = { day, items: [], net: 0 }; out.push(g); }
      g.items.push(t);
      g.net += net(t);
    }
    return out;
  }, [filtered, limit]);

  const active: { key: keyof Filters; label: string }[] = [];
  if (f.month) active.push({ key: 'month', label: monthName(f.month) });
  if (f.type) active.push({ key: 'type', label: f.type === 'expense' ? 'Spending' : f.type === 'income' ? 'Income' : 'Transfers' });
  if (f.cat) active.push({ key: 'cat', label: data.cat(f.cat)?.name ?? 'Category' });
  if (f.acct) active.push({ key: 'acct', label: data.acct(f.acct)?.name ?? 'Account' });
  if (f.member) active.push({ key: 'member', label: data.member(f.member)?.name ?? 'Member' });
  if (f.source) active.push({ key: 'source', label: SOURCE_LABEL[f.source] ?? f.source });
  if (f.min) active.push({ key: 'min', label: `At least ${fmt(toMinor(f.min))}` });
  if (f.max) active.push({ key: 'max', label: `At most ${fmt(toMinor(f.max))}` });

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); setBulkCat(''); };

  async function bulkCategory() {
    if (!bulkCat || !selected.size) return;
    const ids = [...selected];
    await db.transactions.where('id').anyOf(ids).modify({ categoryId: bulkCat, updatedAt: Date.now() });
    await log('bulk-category', `${ids.length} → ${bulkCat}`);
    toast(`Moved ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} to ${data.cat(bulkCat)?.name ?? 'category'}`);
    exitSelect();
  }
  async function bulkReviewed() {
    const ids = [...selected];
    await db.transactions.where('id').anyOf(ids).modify({ needsReview: false, updatedAt: Date.now() });
    toast(`Marked ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} as reviewed`);
    exitSelect();
  }
  async function bulkDelete() {
    const ids = [...selected];
    exitSelect();
    await softDelete(ids);
  }

  async function exportCSV() {
    const rows: (string | number)[][] = [['Date', 'Type', 'Payee', 'Category', 'Account', 'To account', 'Member', 'Amount', 'Currency', 'Source', 'Tags', 'Notes', 'Needs review']];
    for (const t of filtered) {
      rows.push([
        isoDate(new Date(t.date)), TYPE_LABEL[t.type], t.payee ?? '', data.cat(t.categoryId)?.name ?? '', data.acct(t.accountId)?.name ?? '',
        data.acct(t.toAccountId)?.name ?? '', data.member(t.memberId)?.name ?? '',
        ((t.type === 'transfer' ? t.amount : net(t)) / 100).toFixed(2), t.currency, SOURCE_LABEL[t.source] ?? t.source,
        t.tags.join('; '), t.notes ?? '', t.needsReview ? 'Yes' : 'No',
      ]);
    }
    const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    if (!(await saveFile(`tandem-activity-${f.month || 'all'}-${isoDate(new Date())}.csv`, blob))) return;
    toast(`Exported ${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`);
  }

  const expenseCats = data.categories.filter((c) => c.kind === 'expense');
  const incomeCats = data.categories.filter((c) => c.kind === 'income');
  const catOptions = (
    <>
      <optgroup label="Spending">{expenseCats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
      <optgroup label="Income">{incomeCats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
    </>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 pt-2 flex-wrap">
        <div>
          <h1 className="h1">Activity</h1>
          <p className="sub">Every entry across your household, newest first.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-soft" onClick={exportCSV} disabled={!filtered.length}><Download size={16} /> Export CSV</button>
          <button className="btn-soft" aria-pressed={selecting} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
            <ListChecks size={16} /> {selecting ? 'Done selecting' : 'Select'}
          </button>
          <button className="btn-ghost text-muted" onClick={() => setTrashOpen(true)}><Trash2 size={16} /> Trash</button>
        </div>
      </div>

      {/* Search + filters */}
      <section className="panel p-4 space-y-3">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search transactions</span>
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input ref={searchRef} type="search" className="field pl-10" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search payee, note, category, tag or amount" />
          </label>
          <button className="btn-soft shrink-0" aria-expanded={showFilters} aria-controls="activity-filters" onClick={() => setShowFilters((s) => !s)}>
            <Filter size={16} /> <span className="hidden sm:inline">Filters</span>
            {active.length > 0 && <span className="num text-xs font-bold rounded-full bg-ink text-surface px-1.5">{active.length}</span>}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Type" value={f.type} onChange={(v) => set('type', v)}
            options={[{ value: '', label: 'All' }, { value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfers' }]} />
          <label className="sr-only" htmlFor="flt-month">Month</label>
          <select id="flt-month" className="field h-10 w-auto min-w-[10rem]" value={f.month} onChange={(e) => set('month', e.target.value)}>
            <option value="">All time</option>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>

        {showFilters && (
          <div id="activity-filters" className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">
            <label><span className="label">Category</span>
              <select className="field" value={f.cat} onChange={(e) => set('cat', e.target.value)}>
                <option value="">Any category</option>{catOptions}
              </select>
            </label>
            <label><span className="label">Account</span>
              <select className="field" value={f.acct} onChange={(e) => set('acct', e.target.value)}>
                <option value="">Any account</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label><span className="label">Member</span>
              <select className="field" value={f.member} onChange={(e) => set('member', e.target.value)}>
                <option value="">Anyone</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label><span className="label">Source</span>
              <select className="field" value={f.source} onChange={(e) => set('source', e.target.value)}>
                <option value="">Any source</option>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label><span className="label">Minimum amount</span>
              <input className="field num" inputMode="decimal" value={f.min} onChange={(e) => set('min', e.target.value)} placeholder="0" />
            </label>
            <label><span className="label">Maximum amount</span>
              <input className="field num" inputMode="decimal" value={f.max} onChange={(e) => set('max', e.target.value)} placeholder="No limit" />
            </label>
          </div>
        )}

        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {active.map((a) => (
              <button key={a.key} className="chip" onClick={() => set(a.key, '')} aria-label={`Remove filter: ${a.label}`}>
                {a.label} <X size={14} aria-hidden />
              </button>
            ))}
            <button className="text-sm font-semibold text-primary px-2 h-8" onClick={() => setF(EMPTY)}>Clear filters</button>
          </div>
        )}
      </section>

      {/* Summary strip */}
      <section className="panel px-5 py-4 grid grid-cols-3 gap-4" aria-label="Summary of matching entries">
        <SummaryItem label="Entries"><span className="num">{filtered.length.toLocaleString(APP_LOCALE)}</span></SummaryItem>
        <SummaryItem label="Total out"><Money value={summary.out} /></SummaryItem>
        <SummaryItem label="Total in"><span className="text-good"><Money value={summary.inn} /></span></SummaryItem>
      </section>

      {/* Bulk action bar */}
      {selecting && (
        <section className="panel p-3 flex flex-wrap items-center gap-2 sticky top-16 md:top-2 z-20" aria-label="Bulk actions">
          <span className="text-sm font-semibold px-2 num">{selected.size} selected</span>
          <button className="btn-ghost h-9" onClick={() => setSelected(selected.size === Math.min(limit, filtered.length) ? new Set() : new Set(filtered.slice(0, limit).map((t) => t.id)))}>
            <CheckSquare size={16} /> {selected.size === Math.min(limit, filtered.length) && selected.size > 0 ? 'Select none' : 'Select all shown'}
          </button>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="bulk-cat">New category</label>
            <select id="bulk-cat" className="field h-9 w-auto" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
              <option value="">Change category…</option>{catOptions}
            </select>
            <button className="btn-soft h-9" disabled={!bulkCat || !selected.size} onClick={bulkCategory}>Apply</button>
          </div>
          <button className="btn-soft h-9" disabled={!selected.size} onClick={bulkReviewed}>Mark reviewed</button>
          <button className="btn-soft h-9 text-bad" disabled={!selected.size} onClick={bulkDelete}><Trash2 size={15} /> Delete</button>
          <button className="btn-ghost h-9 ml-auto" onClick={exitSelect}>Cancel</button>
        </section>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <section className="panel">
          {data.txs.length === 0 ? (
            <Empty icon={<Search size={20} />} title="No entries yet" body="Add a spend with the plus button, or import a statement from Inbox & import."
              action={<button className="btn-primary" onClick={() => useUI.getState().openQuickAdd('expense')}>Add an entry</button>} />
          ) : (
            <Empty icon={<Search size={20} />} title="Nothing matches" body="Try a different search word, or remove a filter to see more entries."
              action={active.length > 0 || q ? <button className="btn-soft" onClick={() => { setF(EMPTY); setQ(''); }}>Clear search and filters</button> : undefined} />
          )}
        </section>
      ) : (
        <section className="panel overflow-clip" aria-label="Transactions">
          {groups.map((g) => (
            <div key={g.day}>
              <h3 className="sticky top-14 md:top-0 z-10 flex items-center justify-between gap-3 px-5 py-2 bg-sunk/95 backdrop-blur text-[13px] font-bold border-b border-line/70">
                <span>{relativeDay(g.day + 'T12:00:00')}{' '}<span className="font-semibold text-muted">· {new Date(g.day + 'T12:00:00').toLocaleDateString(APP_LOCALE, { weekday: 'long' })}</span></span>
                <span className="text-muted font-semibold">Net <span className={`money num ${g.net > 0 ? 'text-good' : 'text-ink'}`}>{fmt(g.net, { sign: true })}</span></span>
              </h3>
              <ul className="divide-y divide-line/60">
                {g.items.map((t) => (
                  <li key={t.id}>
                    <Row t={t} data={data} selecting={selecting} checked={selected.has(t.id)}
                      onClick={() => (selecting ? toggle(t.id) : setEditing(t))} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {filtered.length > limit && (
            <div className="p-4 text-center border-t border-line/70">
              <button className="btn-soft" onClick={() => setLimit((l) => l + PAGE)}>Show more</button>
              <p className="text-xs text-muted mt-2 num">Showing {limit.toLocaleString(APP_LOCALE)} of {filtered.length.toLocaleString(APP_LOCALE)}</p>
            </div>
          )}
        </section>
      )}

      {editing && <EditSheet key={editing.id} tx={editing} data={data} onClose={() => setEditing(null)} />}
      <TrashSheet open={trashOpen} onOpenChange={setTrashOpen} data={data} />
    </div>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className="text-lg md:text-xl font-extrabold tracking-tight truncate">{children}</p>
    </div>
  );
}

function Row({ t, data, selecting, checked, onClick }: { t: Transaction; data: Data; selecting: boolean; checked: boolean; onClick: () => void }) {
  const c = data.cat(t.categoryId);
  const acct = data.acct(t.accountId);
  const to = data.acct(t.toAccountId);
  const m = data.member(t.memberId);
  const title = t.payee || (t.type === 'transfer' ? `Transfer${to ? ` to ${to.name}` : ''}` : c?.name ?? 'Untitled entry');
  const meta = [t.type === 'transfer' ? 'Transfer' : t.splits?.length ? 'Split' : c?.name ?? 'Uncategorised', acct?.name].filter(Boolean).join(' · ');
  const inner = (
    <>
      {selecting && (
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(var(--primary))]" checked={checked} onChange={onClick}
          aria-label={`Select ${title}`} onClick={(e) => e.stopPropagation()} />
      )}
      <CatIcon c={c} size={40} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{title}</span>
          {t.private && <span className="text-[11px] font-semibold text-muted border border-line rounded-md px-1.5 py-0.5 shrink-0">Private</span>}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted min-w-0 flex-wrap">
          <span className="truncate">{meta}</span>
          <SourceBadge s={t.source} />
          {t.needsReview && <span className="text-[11px] font-semibold text-warn bg-warn/10 rounded-md px-1.5 py-0.5">Needs review</span>}
        </span>
      </span>
      <Avatar m={m} size={24} />
      <AmountText t={t} className="text-[15px] text-right shrink-0" />
    </>
  );
  if (selecting) {
    return (
      <div className={`flex items-center gap-3 px-5 py-3 cursor-pointer ${checked ? 'bg-primary/5' : 'hover:bg-sunk/50'}`} onClick={onClick}>{inner}</div>
    );
  }
  return (
    <button type="button" className="w-full text-left flex items-center gap-3 px-5 py-3 hover:bg-sunk/50 focus-visible:bg-sunk/50 transition-colors" onClick={onClick}
      aria-label={`${title}, ${meta}. Open to edit`}>
      {inner}
    </button>
  );
}

function EditSheet({ tx, data, onClose }: { tx: Transaction; data: Data; onClose: () => void }) {
  const profile = useProfile();
  const toast = useUI((s) => s.toast);
  const [type, setType] = useState<TxType>(tx.type);
  const [amount, setAmount] = useState(String(tx.amount / 100));
  const [payee, setPayee] = useState(tx.payee ?? '');
  const [categoryId, setCategoryId] = useState(tx.categoryId ?? '');
  const [accountId, setAccountId] = useState(tx.accountId);
  const [toAccountId, setToAccountId] = useState(tx.toAccountId ?? '');
  const [memberId, setMemberId] = useState(tx.memberId ?? '');
  const [date, setDate] = useState(isoDate(new Date(tx.date)));
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [tags, setTags] = useState(tx.tags.join(', '));
  const [priv, setPriv] = useState(!!tx.private);
  const [tax, setTax] = useState(tx.taxSection ?? '');
  const [error, setError] = useState('');

  const parsedAmount = evalAmount(amount);
  const cats = data.categories.filter((c) => (type === 'income' ? c.kind === 'income' : c.kind === 'expense'));

  function build(): Transaction | null {
    if (parsedAmount === null || parsedAmount <= 0) { setError('Enter an amount greater than zero.'); return null; }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) { setError('Choose a different account to transfer to.'); return null; }
    const orig = new Date(tx.date);
    const [y, m, d] = date.split('-').map(Number);
    const when = new Date(y, m - 1, d, orig.getHours(), orig.getMinutes(), orig.getSeconds());
    return {
      ...tx, type, amount: toMinor(parsedAmount), payee: payee.trim() || undefined,
      categoryId: type === 'transfer' ? undefined : categoryId || undefined,
      accountId, toAccountId: type === 'transfer' ? toAccountId : undefined, memberId: memberId || undefined,
      date: Number.isNaN(when.getTime()) ? tx.date : when.toISOString(), notes: notes.trim() || undefined,
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean), private: priv || undefined, taxSection: tax || undefined,
    };
  }

  async function save() {
    const row = build();
    if (!row) return;
    await saveTransaction({ ...row, needsReview: false });
    toast('Changes saved');
    onClose();
  }
  async function duplicate() {
    const row = build();
    if (!row) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, createdAt: _c, updatedAt: _u, refNo: _r, deletedAt: _d, ...rest } = row;
    await saveTransaction({ ...rest, date: new Date().toISOString(), source: 'manual', needsReview: false, currency: rest.currency ?? profile?.currency });
    toast('Duplicate added for today');
    onClose();
  }
  async function remove() {
    onClose();
    await softDelete([tx.id]);
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Edit entry"
      description={`${SOURCE_LABEL[tx.source] ?? tx.source} · added ${new Date(tx.createdAt).toLocaleDateString(APP_LOCALE)}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Segmented label="Entry type" value={type} onChange={setType}
          options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }, { value: 'refund', label: 'Refund' }]} />
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2"><span className="label">Amount</span>
            <input className="field num text-lg font-bold" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }}
              aria-invalid={!!error} aria-describedby={error ? 'edit-error' : undefined} />
          </label>
          <label className="col-span-2"><span className="label">Payee</span>
            <input className="field" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Who was paid, or who paid you" />
          </label>
          {type !== 'transfer' && (
            <label className="col-span-2"><span className="label">Category</span>
              <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorised</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </label>
          )}
          <label className={type === 'transfer' ? '' : 'col-span-2 sm:col-span-1'}><span className="label">{type === 'transfer' ? 'From account' : 'Account'}</span>
            <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {type === 'transfer' && (
            <label><span className="label">To account</span>
              <select className="field" value={toAccountId} onChange={(e) => { setToAccountId(e.target.value); setError(''); }}>
                <option value="">Choose…</option>
                {data.accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <label className={type === 'transfer' ? '' : 'col-span-2 sm:col-span-1'}><span className="label">Member</span>
            <select className="field" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Household</option>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className={type === 'transfer' ? '' : 'col-span-2 sm:col-span-1'}><span className="label">Date</span>
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="col-span-2 sm:col-span-1"><span className="label">Tax section</span>
            <select className="field" value={tax} onChange={(e) => setTax(e.target.value)}>
              {TAX_SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="col-span-2"><span className="label">Notes</span>
            <textarea className="field h-auto min-h-[72px] py-2.5" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </label>
          <label className="col-span-2"><span className="label">Tags</span>
            <input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Separate with commas, e.g. holiday, school" />
          </label>
          <label className="col-span-2 flex items-start gap-3 rounded-xl bg-sunk/60 p-3 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 mt-0.5 accent-[rgb(var(--primary))]" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
            <span><span className="font-semibold text-sm block">Private</span><span className="text-xs text-muted">Only the member it belongs to can see this entry.</span></span>
          </label>
        </div>
        {error && <p id="edit-error" role="alert" className="text-sm font-semibold text-bad">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1">Save changes</button>
          <button type="button" className="btn-soft" onClick={duplicate}><Copy size={16} /> Duplicate</button>
          <button type="button" className="btn-soft text-bad" onClick={remove}><Trash2 size={16} /> Delete</button>
        </div>
      </form>
    </Sheet>
  );
}

function TrashSheet({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: Data }) {
  const toast = useUI((s) => s.toast);
  const trashed = useLiveQuery(
    async () => (open ? (await db.transactions.filter((t) => !!t.deletedAt).toArray()).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)) : []),
    [open],
  );
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function restore(id: string) {
    await db.transactions.where('id').equals(id).modify((t) => { delete t.deletedAt; });
    await log('restore', id);
    toast('Entry restored');
  }
  async function destroy(id: string) {
    await db.transactions.delete(id);
    await log('purge', id);
    setConfirmId(null);
    toast('Deleted forever');
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Trash" description="Deleted entries stay here for 30 days, then empty automatically.">
      {!trashed || trashed.length === 0 ? (
        <Empty icon={<Trash2 size={20} />} title="Trash is empty" body="When you delete an entry it lands here, so you can restore it within 30 days." />
      ) : (
        <ul className="divide-y divide-line/60 -mx-1">
          {trashed.map((t) => {
            const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - (t.deletedAt ?? 0)) / 86400_000));
            return (
              <li key={t.id} className="py-3 px-1">
                <div className="flex items-center gap-3">
                  <CatIcon c={data.cat(t.categoryId)} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{t.payee || data.cat(t.categoryId)?.name || TYPE_LABEL[t.type]}</p>
                    <p className="text-xs text-muted">{relativeDay(t.date)} · removed in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}</p>
                  </div>
                  <AmountText t={t} className="text-sm" />
                </div>
                {confirmId === t.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-bad/10 p-2" role="alert">
                    <span className="text-sm font-semibold flex-1 min-w-[10rem]">Delete this entry forever? This can’t be undone.</span>
                    <button className="btn-ghost h-9" onClick={() => setConfirmId(null)}>Cancel</button>
                    <button className="btn h-9 bg-bad text-white hover:brightness-110" onClick={() => destroy(t.id)}>Delete forever</button>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2 justify-end">
                    <button className="btn-soft h-9" onClick={() => restore(t.id)}><RotateCcw size={15} /> Restore</button>
                    <button className="btn-ghost h-9 text-bad" onClick={() => setConfirmId(t.id)}>Delete forever</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
