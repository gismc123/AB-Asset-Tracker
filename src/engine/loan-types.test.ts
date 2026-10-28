import { describe, expect, it } from 'vitest';
import {
  analyzeEquity,
  generateSchedule,
  lockRow,
  periodBreakouts,
  projectedValue,
  resolutionToAdjustment,
  ResolutionError,
  standardPayment,
  summarize,
  validateSetup,
  type Asset,
  type LoanSetup,
} from './index.js';

// Made-up sample loans. Not real numbers.
const auto: LoanSetup = {
  originalAmount: 3_000_000,
  annualRatePercent: 6.9,
  termYears: 5,
  termMonths: 60,
  openDate: '2025-03-10',
  firstPaymentDate: '2025-04-10',
  paymentDay: 10,
  piPaymentOverride: null,
  originalHomeValue: 0,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 0,
  extraPrincipal: 0,
  modules: { pmi: false, escrow: false },
};

const personal: LoanSetup = { ...auto, originalAmount: 1_200_000, annualRatePercent: 11.5, termYears: 2, termMonths: 18 };

const mortgage: LoanSetup = {
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

const car: Asset = {
  name: 'Sample hatchback',
  kind: 'vehicle',
  originalValue: 3_600_000,
  valueTrend: 'depreciating',
  trendRatePercent: 15,
  acquiredDate: '2025-03-10',
  values: [],
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('auto loan', () => {
  it('amortizes over months with no PMI or escrow', () => {
    expect(validateSetup(auto)).toEqual([]);
    const s = generateSchedule(auto);
    expect(s.rows).toHaveLength(60);
    expect(s.piPayment).toBe(standardPayment(3_000_000, 6.9, 60));
    expect(s.rows.every((r) => r.pmi === 0 && r.escrow === 0)).toBe(true);
    expect(s.rows[0]!.total).toBe(s.piPayment);
    expect(sum(s.rows.map((r) => r.principal))).toBe(3_000_000);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
    expect(s.pmi.hasPmi).toBe(false);
  });

  it('ignores a PMI amount and escrow changes when those modules are off', () => {
    const s = generateSchedule({ ...auto, pmiMonthly: 5_000, escrowMonthly: 9_000 }, {
      adjustments: [{ kind: 'escrow', fromPayment: 3, amount: 12_000 }],
    });
    expect(s.rows.every((r) => r.pmi === 0 && r.escrow === 0)).toBe(true);
  });

  it('refuses escrow and PMI answers when reconciling', () => {
    const row = generateSchedule(auto).rows[0]!;
    expect(() => resolutionToAdjustment(auto, [], row, 1_000, 'escrow')).toThrow(ResolutionError);
    expect(() => resolutionToAdjustment(auto, [], row, 1_000, 'pmi')).toThrow(/no PMI/);
    expect(resolutionToAdjustment(auto, [], row, 1_000, 'extraPrincipal')).toEqual({ kind: 'extraPrincipal', payment: 1, amount: 1_000 });
  });

  it('pays off sooner with extra principal, and later after a skipped month', () => {
    const extra = generateSchedule({ ...auto, extraPrincipal: 10_000 });
    expect(extra.rows.length).toBeLessThan(60);
    expect(sum(extra.rows.map((r) => r.principal))).toBe(3_000_000);
    const skipped = generateSchedule(auto, { adjustments: [{ kind: 'skip', payment: 6, mode: 'capitalize' }] });
    // The added interest needs paying too, so the loan runs past its 60 payments.
    expect(skipped.rows.length).toBeGreaterThan(60);
    expect(skipped.rows.at(-1)!.endingBalance).toBe(0);
    expect(skipped.rows[5]!.total).toBe(0);
    expect(skipped.totals.capitalizedInterest).toBeGreaterThan(0);
  });

  it('measures equity against the vehicle and its depreciation curve', () => {
    const s = generateSchedule(auto);
    const sm = summarize(auto, s, new Set([1, 2, 3]), '2025-07-01', car);
    expect(sm.asset).toMatchObject({ kind: 'vehicle', value: 3_600_000, valueEntered: false });
    expect(sm.asset!.equity).toBe(3_600_000 - sm.owed);
    expect(sm.asset!.projectedValue).toBeLessThan(3_600_000);
    expect(sm.pmi.active).toBe(false);

    const e = analyzeEquity(auto, s, new Set([1, 2, 3]), '2025-07-01', car);
    expect(e.projected).toBe(true);
    // Ahead of today, value follows the curve down.
    const future = e.projection.filter((p) => p.dueDate > '2025-07-01');
    expect(future[0]!.value).toBeLessThan(3_600_000);
    expect(future.at(-1)!.value).toBeLessThan(future[0]!.value);
    // Vehicles get a "worth more than you owe" (0%) milestone, not the PMI lines.
    expect(e.milestones.map((m) => m.percent)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe('personal loan', () => {
  it('amortizes an 18-month term and has no asset or equity', () => {
    const s = generateSchedule(personal);
    expect(s.rows).toHaveLength(18);
    const sm = summarize(personal, s, new Set([1]), '2025-04-20', null);
    expect(sm.asset).toBeNull();
    expect(sm.equity).toBeNull();
    expect(sm.owed).toBe(s.rows[0]!.endingBalance);
  });

  it('validates term in months', () => {
    expect(validateSetup({ ...personal, termMonths: 0 })).toContain('Term must be 1 to 600 months');
    expect(validateSetup({ ...personal, termMonths: 7.5 })).toContain('Term must be 1 to 600 months');
  });
});

describe('mortgage modules', () => {
  it('keeps PMI and escrow on when modules are missing (every loan saved before modules)', () => {
    const s = generateSchedule(mortgage);
    expect(s.rows[0]).toMatchObject({ pmi: 14_800, escrow: 41_250 });
  });

  it('can turn PMI off without touching escrow', () => {
    const s = generateSchedule({ ...mortgage, modules: { pmi: false, escrow: true } });
    expect(s.rows[0]).toMatchObject({ pmi: 0, escrow: 41_250 });
    expect(s.totals.pmi).toBe(0);
  });

  it('only needs a home value when PMI is on', () => {
    expect(validateSetup({ ...mortgage, originalHomeValue: 0 })).toContain('Original home value must be more than zero');
    expect(validateSetup({ ...mortgage, originalHomeValue: 0, modules: { pmi: false, escrow: true } })).toEqual([]);
  });
});

describe('fees', () => {
  it('charges a yearly fee on the original amount with payments 1, 13, 25 …', () => {
    const s = generateSchedule({ ...auto, yearlyFee: { basis: 'original', percent: 0.5 } });
    const charged = s.rows.filter((r) => r.fee > 0).map((r) => r.payment);
    expect(charged).toEqual([1, 13, 25, 37, 49]);
    expect(s.rows[0]!.fee).toBe(15_000);
    expect(s.rows[0]!.total).toBe(s.piPayment + 15_000);
    expect(s.totals.fees).toBe(75_000);
    // Fees never touch the balance.
    expect(s.rows.map((r) => r.endingBalance)).toEqual(generateSchedule(auto).rows.map((r) => r.endingBalance));
  });

  it('charges a balance-based fee on the balance at that payment', () => {
    const s = generateSchedule({ ...auto, yearlyFee: { basis: 'balance', percent: 1 } });
    expect(s.rows[12]!.fee).toBe(Math.round(s.rows[12]!.beginningBalance / 100));
    expect(s.rows[12]!.fee).toBeLessThan(s.rows[0]!.fee);
  });

  it('moves a fee off a skipped month and keeps a reconciled month as locked', () => {
    const withFee = { ...auto, yearlyFee: { basis: 'original' as const, percent: 0.5 } };
    const skipped = generateSchedule(withFee, { adjustments: [{ kind: 'skip', payment: 13, mode: 'capitalize' }] });
    expect(skipped.rows[12]!.fee).toBe(0);
    expect(skipped.rows[13]!.fee).toBe(15_000);

    // Month 1 was reconciled before the fee was set up: the fee waits for month 2.
    const lock = lockRow(generateSchedule(auto).rows[0]!);
    const s = generateSchedule(withFee, { locked: new Map([[1, lock]]) });
    expect(s.rows[0]!.fee).toBe(0);
    expect(s.rows[1]!.fee).toBe(15_000);
  });

  it('adds fees to the period totals', () => {
    const s = generateSchedule({ ...auto, yearlyFee: { basis: 'original', percent: 0.5 } });
    const p = periodBreakouts(s.rows, new Map(), '2025-04-20', 'scheduled');
    expect(p.month.totals.fees).toBe(15_000);
    expect(p.fullLoan.totals.fees).toBe(75_000);
    expect(p.month.totals.total).toBe(s.rows[0]!.total);
  });

  it('sums one-off fees and validates them', () => {
    const withFees: LoanSetup = { ...auto, fees: [{ label: 'Processing', amount: 29_900, financed: false }, { label: 'Credit insurance', amount: 45_000, financed: true }] };
    expect(validateSetup(withFees)).toEqual([]);
    expect(summarize(withFees, generateSchedule(withFees), new Set(), '2025-04-01', null).oneOffFees).toBe(74_900);
    expect(validateSetup({ ...auto, fees: [{ label: '', amount: 1, financed: false }] })).toHaveLength(1);
    expect(validateSetup({ ...auto, yearlyFee: { basis: 'original', percent: 50 } })).toContain('The yearly fee must be 0 to 20 percent');
  });
});

describe('payoff amount', () => {
  const loan: LoanSetup = { ...auto, annualRatePercent: 7.3, originalAmount: 2_500_000 };

  it('estimates what is owed plus simple interest since the last payment', () => {
    const s = generateSchedule(loan);
    const sm = summarize(loan, s, new Set([1]), '2025-04-20', null);
    // 10 days since the April 10 payment at 0.02% a day.
    const balance = s.rows[0]!.endingBalance;
    expect(sm.payoff).toMatchObject({ source: 'estimate', asOf: '2025-04-20', expiredQuote: null });
    expect(sm.payoff!.perDiem).toBe(Math.round(balance * 0.0002));
    expect(sm.payoff!.amount).toBe(balance + Math.round(balance * 0.0002 * 10));
  });

  it('uses a payoff quote while it is good, then falls back to the estimate', () => {
    const quoted = { ...loan, payoffQuote: { amount: 2_400_000, goodThrough: '2025-04-30' } };
    const s = generateSchedule(quoted);
    expect(summarize(quoted, s, new Set([1]), '2025-04-20', null).payoff).toMatchObject({ amount: 2_400_000, source: 'quote' });
    expect(summarize(quoted, s, new Set([1]), '2025-05-01', null).payoff).toMatchObject({ source: 'estimate', expiredQuote: '2025-04-30' });
  });
});

describe('daily interest', () => {
  // 7.3% a year is exactly 0.02% a day, so the numbers are easy to check by hand.
  const loan: LoanSetup = { ...auto, annualRatePercent: 7.3, originalAmount: 2_500_000, interestMethod: 'daily', openDate: '2025-01-15', firstPaymentDate: '2025-02-15', paymentDay: 15 };

  it('charges interest for the days in each period, from the open date', () => {
    const s = generateSchedule(loan);
    // Jan 15 to Feb 15: 31 days. Feb 15 to Mar 15: 28 days.
    expect(s.rows[0]!.interest).toBe(15_500);
    expect(s.rows[1]!.interest).toBe(Math.round(s.rows[0]!.endingBalance * 0.0002 * 28));
    expect(sum(s.rows.map((r) => r.principal))).toBe(2_500_000);
    // The scheduled last payment settles the loan.
    expect(s.rows).toHaveLength(60);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('uses the real payment date: paying early means less interest and more principal', () => {
    const due = generateSchedule(loan).rows[0]!;
    const early = generateSchedule(loan, { paidDates: new Map([[1, '2025-02-10']]) }).rows;
    // Jan 15 to Feb 10: 26 days.
    expect(early[0]!.interest).toBe(13_000);
    expect(early[0]!.total).toBe(due.total);
    expect(early[0]!.principal).toBe(due.principal + 2_500);
    // The next period runs from the day it was really paid: Feb 10 to Mar 15, 33 days.
    expect(early[1]!.interest).toBe(Math.round(early[0]!.endingBalance * 0.0002 * 33));
  });

  it('applies extra principal on the day of the payment it came with', () => {
    const s = generateSchedule(loan, { adjustments: [{ kind: 'extraPrincipal', payment: 1, amount: 100_000 }] });
    expect(s.rows[1]!.interest).toBe(Math.round((2_500_000 - s.rows[0]!.principal) * 0.0002 * 28));
    expect(s.rows.length).toBeLessThan(60);
  });

  it('runs longer after interest is added by a skipped month', () => {
    const s = generateSchedule(loan, { adjustments: [{ kind: 'skip', payment: 4, mode: 'capitalize' }] });
    expect(s.rows).toHaveLength(61);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('leaves monthly loans alone', () => {
    const monthly = generateSchedule({ ...loan, interestMethod: 'monthly' });
    expect(monthly.rows[0]!.interest).toBe(Math.round(2_500_000 * 0.073 / 12));
    const ignored = generateSchedule({ ...loan, interestMethod: 'monthly' }, { paidDates: new Map([[1, '2025-02-01']]) });
    expect(ignored.rows).toEqual(monthly.rows);
  });
});

describe('asset value projection', () => {
  it('compounds the yearly rate from the latest value, and stays flat for manual assets', () => {
    expect(projectedValue(car, '2025-03-10', '2025-03-10')).toBe(3_600_000);
    // 2025-03-10 to 2029-03-10 is 1,461 days: exactly four 365.25-day years, 15% lower each.
    expect(Math.abs(projectedValue(car, '2029-03-10', '2025-03-10') - 3_600_000 * 0.85 ** 4)).toBeLessThanOrEqual(1);
    const updated: Asset = { ...car, values: [{ date: '2026-01-01', value: 3_300_000, source: 'Pricing guide' }] };
    expect(projectedValue(updated, '2026-01-01', '2025-03-10')).toBe(3_300_000);
    expect(projectedValue(updated, '2027-01-01', '2025-03-10')).toBeLessThan(3_300_000);
    expect(projectedValue({ ...updated, valueTrend: 'manual' }, '2030-01-01', '2025-03-10')).toBe(3_300_000);
    const home: Asset = { ...car, kind: 'home', valueTrend: 'appreciating', trendRatePercent: 3 };
    expect(projectedValue(home, '2026-03-10', '2025-03-10')).toBeGreaterThan(3_600_000);
  });
});
