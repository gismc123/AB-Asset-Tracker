import { daysBetween, dueDateFor, isValidISODate } from './dates.js';
import { dailyInterest, monthlyInterest, roundCents, standardPayment } from './money.js';
import type {
  Adjustment,
  Cents,
  ISODate,
  LoanModules,
  LoanSetup,
  LockedPayment,
  PmiInfo,
  PmiMilestone,
  Schedule,
  ScheduleRow,
  PaymentParts,
  SkipMode,
} from './types.js';

/** Hard stop so a bad override can never loop forever. */
const MAX_PAYMENTS = 1200;

export interface GenerateOptions {
  adjustments?: readonly Adjustment[];
  /** Reconciled months, keyed by payment number. Their amounts are used as-is. */
  locked?: ReadonlyMap<number, LockedPayment>;
  /**
   * When each matched payment really left the bank. Only daily-interest loans
   * use it: interest runs up to the date the payment was made.
   */
  paidDates?: ReadonlyMap<number, ISODate>;
}

/** Loans saved before modules existed were all mortgages, with both. */
export function modulesOf(setup: LoanSetup): LoanModules {
  return { pmi: setup.modules?.pmi ?? true, escrow: setup.modules?.escrow ?? true };
}

export function termMonthsOf(setup: LoanSetup): number {
  return setup.termMonths ?? setup.termYears * 12;
}

/** Longest term accepted, in months. */
export const MAX_TERM_MONTHS = 600;

