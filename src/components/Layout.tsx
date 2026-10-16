import {
  Activity, BarChart3, CalendarClock, EyeOff, Eye, Home, Inbox, Landmark, LineChart, MoreHorizontal, PiggyBank, Plus, Search, Settings, Target, Users, Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useData, useProfile } from '../db/hooks';
import { useUI } from '../store/ui';
import { Avatar, Sheet } from './ui';
import { AppearancePicker } from './AppearancePicker';
import { SyncBadge } from './SyncBadge';
import iconUrl from '../assets/icon.svg';

export const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/budgets', label: 'Budgets', icon: Wallet },
  { to: '/bills', label: 'Bills', icon: CalendarClock },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/debts', label: 'Debts', icon: Landmark },
  { to: '/wealth', label: 'Net worth', icon: LineChart },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/family', label: 'Family', icon: Users },
  { to: '/inbox', label: 'Inbox & import', icon: Inbox },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const TABS = ['/', '/activity', '/budgets', '/insights'];

export function Layout({ children }: { children: ReactNode }) {
  const { openQuickAdd, hideAmounts, toggleHide, viewAs, setViewAs } = useUI();
  const data = useData();
  const profile = useProfile();
  const nav = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const reviewCount = data?.review.length ?? 0;

  // Desktop shortcuts: N = new entry, / = search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || e.metaKey || e.ctrlKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openQuickAdd(); }
      if (e.key === '/') { e.preventDefault(); nav('/activity?focus=1'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, openQuickAdd]);

  useEffect(() => setMore(false), [loc.pathname]);

  const limited = !!data?.viewer;
  const items = limited ? NAV.filter((n) => ['/', '/activity', '/goals'].includes(n.to)) : NAV;

  return (
    <div className={`min-h-screen md:flex ${hideAmounts ? 'blurred' : ''}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 z-50 btn-primary">Skip to content</a>

      {/* Sidebar — tablet & desktop */}
      <aside className="hidden md:flex flex-col w-[248px] shrink-0 h-screen sticky top-0 border-r border-line/70 px-4 py-5 gap-1">
        <div className="flex items-center gap-2.5 px-2 mb-5">
          <img src={iconUrl} alt="" className="h-8 w-8 rounded-[10px]" />
          <span className="text-[19px] font-extrabold tracking-tight">{profile?.appName ?? 'Tandem'}</span>
        </div>
        <button className="btn-primary mb-4 justify-start" onClick={() => openQuickAdd()}>
          <Plus size={18} /> New entry <kbd className="ml-auto text-[11px] opacity-70 font-semibold rounded border border-current/30 px-1.5">N</kbd>
        </button>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-3 h-10 px-3 rounded-xl text-[14px] font-semibold transition-colors ${isActive ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-muted hover:text-ink hover:bg-sunk/70'}`}>
              <Icon size={18} strokeWidth={2.2} />{label}
              {to === '/inbox' && reviewCount > 0 && <span className="ml-auto text-[11px] font-bold bg-warn/20 text-warn rounded-full px-2 py-0.5">{reviewCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <SyncBadge />
          <ViewingAs />
          <button className="btn-ghost w-full justify-start text-muted" onClick={toggleHide} aria-pressed={hideAmounts}>
            {hideAmounts ? <Eye size={18} /> : <EyeOff size={18} />} {hideAmounts ? 'Show amounts' : 'Hide amounts'}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 bg-bg/85 backdrop-blur-md flex items-center gap-2 px-4 h-14 pt-[env(safe-area-inset-top)]">
          <img src={iconUrl} alt="" className="h-7 w-7 rounded-[9px]" />
          <span className="font-extrabold tracking-tight text-[17px]">{profile?.appName ?? 'Tandem'}</span>
          <div className="ml-auto flex items-center gap-1">
            <button className="btn-ghost h-10 w-10 p-0" aria-label="Search" onClick={() => nav('/activity?focus=1')}><Search size={19} /></button>
            <button className="btn-ghost h-10 w-10 p-0" aria-label={hideAmounts ? 'Show amounts' : 'Hide amounts'} onClick={toggleHide}>{hideAmounts ? <Eye size={19} /> : <EyeOff size={19} />}</button>
            {viewAs && data?.member(viewAs) && <button onClick={() => setViewAs(null)} aria-label="Leave member view"><Avatar m={data.member(viewAs)} size={30} /></button>}
          </div>
        </header>

        <main id="main" className="px-4 md:px-8 lg:px-10 pt-2 md:pt-8 pb-28 md:pb-12 max-w-[1280px] mx-auto">{children}</main>
      </div>

      {/* Bottom tabs — phones */}
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur-md border-t border-line/70 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 h-16 items-center">
          {TABS.slice(0, 2).map((to) => <Tab key={to} to={to} />)}
          <div className="grid place-items-center">
            <button onClick={() => openQuickAdd()} aria-label="New entry"
              className="h-14 w-14 -mt-6 rounded-[20px] bg-primary text-onprimary grid place-items-center shadow-lg shadow-primary/30 active:scale-95 transition-transform">
              <Plus size={26} strokeWidth={2.6} />
            </button>
          </div>
          {limited ? <Tab to="/goals" /> : <Tab to={TABS[2]} />}
          <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 text-muted text-[11px] font-semibold relative">
            <MoreHorizontal size={22} />More
            {reviewCount > 0 && <span className="absolute top-0 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-warn" />}
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="Everything else">
        <div className="grid grid-cols-3 gap-2">
          {items.filter((n) => !TABS.slice(0, 3).includes(n.to)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="flex flex-col items-center gap-2 rounded-2xl bg-sunk/70 py-4 text-[13px] font-semibold text-center">
              <Icon size={22} className="text-primary" />{label}
              {to === '/inbox' && reviewCount > 0 && <span className="text-[11px] text-warn font-bold">{reviewCount} to review</span>}
            </NavLink>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-line/70"><AppearancePicker compact /></div>
        <div className="mt-4"><ViewingAs /></div>
      </Sheet>
    </div>
  );
}

function Tab({ to }: { to: string }) {
  const n = NAV.find((x) => x.to === to)!;
  const Icon = n.icon;
  return (
    <NavLink to={to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 text-[11px] font-semibold ${isActive ? 'text-primary' : 'text-muted'}`}>
      <Icon size={22} strokeWidth={2.2} />{n.label}
    </NavLink>
  );
}

/** Switch the whole app to a member's perspective (teens/kids see only their own money). */
function ViewingAs() {
  const data = useData();
  const { viewAs, setViewAs } = useUI();
  if (!data || data.members.length < 2) return null;
  return (
    <label className="block">
      <span className="label flex items-center gap-1.5"><PiggyBank size={14} /> Viewing as</span>
      <select className="field h-10 text-sm" value={viewAs ?? ''} onChange={(e) => setViewAs(e.target.value || null)}>
        <option value="">Whole household</option>
        {data.members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
      </select>
    </label>
  );
}
