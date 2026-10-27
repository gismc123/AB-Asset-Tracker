import { describe, expect, it } from 'vitest';
import {
  analyzeEquity,
  escrowReport,
  generateSchedule,
  lockRow,
  periodBreakouts,
  summarize,
  type EscrowEntry,
  type LoanSetup,
} from './index.js';

// Made-up sample loan. Not real numbers.
const setup: LoanSetup = {
  originalAmount: 30_000_000,
  annualRatePercent: 6.5,
  termYears: 30,
  openDate: '2025-02-14',
  firstPaymentDate: '2025-04-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 37_500_000,
  pmiMonthly: 12_000,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 40_000,
  extraPrincipal: 0,
};

const plain = generateSchedule(setup);
const paidThrough = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1));
const paidOnDue = (n: number) => new Map(plain.rows.slice(0, n).map((r) => [r.payment, r.dueDate]));

describe('skipping a payment', () => {
  it('capitalize: pays nothing, adds the interest to the balance, and runs longer', () => {
    const s = generateSchedule(setup, { adjustments: [{ kind: 'skip', payment: 3, mode: 'capitalize' }] });
    const r = s.rows[2]!;
    expect(r).toMatchObject({ skipped: 'capitalize', total: 0, pmi: 0, escrow: 0, principal: 0 });
    expect(r.capitalizedInterest).toBe(plain.rows[2]!.interest);
    expect(r.endingBalance).toBe(r.beginningBalance + r.capitalizedInterest);
    // Payment 4 starts from a higher balance, so it pays more interest.
    expect(s.rows[3]!.interest).toBeGreaterThan(plain.rows[3]!.interest);
    expect(s.rows.length).toBeGreaterThan(plain.rows.length);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
    // No outsized final payment: the residue becomes its own short payment.
    expect(s.rows.at(-1)!.principalAndInterest).toBeLessThanOrEqual(s.piPayment);
    expect(s.totals.capitalizedInterest).toBe(r.capitalizedInterest);
    expect(s.totals.payments).toBe(s.rows.length - 1);
  });

  it('defer: pays nothing now and repays the missed P&I as a lump sum at payoff', () => {
    const s = generateSchedule(setup, { adjustments: [{ kind: 'skip', payment: 3, mode: 'defer' }] });
    const r = s.rows[2]!;
    expect(r).toMatchObject({ skipped: 'defer', total: 0, pmi: 0, escrow: 0 });
    expect(r.deferred).toBe(plain.rows[2]!.principalAndInterest);
    // The amortizing balance moves as if the payment had been made.
    expect(r.endingBalance).toBe(plain.rows[2]!.endingBalance);
    expect(s.rows).toHaveLength(plain.rows.length);
    const last = s.rows.at(-1)!;
    expect(last.deferredRepaid).toBe(r.deferred);
    expect(last.total).toBe(plain.rows.at(-1)!.total + r.deferred);
  });

  it('skipped months are settled once due, and the deferred amount counts against equity', () => {
    const s = generateSchedule(setup, { adjustments: [{ kind: 'skip', payment: 3, mode: 'defer' }] });
    const sum = summarize(setup, s, paidThrough(2), '2025-06-15');
    expect(sum.balance).toBe(s.rows[2]!.endingBalance);
    expect(sum.deferredBalance).toBe(s.rows[2]!.deferred);
    expect(sum.equity).toBe(setup.originalHomeValue - sum.balance - sum.deferredBalance);
    expect(sum.nextPayment?.payment).toBe(4);
    expect(sum.paymentsMade).toBe(2);
  });

  it('a skipped month cannot be locked as paid', () => {
    const s = generateSchedule(setup, { adjustments: [{ kind: 'skip', payment: 1, mode: 'capitalize' }] });
    expect(() => lockRow(s.rows[0]!)).toThrow(/skipped/);
  });

  it('accepts locks saved before skips existed', () => {
    const { skipped: _s, capitalizedInterest: _c, deferred: _d, deferredRepaid: _r, ...old } = lockRow(plain.rows[0]!);
    const s = generateSchedule(setup, { locked: new Map([[1, old as never]]) });
    expect(s.rows[0]).toMatchObject({ locked: true, skipped: null, deferred: 0 });
  });
});

describe('period breakouts', () => {
  it('splits principal, interest, PMI and escrow by month, quarter, year and loan', () => {
    // Payments 1-3 (Apr-Jun 2025) paid; today is in June 2025.
    const b = periodBreakouts(plain.rows, paidOnDue(3), '2025-06-15', 'paid');
    const r = plain.rows;
    expect(b.month.totals.payments).toBe(1);
    expect(b.month.totals.interest).toBe(r[2]!.interest);
    expect(b.quarter.totals.payments).toBe(3); // Apr, May, Jun
    expect(b.yearToDate.totals.principal).toBe(r[0]!.principal + r[1]!.principal + r[2]!.principal);
    expect(b.loanToDate.totals.pmi).toBe(3 * 12_000);
    expect(b.loanToDate.totals.escrow).toBe(3 * 40_000);
    const t = b.loanToDate.totals;
    expect(t.total).toBe(t.principal + t.extraPrincipal + t.interest + t.pmi + t.escrow + t.deferredRepaid);
    expect(b.fullLoan.totals.payments).toBe(plain.rows.length);
    expect(b.fullLoan.totals.interest).toBe(plain.totals.interest);
  });

  it('dates paid months by when the bank paid them', () => {
    // Payment 1 (due Apr 1) actually paid Mar 28: it falls in Q1, not this quarter.
    const b = periodBreakouts(plain.rows, new Map([[1, '2025-03-28']]), '2025-04-10', 'paid');
    expect(b.month.totals.payments).toBe(0);
    expect(b.yearToDate.totals.payments).toBe(1);
  });

  it('scheduled basis counts everything due, paid or not', () => {
    const b = periodBreakouts(plain.rows, new Map(), '2025-06-15', 'scheduled');
    expect(b.yearToDate.totals.payments).toBe(3);
    expect(b.month.totals.total).toBe(plain.rows[2]!.total);
  });
});

