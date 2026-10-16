import { X } from 'lucide-react';
import { useState } from 'react';
import { getSetting } from '../db/db';
import { clearToFreshStart } from '../db/seed';
import { useLiveQuery } from 'dexie-react-hooks';
import { askConfirm } from '../store/ui';
import { useSync } from '../lib/cloudSync';

/** Shown only in the shared single-file build: explains the demo and offers a clean start. */
export function EmbedBanner() {
  const demo = useLiveQuery(() => getSetting('demo', false), []);
  const [hidden, setHidden] = useState(false);
  const status = useSync((x) => x.status);
  const where = status === 'synced' || status === 'saving' ? 'is saved privately to your Claude account'
    : import.meta.env.VITE_EMBED === '1' ? 'stays in this browser' : 'stays on this device';
  if (hidden || !demo) return null;
  const startOwn = async () => {
    if (!(await askConfirm('This deletes all the demo data so you can set up your own household: your name, family, currency and starting balances.', 'Remove demo data'))) return;
    await clearToFreshStart();
  };
  return (
    <div className="mb-4 md:mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-primary/10 px-4 py-3 text-sm">
      <p className="flex-1 min-w-[14rem]">
        <b>You’re exploring a demo household.</b> Everything you do {where}. When you’re ready, remove it and set up your own.
      </p>
      <button className="btn-primary h-9" onClick={startOwn}>Remove demo data</button>
      <button className="btn-ghost h-9 w-9 p-0" aria-label="Hide this message" onClick={() => setHidden(true)}><X size={16} /></button>
    </div>
  );
}
