import '../styles/motion-extra.css';

const CREST = 'M0 30 C 100 6, 200 6, 300 30 S 500 54, 600 30 S 800 6, 900 30 S 1100 54, 1200 30 V 60 H 0 Z';
const CREST_H = 30;

/**
 * A quiet water line along the bottom of a full-screen page. Put it first inside a container
 * that is `relative isolate`; it sits behind everything, takes no pointer events and is hidden
 * from assistive tech. `rising` floods the whole screen (used when the lock screen opens).
 */
export function WaveBackdrop({ rising = false, level = 0.28 }: { rising?: boolean; level?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="backdrop-water absolute inset-x-0 bottom-0" style={{ height: rising ? `calc(100% + ${CREST_H}px)` : `${level * 100}%` }}>
        <Layer o={0.04} d="31s" offset={0} />
        <Layer o={0.05} d="19s" offset={-260} lift={10} />
        <Layer o={0.07} d="43s" offset={-520} lift={22} reverse />
      </div>
      {/* The flood: solid water that follows the waves up, so the app is revealed from under it. */}
      <div className="backdrop-flood absolute inset-x-0 bottom-0 flex flex-col" style={{ height: rising ? `calc(100% + ${CREST_H}px)` : '0%', opacity: rising ? 1 : 0 }}>
        <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-full shrink-0 block" style={{ height: CREST_H }}><path d={CREST} fill="rgb(var(--primary))" /></svg>
        <div className="flex-1 -mt-px" style={{ background: 'rgb(var(--primary))' }} />
      </div>
    </div>
  );
}

/** One wave layer: a crest drawn twice side by side, drifting by half its width so it loops. */
function Layer({ o, d, offset, lift = 0, reverse }: { o: number; d: string; offset: number; lift?: number; reverse?: boolean }) {
  return (
    <div className="absolute inset-x-0 bottom-0" style={{ top: lift, opacity: o }}>
      <div className="backdrop-swell absolute inset-0" style={{ animationDelay: `${offset / 100}s` }}>
        <div className="backdrop-wave absolute inset-y-0 left-0 w-[200%] min-w-[1400px] flex flex-col" style={{ ['--d' as string]: d, animationDirection: reverse ? 'reverse' : 'normal', animationDelay: `${offset / 40}s` }}>
          <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-full shrink-0 block" style={{ height: CREST_H }}><path d={CREST} fill="rgb(var(--primary))" /></svg>
          <div className="flex-1 -mt-px" style={{ background: 'rgb(var(--primary))' }} />
        </div>
      </div>
    </div>
  );
}
