import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion';

const EVENT = 'tandem-celebrate';
const COLOURS = ['rgb(var(--primary))', 'rgb(var(--good))', 'rgb(var(--warn))', 'rgb(var(--indigo))', 'rgb(var(--accent))', 'rgb(var(--bad))'];

/** Fire a short burst of confetti. Does nothing when the device asks for reduced motion. */
export function celebrate(origin?: { x: number; y: number }) {
  if (typeof window === 'undefined' || prefersReducedMotion()) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: origin }));
}

/** Celebrate a milestone once per device (e.g. a streak day): returns true if it fired. */
export function celebrateOnce(key: string, origin?: { x: number; y: number }) {
  try {
    const k = 'tandem-celebrated';
    const seen: string[] = JSON.parse(localStorage.getItem(k) || '[]');
    if (seen.includes(key)) return false;
    localStorage.setItem(k, JSON.stringify([key, ...seen].slice(0, 60)));
  } catch { /* storage blocked: celebrate anyway */ }
  celebrate(origin);
  return true;
}

interface Piece { id: number; x: number; y: number; dx: number; dy: number; rot: number; colour: string; w: number; h: number; delay: number; round: boolean }
let seq = 0;

/** Mounted once in App. Pieces are plain elements animated with CSS, removed after the burst. */
export function ConfettiHost() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const o = (e as CustomEvent<{ x: number; y: number } | undefined>).detail ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.38 };
      const batch: Piece[] = Array.from({ length: 46 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 46 + Math.random() * 0.5;
        const v = 90 + Math.random() * 170;
        return {
          id: ++seq, x: o.x, y: o.y, dx: Math.cos(a) * v, dy: Math.sin(a) * v - 110, rot: Math.random() * 720 - 360,
          colour: COLOURS[i % COLOURS.length], w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, delay: Math.random() * 90, round: i % 5 === 0,
        };
      });
      setPieces((p) => [...p, ...batch]);
      const ids = new Set(batch.map((b) => b.id));
      window.setTimeout(() => setPieces((p) => p.filter((x) => !ids.has(x.id))), 2000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!pieces.length) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {pieces.map((p) => (
        <span key={p.id} className="confetti absolute block" style={{
          left: p.x, top: p.y, width: p.w, height: p.round ? p.w : p.h, background: p.colour, borderRadius: p.round ? '50%' : 2,
          animationDelay: `${p.delay}ms`, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, ['--rot' as string]: `${p.rot}deg`,
        }} />
      ))}
    </div>
  );
}
