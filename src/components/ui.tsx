import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useProfile } from '../db/hooks';
import type { Category, Member } from '../db/types';
import { formatMoney } from '../lib/money';
import { useUI } from '../store/ui';
import { useMounted, useTween } from '../lib/motion';
import '../styles/motion-extra.css';

export function Money({ value, className = '', sign, compact, currency, animate }: { value: number; className?: string; sign?: boolean; compact?: boolean; currency?: string; animate?: boolean }) {
  const profile = useProfile();
  const cur = currency ?? profile?.currency ?? lastCurrency();
  const shown = useTween(value, 900, !!animate);
  const text = formatMoney(animate ? shown : value, cur, { sign, compact });
  // Screen readers get the final figure, not every frame of the count.
  if (animate) return <span className={`money num ${className}`}><span aria-hidden>{text}</span><span className="sr-only">{formatMoney(value, cur, { sign, compact })}</span></span>;
  return <span className={`money num ${className}`}>{text}</span>;
}

/** Last currency this device showed, so the first frame (before the profile loads) isn't in USD. */
export function lastCurrency() {
  try { return localStorage.getItem('tandem-currency') || 'USD'; } catch { return 'USD'; }
}

export function useFmt() {
  const profile = useProfile();
  const cur = profile?.currency ?? lastCurrency();
  return (v: number, o: { compact?: boolean; sign?: boolean } = {}) => formatMoney(v, cur, o);
}

export function Panel({ title, action, children, className = '', pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`panel min-w-0 ${pad ? "p-5" : ""} ${className}`}>
      {(title || action) && (
        <header className={`flex items-center justify-between gap-3 ${pad ? 'mb-4' : 'px-5 pt-5 pb-3'}`}>
          {title && <h2 className="h2">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Circular progress. Colour alone never carries meaning — callers render a text label too. */
export function Ring({ value, size = 56, stroke = 6, colour = 'rgb(var(--primary))', track = 'rgb(var(--sunk))', children }: { value: number; size?: number; stroke?: number; colour?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mounted = useMounted();
  const v = mounted ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Bar({ value, marker, colour }: { value: number; marker?: number; colour?: string }) {
  const mounted = useMounted();
  const v = mounted ? Math.max(0, Math.min(1, value)) : 0;
  const tone = colour ?? (value >= 1 ? 'rgb(var(--bad))' : marker !== undefined && value > marker + 0.1 ? 'rgb(var(--warn))' : 'rgb(var(--primary))');
  return (
    <div className="relative h-2 rounded-full bg-sunk overflow-visible">
      <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: tone, transition: 'width .8s cubic-bezier(.2,.8,.2,1)' }} />
      {marker !== undefined && (
        <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink/40" style={{ left: `${Math.min(1, marker) * 100}%` }} title="Today" />
      )}
    </div>
  );
}

export function Sheet({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-[rise_.2s]" />
        <Dialog.Content
          className={`fixed z-50 bottom-0 inset-x-0 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full ${wide ? 'md:max-w-2xl' : 'md:max-w-md'} max-h-[92vh] overflow-y-auto bg-surface rounded-t-[28px] md:rounded-[28px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-rise`}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <Dialog.Title className="font-display text-[22px] font-bold tracking-tight leading-tight" style={{ fontStretch: '92%' }}>{title}</Dialog.Title>
              {description ? <Dialog.Description className="sub mt-0.5">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="btn-ghost h-9 w-9 p-0 rounded-full" aria-label="Close"><X size={18} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  // A thumb slides to the chosen option, so the change reads as one movement.
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (box.current) ro?.observe(box.current);
    return () => ro?.disconnect();
  }, [value, options.length]);
  return (
    <div ref={box} role="radiogroup" aria-label={label} className="relative inline-flex max-w-full overflow-x-auto no-scrollbar p-1 rounded-xl bg-sunk gap-1">
      {thumb && <span aria-hidden className="absolute top-1 bottom-1 left-0 rounded-lg bg-surface shadow-sm" style={{ width: thumb.w, translate: `${thumb.x}px 0`, transition: 'translate .3s cubic-bezier(.2,.8,.2,1), width .3s cubic-bezier(.2,.8,.2,1)' }} />}
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`relative shrink-0 h-8 px-2.5 sm:px-3 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors ${value === o.value ? `text-ink ${thumb ? '' : 'bg-surface shadow-sm'}` : 'text-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      <div className="relative mx-auto mb-5 h-12 w-12">
        <span aria-hidden className="empty-ripple absolute left-1/2 -bottom-2.5 -ml-6 h-2.5 w-12 rounded-[50%] border-[1.5px] border-primary/60" />
        <div className="empty-bob relative h-12 w-12 rounded-2xl bg-sunk grid place-items-center text-muted">{icon}</div>
      </div>
      <p className="font-bold">{title}</p>
      <p className="sub mt-1 max-w-sm mx-auto">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function CatIcon({ c, size = 40 }: { c?: Category; size?: number }) {
  return (
    <span className="grid place-items-center rounded-[12px] shrink-0 text-[18px]" aria-hidden
      style={{ width: size, height: size, background: `${c?.colour ?? '#7C8798'}1f`, fontSize: size * 0.45 }}>
      {c?.emoji ?? '•'}
    </span>
  );
}

export function Avatar({ m, size = 28 }: { m?: Member; size?: number }) {
  if (!m) return null;
  return (
    <span className="inline-grid place-items-center rounded-full font-bold text-white shrink-0" title={m.name}
      style={{ width: size, height: size, background: m.colour, fontSize: size * 0.42 }}>
      {m.name.slice(0, 1)}
    </span>
  );
}

/** Renders the pending askConfirm() request as a small sheet. Mounted once in App. */
export function ConfirmHost() {
  const req = useUI((s) => s.confirmReq);
  const close = (ok: boolean) => { req?.resolve(ok); useUI.setState({ confirmReq: null }); };
  return (
    <Sheet open={!!req} onOpenChange={(o) => !o && close(false)} title="Are you sure?">
      <p className="text-[15px] leading-relaxed">{req?.message}</p>
      <div className="flex gap-2 justify-end mt-6">
        <button className="btn-soft" onClick={() => close(false)}>Cancel</button>
        <button className={req?.danger ? 'btn bg-bad text-white hover:brightness-110' : 'btn-primary'} onClick={() => close(true)} autoFocus>{req?.action}</button>
      </div>
    </Sheet>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUI();
  return (
    <div className="fixed z-[60] bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-[min(92vw,420px)]" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="animate-rise flex items-center gap-3 rounded-2xl bg-ink text-surface pl-4 pr-2 py-2 shadow-xl">
          <span className="text-sm font-semibold flex-1">{t.text}</span>
          {t.undo && (
            <button className="h-9 px-3 rounded-xl text-sm font-bold text-accent hover:bg-white/10" onClick={async () => { await t.undo!(); dismiss(t.id); }}>
              Undo
            </button>
          )}
          <button className="h-9 w-9 grid place-items-center rounded-xl hover:bg-white/10" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual', sms: 'Bank alert', ocr: 'Receipt', import: 'Imported', recurring: 'Recurring', voice: 'Voice', share: 'Shared',
};

export function SourceBadge({ s }: { s: string }) {
  if (s === 'manual') return null;
  return <span className="text-[11px] font-semibold text-muted bg-sunk rounded-md px-1.5 py-0.5">{SOURCE_LABEL[s] ?? s}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className="font-display text-[22px] font-bold tracking-tight num mt-0.5" style={{ fontStretch: '88%' }}>{value}</p>
      {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
    </div>
  );
}
