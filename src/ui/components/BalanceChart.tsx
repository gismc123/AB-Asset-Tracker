import { useMemo, useRef, useState } from 'react';
import type { Cents, ISODate, ScheduleRow } from '../../engine/index.js';
import { date, money } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  rows: ScheduleRow[];
  /** Horizontal reference lines, e.g. the 80% and 78% PMI balances. */
  references: { label: string; balance: Cents }[];
  today: ISODate;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 52 };

/** Balance over the life of the loan, with PMI thresholds and a "today" marker. */
export function BalanceChart({ rows, references, today }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const geo = useMemo(() => {
    const max = rows[0]?.beginningBalance ?? 1;
    const n = rows.length;
    const x = (i: number) => PAD.left + (i / Math.max(1, n)) * (W - PAD.left - PAD.right);
    const y = (b: number) => PAD.top + (1 - b / max) * (H - PAD.top - PAD.bottom);
    const pts = [[x(0), y(max)], ...rows.map((r, i) => [x(i + 1), y(r.endingBalance)])] as [number, number][];
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const area = `${line}L${x(n).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: y(max * f) }));
    const years = rows
      .map((r, i) => ({ i, d: r.dueDate }))
      .filter((r, k, all) => k === 0 || r.d.slice(0, 4) !== all[k - 1]!.d.slice(0, 4))
      .filter((_, k, all) => k % Math.max(1, Math.ceil(all.length / 6)) === 0);
    const todayIdx = rows.findIndex((r) => r.dueDate > today);
    return { x, y, line, area, ticks, years, max, todayIdx: todayIdx === -1 ? n : todayIdx };
  }, [rows, today]);

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - PAD.left) / (W - PAD.left - PAD.right)) * rows.length) - 1;
    setHover(i >= 0 && i < rows.length ? i : null);
  };

  const h = hover !== null ? rows[hover] : undefined;
  return (
    <div className="mt-chart-wrap">
      <svg
        ref={svgRef}
        className="mt-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Loan balance over ${rows.length} payments`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {geo.ticks.map((t) => (
          <g key={t.v}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} />
            <text className="axis amount" x={PAD.left - 8} y={t.y + 4} textAnchor="end">
              {`$${Math.round(t.v / 100_000)}k`}
            </text>
          </g>
        ))}
        {geo.years.map((yr) => (
          <text key={yr.i} className="axis" x={geo.x(yr.i)} y={H - 6} textAnchor="middle">
            {yr.d.slice(0, 4)}
          </text>
        ))}
        <path className="area" d={geo.area} />
        <path className="line" d={geo.line} />
        {references.map((r, i) => (
          <g key={r.label}>
            <line className="ref" x1={PAD.left} x2={W - PAD.right} y1={geo.y(r.balance)} y2={geo.y(r.balance)} />
            {/* Thresholds sit close together: first label above its line, the next below. */}
            <text className="ref-label" x={W - PAD.right - 4} y={geo.y(r.balance) + (i % 2 ? 13 : -5)} textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}
        {geo.todayIdx > 0 && geo.todayIdx < rows.length && (
          <g>
            <line className="today" x1={geo.x(geo.todayIdx)} x2={geo.x(geo.todayIdx)} y1={PAD.top} y2={H - PAD.bottom} />
            <text className="ref-label" x={geo.x(geo.todayIdx) + 4} y={H - PAD.bottom - 6}>
              Today
            </text>
          </g>
        )}
        {h && hover !== null && (
          <g>
            <line className="cross" x1={geo.x(hover + 1)} x2={geo.x(hover + 1)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className="dot" cx={geo.x(hover + 1)} cy={geo.y(h.endingBalance)} r={4.5} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="mt-tip"
          style={{ left: `${(geo.x(hover + 1) / W) * 100}%`, top: `${(geo.y(h.endingBalance) / H) * 100}%` }}
        >
          <b><Amt cents={h.endingBalance} /></b>
          Payment #{h.payment} · {date(h.dueDate)}
        </div>
      )}
    </div>
  );
}
