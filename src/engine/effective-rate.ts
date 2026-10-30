import { generateSchedule } from './amortize.js';
import type { Cents, LoanSetup } from './types.js';

/**
 * An estimate of what the loan really costs a year, fees included. It's the
 * yearly rate, compounded monthly, at which what you received when the loan
 * was opened equals what you pay back over the original schedule.
 *
 * - Received: the amount borrowed, minus one-off fees paid at opening and
 *   fees financed into the amount borrowed.
 * - Paid back: every scheduled principal and interest payment, the yearly
 *   fee (in the payment or charged separately), and one-off fees charged
 *   later (in the month they fall in). A fee added to the balance is paid
 *   back through the payments, with interest.
 * - Left out: PMI, escrow and extra principal. PMI and escrow are insurance
 *   and taxes, not the price of the money, and extra principal is a choice.
 */
export interface EffectiveRate {
  /** Effective yearly rate, in percent, rounded to two decimals. */
  percent: number;
  /** The note rate, for comparison. */
  nominalPercent: number;
  /** The same rate compounded monthly at the note rate's convention (12 x the monthly rate), in percent. */
  monthlyBasisPercent: number;
  /** What went into it. */
  feesAtOpening: Cents;
  feesFinanced: Cents;
  yearlyFees: Cents;
  laterFees: Cents;
  feesAdded: Cents;
  /** True when fees change the rate (otherwise it's just the note rate, compounded). */
  hasFees: boolean;
}

/** Solve for the monthly rate that makes `received` equal the payments, discounted month by month. */
function monthlyIrr(received: number, payments: readonly number[]): number {
  const npv = (i: number) => received - payments.reduce((sum, p, k) => sum + p / Math.pow(1 + i, k + 1), 0);
  // npv grows with the rate; bisection is slow but never fails on a loan's cash flows.
  let lo = -0.5;
  let hi = 1;
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Null when the loan can't be scheduled, or nothing was received. */
export function effectiveRate(setup: LoanSetup): EffectiveRate | null {
  // The contract: no standing extra, no starting point; fees as set up.
  let rows;
  try {
    rows = generateSchedule({ ...setup, extraPrincipal: 0, startingPoint: null }).rows;
  } catch {
    return null;
  }
  const fees = setup.fees ?? [];
  const feesFinanced = fees.filter((f) => f.financed).reduce((sum, f) => sum + f.amount, 0);
  const feesAtOpening = fees
    .filter((f) => !f.financed && !f.addedToBalance && (!f.date || f.date <= setup.openDate))
    .reduce((sum, f) => sum + f.amount, 0);
  const received = setup.originalAmount - feesFinanced - feesAtOpening;
  if (received <= 0 || !rows.length) return null;

  let yearlyFees = 0;
  let laterFees = 0;
  let feesAdded = 0;
  const payments = rows.map((r) => {
    yearlyFees += r.fee + r.separateFee;
    laterFees += r.oneOffFees;
    feesAdded += r.feesAdded;
    return r.principalAndInterest + r.fee + r.separateFee + r.oneOffFees;
  });
  const i = monthlyIrr(received, payments);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    percent: round2((Math.pow(1 + i, 12) - 1) * 100),
    nominalPercent: setup.annualRatePercent,
    monthlyBasisPercent: round2(i * 1200),
    feesAtOpening,
    feesFinanced,
    yearlyFees,
    laterFees,
    feesAdded,
    hasFees: feesAtOpening + feesFinanced + yearlyFees + laterFees + feesAdded > 0,
  };
}
