import { X } from 'lucide-react';
import { useState } from 'react';
import { getSetting, setSetting } from '../db/db';
import { wipeAll } from '../db/seed';
import { useLiveQuery } from 'dexie-react-hooks';
import { askConfirm } from '../store/ui';

/** Shown only in the shared single-file build: explains the demo and offers a clean start. */
export function EmbedBanner() {
  const demo = useLiveQuery(() => getSetting('demo', false), []);
  const [hidden, setHidden] = useState(false);
  if (import.meta.env.VITE_EMBED !== '1' || hidden) return null;
  const startOwn = async () => {
    if (!(await askConfirm('This clears the demo household so you can set up your own. Your data stays in this browser only.', 'Start my own'))) return;
    await wipeAll();
    await setSetting('skipDemo', true);
  };
  return (
    <div className="mb-4 md:mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-primary/10 px-4 py-3 text-sm">
      <p className="flex-1 min-w-[14rem]">
        {demo ? <><b>You’re exploring a demo household.</b> Everything you do stays in this browser.</> : <><b>Your data stays in this browser.</b> Backups and file exports work in the installed app.</>}
      </p>
      {demo && <button className="btn-primary h-9" onClick={startOwn}>Start my own</button>}
      <button className="btn-ghost h-9 w-9 p-0" aria-label="Hide this message" onClick={() => setHidden(true)}><X size={16} /></button>
    </div>
  );
}
