import { describe, expect, it } from 'vitest';
import { generateSchedule, lockRow, validateSetup } from './amortize.js';
import { analyzeEquity } from './equity.js';
import { periodBreakouts } from './periods.js';
import { summarize } from './summary.js';
import type { LoanSetup, LockedPayment, OneOffFee } from './types.js';

/** Made-up loan: $12,000 at 12% for 24 months, monthly interest (1% a month). */
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

const withFees = (fees: OneOffFee[], base: LoanSetup = LOAN): LoanSetup => ({ ...base, fees });
const plain = generateSchedule(LOAN);

describe('one-off fees', () => {
  it('undated or financed: in the setup only, never on the schedule or in the balance', () => {
    const s = generateSchedule(withFees([
      { label: 'Processing', amount: 25_000, financed: false },
      { label: 'Credit insurance', amount: 40_000, financed: true },
    ]));
    expect(s.rows).toEqual(plain.rows);
    expect(s.totals).toMatchObject({ oneOffFees: 0, feesAdded: 0 });
    const sum = summarize(withFees([{ label: 'Processing', amount: 25_000, financed: false }]), s, new Set(), '2025-01-15', null);
    expect(sum.oneOffFees).toBe(25_000);
  });

  it('dated and paid separately: on its row and in the totals, not in the payment or the balance', () => {
    const s = generateSchedule(withFees([{ label: 'Late charge', amount: 3_500, financed: false, date: '2025-04-20' }]));
    // Monthly: Apr 20 falls after the Apr 1 payment (#3) and before May 1.
    const r = s.rows[2]!;
    expect(r).toMatchObject({ oneOffFees: 3_500, feesAdded: 0, total: plain.rows[2]!.total, endingBalance: plain.rows[2]!.endingBalance });
    expect(r.oneOffFeeList).toEqual([{ label: 'Late charge', date: '2025-04-20', amount: 3_500, addedToBalance: false }]);
    expect(s.totals).toMatchObject({ oneOffFees: 3_500, feesAdded: 0, interest: plain.totals.interest });
  });

  it('added to the balance, monthly interest: raises the balance from that payment and the loan runs longer', () => {
    const s = generateSchedule(withFees([{ label: 'Force-placed insurance', amount: 120_000, financed: false, date: '2025-04-20', addedToBalance: true }]));
    const r = s.rows[2]!;
    expect(r).toMatchObject({ feesAdded: 120_000, oneOffFees: 0, total: plain.rows[2]!.total });
    expect(r.endingBalance).toBe(plain.rows[2]!.endingBalance + 120_000);
    // Next month's interest is 1% more of $1,200: $12.00.
    expect(s.rows[3]!.interest - plain.rows[3]!.interest).toBe(1_200);
    // Same payment, so it takes longer, and every cent (loan + fee) is paid back.
    expect(s.piPayment).toBe(plain.piPayment);
    expect(s.rows.length).toBeGreaterThan(24);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
    expect(s.totals.principal).toBe(LOAN.originalAmount + 120_000);
    expect(s.totals.feesAdded).toBe(120_000);
  });

  it('added to the balance, daily interest: accrues from its own day (hand-checked)', () => {
    // $10,000 at 7.3%, which is exactly 0.02% a day.
    const daily: LoanSetup = { ...LOAN, originalAmount: 1_000_000, annualRatePercent: 7.3, interestMethod: 'daily' };
    const base = generateSchedule(daily);
    const s = generateSchedule(withFees([{ label: 'Insurance', amount: 50_000, financed: false, date: '2025-01-21', addedToBalance: true }], daily));
    // Jan 1 to Feb 1: 20 days on $10,000 ($40.00) + 11 days on $10,500 ($23.10) = $63.10.
    expect(base.rows[0]!.interest).toBe(6_200);
    expect(s.rows[0]!.interest).toBe(4_000 + 2_310);
    expect(s.rows[0]!.feesAdded).toBe(50_000);
    expect(s.rows[0]!.endingBalance).toBe(1_050_000 - (s.piPayment - 6_310));
    // Daily loans normally settle on the last scheduled payment; with a fee added they run until paid.
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
    expect(s.rows.at(-1)!.principalAndInterest).toBeLessThanOrEqual(s.piPayment);
    expect(s.totals.principal).toBe(1_050_000);
  });

  it('applies on top of a reconciled month without changing it', () => {
    const lock = lockRow(plain.rows[2]!);
    const s = generateSchedule(withFees([{ label: 'Insurance', amount: 10_000, financed: false, date: '2025-04-05', addedToBalance: true }]), {
      locked: new Map<number, LockedPayment>([[3, lock]]),
    });
    expect(s.rows[2]).toMatchObject({ locked: true, total: plain.rows[2]!.total, feesAdded: 10_000 });
    expect(s.rows[2]!.endingBalance).toBe(plain.rows[2]!.endingBalance + 10_000);
    expect(lockRow(s.rows[2]!)).toEqual(lock);
  });

  it('ignores fees dated before tracking began: the starting balance has them', () => {
    const start: LoanSetup = { ...withFees([{ label: 'Old fee', amount: 5_000, financed: false, date: '2025-02-15', addedToBalance: true }]), startingPoint: { payment: 3, balance: 1_000_000 } };
    const s = generateSchedule(start);
    expect(s.totals.feesAdded).toBe(0);
    expect(s.rows[2]!.endingBalance).toBe(1_000_000);
  });

  it('validates dates and when a fee can be added to the balance', () => {
    const problems = (f: OneOffFee) => validateSetup(withFees([f]));
    expect(problems({ label: 'A', amount: 100, financed: false, date: 'soon' })).toEqual(['Fee "A" needs a valid date']);
    expect(problems({ label: 'A', amount: 100, financed: false, date: '2024-12-31' })[0]).toMatch(/before the loan open date/);
    expect(problems({ label: 'A', amount: 100, financed: false, addedToBalance: true })[0]).toMatch(/added to the balance/);
    expect(problems({ label: 'A', amount: 100, financed: true, date: '2025-03-01', addedToBalance: true })[0]).toMatch(/added to the balance/);
    expect(problems({ label: 'A', amount: 100, financed: false, date: '2025-01-01', addedToBalance: true })[0]).toMatch(/added to the balance/);
    expect(problems({ label: 'A', amount: 100, financed: false, date: '2025-03-01', addedToBalance: true })).toEqual([]);
  });

  it('counts in the summary, equity and period totals', () => {
    const setup = withFees([
      { label: 'Insurance', amount: 60_000, financed: false, date: '2025-02-10', addedToBalance: true },
      { label: 'Statement fee', amount: 1_000, financed: false, date: '2025-02-12' },
    ]);
    const s = generateSchedule(setup);
    const asset = { name: 'Sample', kind: 'other' as const, originalValue: 1_500_000, valueTrend: 'manual' as const, trendRatePercent: null, acquiredDate: null, values: [] };
    // Payment 1 is paid; the fee is in payment 1's month (Feb 1 to Mar 1) and already charged on Feb 15.
    const sum = summarize(setup, s, new Set([1]), '2025-02-15', asset);
    expect(sum.balance).toBe(s.rows[0]!.endingBalance);
    const before = summarize(setup, s, new Set(), '2025-01-15', asset);
    expect(before.balance).toBe(1_200_000);
    const eq = analyzeEquity(setup, s, new Set([1]), '2025-02-15', asset);
    expect(eq.parts.feesAdded).toBe(-60_000);
    expect(eq.parts.skipped).toBe(0);
    const p = periodBreakouts(s.rows, new Map([[1, '2025-02-01']]), '2025-02-20', 'paid');
    expect(p.month.totals).toMatchObject({ feesAdded: 60_000, fees: 1_000 });
  });
});

