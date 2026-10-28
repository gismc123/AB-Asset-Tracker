import { modulesOf, standingExtraAt } from './amortize.js';
import type { Adjustment, Cents, LoanSetup, ScheduleRow } from './types.js';

/** What the user says a payment difference was. */
export type Resolution = 'rounding' | 'escrow' | 'pmi' | 'extraPrincipal';

/** Largest difference accepted as a "rounding offset": one dollar. */
export const MAX_PENNY_OFFSET: Cents = 100;

export interface Comparison {
  scheduled: Cents;
  actual: Cents;
  /** actual - scheduled. Positive means you paid more than the schedule. */
  difference: Cents;
  matches: boolean;
}

/** Compare a bank amount (positive cents) against a schedule row. */
export function compareToSchedule(row: ScheduleRow, actualTotal: Cents): Comparison {
  const actual = Math.abs(actualTotal);
  return { scheduled: row.total, actual, difference: actual - row.total, matches: actual === row.total };
}

export class ResolutionError extends Error {}

export interface ResolveOptions {
  /** For extraPrincipal: keep paying this extra every month from now on. */
  standing?: boolean;
}

/**
 * Turn the user's answer for a flagged month into one schedule adjustment.
 * Each answer reshapes the schedule differently:
 *
 * - rounding:        this month only, the cents go to principal
 * - escrow:          new escrow amount from this month onward
 * - pmi:             new PMI amount from this month onward
 * - extraPrincipal:  one-time extra this month, or (standing) every month onward
 */
export function resolutionToAdjustment(
  setup: LoanSetup,
  existing: readonly Adjustment[],
  row: ScheduleRow,
  difference: Cents,
  resolution: Resolution,
  options: ResolveOptions = {},
): Adjustment {
  if (difference === 0) throw new ResolutionError('There is no difference to explain');
  const k = row.payment;

  switch (resolution) {
    case 'rounding':
      if (Math.abs(difference) > MAX_PENNY_OFFSET) {
        throw new ResolutionError(
          `A rounding offset can be at most $${(MAX_PENNY_OFFSET / 100).toFixed(2)}. ` +
            'For a bigger difference choose escrow, PMI, or extra principal.',
        );
      }
      return { kind: 'pennyOffset', payment: k, amount: difference };

    case 'escrow': {
      if (!modulesOf(setup).escrow) throw new ResolutionError('This loan has no escrow');
      const amount = row.escrow + difference;
      if (amount < 0) throw new ResolutionError('That would make escrow negative');
      return { kind: 'escrow', fromPayment: k, amount };
    }

    case 'pmi': {
      if (!modulesOf(setup).pmi) throw new ResolutionError('This loan has no PMI');
      const amount = row.pmi + difference;
      if (amount < 0) throw new ResolutionError('That would make PMI negative');
      return { kind: 'pmi', fromPayment: k, amount };
    }

    case 'extraPrincipal': {
      if (difference < 0) {
        throw new ResolutionError('You paid less than scheduled, so the difference cannot be extra principal');
      }
      if (difference > row.endingBalance) {
        throw new ResolutionError('That extra principal is more than the remaining balance');
      }
      if (options.standing) {
        return { kind: 'standingExtra', fromPayment: k, amount: standingExtraAt(setup, existing, k) + difference };
      }
      return { kind: 'extraPrincipal', payment: k, amount: difference };
    }

    default:
      throw new ResolutionError(`Unknown resolution "${String(resolution)}"`);
  }
}
