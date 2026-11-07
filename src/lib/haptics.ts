/**
 * Light haptic feedback on devices that support the Vibration API (mostly Android).
 * Silently does nothing elsewhere, including iOS Safari and desktop browsers.
 */
function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* blocked by the browser or permissions policy */
  }
}

/** A short tick for taps and selections. */
export const tap = () => vibrate(8);

/** A double pulse for a completed action, such as saving an entry. */
export const success = () => vibrate([12, 40, 18]);
