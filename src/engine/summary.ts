import { modulesOf } from './amortize.js';
import { currentValue, hasProjection, homeAssetFor, latestValue, projectedValue, type Asset, type AssetKind, type AssetValue } from './assets.js';
import { daysBetween } from './dates.js';
import { dailyInterest } from './money.js';
import type { Cents, ISODate, LoanSetup, Schedule, ScheduleRow } from './types.js';

/** Kept for code written before assets: a value estimate of the home. */
export type HomeValueEstimate = AssetValue;

/** What it would take to pay the loan off today. */
export interface Payoff {
  amount: Cents;
  /** `quote`: the lender's payoff quote, still good. `estimate`: worked out here. */
  source: 'quote' | 'estimate';
  /** For a quote: its good-through date. For an estimate: today. */
  asOf: ISODate;
  /** Interest per day on today's balance (simple, 365-day year), included in an estimate. */
  perDiem: Cents;
  /** Set when a quote is on file but has expired. */
  expiredQuote: ISODate | null;
}

export interface LoanSummary {
  asOf: ISODate;
  /** Highest paid payment number (reconciled, or made before tracking), or null before the first one. */
  lastPaidPayment: number | null;
  paymentsMade: number;
  totalPayments: number;
  /** Balance after the last reconciled payment (or past skipped payment). */
  balance: Cents;
  /** Skipped payments deferred to payoff and not yet repaid. Also owed on the home. */
  deferredBalance: Cents;
  /** Missed payments (catch-up skips) not yet paid back. */
  pastDue: Cents;
  /** Balance the schedule expects after every payment due on or before today. */
  scheduledBalance: Cents;
  percentPaid: number;
  /** Balance + deferred + past due. */
  owed: Cents;
  /** The asset's original value minus what's owed. Null when the loan has no asset. */
  equity: Cents | null;
  equityPercent: number | null;
  /** Latest value entered for the asset, if any, and equity measured against it. */
  homeValue: AssetValue | null;
  marketEquity: Cents | null;
  marketEquityPercent: number | null;
  /**
   * The asset and the headline equity: its current value (latest entry, or
   * the original value) minus what's owed. Null when the loan has no asset.
   */
  asset: {
    name: string;
    kind: AssetKind;
    originalValue: Cents;
    value: Cents;
    valueDate: ISODate | null;
    valueSource: string;
    /** False when no value has been entered and the original value stands in. */
    valueEntered: boolean;
    /** Today's value on the projected curve, when the asset has one. Always an estimate. */
    projectedValue: Cents | null;
    equity: Cents;
    equityPercent: number;
  } | null;
  payoff: Payoff | null;
  /** One-off fees from the setup (paid up front or financed). */
  oneOffFees: Cents;
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
 * Rows that have happened: reconciled payments, payments made before
 * tracking began, and skipped payments whose due date has passed (a skip has
 * no bank transaction to reconcile).
 */
export function settledRows(rows: readonly ScheduleRow[], paid: ReadonlySet<number>, today: ISODate): ScheduleRow[] {
  return rows.filter((r) => isPaid(r, paid) || (r.skipped !== null && r.dueDate <= today));
}

/** Reconciled, or made before tracking began. */
export const isPaid = (r: ScheduleRow, paid: ReadonlySet<number>) => r.beforeTracking || paid.has(r.payment);

/** The latest estimate by date (later entries win ties). */
export const latestHomeValue = latestValue;

/**
 * Payoff today: the lender's quote while it's good, otherwise what's owed
 * plus simple interest since the last payment settled (a per diem, as payoff
 * quotes count it). An estimate: the lender's quote has the final word.
 */
export function payoffToday(setup: LoanSetup, owed: Cents, balance: Cents, lastSettled: ISODate | null, today: ISODate): Payoff | null {
  if (owed <= 0) return null;
  const perDiem = dailyInterest(balance, setup.annualRatePercent, 1);
  const quote = setup.payoffQuote;
  if (quote && quote.goodThrough >= today) {
    return { amount: quote.amount, source: 'quote', asOf: quote.goodThrough, perDiem, expiredQuote: null };
  }
  const days = Math.max(0, daysBetween(lastSettled ?? setup.openDate, today));
  return {
    amount: owed + dailyInterest(balance, setup.annualRatePercent, days),
    source: 'estimate',
    asOf: today,
    perDiem,
    expiredQuote: quote ? quote.goodThrough : null,
  };
}

/**
 * `asset`: what the loan paid for. Left out, it's the home described by the
 * setup's original home value (how every loan worked before assets). Null
 * for a loan with no asset, such as most personal loans.
 */
export function summarize(
  setup: LoanSetup,
  schedule: Schedule,
  paid: ReadonlySet<number>,
  today: ISODate,
  asset: Asset | null = homeAssetFor(setup),
): LoanSummary {
  const rows = schedule.rows;
  const settled = settledRows(rows, paid, today);
  const paidRows = rows.filter((r) => isPaid(r, paid));
  const lastPaid = paidRows.at(-1) ?? null;
  const lastSettled = settled.at(-1) ?? null;
  const balance = lastSettled ? lastSettled.endingBalance : setup.originalAmount;
  const deferredBalance = settled.reduce((sum, r) => sum + r.deferred - r.deferredRepaid, 0);
  const pastDue = settled.reduce((sum, r) => sum + r.pastDue - (r.catchUp?.total ?? 0), 0);
  const owed = balance + deferredBalance + pastDue;
  const dueByToday = rows.filter((r) => r.dueDate <= today).at(-1);
  const scheduledBalance = dueByToday ? dueByToday.endingBalance : setup.originalAmount;
  const next = rows.find((r) => !isPaid(r, paid) && r.skipped === null) ?? null;
  const homeValue = asset ? latestValue(asset.values) : null;
  const p = schedule.pmi;
  const nextRow = next ?? rows.at(-1);
  const active = modulesOf(setup).pmi && p.hasPmi && nextRow !== undefined && (p.dropPayment === null || nextRow.payment < p.dropPayment);
  const current = asset ? currentValue(asset) : null;
  // The settled date a per diem runs from: the bank date for a reconciled payment.
  const lastSettledDate = lastSettled ? lastSettled.dueDate : null;

  return {
    asOf: today,
    lastPaidPayment: lastPaid?.payment ?? null,
    paymentsMade: paidRows.length,
    totalPayments: rows.length,
    balance,
    deferredBalance,
    pastDue,
    scheduledBalance,
    percentPaid: pct(setup.originalAmount - balance, setup.originalAmount),
    owed,
    equity: asset ? asset.originalValue - owed : null,
    equityPercent: asset ? pct(asset.originalValue - owed, asset.originalValue) : null,
    homeValue,
    marketEquity: homeValue ? homeValue.value - owed : null,
    marketEquityPercent: homeValue ? pct(homeValue.value - owed, homeValue.value) : null,
    nextPayment: next
      ? { payment: next.payment, dueDate: next.dueDate, total: next.total, daysUntil: daysBetween(today, next.dueDate) }
      : null,
    payoffDate: rows.at(-1)?.dueDate ?? null,
    asset:
      asset && current
        ? {
            name: asset.name,
            kind: asset.kind,
            originalValue: asset.originalValue,
            value: current.value,
            valueDate: current.date,
            valueSource: current.source,
            valueEntered: current.entered,
            projectedValue: hasProjection(asset) ? projectedValue(asset, today, setup.openDate) : null,
            equity: current.value - owed,
            equityPercent: pct(current.value - owed, current.value),
          }
        : null,
    payoff: payoffToday(setup, owed, balance, lastSettledDate, today),
    oneOffFees: (setup.fees ?? []).reduce((sum, f) => sum + f.amount, 0),
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
