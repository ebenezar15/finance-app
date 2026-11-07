/** Small motion helpers. All of them fall back to the final state when the device asks for reduced motion. */
import { useEffect, useRef, useState } from 'react';

const query = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);

export function prefersReducedMotion() { return !!query()?.matches; }

export function useReducedMotion() {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = () => setReduce(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

/** True from the second frame on, so CSS transitions can run from an empty state on first show. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setM(true))); return () => cancelAnimationFrame(id); }, []);
  return m;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Animates a number towards `value`: from 0 on first show, then from the previous value whenever
 * it changes. Integer output (minor units), so currency formatting stays exact at rest.
 */
export function useTween(value: number, ms = 900, enabled = true) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(enabled && !reduce ? 0 : value);
  const from = useRef(enabled && !reduce ? 0 : value);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!enabled || reduce || typeof requestAnimationFrame === 'undefined') { setShown(value); return; }
    from.current = shownRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(from.current + (value - from.current) * ease(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, enabled, reduce]);
  return shown;
}
