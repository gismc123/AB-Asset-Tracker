import { useMemo, useRef, useState } from 'react';
import type { ISODate } from '../../engine/index.js';
import { date, money } from '../format.js';

export interface TrendPoint {
  date: ISODate;
  value: number;
  /** Second line of the hover tooltip, e.g. "Payment #12". */
  note?: string;
}

interface Props {
  points: TrendPoint[];
  label: string;
  /** Draw points up to this index solid and the rest dashed (projected). -1 = all projected. */
  actualUntil?: number;
  /** Step line: the value holds until the next point (account balances). */
  step?: boolean;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 56 };

function tickLabel(cents: number): string {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (d >= 1000) return `${sign}$${Number((d / 1000).toFixed(d >= 10_000 ? 0 : 1))}k`;
  return `${sign}$${Math.round(d)}`;
}

/** Round axis bounds and a step of 1, 2 or 5 × 10ⁿ so tick labels read cleanly. */
function niceScale(min: number, max: number, ticks = 4): { lo: number; hi: number; step: number } {
  const raw = (max - min) / ticks || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

/** One series over time with a hover tooltip. Recorded points solid, projections dashed. */
export function TrendChart({ points, label, actualUntil = points.length - 1, step = false }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const geo = useMemo(() => {
    const values = points.map((p) => p.value);
    const { lo, hi, step: tickStep } = niceScale(Math.min(0, ...values), Math.max(1, ...values));
    const n = Math.max(1, points.length - 1);
    const x = (i: number) => PAD.left + (i / n) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const path = (from: number, to: number) =>
      points
        .slice(from, to + 1)
        .map((p, k) => {
          const i = from + k;
          const px = x(i).toFixed(1);
          const py = y(p.value).toFixed(1);
          if (k === 0) return `M${px},${py}`;
          return step ? `H${px}V${py}` : `L${px},${py}`;
        })
        .join('');
    const split = Math.max(0, Math.min(actualUntil, points.length - 1));
    const ticks: number[] = [];
    for (let t = lo; t <= hi + tickStep / 2; t += tickStep) ticks.push(t);
    const years = points
      .map((p, i) => ({ i, y: p.date.slice(0, 4) }))
      .filter((p, k, all) => k === 0 || p.y !== all[k - 1]!.y)
      .filter((_, k, all) => k % Math.max(1, Math.ceil(all.length / 6)) === 0);
    return {
      x,
      y,
      actual: actualUntil >= 0 ? path(0, split) : '',
      projected: split < points.length - 1 ? path(actualUntil >= 0 ? split : 0, points.length - 1) : '',
      ticks,
      years,
      zero: y(0),
    };
  }, [points, actualUntil, step]);

  if (points.length === 0) return <div className="mt-empty">Nothing to chart yet.</div>;

  const onMove = (e: React.PointerEvent) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - PAD.left) / (W - PAD.left - PAD.right)) * Math.max(1, points.length - 1));
    setHover(i >= 0 && i < points.length ? i : null);
  };
  const h = hover !== null ? points[hover] : undefined;

  return (
    <div className="mt-chart-wrap">
      <svg ref={svgRef} className="mt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={geo.y(t)} y2={geo.y(t)} />
            <text className="axis amount" x={PAD.left - 8} y={geo.y(t) + 4} textAnchor="end">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {geo.years.map((yr) => (
          <text key={yr.i} className="axis" x={geo.x(yr.i)} y={H - 6} textAnchor="middle">
            {yr.y}
          </text>
        ))}
        <line className="ref" x1={PAD.left} x2={W - PAD.right} y1={geo.zero} y2={geo.zero} />
        {geo.actual && <path className="line" d={geo.actual} />}
        {geo.projected && <path className="line projected" d={geo.projected} />}
        {h && hover !== null && (
          <g>
            <line className="cross" x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className="dot" cx={geo.x(hover)} cy={geo.y(h.value)} r={4.5} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="mt-tip" style={{ left: `${(geo.x(hover) / W) * 100}%`, top: `${(geo.y(h.value) / H) * 100}%` }}>
          <b>{money(h.value)}</b>
          {date(h.date)}
          {h.note ? ` · ${h.note}` : ''}
          {hover > actualUntil ? ' · projected' : ''}
        </div>
      )}
    </div>
  );
}
