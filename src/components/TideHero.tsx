import type { ReactNode } from 'react';
import { useMounted } from '../lib/motion';

/**
 * The tide gauge: the water level is how much of this month's spending money is left.
 * Waves are the app's one ambient motion; they stop when the device asks for reduced motion.
 */
export function TideHero({ level, label, children, footer }: { level: number; label: string; children: ReactNode; footer?: ReactNode }) {
  const mounted = useMounted();
  const lv = Math.max(0.06, Math.min(0.94, level));
  const h = mounted ? lv : 0;
  return (
    <section className="relative isolate overflow-hidden rounded-[28px] bg-tidebg text-tidefg border border-line/40 min-h-[300px] md:min-h-[340px] flex"
      style={{ boxShadow: '0 24px 48px -28px rgb(var(--primary) / .55)' }}>
      {/* Water */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10" style={{ height: `${h * 100}%`, transition: 'height 1.8s cubic-bezier(.16,.84,.3,1)' }}>
        <Wave o={.07} d="17s" offset={0} />
        <Wave o={.09} d="11s" offset={-220} lift={6} />
        <Wave o={.12} d="23s" offset={-480} lift={12} reverse />
      </div>
      {/* Light from above, for depth */}
      <div aria-hidden className="absolute inset-0 -z-10" style={{ background: 'radial-gradient(120% 80% at 0% 0%, rgb(var(--tide-wave) / calc(.10 * var(--tide-boost))), transparent 60%)' }} />

      <div className="relative flex-1 min-w-0 p-6 md:p-8 pr-[4.5rem] md:pr-28 flex flex-col">
        {children}
        {footer && <div className="mt-auto pt-6">{footer}</div>}
      </div>

      {/* Tide staff: a graduated scale with the current level marked */}
      <div aria-hidden className="absolute right-0 inset-y-0 w-14 md:w-20 border-l border-tidefg/15">
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className="absolute left-0 h-px bg-tidefg/30" style={{ bottom: `${i * 10}%`, width: i % 5 === 0 ? 14 : 7 }} />
        ))}
        <span className="absolute left-0 right-0 flex items-center gap-1" style={{ bottom: `${h * 100}%`, transition: 'bottom 1.8s cubic-bezier(.16,.84,.3,1)', translate: '0 50%' }}>
          <span className="h-0.5 w-3 md:w-4 shrink-0 bg-tidefg rounded-full" />
          <span className="font-display text-[13px] md:text-[16px] font-bold num">{Math.round(lv * 100)}%</span>
        </span>
      </div>
      <p className="sr-only">{label}</p>
    </section>
  );
}

/** One wave layer: a crest drawn twice side by side, drifting by half its width so it loops. */
function Wave({ o, d, offset, lift = 0, reverse }: { o: number; d: string; offset: number; lift?: number; reverse?: boolean }) {
  const crest = 'M0 30 C 100 6, 200 6, 300 30 S 500 54, 600 30 S 800 6, 900 30 S 1100 54, 1200 30 V 60 H 0 Z';
  return (
    <div className="absolute inset-x-0 bottom-0" style={{ top: -30 + lift, opacity: `calc(${o} * var(--tide-boost))` }}>
      <div className="swell absolute inset-0" style={{ animationDelay: `${offset / 100}s` }}>
        <div className="wave absolute inset-y-0 left-0 w-[200%] flex flex-col" style={{ ['--d' as string]: d, animationDirection: reverse ? 'reverse' : 'normal', marginLeft: offset / 10 }}>
          <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-full h-[30px] shrink-0 block"><path d={crest} fill="rgb(var(--tide-wave))" /></svg>
          <div className="flex-1 bg-tidewave -mt-px" />
        </div>
      </div>
    </div>
  );
}
