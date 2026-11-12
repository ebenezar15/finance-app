import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, CornerDownLeft, DatabaseBackup, Eye, EyeOff, Import, Keyboard, Monitor, Moon, Search, Sun, Target, Wallet,
} from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData, type Data } from '../db/hooks';
import type { Transaction } from '../db/types';
import { relativeDay } from '../lib/dates';
import { bestScore, fuzzyScore } from '../lib/fuzzy';
import { toMinor } from '../lib/money';
import { useUI } from '../store/ui';
import { NAV } from './Layout';
import { CatIcon, Money } from './ui';

type Group = 'Actions' | 'Pages' | 'Entries';
type View = 'search' | 'help';

interface Item {
  id: string;
  group: Group;
  label: string;
  /** Extra words the search should match, e.g. "privacy" for Hide amounts. */
  keywords?: string[];
  icon: ReactNode;
  /** Secondary line under the label. */
  detail?: ReactNode;
  /** Shown on the right (desktop): a shortcut, or an amount for entries. */
  kbd?: string[];
  trailing?: ReactNode;
  /** Run without closing the palette (switching to the help view). */
  keepOpen?: boolean;
  run: () => void;
}

const MAX_ENTRIES = 8;
const LIMITED_PAGES = ['/', '/activity', '/goals'];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

