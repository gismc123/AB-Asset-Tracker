import { describe, expect, it } from 'vitest';
import { generateSchedule, lockRow } from './amortize.js';
import { analyzeEquity } from './equity.js';
import { periodBreakouts } from './periods.js';
import { summarize } from './summary.js';
import type { ExtraPayment, LoanSetup, LockedPayment } from './types.js';

/** Made-up loan: $12,000 at 12% for 12 months, monthly interest (1% a month). */
const MONTHLY: LoanSetup = {
  originalAmount: 1_200_000,
  annualRatePercent: 12,
  termYears: 1,
  termMonths: 12,
  openDate: '2025-01-01',
  firstPaymentDate: '2025-02-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 0,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 0,
  extraPrincipal: 0,
  modules: { pmi: false, escrow: false },
};

/** Made-up loan: $10,000 at 7.3%, daily interest. 7.3% / 365 is exactly 0.02% a day: $2.00 a day on $10,000. */
const DAILY: LoanSetup = { ...MONTHLY, originalAmount: 1_000_000, annualRatePercent: 7.3, interestMethod: 'daily' };

const extra = (id: number, date: string, amount: number): ExtraPayment => ({ id, date, amount });

describe('extra payments of their own, monthly interest', () => {
  const base = generateSchedule(MONTHLY);

  it('applies after the payment due on or before its date, and cuts interest from the next payment', () => {
    // Hand check: payment is $1,066.19; month 1 is $120.00 interest and $946.19 principal, leaving $11,053.81.
    expect(base.piPayment).toBe(106_619);
    expect(base.rows[0]).toMatchObject({ interest: 12_000, scheduledPrincipal: 94_619, endingBalance: 1_105_381 });
    expect(base.rows[1]!.interest).toBe(11_054);

    const s = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-02-15', 100_000)] });
    const r1 = s.rows[0]!;
    // The regular payment is unchanged (it's a separate transaction), the balance drops by $1,000.
    expect(r1).toMatchObject({ total: 106_619, interest: 12_000, scheduledPrincipal: 94_619, extraPayments: 100_000, principal: 194_619 });
    expect(r1.extraPaymentList).toEqual([extra(1, '2025-02-15', 100_000)]);
    expect(r1.endingBalance).toBe(1_005_381);
    // Next month: 1% of $10,053.81 = $100.54, not $110.54.
    expect(s.rows[1]!.interest).toBe(10_054);
  });

  it('moves the payoff date up and cuts total interest', () => {
    const s = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-02-15', 100_000)] });
    expect(base.rows).toHaveLength(12);
    expect(s.rows.length).toBe(11);
    expect(s.rows.at(-1)!.dueDate < base.rows.at(-1)!.dueDate).toBe(true);
    expect(s.totals.interest).toBeLessThan(base.totals.interest);
    // Every cent of principal is still paid back.
    expect(s.totals.principal).toBe(MONTHLY.originalAmount);
  });

  it('takes any number of extras in one month, each applied, in date order', () => {
    const s = generateSchedule(MONTHLY, {
      extraPayments: [extra(2, '2025-02-20', 5_000), extra(1, '2025-02-03', 10_000), extra(3, '2025-02-28', 2_500)],
    });
    expect(s.rows[0]!.extraPaymentList.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(s.rows[0]!.extraPayments).toBe(17_500);
    // Removing one leaves the others exactly as they were.
    const without2 = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-02-03', 10_000), extra(3, '2025-02-28', 2_500)] });
    expect(without2.rows[0]!.extraPaymentList).toEqual([extra(1, '2025-02-03', 10_000), extra(3, '2025-02-28', 2_500)]);
    expect(without2.rows[0]!.endingBalance - s.rows[0]!.endingBalance).toBe(5_000);
  });

  it('applies an extra before the first due date with the first payment', () => {
    const s = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-01-20', 50_000)] });
    expect(s.rows[0]!.extraPayments).toBe(50_000);
    expect(s.rows[0]!.interest).toBe(12_000);
  });

  it('never pays more than the balance', () => {
    const s = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-02-10', 5_000_000)] });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]!.extraPaymentList[0]!.amount).toBe(1_105_381);
    expect(s.rows[0]!.endingBalance).toBe(0);
  });

  it('leaves a reconciled month locked and applies the extra on top', () => {
    const lock = lockRow(base.rows[0]!);
    const locked = new Map<number, LockedPayment>([[1, lock]]);
    const s = generateSchedule(MONTHLY, { locked, extraPayments: [extra(1, '2025-02-15', 100_000)] });
    expect(s.rows[0]).toMatchObject({ locked: true, total: 106_619, interest: 12_000, extraPayments: 100_000, endingBalance: 1_005_381 });
    // Locking a row with an extra stores only the regular payment.
    const relocked = lockRow(s.rows[0]!);
    expect(relocked).toEqual(lock);
    expect('extraPayments' in relocked).toBe(false);
  });

  it('carries an extra from a skipped month to the next payment made', () => {
    const s = generateSchedule(MONTHLY, {
      adjustments: [{ kind: 'skip', payment: 2, mode: 'capitalize' }],
      extraPayments: [extra(1, '2025-03-10', 20_000)],
    });
    expect(s.rows[1]!.extraPayments).toBe(0);
    expect(s.rows[2]!.extraPayments).toBe(20_000);
  });

  it('ignores extras dated before tracking began: the starting balance already has them', () => {
    const start = { ...MONTHLY, startingPoint: { payment: 3, balance: 900_000 } };
    const s = generateSchedule(start, { extraPayments: [extra(1, '2025-03-15', 10_000), extra(2, '2025-04-02', 20_000)] });
    expect(s.rows.slice(0, 3).every((r) => r.extraPayments === 0)).toBe(true);
    expect(s.rows[2]!.endingBalance).toBe(900_000);
    expect(s.rows[3]!.extraPaymentList).toEqual([extra(2, '2025-04-02', 20_000)]);
  });
});

describe('extra payments of their own, daily interest', () => {
  it('cuts interest only for the days after the payment (hand-checked)', () => {
    const base = generateSchedule(DAILY);
    // Jan 1 to Feb 1 is 31 days at $2.00 a day.
    expect(base.rows[0]!.interest).toBe(6_200);

    // $2,000 on Jan 11: 10 days on $10,000 ($20.00) + 21 days on $8,000 ($33.60) = $53.60.
    const s = generateSchedule(DAILY, { extraPayments: [extra(1, '2025-01-11', 200_000)] });
    const r = s.rows[0]!;
    expect(r.interest).toBe(2_000 + 3_360);
    expect(r.extraPayments).toBe(200_000);
    expect(r.scheduledPrincipal).toBe(s.piPayment - 5_360);
    expect(r.total).toBe(s.piPayment);
    expect(r.endingBalance).toBe(800_000 - (s.piPayment - 5_360));
  });

  it('an extra after the regular payment splits the next period', () => {
    const base = generateSchedule(DAILY);
    const b1 = base.rows[0]!.endingBalance;
    // Feb 1 to Mar 1 is 28 days; $1,000 paid Feb 20: 19 days on b1, 9 days on b1 - $1,000.
    const s = generateSchedule(DAILY, { extraPayments: [extra(1, '2025-02-20', 100_000)] });
    expect(s.rows[0]!.extraPayments).toBe(0);
    const r2 = s.rows[1]!;
    expect(r2.extraPayments).toBe(100_000);
    expect(r2.interest).toBe(Math.round((b1 * 19 + (b1 - 100_000) * 9) * 0.0002));
    // Interest saved is the extra's 9 days: $1,000 x 9 x 0.02% = $1.80.
    expect(base.rows[1]!.interest - r2.interest).toBe(180);
  });

  it('uses the bank date of a matched payment as the end of the period', () => {
    const paidDates = new Map([[1, '2025-01-27']]);
    // Paid Jan 27; an extra on Jan 30 falls in period 2, after the payment.
    const s = generateSchedule(DAILY, { paidDates, extraPayments: [extra(1, '2025-01-30', 50_000)] });
    expect(s.rows[0]!.interest).toBe(26 * 200);
    expect(s.rows[0]!.extraPayments).toBe(0);
    expect(s.rows[1]!.extraPayments).toBe(50_000);
  });

  it('pays off sooner, and the last payment still settles the loan', () => {
    const s = generateSchedule(DAILY, { extraPayments: [extra(1, '2025-03-05', 250_000)] });
    expect(s.rows.length).toBeLessThan(12);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
    expect(s.totals.principal).toBe(DAILY.originalAmount);
  });
});

describe('extra payments in the summary, equity and period totals', () => {
  const asset = {
    name: 'Sample asset', kind: 'other' as const, originalValue: 1_500_000, valueTrend: 'manual' as const,
    trendRatePercent: null, acquiredDate: '2025-01-01', values: [],
  };

  it('lowers the balance today even before the month it applies with is reconciled', () => {
    // Payment 1 is reconciled. A $1,000 extra on Mar 5 applies with payment 2 (due Mar 1), which isn't.
    const s = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-03-05', 100_000)] });
    expect(s.rows[1]!.extraPayments).toBe(100_000);
    const paid = new Set([1]);
    const before = summarize(MONTHLY, s, paid, '2025-03-04', asset);
    const after = summarize(MONTHLY, s, paid, '2025-03-06', asset);
    expect(before.balance).toBe(s.rows[0]!.endingBalance);
    expect(after.balance).toBe(s.rows[0]!.endingBalance - 100_000);
    expect(after.asset!.equity - before.asset!.equity).toBe(100_000);
    const eq = analyzeEquity(MONTHLY, s, paid, '2025-03-06', asset);
    expect(eq.owed).toBe(after.owed);
    expect(eq.parts.extraPrincipal).toBe(100_000);
    expect(eq.parts.skipped).toBe(0);
  });

  it('counts extra payments in the period they were made', () => {
    const s = generateSchedule(MONTHLY, { extraPayments: [extra(1, '2025-02-15', 100_000), extra(2, '2025-04-03', 30_000)] });
    const p = periodBreakouts(s.rows, new Map([[1, '2025-02-01']]), '2025-02-20', 'paid');
    expect(p.month.totals.extraPrincipal).toBe(100_000);
    expect(p.month.totals.total).toBe(106_619 + 100_000);
    expect(p.fullLoan.totals.extraPrincipal).toBe(130_000);
  });
});
