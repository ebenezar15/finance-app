import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LockScreen, useAutoLock } from './components/Lock';
import { QuickAdd } from './components/QuickAdd';
import { ConfirmHost, Toasts } from './components/ui';
import { getSetting, purgeTrash } from './db/db';
import { seedDemo } from './db/seed';
import { guessCurrency } from './components/CurrencySelect';
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

  // Shared link: open straight into the demo household (in the viewer's local currency) unless they chose to start fresh.
  const syncReady = useSync((s) => s.ready);
  useEffect(() => { startCloudSync(); requestPersistentStorage(); }, []);
  useEffect(() => {
    // Wait for the account copy first, so a returning user gets their household, not the demo.
    if (import.meta.env.VITE_EMBED !== '1' || !syncReady || !profile || profile.onboarded) return;
    getSetting('skipDemo', false).then((skip) => { if (!skip) seedDemo(guessCurrency()); });
  }, [profile, syncReady]);

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
