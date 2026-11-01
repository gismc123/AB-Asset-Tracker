import { describe, expect, it } from 'vitest';
import { generateSchedule, lockRow, recalculateLocks, type LoanSetup, type LockedPayment } from './index.js';

// Made-up loan. 7.3% a year is exactly 0.02% a day.
const loan: LoanSetup = {
  originalAmount: 2_500_000,
  annualRatePercent: 7.3,
  termYears: 5,
  termMonths: 60,
  openDate: '2025-01-15',
  firstPaymentDate: '2025-02-15',
  paymentDay: 15,
  piPaymentOverride: null,
  originalHomeValue: 0,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 0,
  extraPrincipal: 0,
  modules: { pmi: false, escrow: false },
  interestMethod: 'daily',
};

/** Lock payments 1..n as paid on their due dates under `setup`, the way matching does. */
function lockFirst(setup: LoanSetup, n: number) {
  const rows = generateSchedule(setup).rows;
  const locked = new Map<number, LockedPayment>(rows.slice(0, n).map((r) => [r.payment, lockRow(r)]));
  const paid = rows.slice(0, n).map((r) => ({ payment: r.payment, amount: r.total }));
  return { locked, paid };
}

describe('recalculating reconciled months', () => {
  it('changes nothing when the locks already agree', () => {
    const { locked, paid } = lockFirst(loan, 3);
    const r = recalculateLocks(loan, { locked }, paid);
    expect(r.changes).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.locks).toEqual(locked);
  });

  it('works each month out again from the balance the one before leaves', () => {
    const { locked, paid } = lockFirst(loan, 3);
    // The rate was entered wrong; the payment amount is right.
    const fixed = { ...loan, annualRatePercent: 3.65, piPaymentOverride: paid[0]!.amount };
    const r = recalculateLocks(fixed, { locked }, paid);
    expect(r.changes.map((c) => c.payment)).toEqual([1, 2, 3]);
    expect(r.changes.every((c) => c.difference === 0)).toBe(true);
    // Jan 15 to Feb 15 at 0.01% a day.
    expect(r.changes[0]!.after.interest).toBe(7_750);
    expect(r.changes[0]!.before.interest).toBe(15_500);
    const rows = r.schedule.rows;
    expect(rows[1]!.interest).toBe(Math.round(rows[0]!.endingBalance * 0.0001 * 28));
    expect(rows.slice(0, 3).every((row) => row.locked && row.total === paid[0]!.amount)).toBe(true);
  });

  it('keeps what was paid when the payment changed, putting the difference on principal', () => {
    const { locked, paid } = lockFirst(loan, 2);
    // A shorter term alone changes nothing already paid: the interest on those dates is the same.
    expect(recalculateLocks({ ...loan, termMonths: 48 }, { locked }, paid).changes).toEqual([]);
    const shorter = { ...loan, termMonths: 48, annualRatePercent: 3.65 };
    const r = recalculateLocks(shorter, { locked }, paid);
    const expected = generateSchedule(shorter).rows[0]!.total;
    expect(r.changes[0]!.difference).toBe(paid[0]!.amount - expected);
    expect(r.changes[0]!.difference).toBeLessThan(0);
    const row = r.schedule.rows[0]!;
    expect(row.total).toBe(paid[0]!.amount);
    expect(row.pennyOffset).toBe(r.changes[0]!.difference);
    expect(row.endingBalance).toBe(2_500_000 - (paid[0]!.amount - row.interest));
  });

  it('picks up interest that built through a skipped month', () => {
    const skip = { kind: 'skip' as const, payment: 2, mode: 'capitalize' as const };
    const paidDates = new Map([[1, '2025-02-15'], [3, '2025-04-15']]);
    const rows = generateSchedule(loan, { adjustments: [skip], paidDates }).rows;
    // Payment 3 locked with only its own month's interest, as an older version would have.
    const stale = { ...lockRow(rows[2]!), interest: rows[2]!.interest - 5_000, scheduledPrincipal: rows[2]!.scheduledPrincipal + 5_000, principal: rows[2]!.principal + 5_000 };
    const locked = new Map([[1, lockRow(rows[0]!)], [3, stale]]);
    const r = recalculateLocks(loan, { adjustments: [skip], locked, paidDates }, [
      { payment: 1, amount: rows[0]!.total },
      { payment: 3, amount: rows[2]!.total },
    ]);
    expect(r.changes.map((c) => c.payment)).toEqual([3]);
    expect(r.changes[0]!.after.interest).toBe(rows[2]!.interest);
    expect(r.schedule.rows[2]!.endingBalance).toBe(rows[2]!.endingBalance);
  });

  it("won't recalculate a month whose payment no longer covers the interest", () => {
    const { locked } = lockFirst(loan, 1);
    const r = recalculateLocks(loan, { locked }, [{ payment: 1, amount: 100 }]);
    expect(r.problems).toEqual([{ payment: 1, message: expect.stringMatching(/no longer covers the interest/) }]);
  });
});
