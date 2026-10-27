import { dueDateFor, isValidISODate } from './dates.js';
import { monthlyInterest, roundCents, standardPayment } from './money.js';
import type {
  Adjustment,
  Cents,
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
}

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
  if (!(Number.isInteger(s.termYears) && s.termYears >= 1 && s.termYears <= 50)) problems.push('Term must be 1 to 50 whole years');
  if (!isValidISODate(s.openDate)) problems.push('Loan open date is not a valid date');
  if (!isValidISODate(s.firstPaymentDate)) problems.push('First payment date is not a valid date');
  if (isValidISODate(s.openDate) && isValidISODate(s.firstPaymentDate) && s.openDate > s.firstPaymentDate) {
    problems.push('First payment date must be on or after the loan open date');
  }
  if (!(Number.isInteger(s.paymentDay) && s.paymentDay >= 1 && s.paymentDay <= 31)) problems.push('Payment day must be 1 to 31');
  if (s.piPaymentOverride !== null && (!isCents(s.piPaymentOverride) || s.piPaymentOverride <= 0)) {
    problems.push('P&I override must be more than zero, or empty to use the calculated payment');
  }
  if (!isCents(s.originalHomeValue) || s.originalHomeValue <= 0) problems.push('Original home value must be more than zero');
  if (!isCents(s.pmiMonthly)) problems.push('Monthly PMI must be zero or more');
  if (s.pmiStartDate !== null && !isValidISODate(s.pmiStartDate)) problems.push('PMI start date is not a valid date');
  if (!['auto78Scheduled', 'auto78Actual', 'request80'].includes(s.pmiRemovalRule)) problems.push('Unknown PMI removal rule');
  if (!isCents(s.escrowMonthly)) problems.push('Monthly escrow must be zero or more');
  if (!isCents(s.extraPrincipal)) problems.push('Extra principal must be zero or more');
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
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const termMonths = setup.termYears * 12;
  let balance = setup.originalAmount;
  let deferredBalance = 0;

  for (let k = 1; balance > 0; k++) {
    if (k > MAX_PAYMENTS) {
      throw new SetupError([`The loan does not pay off within ${MAX_PAYMENTS} payments; check the P&I payment`]);
    }
    const dueDate = dueDateFor(setup.firstPaymentDate, setup.paymentDay, k);
    const lock = locked.get(k);

    if (lock) {
      const principal = Math.min(lock.principal, balance);
      // Locks saved before skips existed lack the skip fields.
      rows.push({ ...NOT_SKIPPED, ...lock, payment: k, dueDate, beginningBalance: balance, principal, endingBalance: balance - principal, locked: true });
      balance -= principal;
      continue;
    }

    const skip = withExtras ? skipAt(adjustments, k) : null;
    const interest = monthlyInterest(balance, setup.annualRatePercent);
    const empty = { payment: k, dueDate, beginningBalance: balance, extraPrincipal: 0, pennyOffset: 0, pmi: 0, escrow: 0, total: 0, locked: false };

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

    if (skip === 'defer' || skip === 'catchUp') {
      // The balance moves as if this installment were paid; what's missed is
      // tracked separately (deferred to payoff, or past due until caught up).
      const missedPi = scheduledPrincipal + interest;
      const catchUp = skip === 'catchUp';
      const escrow = catchUp ? valueFrom(adjustments, 'escrow', k, setup.escrowMonthly).amount : 0;
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

    let pennyOffset = withExtras ? sumFor(adjustments, 'pennyOffset', k) : 0;
    pennyOffset = Math.max(-scheduledPrincipal, Math.min(pennyOffset, balance - scheduledPrincipal));

    let extra = withExtras
      ? standingExtraAt(setup, adjustments, k) + sumFor(adjustments, 'extraPrincipal', k)
      : 0;
    extra = Math.max(0, Math.min(extra, balance - scheduledPrincipal - pennyOffset));

    const principal = scheduledPrincipal + pennyOffset + extra;
    const escrow = valueFrom(adjustments, 'escrow', k, setup.escrowMonthly).amount;
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
      total: principalAndInterest + extra + pennyOffset + escrow,
      endingBalance: balance - principal,
      locked: false,
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
  const months = setup.termYears * 12;
  const calculatedPiPayment = standardPayment(setup.originalAmount, setup.annualRatePercent, months);
  const piPayment = setup.piPaymentOverride ?? calculatedPiPayment;

  const rows = amortize(setup, piPayment, adjustments, locked, true);
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
    if (row.locked || (row.skipped && row.skipped !== 'catchUp')) continue;
    const set = valueFrom(adjustments, 'pmi', row.payment, setup.pmiMonthly);
    // A PMI change recorded on or after the planned drop means the servicer is
    // still charging it, so reality overrides the plan from that payment on.
    const servicerStillCharging = set.fromPayment !== null && set.fromPayment >= plannedDrop;
    const active = row.dueDate >= pmiStart && (row.payment < plannedDrop || servicerStillCharging);
    row.pmi = active ? set.amount : 0;
    if (row.skipped) row.pastDue += row.pmi;
    else row.total += row.pmi;
  }
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
      payments: t.payments + (r.skipped ? 0 : 1),
      capitalizedInterest: t.capitalizedInterest + r.capitalizedInterest,
      deferred: t.deferred + r.deferred,
      pastDue: t.pastDue + r.pastDue,
    }),
    { interest: 0, principal: 0, pmi: 0, escrow: 0, payments: 0, capitalizedInterest: 0, deferred: 0, pastDue: 0 },
  );

  return { piPayment, calculatedPiPayment, rows, pmi, totals };
}

/** Freeze a generated row so later setup edits or adjustments can't change it. */
export function lockRow(row: ScheduleRow): LockedPayment {
  if (row.skipped) throw new Error(`Payment ${row.payment} is skipped and can't be locked as paid`);
  const { beginningBalance: _b, endingBalance: _e, locked: _l, dueDate: _d, ...rest } = row;
  return rest;
}
