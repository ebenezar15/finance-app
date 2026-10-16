import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

export const EMBED = import.meta.env.VITE_EMBED === '1';
// Embedded hosts serve one page and don't run service workers: keep routes in memory.
const Router = EMBED ? MemoryRouter : BrowserRouter;
if (!EMBED) registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router basename={EMBED ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <App />
    </Router>
  </React.StrictMode>,
);
