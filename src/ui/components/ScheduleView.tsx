import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { LoanModules } from '../../engine/index.js';
import type { MonthView } from '../../server/service.js';
import { date, money } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  rows: MonthView[];
  /** PMI and escrow columns only show for loans that have them. */
  modules: LoanModules;
  currentPayment: number | null;
  onOpen(payment: number): void;
  /** Open a month's extra payments to add one. */
  onAddExtra(payment: number): void;
  /** Remove one extra payment. */
  onRemoveExtra(id: number): Promise<void>;
}

type Filter = 'all' | 'upcoming' | 'reconciled';

/** A month's fees: in the payment, charged separately, or added to the balance. */
function FeeCell({ r, total }: { r: MonthView; total: number }) {
  if (!total) return <td className="muted">—</td>;
  const parts = [
    r.fee && `${money(r.fee)} yearly fee in the payment`,
    r.separateFee && `${money(r.separateFee)} yearly fee charged separately`,
    ...r.oneOffFeeList.map((f) => `${money(f.amount)} ${f.label} on ${date(f.date)}, ${f.addedToBalance ? 'added to the balance' : 'paid separately'}`),
  ].filter(Boolean);
  const outside = total - r.fee;
  return (
    <td title={parts.join('. ')}>
      <Amt cents={total} />
      {outside > 0 && ' *'}
    </td>
  );
}

export function StatusPill({ status }: { status: MonthView['status'] }) {
  const label = { paid: 'Paid', flagged: 'Flagged', skipped: 'Skipped', scheduled: 'Scheduled', history: 'Before tracking' }[status];
  return <span className={`mt-pill ${status}`}>{label}</span>;
}

/** The full amortization schedule, grouped by year. Click a row to reconcile it. */
export function ScheduleView({ rows, modules, currentPayment, onOpen, onAddExtra, onRemoveExtra }: Props) {
  const feeOf = (r: MonthView) => r.fee + r.separateFee + r.oneOffFees + r.feesAdded;
  const fees = rows.some((r) => feeOf(r) > 0);
  // #, due, principal, interest, extra, [pmi], [escrow], [fee], total, balance, status
  const columns = 8 + Number(modules.pmi) + Number(modules.escrow) + Number(fees);
  const [filter, setFilter] = useState<Filter>('all');
  const currentRef = useRef<HTMLTableRowElement>(null);
  const [busy, setBusy] = useState(false);
  const remove = async (id: number) => {
    setBusy(true);
    try {
      await onRemoveExtra(id);
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    if (filter === 'upcoming') return rows.filter((r) => r.status === 'scheduled' || r.status === 'flagged');
    if (filter === 'reconciled') return rows.filter((r) => r.status !== 'scheduled' && r.status !== 'history');
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
              {modules.pmi && <th>PMI</th>}
              {modules.escrow && <th>Escrow</th>}
              {fees && <th>Fee</th>}
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
                      <td colSpan={columns}>{year}</td>
                    </tr>
                  )}
                  <tr
                    ref={r.payment === currentPayment ? currentRef : undefined}
                    className={[r.payment === currentPayment ? 'current' : '', r.extraPaymentList.length ? 'has-sub' : ''].join(' ').trim() || undefined}
                    onClick={() => onOpen(r.payment)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(r.payment)}
                  >
                    <td>{r.payment}</td>
                    <td className="l">{date(r.dueDate)}</td>
                    {r.skipped ? (
                      <td colSpan={columns - 4} className="muted" style={{ textAlign: 'center' }}>
                        {r.skipped === 'catchUp' ? (
                          <>Missed · <Amt cents={r.pastDue} /> past due, caught up later</>
                        ) : r.skipped === 'capitalize' ? (
                          <>Skipped · <Amt cents={r.capitalizedInterest} /> interest added to the balance</>
                        ) : (
                          <>Skipped · <Amt cents={r.deferred} /> deferred to payoff</>
                        )}
                      </td>
                    ) : (
                      <>
                        <td><Amt cents={r.scheduledPrincipal + r.pennyOffset} /></td>
                        <td>
                          {r.fromBank && <span className="mt-badge" title="Interest and principal from your lender's table" style={{ marginRight: 6, marginLeft: 0 }}>bank table</span>}
                          <Amt cents={r.interest} />
                        </td>
                        <td
                          className={r.extraPrincipal || r.extraPayments ? '' : 'muted'}
                          title={
                            r.beforeTracking && r.extraPrincipal
                              ? 'Extra principal paid at some point before tracking began'
                              : r.extraPayments
                                ? `Includes ${r.extraPaymentList.length} extra ${r.extraPaymentList.length === 1 ? 'payment' : 'payments'} of their own`
                                : undefined
                          }
                        >
                          {r.extraPrincipal || r.extraPayments ? <Amt cents={r.extraPrincipal + r.extraPayments} /> : '—'}
                          {r.beforeTracking && r.extraPrincipal !== 0 && ' *'}
                          {!r.beforeTracking && (
                            <button
                              type="button"
                              className="mt-plus"
                              aria-label={`Add an extra payment with #${r.payment}`}
                              title="Add an extra payment"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddExtra(r.payment);
                              }}
                            >
                              +
                            </button>
                          )}
                        </td>
                        {modules.pmi && <td className={r.pmi ? '' : 'muted'}>{r.pmi ? <Amt cents={r.pmi} /> : '—'}</td>}
                        {modules.escrow && <td><Amt cents={r.escrow} /></td>}
                        {fees && <FeeCell r={r} total={feeOf(r)} />}
                        <td
                          style={{ fontWeight: 600 }}
                          title={
                            [r.deferredRepaid ? 'Includes the deferred balance, due at payoff' : '', r.catchUp ? 'Includes catching up missed payments' : '']
                              .filter(Boolean)
                              .join('. ') || undefined
                          }
                        >
                          <Amt cents={r.total} />
                          {(r.deferredRepaid > 0 || r.catchUp) && ' *'}
                        </td>
                      </>
                    )}
                    <td><Amt cents={r.endingBalance} /></td>
                    <td className="l">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                  {r.extraPaymentList.length > 0 && (
                    <tr className="mt-subrow">
                      <td />
                      <td colSpan={columns - 1}>
                        <div className="mt-chips">
                          <span className="mt-kpi-note" style={{ marginTop: 0 }}>Extra paid on its own:</span>
                          {r.extraPaymentList.map((e) => (
                            <span key={e.id ?? e.date} className="mt-chip">
                              <Amt cents={e.amount} /> on {date(e.date)}
                              {e.id !== null && (
                                <button type="button" className="mt-x" aria-label={`Remove the ${date(e.date)} extra payment`} disabled={busy} onClick={() => remove(e.id!)}>
                                  ✕
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.separateFee + r.oneOffFees + r.feesAdded > 0) && (
        <p className="mt-kpi-note">* Includes a fee charged separately or added to the balance, which isn't part of that month's payment. Hover for details.</p>
      )}
    </div>
  );
}