export class SetupError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid loan setup: ${problems.join('; ')}`);
  }
}

export function validateSetup(s: LoanSetup): string[] {
  const problems: string[] = [];
  const isCents = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

  if (!isCents(s.originalAmount) || s.originalAmount <= 0) problems.push('Original loan amount must be more than zero');
  if (!(typeof s.annualRatePercent === 'number' && s.annualRatePercent >= 0 && s.annualRatePercent < 50)) {
    problems.push('Interest rate must be between 0 and 50 percent');
  }
  const term = termMonthsOf(s);
  if (s.termMonths !== undefined && s.termMonths !== null) {
    if (!(Number.isInteger(s.termMonths) && s.termMonths >= 1 && s.termMonths <= MAX_TERM_MONTHS)) {
      problems.push(`Term must be 1 to ${MAX_TERM_MONTHS} months`);
    }
  } else if (!(Number.isInteger(s.termYears) && s.termYears >= 1 && s.termYears <= 50)) problems.push('Term must be 1 to 50 whole years');
  if (!isValidISODate(s.openDate)) problems.push('Loan open date is not a valid date');
  if (!isValidISODate(s.firstPaymentDate)) problems.push('First payment date is not a valid date');
  if (isValidISODate(s.openDate) && isValidISODate(s.firstPaymentDate) && s.openDate > s.firstPaymentDate) {
    problems.push('First payment date must be on or after the loan open date');
  }
  if (!(Number.isInteger(s.paymentDay) && s.paymentDay >= 1 && s.paymentDay <= 31)) problems.push('Payment day must be 1 to 31');
  if (s.piPaymentOverride !== null && (!isCents(s.piPaymentOverride) || s.piPaymentOverride <= 0)) {
    problems.push('P&I override must be more than zero, or empty to use the calculated payment');
  }
  const modules = modulesOf(s);
  if (modules.pmi && (!isCents(s.originalHomeValue) || s.originalHomeValue <= 0)) problems.push('Original home value must be more than zero');
  if (!modules.pmi && !isCents(s.originalHomeValue)) problems.push('Original home value must be zero or more');
  if (!isCents(s.pmiMonthly)) problems.push('Monthly PMI must be zero or more');
  if (s.pmiStartDate !== null && !isValidISODate(s.pmiStartDate)) problems.push('PMI start date is not a valid date');
  if (!['auto78Scheduled', 'auto78Actual', 'request80'].includes(s.pmiRemovalRule)) problems.push('Unknown PMI removal rule');
  if (!isCents(s.escrowMonthly)) problems.push('Monthly escrow must be zero or more');
  if (!isCents(s.extraPrincipal)) problems.push('Extra principal must be zero or more');
  const start = s.startingPoint;
  if (start) {
    if (!(Number.isInteger(start.payment) && start.payment >= 1 && (!Number.isInteger(term) || start.payment < term))) {
      problems.push('Tracking has to start after a payment within the term');
    }
    if (!isCents(start.balance) || start.balance <= 0) problems.push('The balance when tracking starts must be more than zero');
    else if (isCents(s.originalAmount) && start.balance > s.originalAmount) {
      problems.push('The balance when tracking starts can\'t be more than the original loan amount');
    }
  }
  if (s.modules !== undefined && !(typeof s.modules === 'object' && typeof s.modules.pmi === 'boolean' && typeof s.modules.escrow === 'boolean')) {
    problems.push('Modules must say whether PMI and escrow are on');
  }
  if (s.interestMethod !== undefined && s.interestMethod !== 'monthly' && s.interestMethod !== 'daily') {
    problems.push('Interest method must be monthly or daily');
  }
  if (s.downPayment !== undefined && s.downPayment !== null && !isCents(s.downPayment)) problems.push('Down payment must be zero or more');
  if (s.fees !== undefined) {
    if (!Array.isArray(s.fees) || s.fees.length > 20) problems.push('Keep one-off fees to 20 or fewer');
    else {
      for (const f of s.fees) {
        if (!f || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 80) problems.push('Every fee needs a name of up to 80 characters');
        else if (!isCents(f.amount)) problems.push(`Fee "${f.label}" must be zero or more`);
        else if (typeof f.financed !== 'boolean') problems.push(`Fee "${f.label}" must say whether it was financed`);
      }
    }
  }
  const yf = s.yearlyFee;
  if (yf !== undefined && yf !== null) {
    if (yf.basis !== 'original' && yf.basis !== 'balance') problems.push('The yearly fee is a percent of the original amount or of the balance');
    if (!(typeof yf.percent === 'number' && yf.percent >= 0 && yf.percent <= 20)) problems.push('The yearly fee must be 0 to 20 percent');
  }
  const quote = s.payoffQuote;
  if (quote !== undefined && quote !== null) {
    if (!isCents(quote.amount) || quote.amount <= 0) problems.push('The payoff quote must be more than zero');
    if (!isValidISODate(quote.goodThrough)) problems.push('The payoff quote needs a valid "good through" date');
  }
  return problems;
}

/** Most recent "from payment N onward" value in effect at payment `k`. */
function valueFrom(
  adjustments: readonly Adjustment[],
  kind: 'standingExtra' | 'escrow' | 'pmi',
  k: number,
  fallback: Cents,
): { amount: Cents; fromPayment: number | null } {
  let best: { amount: Cents; fromPayment: number | null } = { amount: fallback, fromPayment: null };
  for (const a of adjustments) {
    // Later entries win ties, so a newer correction replaces an older one.
    if (a.kind === kind && a.fromPayment <= k && (best.fromPayment === null || a.fromPayment >= best.fromPayment)) {
      best = { amount: a.amount, fromPayment: a.fromPayment };
    }
  }
  return best;
}

function sumFor(adjustments: readonly Adjustment[], kind: 'pennyOffset' | 'extraPrincipal', k: number): Cents {
  let total = 0;
  for (const a of adjustments) if (a.kind === kind && a.payment === k) total += a.amount;
  return total;
}

function skipAt(adjustments: readonly Adjustment[], k: number): SkipMode | null {
  let mode: SkipMode | null = null;
  for (const a of adjustments) if (a.kind === 'skip' && a.payment === k) mode = a.mode;
  return mode;
}

/** Fields a row has when nothing was skipped. */
const NOT_SKIPPED = { skipped: null, capitalizedInterest: 0, deferred: 0, deferredRepaid: 0, pastDue: 0, catchUp: null } as const;

const noParts = (): PaymentParts => ({ principal: 0, interest: 0, pmi: 0, escrow: 0, total: 0 });
function addParts(a: PaymentParts, b: PaymentParts) {
  a.principal += b.principal;
  a.interest += b.interest;
  a.pmi += b.pmi;
  a.escrow += b.escrow;
  a.total += b.total;
}

/** Split `pool` into `n` installments: even shares, any remainder on the last. */
function splitParts(pool: PaymentParts, n: number): PaymentParts[] {
  const keys = ['principal', 'interest', 'pmi', 'escrow'] as const;
  return Array.from({ length: n }, (_, i) => {
    const part = noParts();
    for (const k of keys) {
      const share = Math.floor(pool[k] / n);
      part[k] = i === n - 1 ? pool[k] - share * (n - 1) : share;
    }
    part.total = part.principal + part.interest + part.pmi + part.escrow;
    return part;
  });
}

/**
 * Place catch-up payments. Each `catchUp` skip adds its missed payment to a
 * past-due pool; a plan spreads the pool present at its start over its
 * months. A planned month that is itself skipped goes back into the pool.
 * Whatever is never planned is due with the final payment.
 */
function applyCatchUp(rows: ScheduleRow[], adjustments: readonly Adjustment[]) {
  const plans = new Map<number, number>();
  for (const a of adjustments) if (a.kind === 'catchUpPlan') plans.set(a.fromPayment, a.months);
  let pool = noParts();
  const due = new Map<number, PaymentParts>();

  for (const row of rows) {
    const months = plans.get(row.payment);
    if (months && pool.total > 0) {
      splitParts(pool, months).forEach((part, i) => {
        const existing = due.get(row.payment + i);
        if (existing) addParts(existing, part);
        else due.set(row.payment + i, part);
      });
      pool = noParts();
    }
    const share = due.get(row.payment);
    due.delete(row.payment);
    if (row.skipped === 'catchUp') {
      const missed = { principal: row.scheduledPrincipal, interest: row.interest, pmi: row.pmi, escrow: row.escrow, total: row.pastDue };
      addParts(pool, missed);
    }
    if (!share) continue;
    // A locked row already carries what was actually paid back.
    if (row.skipped || row.locked) {
      if (row.skipped) addParts(pool, share);
      continue;
    }
    row.catchUp = share;
    row.total += share.total;
  }

  for (const rest of due.values()) addParts(pool, rest);
  const last = rows.at(-1);
  if (last && pool.total > 0 && !last.skipped && !last.locked) {
    if (last.catchUp) addParts(last.catchUp, pool);
    else last.catchUp = pool;
    last.total += pool.total;
  }
}

/**
 * Charge the yearly fee with the first payment of each loan year. A fee
 * that falls on a skipped month moves to the next payment that is made; a
 * reconciled month keeps whatever fee it was locked with.
 */
function applyYearlyFee(rows: ScheduleRow[], setup: LoanSetup) {
  const fee = setup.yearlyFee;
  if (!fee || !(fee.percent > 0)) return;
  let pending = 0;
  for (const row of rows) {
    if ((row.payment - 1) % 12 === 0) {
      const basis = fee.basis === 'balance' ? row.beginningBalance : setup.originalAmount;
      pending += roundCents((basis * fee.percent) / 100);
    }
    if (row.locked) {
      pending = Math.max(0, pending - row.fee);
      continue;
    }
    if (row.skipped || pending === 0) continue;
    row.fee = pending;
    row.total += pending;
    pending = 0;
  }
}

export function standingExtraAt(setup: LoanSetup, adjustments: readonly Adjustment[], k: number): Cents {
  return valueFrom(adjustments, 'standingExtra', k, setup.extraPrincipal).amount;
}

/** Balance-only pass. PMI is filled in afterwards because it never affects principal. */
function amortize(
  setup: LoanSetup,
  pi: Cents,
  adjustments: readonly Adjustment[],
  locked: ReadonlyMap<number, LockedPayment>,
  withExtras: boolean,
  paidDates: ReadonlyMap<number, ISODate> = new Map(),
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const termMonths = termMonthsOf(setup);
  const escrowOn = modulesOf(setup).escrow;
  const daily = setup.interestMethod === 'daily';
  // The original schedule knows nothing of what happened before tracking.
  const start = withExtras ? (setup.startingPoint ?? null) : null;
  let balance = setup.originalAmount;
  let deferredBalance = 0;
  // Daily interest runs from the previous payment's date (the open date for the first).
  let lastDate = setup.openDate;
  let capitalizedSkips = 0;
  const escrowAt = (k: number) => (escrowOn ? valueFrom(adjustments, 'escrow', k, setup.escrowMonthly).amount : 0);

  for (let k = 1; balance > 0; k++) {
    if (k > MAX_PAYMENTS) {
      throw new SetupError([`The loan does not pay off within ${MAX_PAYMENTS} payments; check the P&I payment`]);
    }
    const dueDate = dueDateFor(setup.firstPaymentDate, setup.paymentDay, k);
    const lock = locked.get(k);
    const periodEnd = (withExtras && paidDates.get(k)) || dueDate;
    const periodStart = lastDate;
    lastDate = periodEnd;

    if (lock) {
      const principal = Math.min(lock.principal, balance);
      // Locks saved before skips or fees existed lack those fields.
      rows.push({
        ...NOT_SKIPPED,
        ...lock,
        fee: (lock.fee as Cents | undefined) ?? 0,
        payment: k,
        dueDate,
        beginningBalance: balance,
        principal,
        endingBalance: balance - principal,
        locked: true,
        beforeTracking: false,
      });
      balance -= principal;
      continue;
    }

    // Before tracking, payments follow the original schedule: no skips, offsets or extras.
    const beforeTracking = start !== null && k <= start.payment;
    const skip = withExtras && !beforeTracking ? skipAt(adjustments, k) : null;
    const interest = daily
      ? dailyInterest(balance, setup.annualRatePercent, Math.max(0, daysBetween(periodStart, periodEnd)))
      : monthlyInterest(balance, setup.annualRatePercent);
    const empty = {
      payment: k,
      dueDate,
      beginningBalance: balance,
      extraPrincipal: 0,
      pennyOffset: 0,
      pmi: 0,
      escrow: 0,
      fee: 0,
      total: 0,
      locked: false,
      beforeTracking: false,
    };

    if (skip === 'capitalize') {
      rows.push({
        ...empty,
        ...NOT_SKIPPED,
        interest: 0,
        scheduledPrincipal: 0,
        principal: 0,
        principalAndInterest: 0,
        endingBalance: balance + interest,
        skipped: 'capitalize',
        capitalizedInterest: interest,
      });
      balance += interest;
      capitalizedSkips++;
      continue;
    }

    let scheduledPrincipal = pi - interest;
    if (scheduledPrincipal <= 0) {
      throw new SetupError([
        `Payment ${k}: the P&I payment does not cover the month's interest, so the loan would never pay off`,
      ]);
    }
    scheduledPrincipal = Math.min(scheduledPrincipal, balance);
    // Rounding the payment to the cent leaves a few cents over at the end of
    // the term. Like lenders do, fold that residue into the final payment
    // instead of creating a tiny extra one. Only a small residue: after a
    // skipped payment the loan genuinely runs longer.
    if (k >= termMonths && balance - scheduledPrincipal <= Math.max(100, Math.round(pi * 0.02))) scheduledPrincipal = balance;
    // Daily interest makes the residue depend on the calendar, so the
    // scheduled last payment always settles the loan (later if interest was
    // added by skips).
    if (daily && k >= termMonths + capitalizedSkips) scheduledPrincipal = balance;

    if (skip === 'defer' || skip === 'catchUp') {
      // The balance moves as if this installment were paid; what's missed is
      // tracked separately (deferred to payoff, or past due until caught up).
      const missedPi = scheduledPrincipal + interest;
      const catchUp = skip === 'catchUp';
      const escrow = catchUp ? escrowAt(k) : 0;
      rows.push({
        ...empty,
        ...NOT_SKIPPED,
        interest,
        scheduledPrincipal,
        principal: scheduledPrincipal,
        principalAndInterest: missedPi,
        escrow,
        endingBalance: balance - scheduledPrincipal,
        skipped: skip,
        deferred: catchUp ? 0 : missedPi,
        // PMI is added to this once it's known, below.
        pastDue: catchUp ? missedPi + escrow : 0,
      });
      balance -= scheduledPrincipal;
      if (!catchUp) deferredBalance += missedPi;
      continue;
    }

    let pennyOffset = withExtras && !beforeTracking ? sumFor(adjustments, 'pennyOffset', k) : 0;
    pennyOffset = Math.max(-scheduledPrincipal, Math.min(pennyOffset, balance - scheduledPrincipal));

    let extra: Cents;
    if (beforeTracking) {
      // Whatever the original schedule doesn't explain was paid as extra
      // principal at some point before tracking. Recorded on the last payment
      // before tracking so the balance lands on the statement's.
      extra = k === start!.payment ? balance - scheduledPrincipal - start!.balance : 0;
    } else {
      extra = withExtras ? standingExtraAt(setup, adjustments, k) + sumFor(adjustments, 'extraPrincipal', k) : 0;
      extra = Math.max(0, Math.min(extra, balance - scheduledPrincipal - pennyOffset));
    }

    const principal = scheduledPrincipal + pennyOffset + extra;
    const escrow = escrowAt(k);
    const principalAndInterest = scheduledPrincipal + interest;

    rows.push({
      payment: k,
      dueDate,
      beginningBalance: balance,
      interest,
      scheduledPrincipal,
      extraPrincipal: extra,
      pennyOffset,
      principal,
      principalAndInterest,
      pmi: 0,
      escrow,
      fee: 0,
      total: principalAndInterest + extra + pennyOffset + escrow,
      endingBalance: balance - principal,
      locked: false,
      beforeTracking,
      ...NOT_SKIPPED,
    });
    balance -= principal;
  }
  // Deferred payments come due in one lump sum with the final payment.
  const last = rows.at(-1);
  if (last && deferredBalance > 0) {
    last.deferredRepaid = deferredBalance;
    last.total += deferredBalance;
  }
  return rows;
}

