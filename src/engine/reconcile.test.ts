import { describe, expect, it } from 'vitest';
import {
  compareToSchedule,
  generateSchedule,
  resolutionToAdjustment,
  ResolutionError,
  summarize,
  type Adjustment,
  type LoanSetup,
  type Resolution,
} from './index.js';

// Made-up sample loan. Not real numbers.
const loan: LoanSetup = {
  originalAmount: 32_000_000,
  annualRatePercent: 6.5,
  termYears: 30,
  openDate: '2025-02-14',
  firstPaymentDate: '2025-04-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 35_500_000,
  pmiMonthly: 14_800,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 41_250,
  extraPrincipal: 0,
};

/** Simulate the full flag-and-ask loop for one month. */
function reconcile(k: number, bankAmount: number, resolution: Resolution, standing = false) {
  const before = generateSchedule(loan);
  const row = before.rows[k - 1]!;
  const cmp = compareToSchedule(row, -bankAmount); // Actual stores payments as negative amounts
  const adj = resolutionToAdjustment(loan, [], row, cmp.difference, resolution, { standing });
  const after = generateSchedule(loan, { adjustments: [adj] });
  return { before, after, adj, cmp };
}

describe('compareToSchedule', () => {
  const row = generateSchedule(loan).rows[0]!;

  it('matches an exact payment regardless of sign', () => {
    expect(compareToSchedule(row, -row.total)).toMatchObject({ matches: true, difference: 0 });
    expect(compareToSchedule(row, row.total).matches).toBe(true);
  });

  it('reports the signed difference when it does not match', () => {
    expect(compareToSchedule(row, -(row.total + 7))).toMatchObject({ matches: false, difference: 7 });
    expect(compareToSchedule(row, -(row.total - 7)).difference).toBe(-7);
  });
});

describe('each answer reshapes the schedule differently', () => {
  const scheduled = generateSchedule(loan).rows[4]!.total;

  it('rounding: this month only, and the month now matches', () => {
    const { after, adj } = reconcile(5, scheduled + 2, 'rounding');
    expect(adj).toEqual({ kind: 'pennyOffset', payment: 5, amount: 2 });
    expect(after.rows[4]!.total).toBe(scheduled + 2);
    expect(after.rows[5]!.pennyOffset).toBe(0);
  });

  it('rounding is refused for more than a dollar', () => {
    expect(() => reconcile(5, scheduled + 101, 'rounding')).toThrow(ResolutionError);
  });

  it('escrow: new amount from this month onward', () => {
    const { after, adj } = reconcile(5, scheduled + 3_125, 'escrow');
    expect(adj).toEqual({ kind: 'escrow', fromPayment: 5, amount: 44_375 });
    expect(after.rows[3]!.escrow).toBe(41_250);
    expect(after.rows[4]!.escrow).toBe(44_375);
    expect(after.rows[50]!.escrow).toBe(44_375);
    expect(after.rows[4]!.total).toBe(scheduled + 3_125);
  });

  it('pmi: new amount from this month onward', () => {
    const { after, adj } = reconcile(5, scheduled - 800, 'pmi');
    expect(adj).toEqual({ kind: 'pmi', fromPayment: 5, amount: 14_000 });
    expect(after.rows[4]!.pmi).toBe(14_000);
    expect(after.rows[20]!.pmi).toBe(14_000);
    expect(after.rows[4]!.total).toBe(scheduled - 800);
  });

  it('extra principal (one-time): later balances and interest recalculate', () => {
    const { before, after, adj } = reconcile(5, scheduled + 50_000, 'extraPrincipal');
    expect(adj).toEqual({ kind: 'extraPrincipal', payment: 5, amount: 50_000 });
    expect(after.rows[4]!.total).toBe(scheduled + 50_000);
    expect(after.rows[5]!.extraPrincipal).toBe(0);
    expect(after.rows[5]!.interest).toBeLessThan(before.rows[5]!.interest);
    expect(after.rows.length).toBeLessThan(before.rows.length);
  });

  it('extra principal (standing): repeats every month onward', () => {
    const { after, adj } = reconcile(5, scheduled + 10_000, 'extraPrincipal', true);
    expect(adj).toEqual({ kind: 'standingExtra', fromPayment: 5, amount: 10_000 });
    expect(after.rows[3]!.extraPrincipal).toBe(0);
    expect(after.rows[4]!.extraPrincipal).toBe(10_000);
    expect(after.rows[40]!.extraPrincipal).toBe(10_000);
  });

  it('standing extra builds on an existing standing amount', () => {
    const withExtra = { ...loan, extraPrincipal: 5_000 };
    const row = generateSchedule(withExtra).rows[4]!;
    const adj = resolutionToAdjustment(withExtra, [], row, 2_500, 'extraPrincipal', { standing: true });
    expect(adj).toEqual({ kind: 'standingExtra', fromPayment: 5, amount: 7_500 });
  });

  it('refuses to call a short payment extra principal', () => {
    expect(() => reconcile(5, scheduled - 100, 'extraPrincipal')).toThrow(ResolutionError);
  });

  it('refuses to make escrow or PMI negative', () => {
    expect(() => reconcile(5, scheduled - 50_000, 'escrow')).toThrow(ResolutionError);
    expect(() => reconcile(5, scheduled - 20_000, 'pmi')).toThrow(ResolutionError);
  });
});

describe('summary', () => {
  const adjustments: Adjustment[] = [];
  const s = generateSchedule(loan, { adjustments });

  it('starts at the original balance before anything is reconciled', () => {
    const sum = summarize(loan, s, new Set(), '2025-03-01');
    expect(sum.lastPaidPayment).toBeNull();
    expect(sum.balance).toBe(loan.originalAmount);
    expect(sum.percentPaid).toBe(0);
    expect(sum.equity).toBe(loan.originalHomeValue - loan.originalAmount);
    expect(sum.nextPayment).toMatchObject({ payment: 1, dueDate: '2025-04-01', daysUntil: 31 });
    expect(sum.pmi.active).toBe(true);
    expect(sum.pmi.paymentsUntilDrop).toBe(s.pmi.dropPayment! - 1);
  });

  it('tracks reconciled payments, equity, and the scheduled balance', () => {
    const sum = summarize(loan, s, new Set([1, 2, 3]), '2025-06-15');
    expect(sum.lastPaidPayment).toBe(3);
    expect(sum.balance).toBe(s.rows[2]!.endingBalance);
    expect(sum.scheduledBalance).toBe(s.rows[2]!.endingBalance);
    expect(sum.equity).toBe(loan.originalHomeValue - s.rows[2]!.endingBalance);
    expect(sum.percentPaid).toBeGreaterThan(0);
    expect(sum.nextPayment!.payment).toBe(4);
  });

  it('reports PMI as finished after the drop', () => {
    const drop = s.pmi.dropPayment!;
    const paid = new Set(Array.from({ length: drop }, (_, i) => i + 1));
    const sum = summarize(loan, s, paid, s.rows[drop - 1]!.dueDate);
    expect(sum.pmi.active).toBe(false);
    expect(sum.pmi.monthly).toBe(0);
    expect(sum.pmi.paymentsUntilDrop).toBe(0);
  });
});
