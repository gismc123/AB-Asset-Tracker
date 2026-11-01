import { generateSchedule, type GenerateOptions } from './amortize.js';
import { currentValue, hasProjection, projectedValue, type Asset } from './assets.js';
import { parseISODate } from './dates.js';
import type { Cents, ISODate, LoanSetup, Schedule, ScheduleRow } from './types.js';

/** A hypothetical change to the payments. Nothing here is saved. */
export interface WhatIfInput {
  /** More principal with every payment from `fromPayment` on. */
  monthlyExtra: Cents;
  fromPayment: number;
  /** A one-time extra payment on a date. */
  lumpSum: { date: ISODate; amount: Cents } | null;
  /** Dates to compare what's owed and equity at. */
  dates: readonly ISODate[];
}

export interface WhatIfPlan {
  /** Last payment's due date. */
  payoffDate: ISODate | null;
  /** Payments on the schedule (skipped months included). */
  payments: number;
  /** Interest over the whole loan, paid and still to pay. */
  interest: Cents;
  /** Payments still to make, from `fromPayment` on (skipped months left out). */
  paymentsLeft: number;
  /** Interest still to pay, from `fromPayment` on. */
  interestLeft: Cents;
  /** The payment at `fromPayment`: what leaves the bank each month from then on. Null when it's past the payoff. */
  payment: Cents | null;
}

export interface WhatIfPoint {
  date: ISODate;
  /** The asset's value on that date (projected when it has a trend). Null without an asset. */
  value: Cents | null;
  current: { owed: Cents; equity: Cents | null };
  scenario: { owed: Cents; equity: Cents | null };
}

export interface WhatIfResult {
  input: WhatIfInput;
  /** The first payment the extra would go with. */
  next: { payment: number; dueDate: ISODate; extraPrincipal: Cents } | null;
  current: WhatIfPlan;
  scenario: WhatIfPlan;
  /** Calendar months between the two payoff dates. */
  monthsSaved: number;
  interestSaved: Cents;
  at: WhatIfPoint[];
  /** Balance after each due date on either plan, for a chart. */
  balances: { dueDate: ISODate; current: Cents | null; scenario: Cents | null }[];
}

function plan(s: Schedule, fromPayment: number): WhatIfPlan {
  const ahead = s.rows.slice(fromPayment - 1);
  return {
    payoffDate: s.rows.at(-1)?.dueDate ?? null,
    payments: s.rows.length,
    interest: s.totals.interest,
    paymentsLeft: ahead.filter((r) => !r.skipped).length,
    interestLeft: ahead.reduce((sum, r) => sum + (r.skipped ? 0 : r.interest) + (r.catchUp?.interest ?? 0), 0),
    payment: ahead[0]?.total ?? null,
  };
}

const monthIndex = (date: ISODate) => {
  const { y, m } = parseISODate(date);
  return y * 12 + m;
};

/**
 * What's owed on `date`: the balance after the last payment due by then,
 * plus anything deferred or past due, less extra payments already made in a
 * later row's period.
 */
export function owedOn(rows: readonly ScheduleRow[], date: ISODate, originalAmount: Cents): Cents {
  let owed = originalAmount;
  let deferred = 0;
  let pastDue = 0;
  let i = 0;
  for (; i < rows.length && rows[i]!.dueDate <= date; i++) {
    const r = rows[i]!;
    deferred += r.deferred - r.deferredRepaid;
    pastDue += r.pastDue - (r.catchUp?.total ?? 0);
    owed = r.endingBalance;
  }
  for (const r of rows.slice(i)) {
    for (const e of r.extraPaymentList) if (e.date <= date) owed -= e.amount;
    for (const f of r.oneOffFeeList) if (f.addedToBalance && f.date <= date) owed += f.amount;
  }
  return Math.max(0, owed) + deferred + pastDue;
}

/**
 * Compare the real schedule (`options`, as saved) with the same schedule
 * plus a hypothetical monthly extra and lump sum: payoff date, months and
 * interest saved, and what's owed and equity on the chosen dates.
 */
export function whatIf(setup: LoanSetup, options: GenerateOptions, input: WhatIfInput, asset: Asset | null): WhatIfResult {
  const current = generateSchedule(setup, options);
  const scenario = generateSchedule(setup, {
    ...options,
    hypotheticalExtra: input.monthlyExtra > 0 ? { fromPayment: input.fromPayment, amount: input.monthlyExtra } : undefined,
    extraPayments: [...(options.extraPayments ?? []), ...(input.lumpSum && input.lumpSum.amount > 0 ? [{ id: null, ...input.lumpSum }] : [])],
  });
  const a = plan(current, input.fromPayment);
  const b = plan(scenario, input.fromPayment);
  const valueOn = (date: ISODate) =>
    asset ? (hasProjection(asset) ? projectedValue(asset, date, setup.openDate) : currentValue(asset).value) : null;

  const at = input.dates.map((date): WhatIfPoint => {
    const value = valueOn(date);
    const owedA = owedOn(current.rows, date, setup.originalAmount);
    const owedB = owedOn(scenario.rows, date, setup.originalAmount);
    return {
      date,
      value,
      current: { owed: owedA, equity: value === null ? null : value - owedA },
      scenario: { owed: owedB, equity: value === null ? null : value - owedB },
    };
  });

  const byDate = new Map<ISODate, { current: Cents | null; scenario: Cents | null }>();
  for (const r of current.rows) byDate.set(r.dueDate, { current: r.endingBalance, scenario: null });
  for (const r of scenario.rows) byDate.set(r.dueDate, { current: byDate.get(r.dueDate)?.current ?? null, scenario: r.endingBalance });

  const nextRow = current.rows[input.fromPayment - 1];
  return {
    input,
    next: nextRow ? { payment: nextRow.payment, dueDate: nextRow.dueDate, extraPrincipal: nextRow.extraPrincipal } : null,
    current: a,
    scenario: b,
    monthsSaved: a.payoffDate && b.payoffDate ? monthIndex(a.payoffDate) - monthIndex(b.payoffDate) : 0,
    interestSaved: a.interest - b.interest,
    at,
    balances: [...byDate].map(([dueDate, v]) => ({ dueDate, ...v })).sort((x, y) => x.dueDate.localeCompare(y.dueDate)),
  };
}
