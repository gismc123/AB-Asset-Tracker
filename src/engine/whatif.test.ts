import { describe, expect, it } from 'vitest';
import { generateSchedule } from './amortize.js';
import type { Asset } from './assets.js';
import type { LoanSetup } from './types.js';
import { owedOn, whatIf } from './whatif.js';

/** Made-up loan: $12,000 at 12% for 24 months, monthly interest. */
const LOAN: LoanSetup = {
  originalAmount: 1_200_000,
  annualRatePercent: 12,
  termYears: 2,
  termMonths: 24,
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

const CAR: Asset = {
  name: 'Sample car', kind: 'vehicle', originalValue: 1_500_000, valueTrend: 'depreciating', trendRatePercent: 10, acquiredDate: '2025-01-01', values: [],
};

describe('what-if', () => {
  it('a monthly extra gives exactly the schedule a standing extra would', () => {
    const r = whatIf(LOAN, {}, { monthlyExtra: 10_000, fromPayment: 3, lumpSum: null, dates: [] }, null);
    const real = generateSchedule(LOAN, { adjustments: [{ kind: 'standingExtra', fromPayment: 3, amount: 10_000 }] });
    expect(r.scenario.payoffDate).toBe(real.rows.at(-1)!.dueDate);
    expect(r.scenario.interest).toBe(real.totals.interest);
    expect(r.current.payments).toBe(24);
    expect(r.scenario.payments).toBe(real.rows.length);
    expect(r.monthsSaved).toBe(24 - real.rows.length);
    expect(r.interestSaved).toBe(generateSchedule(LOAN).totals.interest - real.totals.interest);
    expect(r.interestSaved).toBeGreaterThan(0);
  });

  it('a lump sum gives exactly the schedule a recorded extra payment would', () => {
    const r = whatIf(LOAN, {}, { monthlyExtra: 0, fromPayment: 1, lumpSum: { date: '2025-06-10', amount: 300_000 }, dates: [] }, null);
    const real = generateSchedule(LOAN, { extraPayments: [{ id: 1, date: '2025-06-10', amount: 300_000 }] });
    expect(r.scenario).toEqual({ payoffDate: real.rows.at(-1)!.dueDate, payments: real.rows.length, interest: real.totals.interest });
    expect(r.monthsSaved).toBeGreaterThanOrEqual(5);
  });

  it('builds on what is already recorded, and changes nothing when there is nothing to try', () => {
    const recorded = { adjustments: [{ kind: 'standingExtra' as const, fromPayment: 1, amount: 5_000 }] };
    const none = whatIf(LOAN, recorded, { monthlyExtra: 0, fromPayment: 1, lumpSum: null, dates: [] }, null);
    expect(none.scenario).toEqual(none.current);
    expect(none.monthsSaved).toBe(0);
    expect(none.interestSaved).toBe(0);
    expect(none.current.payments).toBe(generateSchedule(LOAN, recorded).rows.length);
  });

  it('compares what is owed and equity on chosen dates', () => {
    const r = whatIf(LOAN, {}, { monthlyExtra: 20_000, fromPayment: 1, lumpSum: null, dates: ['2025-01-15', '2025-12-31', '2028-01-01'] }, CAR);
    const [start, year, after] = r.at;
    // Before the first payment both plans owe the full amount.
    expect(start!.current.owed).toBe(1_200_000);
    expect(start!.scenario.owed).toBe(1_200_000);
    // After 11 payments the extra has paid down $2,200 more, plus the interest it saved.
    expect(year!.current.owed - year!.scenario.owed).toBeGreaterThan(220_000);
    expect(year!.scenario.equity! - year!.current.equity!).toBe(year!.current.owed - year!.scenario.owed);
    // The value follows the vehicle's projected curve, the same on both plans.
    expect(year!.value).toBeLessThan(1_500_000);
    // Both paid off by 2028.
    expect(after!.current.owed).toBe(0);
    expect(after!.scenario.owed).toBe(0);
  });

  it('gives no equity without an asset, and balances for a chart', () => {
    const r = whatIf(LOAN, {}, { monthlyExtra: 50_000, fromPayment: 1, lumpSum: null, dates: ['2025-07-01'] }, null);
    expect(r.at[0]).toMatchObject({ value: null, current: { equity: null }, scenario: { equity: null } });
    expect(r.balances).toHaveLength(24);
    expect(r.balances.at(-1)).toMatchObject({ current: 0, scenario: null });
  });

  it('counts an extra payment made before a date even when its row is later', () => {
    const daily = { ...LOAN, interestMethod: 'daily' as const };
    const s = generateSchedule(daily, { extraPayments: [{ id: 1, date: '2025-02-10', amount: 100_000 }] });
    // Daily: the Feb 10 extra lands with payment 2 (due Mar 1), but on Feb 15 it is already paid.
    expect(s.rows[1]!.extraPayments).toBe(100_000);
    expect(owedOn(s.rows, '2025-02-15', daily.originalAmount)).toBe(s.rows[0]!.endingBalance - 100_000);
  });
});
