import { parseISODate } from './dates.js';
import type { Cents, ISODate, ScheduleRow } from './types.js';

/**
 * Where the money went over a period: the regular principal, extra
 * principal, interest, PMI and escrow parts of each payment.
 */
export interface PeriodTotals {
  /** Regular principal (scheduled principal plus any rounding offset). */
  principal: Cents;
  extraPrincipal: Cents;
  interest: Cents;
  pmi: Cents;
  escrow: Cents;
  /** Deferred (skipped) payments repaid with the final payment. */
  deferredRepaid: Cents;
  /**
   * Past-due amounts paid back. Already counted in principal, interest, PMI
   * and escrow above; shown separately for reference.
   */
  catchUp: Cents;
  /** Everything paid: principal + extra + interest + PMI + escrow + deferred repaid. */
  total: Cents;
  /** Payments made (skipped months not counted). */
  payments: number;
  skipped: number;
  /** What skipped months cost: interest added to the balance, and P&I deferred. */
  capitalizedInterest: Cents;
  deferred: Cents;
}

/**
 * `paid`: reconciled payments, dated by when the bank paid them (what lands
 * on your year-end mortgage statement), plus payments made before tracking
 * began, dated by their due date. `scheduled`: every payment, dated by its
 * due date, whether or not it has been reconciled yet.
 */
export type PeriodBasis = 'paid' | 'scheduled';

export interface Period {
  start: ISODate;
  end: ISODate;
  totals: PeriodTotals;
}

export interface PeriodBreakouts {
  basis: PeriodBasis;
  month: Period;
  quarter: Period;
  yearToDate: Period;
  loanToDate: Period;
  /** The whole schedule as it stands, paid and still to come. */
  fullLoan: Period;
}

export function emptyTotals(): PeriodTotals {
  return {
    principal: 0,
    extraPrincipal: 0,
    interest: 0,
    pmi: 0,
    escrow: 0,
    deferredRepaid: 0,
    catchUp: 0,
    total: 0,
    payments: 0,
    skipped: 0,
    capitalizedInterest: 0,
    deferred: 0,
  };
}

function add(t: PeriodTotals, r: ScheduleRow) {
  if (r.skipped) {
    t.skipped += 1;
    t.capitalizedInterest += r.capitalizedInterest;
    t.deferred += r.deferred;
    return;
  }
  const c = r.catchUp;
  t.principal += r.scheduledPrincipal + r.pennyOffset + (c?.principal ?? 0);
  t.extraPrincipal += r.extraPrincipal;
  t.interest += r.interest + (c?.interest ?? 0);
  t.pmi += r.pmi + (c?.pmi ?? 0);
  t.escrow += r.escrow + (c?.escrow ?? 0);
  t.deferredRepaid += r.deferredRepaid;
  t.catchUp += c?.total ?? 0;
  t.total += r.total;
  t.payments += 1;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Totals for this month, this quarter, the year so far and the loan so far.
 * Every period runs through the end of the current month, so "this month"
 * includes this month's payment even before its due date.
 */
export function periodBreakouts(
  rows: readonly ScheduleRow[],
  paidOn: ReadonlyMap<number, ISODate>,
  today: ISODate,
  basis: PeriodBasis,
): PeriodBreakouts {
  const { y, m } = parseISODate(today);
  const end = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
  const quarterStart = Math.floor((m - 1) / 3) * 3 + 1;
  const loanStart = rows[0]?.dueDate ?? today;
  const ranges = {
    month: `${y}-${pad(m)}-01`,
    quarter: `${y}-${pad(quarterStart)}-01`,
    yearToDate: `${y}-01-01`,
    loanToDate: loanStart,
  };

  const periods = Object.fromEntries(
    Object.entries(ranges).map(([k, start]) => [k, { start, end, totals: emptyTotals() }]),
  ) as Record<keyof typeof ranges, Period>;
  const fullLoan: Period = { start: loanStart, end: rows.at(-1)?.dueDate ?? loanStart, totals: emptyTotals() };

  for (const r of rows) {
    add(fullLoan.totals, r);
    // Skipped months and payments before tracking have no bank date, so they count by due date.
    const when = basis === 'scheduled' || r.skipped || r.beforeTracking ? r.dueDate : paidOn.get(r.payment);
    if (!when) continue;
    // The extra paid before tracking was paid at times unknown, not in this
    // payment's month, so only the loan-to-date totals include it.
    const dated = r.beforeTracking && r.extraPrincipal
      ? { ...r, extraPrincipal: 0, principal: r.principal - r.extraPrincipal, total: r.total - r.extraPrincipal }
      : r;
    for (const p of Object.values(periods)) {
      // Loan to date has no lower bound: a first payment can clear before its due date.
      if (p === periods.loanToDate) {
        if (when <= p.end) add(p.totals, r);
      } else if (when >= p.start && when <= p.end) add(p.totals, dated);
    }
  }
  return { basis, ...periods, fullLoan };
}
