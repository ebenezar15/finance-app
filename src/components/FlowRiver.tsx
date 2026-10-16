import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFmt } from './ui';

interface Node { id: string; name: string; value: number; colour: string }

/**
 * Cash-flow river: a hand-built Sankey. Money enters on the left (income sources), pools in the
 * household in the middle, and leaves on the right (categories, plus what was kept).
 * Hover/focus a stream to isolate it; click a category stream to open its transactions.
 */
export function FlowRiver({ ins, outs, month }: { ins: { name: string; value: number }[]; outs: Node[]; month: string }) {
  const fmt = useFmt();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const totalIn = ins.reduce((s, x) => s + x.value, 0);
    const totalOut = outs.reduce((s, x) => s + x.value, 0);
    const sources: Node[] = ins.map((x, i) => ({ id: `in-${i}`, name: x.name, value: x.value, colour: ['rgb(var(--good))', 'rgb(var(--indigo))', 'rgb(var(--warn))', '#3B9DD8'][i % 4] }));
    if (totalOut > totalIn) sources.push({ id: 'in-gap', name: 'Drawn from savings', value: totalOut - totalIn, colour: 'rgb(var(--bad))' });
    const total = Math.max(totalIn, totalOut, 1);
    const narrow = w < 560;
    const gap = 10;
    const rowH = narrow ? 40 : 44;
    const H = Math.max(240, Math.max(outs.length, sources.length) * rowH + 20);
    const usable = H - 20 - gap * Math.max(outs.length - 1, sources.length - 1, 0);
    const k = usable / total;
    const nodeW = 10;
    const xL = 0, xC = Math.round(w * (narrow ? 0.3 : 0.36)), xR = Math.round(w * (narrow ? 0.56 : 0.64));

    const stack = (nodes: Node[], x: number) => {
      const used = nodes.reduce((s, n) => s + n.value * k, 0) + gap * (nodes.length - 1);
      let y = (H - used) / 2;
      return nodes.map((n) => { const h = Math.max(2, n.value * k); const r = { ...n, x, y, h }; y += h + gap; return r; });
    };
    const L = stack(sources, xL);
    const R = stack(outs, xR);
    const centreH = total * k;
    const cy = (H - centreH) / 2;
    const mid = (a: number, b: number) => (a + b) / 2;
    const ribbon = (x0: number, y0: number, x1: number, y1: number, h: number) => {
      const m = mid(x0, x1);
      return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1} L${x1},${y1 + h} C${m},${y1 + h} ${m},${y0 + h} ${x0},${y0 + h} Z`;
    };
    let ci = cy;
    const inLinks = L.map((n) => { const p = ribbon(n.x + nodeW, n.y, xC, ci, n.h); ci += n.h; return { id: n.id, colour: n.colour, d: p }; });
    let co = cy;
    const outLinks = R.map((n) => { const p = ribbon(xC + nodeW, co, n.x, n.y, n.h); co += n.h; return { id: n.id, colour: n.colour, d: p }; });
    return { H, L, R, xC, cy, centreH, nodeW, inLinks, outLinks, total, totalIn, narrow };
  }, [ins, outs, w]);

  const { H, L, R, xC, cy, centreH, nodeW, inLinks, outLinks, totalIn, narrow } = layout;
  const dim = (id: string) => (active && active !== id ? 0.12 : active === id ? 0.55 : 0.28);
  const go = (id: string) => {
    if (id.startsWith('in-') || id === 'saved') return;
    nav(`/activity?cat=${id === 'rest' ? '' : id}&month=${month}`);
  };
  const share = (v: number) => (totalIn ? `${Math.round((v / totalIn) * 100)}% of income` : '');

  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Cash flow for the month: income on the left, spending categories on the right" className="block overflow-visible">
        <defs>
          {outLinks.map((l) => (
            <linearGradient key={l.id} id={`g-${l.id}`} x1="0" x2="1">
              <stop offset="0" stopColor="rgb(var(--primary))" />
              <stop offset="1" stopColor={l.colour} />
            </linearGradient>
          ))}
        </defs>
        {inLinks.map((l) => (
          <path key={l.id} d={l.d} fill={l.colour} opacity={dim(l.id)} style={{ transition: 'opacity .25s' }}
            onMouseEnter={() => setActive(l.id)} onMouseLeave={() => setActive(null)} />
        ))}
        {outLinks.map((l) => (
          <g key={l.id}>
            <path d={l.d} fill={`url(#g-${l.id})`} opacity={dim(l.id)} style={{ transition: 'opacity .25s', cursor: l.id === 'saved' ? 'default' : 'pointer' }}
              onMouseEnter={() => setActive(l.id)} onMouseLeave={() => setActive(null)} onClick={() => go(l.id)} />
            {active === l.id && (
              <path d={l.d} fill="none" stroke={l.colour} strokeWidth={1.5} strokeDasharray="6 14" style={{ animation: 'flow 1.2s linear infinite' }} pointerEvents="none" />
            )}
          </g>
        ))}
        <rect x={xC} y={cy} width={nodeW} height={centreH} rx={4} fill="rgb(var(--primary))" />
        {L.map((n) => (
          <g key={n.id} onMouseEnter={() => setActive(n.id)} onMouseLeave={() => setActive(null)}>
            <rect x={n.x} y={n.y} width={nodeW} height={n.h} rx={3} fill={n.colour} />
            <text x={n.x + nodeW + 8} y={n.y + n.h / 2 - 2} className="fill-ink text-[12px] font-bold" style={{ paintOrder: 'stroke', stroke: 'rgb(var(--surface))', strokeWidth: 4 }} dominantBaseline="auto">{n.name}</text>
            <text x={n.x + nodeW + 8} y={n.y + n.h / 2 + 12} className="fill-muted text-[11px] num money" style={{ paintOrder: 'stroke', stroke: 'rgb(var(--surface))', strokeWidth: 4 }}>{fmt(n.value, { compact: narrow })}</text>
          </g>
        ))}
        {R.map((n) => (
          <g key={n.id} tabIndex={0} role="button" aria-label={`${n.name}: ${fmt(n.value)}, ${share(n.value)}`}
            onFocus={() => setActive(n.id)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(n.id)} onMouseLeave={() => setActive(null)}
            onClick={() => go(n.id)} onKeyDown={(e) => e.key === 'Enter' && go(n.id)} style={{ cursor: n.id === 'saved' ? 'default' : 'pointer', outline: 'none' }}>
            <rect x={n.x} y={n.y} width={nodeW} height={n.h} rx={3} fill={n.colour} />
            <text x={n.x + nodeW + 10} y={n.y + n.h / 2 - 2} className={`text-[13px] font-bold ${active === n.id ? 'fill-primary' : 'fill-ink'}`}>{n.name}</text>
            <text x={n.x + nodeW + 10} y={n.y + n.h / 2 + 13} className="fill-muted text-[12px] num">
              <tspan className="money">{fmt(n.value, { compact: narrow })}</tspan>
              {!narrow && <tspan dx={8} opacity={active === n.id ? 1 : 0.7}>{share(n.value)}</tspan>}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