describe('yearly fee', () => {
  const original = { basis: 'original' as const, percent: 0.5 };
  const balance = { basis: 'balance' as const, percent: 0.5 };

  it('original amount, with the payment: in the payment of #1 and #13', () => {
    const s = generateSchedule({ ...LOAN, yearlyFee: original });
    for (const k of [1, 13]) expect(s.rows[k - 1]).toMatchObject({ fee: 6_000, separateFee: 0, total: plain.rows[k - 1]!.total + 6_000 });
    expect(s.rows[1]!.fee).toBe(0);
    expect(s.totals.fees).toBe(12_000);
  });

  it('original amount, charged separately: on #1 and #13, never in the payment', () => {
    const s = generateSchedule({ ...LOAN, yearlyFee: { ...original, collect: 'separately' } });
    for (const k of [1, 13]) expect(s.rows[k - 1]).toMatchObject({ fee: 0, separateFee: 6_000, total: plain.rows[k - 1]!.total });
    expect(s.totals.fees).toBe(12_000);
    expect(s.totals.interest).toBe(plain.totals.interest);
  });

  it('remaining balance, with the payment', () => {
    const s = generateSchedule({ ...LOAN, yearlyFee: balance });
    expect(s.rows[12]).toMatchObject({ fee: Math.round(plain.rows[12]!.beginningBalance * 0.005), separateFee: 0 });
    expect(s.rows[12]!.total).toBe(plain.rows[12]!.total + s.rows[12]!.fee);
  });

  it('remaining balance, charged separately', () => {
    const s = generateSchedule({ ...LOAN, yearlyFee: { ...balance, collect: 'separately' } });
    expect(s.rows[0]).toMatchObject({ fee: 0, separateFee: 6_000 });
    expect(s.rows[12]).toMatchObject({ fee: 0, separateFee: Math.round(plain.rows[12]!.beginningBalance * 0.005), total: plain.rows[12]!.total });
    expect(s.totals.fees).toBe(6_000 + s.rows[12]!.separateFee);
  });

  it('charged separately stays on its month even when that month is skipped', () => {
    const s = generateSchedule({ ...LOAN, yearlyFee: { ...original, collect: 'separately' } }, { adjustments: [{ kind: 'skip', payment: 13, mode: 'capitalize' }] });
    expect(s.rows[12]).toMatchObject({ skipped: 'capitalize', separateFee: 6_000 });
    expect(s.rows[13]!.separateFee).toBe(0);
    const p = periodBreakouts(s.rows, new Map(), '2026-02-15', 'scheduled');
    expect(p.month.totals.fees).toBe(6_000);
  });

  it('rejects an unknown way of collecting it', () => {
    expect(validateSetup({ ...LOAN, yearlyFee: { ...original, collect: 'later' as never } })).toEqual(['The yearly fee is collected with the payment or separately']);
  });
});