function isTyping(target: EventTarget | null) {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-sunk px-1.5 font-sans text-[11px] font-semibold text-muted ${className}`}>
      {children}
    </kbd>
  );
}

/**
 * Ctrl/⌘K command palette: actions, pages and entries in one searchable list.
 * Mount once near the app root; open it from anywhere with `useUI.getState().setPalette(true)`.
 */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setPalette = useUI((s) => s.setPalette);
  const [view, setView] = useState<View>('search');
  // Set when an item ran, so closing doesn't throw focus back at the trigger over the new screen or sheet.
  const ranRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Ctrl/⌘K works everywhere, inputs included, and toggles.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const s = useUI.getState();
        if (s.paletteOpen) s.setPalette(false);
        else { setView('search'); s.setPalette(true); }
        return;
      }
      // "?" opens the shortcuts help, but only when not typing and no other dialog is up.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTyping(e.target)) return;
        const s = useUI.getState();
        if (!s.paletteOpen && document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        setView('help');
        s.setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (!open) setView('search'); }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setPalette}>
      <Dialog.Portal>
        {/* Same overlay as Sheet, one layer higher so ⌘K also works over an open sheet. */}
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-[rise_.2s]" />
        <Dialog.Content
          className="fixed z-[56] left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] md:left-1/2 md:right-auto md:top-[14vh] md:w-full md:max-w-xl md:-translate-x-1/2 flex flex-col max-h-[calc(100dvh-1.5rem)] md:max-h-[72vh] overflow-hidden bg-surface rounded-2xl md:rounded-[28px] border border-line/70 shadow-2xl animate-rise"
          onOpenAutoFocus={(e) => { e.preventDefault(); document.getElementById('cmdk-input')?.focus(); }}
          onCloseAutoFocus={(e) => { if (ranRef.current) e.preventDefault(); ranRef.current = false; }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search actions, pages and entries. Use the arrow keys to move and Enter to choose.</Dialog.Description>
          <PaletteBody view={view} setView={setView} onRan={() => { ranRef.current = true; }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while the palette is open, so its live data query doesn't run in the background. */
function PaletteBody({ view, setView, onRan }: { view: View; setView: (v: View) => void; onRan: () => void }) {
  const data = useData();
  const nav = useNavigate();
  const theme = useUI((s) => s.theme);
  const hideAmounts = useUI((s) => s.hideAmounts);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const deferredQ = useDeferredValue(q);
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;

  const showHelp = view === 'help' || q.trim() === '?';

  const actions = useMemo<Item[]>(() => {
    const ui = useUI.getState;
    const go = (to: string) => () => nav(to);
    const limited = !!data?.viewer;
    const list: Item[] = [
      { id: 'new-expense', group: 'Actions', label: 'New expense', keywords: ['add', 'spend', 'log', 'entry', 'quick add'], icon: <ArrowUpRight size={16} />, kbd: ['N'], run: () => ui().openQuickAdd('expense') },
      { id: 'new-income', group: 'Actions', label: 'New income', keywords: ['add', 'earn', 'salary', 'received', 'entry'], icon: <ArrowDownLeft size={16} />, run: () => ui().openQuickAdd('income') },
      { id: 'new-transfer', group: 'Actions', label: 'New transfer', keywords: ['move money', 'between accounts', 'entry'], icon: <ArrowLeftRight size={16} />, run: () => ui().openQuickAdd('transfer') },
      {
        id: 'toggle-hide', group: 'Actions', label: hideAmounts ? 'Show amounts' : 'Hide amounts', keywords: ['privacy', 'blur', 'amounts', 'hide', 'show'],
        icon: hideAmounts ? <Eye size={16} /> : <EyeOff size={16} />, run: () => ui().toggleHide(),
      },
      ...(['light', 'dark', 'system'] as const).map((t): Item => ({
        id: `theme-${t}`, group: 'Actions', label: `Switch to ${t === 'system' ? 'system' : t} theme`, keywords: ['theme', 'appearance', 'mode', t],
        icon: t === 'light' ? <Sun size={16} /> : t === 'dark' ? <Moon size={16} /> : <Monitor size={16} />,
        detail: theme === t ? 'Current theme' : t === 'system' ? 'Follow this device' : undefined,
        run: () => ui().setTheme(t),
      })),
    ];
    if (!limited) {
      list.push(
        { id: 'add-budget', group: 'Actions', label: 'Add budget', keywords: ['budget', 'limit', 'envelope'], icon: <Wallet size={16} />, run: go('/budgets') },
        { id: 'add-goal', group: 'Actions', label: 'Add goal', keywords: ['goal', 'save', 'savings'], icon: <Target size={16} />, run: go('/goals') },
        { id: 'import-cashbook', group: 'Actions', label: 'Import from CashBook', keywords: ['import', 'cashbook', 'csv', 'file', 'inbox'], icon: <Import size={16} />, run: go('/inbox#cashbook') },
        { id: 'backup', group: 'Actions', label: 'Back up now', keywords: ['backup', 'export', 'save', 'drive'], icon: <DatabaseBackup size={16} />, run: go('/settings') },
      );
    }
    list.push({ id: 'shortcuts', group: 'Actions', label: 'Keyboard shortcuts', keywords: ['help', 'keys', 'hotkeys'], icon: <Keyboard size={16} />, kbd: ['?'], keepOpen: true, run: () => setView('help') });
    return list;
  }, [nav, data?.viewer, hideAmounts, theme, setView]);

  const pages = useMemo<Item[]>(() => {
    const limited = !!data?.viewer;
    return NAV.filter((n) => !limited || LIMITED_PAGES.includes(n.to)).map((n) => {
      const Icon = n.icon;
      return {
        id: `page-${n.to}`, group: 'Pages' as const, label: n.label, keywords: ['go to', 'open', n.to.slice(1)], icon: <Icon size={16} />,
        kbd: n.to === '/activity' ? ['/'] : undefined, run: () => nav(n.to),
      };
    });
  }, [nav, data?.viewer]);

  const entries = useMemo<Item[]>(() => (data ? matchEntries(data, deferredQ).map((t) => entryItem(data, t, nav)) : []), [data, deferredQ, nav]);

  const items = useMemo(() => {
    const qt = q.trim();
    const rank = (list: Item[]) => {
      if (!qt) return list;
      return list
        .map((it, i) => ({ it, i, s: bestScore(qt, [it.label, ...(it.keywords ?? [])]) }))
        .filter((x) => x.s !== null)
        // A hit on the label counts for more than one on a keyword.
        .map((x) => ({ ...x, s: x.s! + (fuzzyScore(qt, x.it.label) !== null ? 20 : 0) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.it);
    };
    return [...rank(actions), ...rank(pages), ...entries];
  }, [q, actions, pages, entries]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { if (active >= items.length) setActive(Math.max(0, items.length - 1)); }, [items.length, active]);
  // Keep the active row visible. "nearest" avoids jumps, and there is no smooth scrolling, which suits reduced motion too.
  useEffect(() => {
    if (showHelp) return;
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, showHelp, items, listId]);

  const runItem = (it: Item | undefined) => {
    if (!it) return;
    if (it.keepOpen) { it.run(); return; }
    onRan();
    useUI.getState().setPalette(false);
    // Let the palette finish closing before opening a sheet or changing route.
    setTimeout(it.run, 0);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (showHelp) {
      if (e.key === 'Backspace' && !q && view === 'help') { e.preventDefault(); setView('search'); }
      return;
    }
    const n = items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((a) => (a + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((a) => (a - 1 + n) % n); }
    else if (e.key === 'PageDown') { e.preventDefault(); if (n) setActive((a) => Math.min(n - 1, a + 5)); }
    else if (e.key === 'PageUp') { e.preventDefault(); if (n) setActive((a) => Math.max(0, a - 5)); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(items[active]); }
  };

  const groups: Group[] = ['Actions', 'Pages', 'Entries'];
  let index = 0;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line/70 px-3 md:px-4">
        <Search size={18} className="shrink-0 text-muted" aria-hidden />
        <input
          id="cmdk-input"
          className="h-14 flex-1 min-w-0 bg-transparent text-[16px] outline-none placeholder:text-muted/70"
          placeholder="Search actions, pages, payees or amounts"
          value={q}
          onChange={(e) => { setQ(e.target.value); if (view === 'help') setView('search'); }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={!showHelp}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={!showHelp && items[active] ? optId(active) : undefined}
          aria-label="Search commands"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <Dialog.Close className="btn-ghost h-8 px-2 text-xs text-muted md:hidden">Cancel</Dialog.Close>
        <Kbd className="hidden md:inline-flex">Esc</Kbd>
      </div>

      {showHelp ? (
        <ShortcutsHelp onBack={() => { setQ(''); setView('search'); }} />
      ) : (
        <div id={listId} role="listbox" aria-label="Commands" className="flex-1 overflow-y-auto overscroll-contain p-2 max-h-[min(60dvh,440px)] md:max-h-none">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted" role="presentation">No matches for “{q.trim()}”</p>
          )}
          {groups.map((g) => {
            const rows = items.filter((it) => it.group === g);
            if (!rows.length) return null;
            const headId = `${listId}-${g}`;
            return (
              <div key={g} role="group" aria-labelledby={headId} className="mb-1 last:mb-0">
                <div id={headId} role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{g}</div>
                {rows.map((it) => {
                  const i = index++;
                  const on = i === active;
                  return (
                    <div
                      key={it.id}
                      id={optId(i)}
                      role="option"
                      aria-selected={on}
                      onMouseMove={() => { if (!on) setActive(i); }}
                      onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
                      onClick={() => runItem(it)}
                      className={`flex items-center gap-3 rounded-xl px-3 min-h-11 py-1.5 cursor-pointer select-none ${on ? 'bg-primary/10' : ''}`}
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${on ? 'text-primary' : 'text-muted'} ${it.group === 'Entries' ? '' : 'bg-sunk'}`} aria-hidden>
                        {it.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{it.label}</span>
                        {it.detail && <span className="block truncate text-xs text-muted">{it.detail}</span>}
                      </span>
                      {it.trailing}
                      {it.kbd && (
                        <span className="hidden md:flex items-center gap-1" aria-hidden>
                          {it.kbd.map((k) => <Kbd key={k}>{k}</Kbd>)}
                        </span>
                      )}
                      {on && <CornerDownLeft size={14} className="hidden md:block shrink-0 text-muted" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="hidden md:flex items-center gap-4 border-t border-line/70 px-4 py-2.5 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> choose</span>
        <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
        <span className="ml-auto flex items-center gap-1"><Kbd>?</Kbd> shortcuts</span>
      </div>
    </>
  );
}

