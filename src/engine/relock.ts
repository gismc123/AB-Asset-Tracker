import { generateSchedule, lockRow, type GenerateOptions } from './amortize.js';
import type { Cents, LoanSetup, LockedPayment, Schedule } from './types.js';

/** A reconciled month: what the bank says was paid. */
export interface PaidMonth {
  payment: number;
  /** The bank transaction's amount, positive. */
  amount: Cents;
}

/** How one reconciled month's locked amounts would change. */
export interface RelockChange {
  payment: number;
  dueDate: string;
  before: { interest: Cents; principal: Cents; endingBalance: Cents };
  after: { interest: Cents; principal: Cents; endingBalance: Cents };
  /**
   * What was paid less what the schedule now expects for this month. Not
   * zero when the setup's payment changed: like a lender, the difference
   * goes to principal (more principal when positive, less when negative).
   */
  difference: Cents;
}

export interface Relock {
  /** New locks for every reconciled month, changed or not. */
  locks: Map<number, LockedPayment>;
  /** Months whose locked amounts would change, in payment order. */
  changes: RelockChange[];
  /** Months that can't be recalculated, and why. Nothing is saved while there are any. */
  problems: { payment: number; message: string }[];
  /** The schedule with the new locks. */
  schedule: Schedule;
}

/** The parts of a lock that move the balance or the payment. */
const KEYS = ['interest', 'principal', 'total', 'escrow', 'pmi', 'fee'] as const;
const same = (a: LockedPayment, b: LockedPayment) => KEYS.every((k) => ((a[k] as Cents | undefined) ?? 0) === ((b[k] as Cents | undefined) ?? 0));

/**
 * Work out reconciled months again with today's setup and math, in payment
 * order, each from the balance the one before leaves. The amount paid stays
 * what the bank says; how it splits between interest and principal is
 * recalculated. `options.locked` holds the current locks, for comparison.
 */
export function recalculateLocks(setup: LoanSetup, options: GenerateOptions, paid: readonly PaidMonth[]): Relock {
  const current = generateSchedule(setup, options);
  const old = options.locked ?? new Map<number, LockedPayment>();
  const locks = new Map<number, LockedPayment>();
  const differences = new Map<number, Cents>();
  const problems: Relock['problems'] = [];
  const fresh = () => generateSchedule(setup, { ...options, locked: locks });
  let schedule = fresh();

  for (const { payment, amount } of [...paid].sort((a, b) => a.payment - b.payment)) {
    const row = schedule.rows[payment - 1];
    if (!row || row.skipped || row.beforeTracking) {
      problems.push({ payment, message: `Payment ${payment} is no longer a payment on the schedule. Undo its match first.` });
      continue;
    }
    const lock = lockRow(row);
    const difference = amount - row.total;
    if (difference !== 0) {
      if (lock.principal + difference < 0) {
        problems.push({ payment, message: `Payment ${payment}: what was paid no longer covers the interest. Check the setup, or undo this month's match.` });
        continue;
      }
      if (difference > 0) lock.extraPrincipal += difference;
      else lock.pennyOffset += difference;
      lock.principal += difference;
      lock.total += difference;
      differences.set(payment, difference);
    }
    locks.set(payment, lock);
    // Later months start from the balance this one really leaves.
    if (difference !== 0) schedule = fresh();
  }

  schedule = fresh();
  const changes: RelockChange[] = [];
  for (const [payment, lock] of locks) {
    const was = old.get(payment);
    if (was && same(was, lock)) continue;
    const before = current.rows[payment - 1]!;
    const after = schedule.rows[payment - 1]!;
    changes.push({
      payment,
      dueDate: after.dueDate,
      before: { interest: before.interest, principal: before.principal, endingBalance: before.endingBalance },
      after: { interest: after.interest, principal: after.principal, endingBalance: after.endingBalance },
      difference: differences.get(payment) ?? 0,
    });
  }
  return { locks, changes, problems, schedule };
}
