import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { MonthView } from '../../server/service.js';
import { date, money } from '../format.js';

interface Props {
  rows: MonthView[];
  currentPayment: number | null;
  onOpen(payment: number): void;
}

type Filter = 'all' | 'upcoming' | 'reconciled';

export function StatusPill({ status }: { status: MonthView['status'] }) {
  const label = status === 'paid' ? 'Paid' : status === 'flagged' ? 'Flagged' : 'Scheduled';
  return <span className={`mt-pill ${status}`}>{label}</span>;
}

/** The full amortization schedule, grouped by year. Click a row to reconcile it. */
export function ScheduleView({ rows, currentPayment, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const currentRef = useRef<HTMLTableRowElement>(null);

  const shown = useMemo(() => {
    if (filter === 'upcoming') return rows.filter((r) => r.status !== 'paid');
    if (filter === 'reconciled') return rows.filter((r) => r.status !== 'scheduled');
    return rows;
  }, [rows, filter]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div>
      <div className="mt-row" style={{ marginBottom: 12 }}>
        <div className="mt-tabs" role="tablist" aria-label="Filter schedule">
          {(['all', 'upcoming', 'reconciled'] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" className="mt-tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'upcoming' ? 'Not yet paid' : 'Reconciled'}
            </button>
          ))}
        </div>
        <span className="mt-spacer" />
        <span style={{ color: 'var(--muted)' }}>{shown.length} payments</span>
      </div>
      <div className="mt-table-wrap">
        <table className="mt-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="l">Due</th>
              <th>Principal</th>
              <th>Interest</th>
              <th>Extra</th>
              <th>PMI</th>
              <th>Escrow</th>
              <th>Total</th>
              <th>Balance</th>
              <th className="l">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const year = r.dueDate.slice(0, 4);
              const newYear = i === 0 || shown[i - 1]!.dueDate.slice(0, 4) !== year;
              return (
                <Fragment key={r.payment}>
                  {newYear && (
                    <tr className="year">
                      <td colSpan={10}>{year}</td>
                    </tr>
                  )}
                  <tr
                    ref={r.payment === currentPayment ? currentRef : undefined}
                    className={r.payment === currentPayment ? 'current' : undefined}
                    onClick={() => onOpen(r.payment)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(r.payment)}
                  >
                    <td>{r.payment}</td>
                    <td className="l">{date(r.dueDate)}</td>
                    <td>{money(r.scheduledPrincipal + r.pennyOffset)}</td>
                    <td>{money(r.interest)}</td>
                    <td className={r.extraPrincipal ? '' : 'muted'}>{r.extraPrincipal ? money(r.extraPrincipal) : '—'}</td>
                    <td className={r.pmi ? '' : 'muted'}>{r.pmi ? money(r.pmi) : '—'}</td>
                    <td>{money(r.escrow)}</td>
                    <td style={{ fontWeight: 600 }}>{money(r.total)}</td>
                    <td>{money(r.endingBalance)}</td>
                    <td className="l">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
