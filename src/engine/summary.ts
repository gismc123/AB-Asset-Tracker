import { daysBetween } from './dates.js';
import type { Cents, ISODate, LoanSetup, Schedule, ScheduleRow } from './types.js';

/** An estimate of what the home is worth now (appraisal, tax assessment, online estimate). */
export interface HomeValueEstimate {
  date: ISODate;
  value: Cents;
  source: string;
}

export interface LoanSummary {
  asOf: ISODate;
  /** Highest reconciled (paid) payment number, or null before the first one. */
  lastPaidPayment: number | null;
  paymentsMade: number;
  totalPayments: number;
  /** Balance after the last reconciled payment (or past skipped payment). */
  balance: Cents;
  /** Skipped payments deferred to payoff and not yet repaid. Also owed on the home. */
  deferredBalance: Cents;
  /** Balance the schedule expects after every payment due on or before today. */
  scheduledBalance: Cents;
  percentPaid: number;
  /** Original home value minus what's owed (balance + deferred). */
  equity: Cents;
  equityPercent: number;
  /** Latest home value estimate, if any, and equity measured against it. */
  homeValue: HomeValueEstimate | null;
  marketEquity: Cents | null;
  marketEquityPercent: number | null;
  nextPayment: { payment: number; dueDate: ISODate; total: Cents; daysUntil: number } | null;
  payoffDate: ISODate | null;
  pmi: {
    hasPmi: boolean;
    /** Still on the schedule as of the next payment. */
    active: boolean;
    monthly: Cents;
    dropPayment: number | null;
    dropDate: ISODate | null;
    paymentsUntilDrop: number | null;
    daysUntilDrop: number | null;
    request80Date: ISODate | null;
    auto78Date: ISODate | null;
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0);

/**
 * Rows that have happened: reconciled payments, and skipped payments whose
 * due date has passed (a skip has no bank transaction to reconcile).
 */
export function settledRows(rows: readonly ScheduleRow[], paid: ReadonlySet<number>, today: ISODate): ScheduleRow[] {
  return rows.filter((r) => paid.has(r.payment) || (r.skipped !== null && r.dueDate <= today));
}

/** The latest estimate by date (later entries win ties). */
export function latestHomeValue(values: readonly HomeValueEstimate[]): HomeValueEstimate | null {
  let best: HomeValueEstimate | null = null;
  for (const v of values) if (!best || v.date >= best.date) best = v;
  return best;
}

export function summarize(
  setup: LoanSetup,
  schedule: Schedule,
  paid: ReadonlySet<number>,
  today: ISODate,
  homeValues: readonly HomeValueEstimate[] = [],
): LoanSummary {
  const rows = schedule.rows;
  const settled = settledRows(rows, paid, today);
  const lastPaid = rows.filter((r) => paid.has(r.payment)).at(-1) ?? null;
  const lastSettled = settled.at(-1) ?? null;
  const balance = lastSettled ? lastSettled.endingBalance : setup.originalAmount;
  const deferredBalance = settled.reduce((sum, r) => sum + r.deferred - r.deferredRepaid, 0);
  const owed = balance + deferredBalance;
  const dueByToday = rows.filter((r) => r.dueDate <= today).at(-1);
  const scheduledBalance = dueByToday ? dueByToday.endingBalance : setup.originalAmount;
  const next = rows.find((r) => !paid.has(r.payment) && r.skipped === null) ?? null;
  const homeValue = latestHomeValue(homeValues);
  const p = schedule.pmi;
  const nextRow = next ?? rows.at(-1);
  const active = p.hasPmi && nextRow !== undefined && (p.dropPayment === null || nextRow.payment < p.dropPayment);

  return {
    asOf: today,
    lastPaidPayment: lastPaid?.payment ?? null,
    paymentsMade: rows.filter((r) => paid.has(r.payment)).length,
    totalPayments: rows.length,
    balance,
    deferredBalance,
    scheduledBalance,
    percentPaid: pct(setup.originalAmount - balance, setup.originalAmount),
    equity: setup.originalHomeValue - owed,
    equityPercent: pct(setup.originalHomeValue - owed, setup.originalHomeValue),
    homeValue,
    marketEquity: homeValue ? homeValue.value - owed : null,
    marketEquityPercent: homeValue ? pct(homeValue.value - owed, homeValue.value) : null,
    nextPayment: next
      ? { payment: next.payment, dueDate: next.dueDate, total: next.total, daysUntil: daysBetween(today, next.dueDate) }
      : null,
    payoffDate: rows.at(-1)?.dueDate ?? null,
    pmi: {
      hasPmi: p.hasPmi,
      active,
      monthly: active ? (nextRow?.pmi ?? 0) : 0,
      dropPayment: p.dropPayment,
      dropDate: p.dropDate,
      paymentsUntilDrop: active && p.dropPayment !== null && next ? p.dropPayment - next.payment : active ? null : 0,
      daysUntilDrop: active && p.dropDate ? Math.max(0, daysBetween(today, p.dropDate)) : active ? null : 0,
      request80Date: p.request80.dueDate,
      auto78Date: p.auto78Scheduled.dueDate,
    },
  };
}