function milestone(rows: readonly ScheduleRow[], threshold: Cents, setup: LoanSetup): PmiMilestone {
  if (setup.originalAmount <= threshold) return { thresholdBalance: threshold, payment: 0, dueDate: setup.openDate };
  const row = rows.find((r) => r.endingBalance <= threshold);
  return { thresholdBalance: threshold, payment: row?.payment ?? null, dueDate: row?.dueDate ?? null };
}

/** First payment *after* a milestone, i.e. the first one without PMI. */
const after = (m: PmiMilestone) => (m.payment === null ? Infinity : m.payment + 1);

export function generateSchedule(setup: LoanSetup, options: GenerateOptions = {}): Schedule {
  const problems = validateSetup(setup);
  if (problems.length) throw new SetupError(problems);

  const adjustments = options.adjustments ?? [];
  const locked = options.locked ?? new Map<number, LockedPayment>();
  const months = termMonthsOf(setup);
  const pmiOn = modulesOf(setup).pmi;
  const calculatedPiPayment = standardPayment(setup.originalAmount, setup.annualRatePercent, months);
  const piPayment = setup.piPaymentOverride ?? calculatedPiPayment;

  const rows = amortize(setup, piPayment, adjustments, locked, true, options.paidDates);
  const start = setup.startingPoint;
  if (start && rows.length <= start.payment) {
    throw new SetupError([`The original schedule pays the loan off by payment ${rows.length}, before tracking starts`]);
  }
  // The original schedule: contractual payment only, no extras or corrections.
  const original = amortize(setup, piPayment, [], new Map(), false);

  const t80 = roundCents(setup.originalHomeValue * 0.8);
  const t78 = roundCents(setup.originalHomeValue * 0.78);
  const request80 = milestone(rows, t80, setup);
  const auto78Actual = milestone(rows, t78, setup);
  const auto78Scheduled = milestone(original, t78, setup);
  const request80Scheduled = milestone(original, t80, setup);
  const midpointPayment = Math.ceil(months / 2);
  const midpoint = { payment: midpointPayment, dueDate: dueDateFor(setup.firstPaymentDate, setup.paymentDay, midpointPayment) };

  const ruleDrop = { auto78Scheduled: after(auto78Scheduled), auto78Actual: after(auto78Actual), request80: after(request80) }[
    setup.pmiRemovalRule
  ];
  // Federal backstops always apply: automatic termination and the midpoint.
  const plannedDrop = Math.min(ruleDrop, after(auto78Scheduled), midpointPayment + 1);
  const pmiStart = setup.pmiStartDate ?? setup.firstPaymentDate;

  for (const row of rows) {
    // Interest-added and deferred skips collect no PMI. A catch-up skip still
    // owes it, as part of the past-due amount.
    if (!pmiOn || row.locked || (row.skipped && row.skipped !== 'catchUp')) continue;
    const set = valueFrom(adjustments, 'pmi', row.payment, setup.pmiMonthly);
    // A PMI change recorded on or after the planned drop means the servicer is
    // still charging it, so reality overrides the plan from that payment on.
    const servicerStillCharging = set.fromPayment !== null && set.fromPayment >= plannedDrop;
    const active = row.dueDate >= pmiStart && (row.payment < plannedDrop || servicerStillCharging);
    row.pmi = active ? set.amount : 0;
    if (row.skipped) row.pastDue += row.pmi;
    else row.total += row.pmi;
  }
  applyYearlyFee(rows, setup);
  applyCatchUp(rows, adjustments);

  let lastPmi = -1;
  rows.forEach((r, i) => {
    if (r.pmi > 0) lastPmi = i;
  });
  const hasPmi = lastPmi >= 0;
  const dropRow = hasPmi ? rows[lastPmi + 1] : undefined;

  const pmi: PmiInfo = {
    hasPmi,
    request80,
    auto78Actual,
    auto78Scheduled,
    request80Scheduled,
    midpoint,
    dropPayment: dropRow?.payment ?? null,
    dropDate: dropRow?.dueDate ?? null,
    paymentsSavedByExtra:
      request80.payment !== null && request80Scheduled.payment !== null
        ? Math.max(0, request80Scheduled.payment - request80.payment)
        : 0,
  };

  // What's actually collected: skipped months pay nothing, catch-up payments
  // pay the missed parts later.
  const totals = rows.reduce(
    (t, r) => ({
      interest: t.interest + (r.skipped ? 0 : r.interest) + (r.catchUp?.interest ?? 0),
      principal: t.principal + (r.skipped ? 0 : r.principal) + (r.catchUp?.principal ?? 0),
      pmi: t.pmi + (r.skipped ? 0 : r.pmi) + (r.catchUp?.pmi ?? 0),
      escrow: t.escrow + (r.skipped ? 0 : r.escrow) + (r.catchUp?.escrow ?? 0),
      fees: t.fees + r.fee,
      payments: t.payments + (r.skipped ? 0 : 1),
      capitalizedInterest: t.capitalizedInterest + r.capitalizedInterest,
      deferred: t.deferred + r.deferred,
      pastDue: t.pastDue + r.pastDue,
    }),
    { interest: 0, principal: 0, pmi: 0, escrow: 0, fees: 0, payments: 0, capitalizedInterest: 0, deferred: 0, pastDue: 0 },
  );

  return { piPayment, calculatedPiPayment, rows, pmi, totals };
}

/** Freeze a generated row so later setup edits or adjustments can't change it. */
export function lockRow(row: ScheduleRow): LockedPayment {
  if (row.skipped) throw new Error(`Payment ${row.payment} is skipped and can't be locked as paid`);
  if (row.beforeTracking) throw new Error(`Payment ${row.payment} was made before tracking began and can't be locked`);
  const { beginningBalance: _b, endingBalance: _e, locked: _l, dueDate: _d, beforeTracking: _t, ...rest } = row;
  return rest;
}
