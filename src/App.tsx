import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LockScreen, useAutoLock } from './components/Lock';
import { QuickAdd } from './components/QuickAdd';
import { ConfirmHost, Toasts } from './components/ui';
import { purgeTrash } from './db/db';
import { clearToFreshStart, demoUntouched } from './db/seed';
import { EmbedBanner } from './components/EmbedBanner';
import { startCloudSync, useSync } from './lib/cloudSync';

/** Asks the browser not to evict the household's data under storage pressure (Chrome, Safari 15.2+). */
function requestPersistentStorage() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* unsupported */ }
}
import { postDueRecurring, useProfile } from './db/hooks';
import Home from './pages/Home';
import Onboarding from './pages/Onboarding';
import { useUI } from './store/ui';
import { rgb, schemeById } from './lib/schemes';

const Activity = lazy(() => import('./pages/Activity'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Bills = lazy(() => import('./pages/Bills'));
const Goals = lazy(() => import('./pages/Goals'));
const Debts = lazy(() => import('./pages/Debts'));
const Wealth = lazy(() => import('./pages/Wealth'));
const Insights = lazy(() => import('./pages/Insights'));
const Family = lazy(() => import('./pages/Family'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Settings = lazy(() => import('./pages/Settings'));

let demoChecked = false;

const TOKENS = ['bg', 'surface', 'sunk', 'line', 'primary', 'onprimary'] as const;

function useTheme() {
  const { theme, scheme } = useUI();
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      root.dataset.theme = t;
      // High contrast keeps its own fixed palette; every other theme takes the scheme's tones.
      const tones = t === 'contrast' ? null : schemeById(scheme)[t === 'dark' ? 'dark' : 'light'];
      for (const k of TOKENS) {
        if (tones) root.style.setProperty(`--${k}`, tones[k]);
        else root.style.removeProperty(`--${k}`);
      }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tones ? rgb(tones.bg) : '#FFFFFF');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, scheme]);
}

export default function App() {
  useTheme();
  useAutoLock();
  const profile = useProfile();
  const locked = useUI((s) => s.locked);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const [params] = useSearchParams();
  const nav = useNavigate();

  useEffect(() => {
    if (!profile?.onboarded) return;
    postDueRecurring().catch(console.error);
    purgeTrash().catch(console.error);
  }, [profile?.onboarded]);

  const syncReady = useSync((s) => s.ready);
  useEffect(() => { startCloudSync(); requestPersistentStorage(); }, []);
  // First open shows the clean setup screen (the demo is an option there). Devices that were
  // given the demo automatically by an earlier version get it removed, but only if nobody has
  // touched it; anything the person entered is never deleted without asking.
  useEffect(() => {
    if (!syncReady || !profile?.onboarded || demoChecked) return;
    demoChecked = true;
    demoUntouched().then(async (untouched) => {
      if (!untouched) return;
      await clearToFreshStart();
      useUI.getState().toast('Removed the demo data. Set up your own household to start.');
    });
  }, [profile?.onboarded, syncReady]);

  // PWA shortcut: /?add=1 opens the quick-add sheet straight away.
  useEffect(() => {
    if (params.get('add') === '1') { openQuickAdd(); nav('/', { replace: true }); }
  }, [params, openQuickAdd, nav]);

  if (!profile || (!syncReady && !profile.onboarded)) return <div className="min-h-screen bg-bg grid place-items-center text-sm text-muted">Loading your household…</div>;
  if (!profile.onboarded) return <Onboarding />;
  if (locked) return <LockScreen />;

  return (
    <Layout>
      <EmbedBanner />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-3xl bg-sunk/60 mt-6" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/wealth" element={<Wealth />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/family" element={<Family />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
      <QuickAdd />
      <Toasts />
      <ConfirmHost />
    </Layout>
  );
}
