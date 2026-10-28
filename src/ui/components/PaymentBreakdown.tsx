import type { ScheduleRow } from '../../engine/index.js';
import { Amt } from './Amt.js';

const PARTS = [
  { key: 'principal', label: 'Principal', color: 'var(--s-principal)' },
  { key: 'interest', label: 'Interest', color: 'var(--s-interest)' },
  { key: 'pmi', label: 'PMI', color: 'var(--s-pmi)' },
  { key: 'escrow', label: 'Escrow', color: 'var(--s-escrow)' },
  { key: 'fee', label: 'Yearly fee', color: 'var(--muted)' },
] as const;

/** Where one month's payment goes, as a stacked bar with a labeled legend. */
export function PaymentBreakdown({ row, title }: { row: ScheduleRow; title?: string }) {
  if (row.skipped) {
    return (
      <div>
        {title && <h3>{title}</h3>}
        <dl className="mt-kv">
          <dt>Paid this month</dt>
          <dd><Amt cents={0} /></dd>
          {row.skipped === 'catchUp' ? (
            <>
              <dt>Principal &amp; interest</dt>
              <dd><Amt cents={row.principalAndInterest} /></dd>
              {row.pmi > 0 && (
                <>
                  <dt>PMI</dt>
                  <dd><Amt cents={row.pmi} /></dd>
                </>
              )}
              {row.escrow > 0 && (
                <>
                  <dt>Escrow</dt>
                  <dd><Amt cents={row.escrow} /></dd>
                </>
              )}
              <dt>Past due, to catch up</dt>
              <dd><Amt cents={row.pastDue} /></dd>
            </>
          ) : row.skipped === 'capitalize' ? (
            <>
              <dt>Interest added to the balance</dt>
              <dd><Amt cents={row.capitalizedInterest} /></dd>
            </>
          ) : (
            <>
              <dt>Principal deferred</dt>
              <dd><Amt cents={row.scheduledPrincipal} /></dd>
              <dt>Interest deferred</dt>
              <dd><Amt cents={row.interest} /></dd>
              <dt>Due at payoff</dt>
              <dd><Amt cents={row.deferred} /></dd>
            </>
          )}
        </dl>
      </div>
    );
  }
  const parts = PARTS.map((p) => ({ ...p, value: row[p.key] })).filter((p) => p.value > 0);
  return (
    <div>
      {title && <h3>{title}</h3>}
      <div className="mt-stack" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} style={{ flexGrow: p.value, background: p.color }} />
        ))}
      </div>
      <div className="mt-legend">
        {parts.map((p) => (
          <div className="mt-legend-row" key={p.key}>
            <span className="mt-swatch" style={{ background: p.color }} />
            {p.label}
            {p.key === 'principal' && row.extraPrincipal > 0 && (
              <span style={{ color: 'var(--muted)' }}>incl. <Amt cents={row.extraPrincipal} /> extra</span>
            )}
            {p.key === 'principal' && row.pennyOffset !== 0 && (
              <span style={{ color: 'var(--muted)' }}>incl. <Amt cents={row.pennyOffset} sign /> offset</span>
            )}
            <span className="v"><Amt cents={p.value} /></span>
          </div>
        ))}
        {row.catchUp && (
          <div className="mt-legend-row">
            <span className="mt-swatch" style={{ background: 'var(--muted)' }} />
            Catching up missed payments
            <span className="v"><Amt cents={row.catchUp.total} /></span>
          </div>
        )}
        {row.deferredRepaid > 0 && (
          <div className="mt-legend-row">
            <span className="mt-swatch" style={{ background: 'var(--muted)' }} />
            Deferred balance repaid
            <span className="v"><Amt cents={row.deferredRepaid} /></span>
          </div>
        )}
        <div className="mt-legend-row mt-legend-total">
          Total payment<span className="v"><Amt cents={row.total} /></span>
        </div>
      </div>
    </div>
  );
}
