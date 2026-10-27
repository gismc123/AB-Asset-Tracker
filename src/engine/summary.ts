import { daysBetween } from './dates.js';
import type { Cents, ISODate, LoanSetup, Schedule } from './types.js';

export interface LoanSummary {
  asOf: ISODate;
  /** Highest reconciled (paid) payment number, or null before the first one. */
  lastPaidPayment: number | null;
  paymentsMade: number;
  totalPayments: number;
  /** Balance after the last reconciled payment. */
  balance: Cents;
  /** Balance the schedule expects after every payment due on or before today. */
  scheduledBalance: Cents;
  percentPaid: number;
  /** Original home value minus balance. */
  equity: Cents;
  equityPercent: number;
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

export function summarize(setup: LoanSetup, schedule: Schedule, paid: ReadonlySet<number>, today: ISODate): LoanSummary {
  const rows = schedule.rows;
  const lastPaid = rows.filter((r) => paid.has(r.payment)).at(-1) ?? null;
  const balance = lastPaid ? lastPaid.endingBalance : setup.originalAmount;
  const dueByToday = rows.filter((r) => r.dueDate <= today).at(-1);
  const scheduledBalance = dueByToday ? dueByToday.endingBalance : setup.originalAmount;
  const next = rows.find((r) => !paid.has(r.payment)) ?? null;
  const p = schedule.pmi;
  const nextRow = next ?? rows.at(-1);
  const active = p.hasPmi && nextRow !== undefined && (p.dropPayment === null || nextRow.payment < p.dropPayment);

  return {
    asOf: today,
    lastPaidPayment: lastPaid?.payment ?? null,
    paymentsMade: rows.filter((r) => paid.has(r.payment)).length,
    totalPayments: rows.length,
    balance,
    scheduledBalance,
    percentPaid: pct(setup.originalAmount - balance, setup.originalAmount),
    equity: setup.originalHomeValue - balance,
    equityPercent: pct(setup.originalHomeValue - balance, setup.originalHomeValue),
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