describe('equity analysis', () => {
  it('starts from the down payment and adds principal paid', () => {
    const e = analyzeEquity(setup, plain, paidThrough(3), '2025-06-15');
    const paidPrincipal = plain.rows.slice(0, 3).reduce((s, r) => s + r.principal, 0);
    expect(e.parts.startingEquity).toBe(7_500_000);
    expect(e.parts.principalPaid).toBe(paidPrincipal);
    expect(e.parts.marketChange).toBe(0);
    expect(e.equity).toBe(7_500_000 + paidPrincipal);
    expect(e.isEstimate).toBe(false);
  });

  it('uses the latest home value estimate and shows the market change', () => {
    const e = analyzeEquity(setup, plain, paidThrough(3), '2025-06-15', [
      { date: '2025-05-01', value: 38_000_000, source: 'Online estimate' },
      { date: '2025-06-01', value: 40_000_000, source: 'Appraisal' },
    ]);
    expect(e).toMatchObject({ homeValue: 40_000_000, homeValueSource: 'Appraisal', isEstimate: true });
    expect(e.parts.marketChange).toBe(2_500_000);
    const p = e.parts;
    expect(p.startingEquity + p.principalPaid + p.extraPrincipal + p.skipped + p.marketChange).toBe(e.equity);
    expect(e.ltv).toBeCloseTo((e.owed / 40_000_000) * 100, 1);
  });

  it('attributes skipped-payment costs so the parts still add up', () => {
    const s = generateSchedule(setup, { adjustments: [{ kind: 'skip', payment: 2, mode: 'capitalize' }] });
    const e = analyzeEquity(setup, s, new Set([1, 3]), '2025-06-15');
    expect(e.parts.skipped).toBe(-s.rows[1]!.capitalizedInterest);
    const p = e.parts;
    expect(p.startingEquity + p.principalPaid + p.extraPrincipal + p.skipped + p.marketChange).toBe(e.equity);
  });

  it('finds when the schedule reaches each equity milestone', () => {
    const e = analyzeEquity(setup, plain, new Set(), '2025-03-01');
    const m20 = e.milestones.find((m) => m.percent === 20)!;
    expect(m20.reached).toBe(true); // 20% down
    const m50 = e.milestones.find((m) => m.percent === 50)!;
    expect(m50.reached).toBe(false);
    const row = plain.rows[m50.payment! - 1]!;
    expect(setup.originalHomeValue - row.endingBalance).toBeGreaterThanOrEqual(setup.originalHomeValue / 2);
    expect(e.milestones.find((m) => m.percent === 100)!.payment).toBe(plain.rows.length);
  });
});

describe('escrow ledger', () => {
  const entries: EscrowEntry[] = [
    { id: 1, date: '2025-02-14', kind: 'deposit', amount: 120_000, note: 'Initial deposit at closing' },
    { id: 2, date: '2025-05-20', kind: 'homeownersInsurance', amount: 180_000, note: '' },
    { id: 3, date: '2025-06-10', kind: 'propertyTax', amount: 95_000, note: 'First half' },
  ];

  it('runs a balance from deposits, escrow in each payment, and bills paid out', () => {
    const rep = escrowReport(plain.rows, paidOnDue(3), entries, '2025-06-15');
    expect(rep.lines.map((l) => l.kind)).toEqual(['deposit', 'payment', 'payment', 'homeownersInsurance', 'payment', 'propertyTax']);
    expect(rep.balance).toBe(120_000 + 3 * 40_000 - 180_000 - 95_000);
    expect(rep.lines.at(-1)!.balance).toBe(rep.balance);
    expect(rep.years[0]).toMatchObject({ year: '2025', collected: 120_000, deposited: 120_000, paidOutTotal: 275_000 });
    expect(rep.years[0]!.paidOut.propertyTax).toBe(95_000);
  });

  it('compares a year of collections with the last 12 months of bills', () => {
    const rep = escrowReport(plain.rows, paidOnDue(3), entries, '2025-06-15');
    expect(rep.monthly).toBe(40_000);
    expect(rep.annualCollection).toBe(480_000);
    expect(rep.billsLast12).toBe(275_000);
    expect(rep.cushion).toBe(205_000);
  });

  it('skipped months put nothing into escrow', () => {
    const s = generateSchedule(setup, { adjustments: [{ kind: 'skip', payment: 2, mode: 'capitalize' }] });
    const rep = escrowReport(s.rows, new Map([[1, '2025-04-01'], [3, '2025-06-01']]), [], '2025-06-15');
    expect(rep.balance).toBe(2 * 40_000);
  });
});
