import { Cloud, CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import { useSync } from '../lib/cloudSync';

const ago = (t?: number) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
};

/** One-line status of where the household's data lives right now. */
export function SyncBadge({ detailed = false }: { detailed?: boolean }) {
  const { status, who, at, message } = useSync();
  const embed = import.meta.env.VITE_EMBED === '1';
  const [Icon, tone, text] =
    status === 'synced' ? [Cloud, 'text-good', `Synced${who ? ` to ${who}’s account` : ' to your account'}${at ? ` · ${ago(at)}` : ''}`]
    : status === 'saving' || status === 'connecting' ? [RefreshCw, 'text-primary', status === 'saving' ? 'Saving to your account…' : 'Connecting to your account…']
    : status === 'error' ? [CloudOff, 'text-warn', message ?? 'Sync paused']
    : status === 'signed-out' ? [HardDrive, 'text-muted', 'Saved in this browser · sign in to claude.ai to sync']
    : [HardDrive, 'text-muted', embed ? 'Saved in this browser' : 'Saved on this device'];
  return (
    <p className={`flex items-start gap-2 ${detailed ? 'text-sm' : 'text-[12px] px-1'} font-semibold ${tone}`} role="status">
      <Icon size={detailed ? 16 : 14} className={`shrink-0 mt-0.5 ${status === 'saving' || status === 'connecting' ? 'animate-spin' : ''}`} aria-hidden />
      <span className={detailed ? '' : 'text-muted'}>{text}</span>
    </p>
  );
}
