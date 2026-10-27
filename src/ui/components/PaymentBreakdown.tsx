import type { ScheduleRow } from '../../engine/index.js';
import { money } from '../format.js';

const PARTS = [
  { key: 'principal', label: 'Principal', color: 'var(--s-principal)' },
  { key: 'interest', label: 'Interest', color: 'var(--s-interest)' },
  { key: 'pmi', label: 'PMI', color: 'var(--s-pmi)' },
  { key: 'escrow', label: 'Escrow', color: 'var(--s-escrow)' },
] as const;

/** Where one month's payment goes, as a stacked bar with a labeled legend. */
export function PaymentBreakdown({ row, title }: { row: ScheduleRow; title?: string }) {
  const parts = PARTS.map((p) => ({ ...p, value: row[p.key] })).filter((p) => p.value > 0);
  return (
    <div>
      {title && <h3>{title}</h3>}
      <div className="mt-stack" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label} ${money(p.value)}`} />
        ))}
      </div>
      <div className="mt-legend">
        {parts.map((p) => (
          <div className="mt-legend-row" key={p.key}>
            <span className="mt-swatch" style={{ background: p.color }} />
            {p.label}
            {p.key === 'principal' && row.extraPrincipal > 0 && (
              <span style={{ color: 'var(--muted)' }}>incl. {money(row.extraPrincipal)} extra</span>
            )}
            {p.key === 'principal' && row.pennyOffset !== 0 && (
              <span style={{ color: 'var(--muted)' }}>incl. {money(row.pennyOffset, { sign: true })} offset</span>
            )}
            <span className="v">{money(p.value)}</span>
          </div>
        ))}
        <div className="mt-legend-row mt-legend-total">
          Total payment<span className="v">{money(row.total)}</span>
        </div>
      </div>
    </div>
  );
}
