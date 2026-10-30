import { describe, expect, it } from 'vitest';
import { effectiveRate } from './effective-rate.js';
import type { LoanSetup } from './types.js';

/** Made-up loan: $10,000 at 12% for 12 months, monthly interest. */
const LOAN: LoanSetup = {
  originalAmount: 1_000_000,
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

// Expected values were worked out separately (an independent script solving
// the same cash flows), not by this code.
describe('effective annual rate', () => {
  it('without fees is the note rate compounded monthly: 12% becomes 12.68%', () => {
    expect(effectiveRate(LOAN)).toMatchObject({ percent: 12.68, nominalPercent: 12, monthlyBasisPercent: 12, hasFees: false });
  });

  it('a $200 fee paid at opening: 17.06%', () => {
    expect(effectiveRate({ ...LOAN, fees: [{ label: 'Processing', amount: 20_000, financed: false }] })).toMatchObject({
      percent: 17.06, monthlyBasisPercent: 15.85, feesAtOpening: 20_000, hasFees: true,
    });
  });

  it('a $200 fee financed into $10,200 borrowed: 16.97%', () => {
    const r = effectiveRate({ ...LOAN, originalAmount: 1_020_000, fees: [{ label: 'Processing', amount: 20_000, financed: true }] });
    expect(r).toMatchObject({ percent: 16.97, feesFinanced: 20_000 });
  });

  it('a yearly fee of 1% of the original amount over 24 months: 14.81%, in the payment or charged separately', () => {
    const base = { ...LOAN, termYears: 2, termMonths: 24 };
    expect(effectiveRate({ ...base, yearlyFee: { basis: 'original', percent: 1 } })).toMatchObject({ percent: 14.81, yearlyFees: 20_000 });
    expect(effectiveRate({ ...base, yearlyFee: { basis: 'original', percent: 1, collect: 'separately' } })!.percent).toBe(14.81);
  });

  it('a 0% loan with a 1% fee still costs something: 1.88%', () => {
    expect(effectiveRate({ ...LOAN, originalAmount: 1_200_000, annualRatePercent: 0, fees: [{ label: 'Fee', amount: 12_000, financed: false }] })!.percent).toBe(1.88);
  });

  it('counts later fees and fees added to the balance, and leaves out PMI, escrow and extra principal', () => {
    const later = effectiveRate({ ...LOAN, fees: [{ label: 'Late', amount: 5_000, financed: false, date: '2025-06-10' }] })!;
    expect(later.laterFees).toBe(5_000);
    expect(later.percent).toBeGreaterThan(12.68);
    const added = effectiveRate({ ...LOAN, fees: [{ label: 'Insurance', amount: 50_000, financed: false, date: '2025-03-10', addedToBalance: true }] })!;
    expect(added.feesAdded).toBe(50_000);
    expect(added.percent).toBeGreaterThan(later.percent);
    expect(effectiveRate({ ...LOAN, extraPrincipal: 50_000, escrowMonthly: 30_000, modules: { pmi: false, escrow: true } })!.percent).toBe(12.68);
  });
});
