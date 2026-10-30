import type { ISODate, LoanSetup } from '../engine/index.js';
import type { BudgetSource, BudgetTransaction, CategoryGroup, SourceStatus } from './actual.js';

/** Made-up sample loan used across the backend tests. Not real numbers. */
export const SAMPLE_SETUP: LoanSetup = {
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

/** Made-up sample car loan: 60 months, no PMI or escrow. Not real numbers. */
export const AUTO_SETUP: LoanSetup = {
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

/** Made-up sample student loan: 10 years, daily simple interest, no asset. Not real numbers. */
export const STUDENT_SETUP: LoanSetup = {
  ...AUTO_SETUP,
  originalAmount: 2_700_000,
  annualRatePercent: 5.5,
  termYears: 10,
  termMonths: 120,
  openDate: '2025-01-15',
  firstPaymentDate: '2025-02-15',
  paymentDay: 15,
  interestMethod: 'daily',
};

export const MORTGAGE_CATEGORY = 'cat-mortgage';
export const CAR_CATEGORY = 'cat-car';
export const STUDENT_CATEGORY = 'cat-student';

/** In-memory stand-in for Actual. */
export class FakeSource implements BudgetSource {
  transactions: (BudgetTransaction & { category: string })[] = [];

  status(): SourceStatus {
    return { connected: true, lastSync: '2025-01-01T00:00:00.000Z', error: null };
  }

  async getCategories(): Promise<CategoryGroup[]> {
    return [
      {
        id: 'grp-housing',
        name: 'Housing',
        categories: [
          { id: MORTGAGE_CATEGORY, name: 'Mortgage' },
          { id: 'cat-utilities', name: 'Utilities' },
        ],
      },
      { id: 'grp-transport', name: 'Transportation', categories: [{ id: CAR_CATEGORY, name: 'Car payment' }] },
      { id: 'grp-debt', name: 'Debt', categories: [{ id: STUDENT_CATEGORY, name: 'Student loan' }] },
    ];
  }

  async getTransactionsInCategory(categoryId: string, start: ISODate, end: ISODate) {
    return this.transactions
      .filter((t) => t.category === categoryId && t.date >= start && t.date <= end)
      .map(({ category: _c, ...t }) => t);
  }

  add(id: string, date: ISODate, amount: number, category = MORTGAGE_CATEGORY) {
    this.transactions.push({ id, date, amount, category, payee: 'Sample Mortgage Servicer', account: 'Checking', notes: null, isSplitPart: false });
  }
}