/** Entries matching the query by payee, note, category, tag, or an amount typed as a number. Newest first on ties. */
function matchEntries(data: Pick<Data, 'txs' | 'cat'>, query: string, max = MAX_ENTRIES): Transaction[] {
  const qt = query.trim();
  if (!qt) return [];
  const lower = qt.toLowerCase();

  // "45", "45.50", "$1,200" → an amount search. Without decimals, 45 also finds 45.99.
  const numText = qt.replace(/[\s,]/g, '').replace(/^[^\d.]+/, '');
  const isAmount = /^\d+(\.\d{1,2})?$/.test(numText) || /^\.\d{1,2}$/.test(numText);
  const minor = isAmount ? toMinor(numText) : 0;
  const whole = isAmount && !numText.includes('.') ? Number(numText) : null;
  if (!isAmount && qt.length < 2) return [];

  const scored: { t: Transaction; s: number; i: number }[] = [];
  const tagNeedle = lower.replace(/^#/, '');
  data.txs.forEach((t, i) => {
    const hits: number[] = [];
    if (isAmount) {
      if (t.amount === minor) hits.push(300);
      else if (whole !== null && Math.trunc(t.amount / 100) === whole) hits.push(250);
    }
    const payee = t.payee ? fuzzyScore(qt, t.payee) : null;
    if (payee !== null) hits.push(payee);
    const catName = data.cat(t.categoryId)?.name;
    const cat = catName ? fuzzyScore(qt, catName) : null;
    if (cat !== null) hits.push(cat - 10); // a payee hit outranks the same hit on its category
    if (t.notes?.toLowerCase().includes(lower)) hits.push(90);
    if (tagNeedle && t.tags.some((g) => g.toLowerCase().includes(tagNeedle))) hits.push(95);
    if (hits.length) scored.push({ t, s: Math.max(...hits), i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.t);
}

function entryItem(data: Data, t: Transaction, nav: (to: string) => void): Item {
  const cat = data.cat(t.categoryId);
  const label = t.payee || cat?.name || t.notes || (t.type === 'transfer' ? 'Transfer' : 'Entry');
  const search = t.payee || t.notes || cat?.name || '';
  const signed = t.type === 'expense' ? -t.amount : t.amount;
  return {
    id: `tx-${t.id}`,
    group: 'Entries',
    label,
    icon: t.type === 'transfer' && !cat ? <ArrowLeftRight size={16} /> : <CatIcon c={cat} size={32} />,
    detail: [relativeDay(t.date), cat && cat.name !== label ? cat.name : undefined, data.acct(t.accountId)?.name].filter(Boolean).join(' · '),
    trailing: (
      <Money value={signed} sign={t.type === 'income' || t.type === 'refund'}
        className={`shrink-0 text-[14px] font-bold ${t.type === 'income' || t.type === 'refund' ? 'text-good' : t.type === 'transfer' ? 'text-muted' : ''}`} />
    ),
    run: () => nav(`/activity?q=${encodeURIComponent(search)}`),
  };
}

function ShortcutsHelp({ onBack }: { onBack: () => void }) {
  const rows: { keys: string[]; label: string }[][] = [
    [
      { keys: [MOD, 'K'], label: 'Open or close the command palette' },
      { keys: ['N'], label: 'New entry' },
      { keys: ['/'], label: 'Search activity' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
    [
      { keys: ['↑', '↓'], label: 'Move through results' },
      { keys: ['↵'], label: 'Run the highlighted result' },
      { keys: ['Esc'], label: 'Close' },
    ],
    [
      { keys: ['0–9', '+', '−', '*', '/'], label: 'Type an amount or a sum' },
      { keys: ['⌫'], label: 'Delete the last digit' },
      { keys: ['↵'], label: 'Save the entry' },
    ],
  ];
  const heads = ['Anywhere', 'In the command palette', 'When adding an entry'];
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain p-4 max-h-[min(60dvh,440px)] md:max-h-none">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="h2 flex items-center gap-2"><Keyboard size={18} className="text-primary" aria-hidden /> Keyboard shortcuts</h2>
        <button className="btn-ghost h-8 px-2 text-sm" onClick={onBack}><ArrowLeft size={15} aria-hidden /> All commands</button>
      </div>
      <p className="sub mb-3">Single-key shortcuts work when you’re not typing in a field and no other window is open.</p>
      {rows.map((group, gi) => (
        <section key={heads[gi]} className="mb-3 last:mb-0">
          <h3 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{heads[gi]}</h3>
          <dl className="rounded-2xl bg-sunk divide-y divide-line/60">
            {group.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-sm">{r.label}</dt>
                <dd className="flex shrink-0 items-center gap-1">{r.keys.map((k) => <Kbd key={k} className="bg-surface">{k}</Kbd>)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
