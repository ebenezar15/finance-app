import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LockScreen, useAutoLock } from './components/Lock';
import { QuickAdd } from './components/QuickAdd';
import { Toasts } from './components/ui';
import { purgeTrash } from './db/db';
import { postDueRecurring, useProfile } from './db/hooks';
import Home from './pages/Home';
import Onboarding from './pages/Onboarding';
import { useUI } from './store/ui';

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

function hexToChannels(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function useTheme() {
  const { theme, accent } = useUI();
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      root.dataset.theme = t;
      // Custom accent only applies to light theme; dark uses its own luminous primary for contrast.
      if (t === 'light' && accent && accent !== '#0F4C5C') root.style.setProperty('--primary', hexToChannels(accent));
      else root.style.removeProperty('--primary');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0B1317' : '#F3F4F1');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent]);
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

  // PWA shortcut: /?add=1 opens the quick-add sheet straight away.
  useEffect(() => {
    if (params.get('add') === '1') { openQuickAdd(); nav('/', { replace: true }); }
  }, [params, openQuickAdd, nav]);

  if (!profile) return <div className="min-h-screen bg-bg" />;
  if (!profile.onboarded) return <Onboarding />;
  if (locked) return <LockScreen />;

  return (
    <Layout>
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
    </Layout>
  );
}
