import { describe, expect, it } from 'vitest';
import {
  analyzeEquity,
  escrowReport,
  generateSchedule,
  lockRow,
  periodBreakouts,
  SetupError,
  summarize,
  validateSetup,
  type LoanSetup,
} from './index.js';

// Made-up loan, 12 years in when tracking starts. Not real numbers.
const original: LoanSetup = {
  originalAmount: 30_000_000,
  annualRatePercent: 4.25,
  termYears: 30,
  openDate: '2014-10-20',
  firstPaymentDate: '2014-12-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 37_500_000,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 45_000,
  extraPrincipal: 0,
};

const plain = generateSchedule(original);
// Payment 144 is due 2026-11-01. Extra principal was paid at unknown times before that.
const N = 144;
const scheduledBalance = plain.rows[N - 1]!.endingBalance;
const extraPaid = 2_345_678;
const setup: LoanSetup = { ...original, startingPoint: { payment: N, balance: scheduledBalance - extraPaid } };
const schedule = generateSchedule(setup);
const today = '2026-11-15';

describe('a loan already under way', () => {
  it('follows the original schedule before tracking and lands on the statement balance', () => {
    const rows = schedule.rows;
    expect(rows[N - 1]!.dueDate).toBe('2026-11-01');
    expect(rows.slice(0, N).every((r) => r.beforeTracking)).toBe(true);
    expect(rows.slice(N).some((r) => r.beforeTracking)).toBe(false);
    // Identical to the original schedule up to the last payment before tracking.
    for (let i = 0; i < N - 1; i++) {
      expect(rows[i]).toMatchObject({ endingBalance: plain.rows[i]!.endingBalance, extraPrincipal: 0, interest: plain.rows[i]!.interest });
    }
    expect(rows[N - 1]!.extraPrincipal).toBe(extraPaid);
    expect(rows[N - 1]!.endingBalance).toBe(setup.startingPoint!.balance);
    expect(rows[N]!.beginningBalance).toBe(setup.startingPoint!.balance);
  });

  it('keeps the same payment, so the extra paid earlier brings the payoff forward', () => {
    expect(schedule.piPayment).toBe(plain.piPayment);
    expect(schedule.rows.length).toBeLessThan(plain.rows.length);
    expect(schedule.rows[N]!.principalAndInterest).toBe(plain.piPayment);
  });

  it('ignores skips, extras and offsets recorded before tracking', () => {
    const withAdjustments = generateSchedule(setup, {
      adjustments: [
        { kind: 'skip', payment: 10, mode: 'capitalize' },
        { kind: 'extraPrincipal', payment: 20, amount: 50_000 },
        { kind: 'pennyOffset', payment: 30, amount: 3 },
        { kind: 'standingExtra', fromPayment: 1, amount: 10_000 },
      ],
    });
    const before = withAdjustments.rows.slice(0, N);
    expect(before.map((r) => r.endingBalance)).toEqual(schedule.rows.slice(0, N).map((r) => r.endingBalance));
    // The standing extra still applies once tracking starts.
    expect(withAdjustments.rows[N]!.extraPrincipal).toBe(10_000);
  });

  it('allows a starting balance a little above the original schedule', () => {
    const higher = generateSchedule({ ...original, startingPoint: { payment: N, balance: scheduledBalance + 1_234 } });
    expect(higher.rows[N - 1]!.extraPrincipal).toBe(-1_234);
    expect(higher.rows[N - 1]!.endingBalance).toBe(scheduledBalance + 1_234);
  });

  it('rejects a starting point outside the loan', () => {
    const at = (payment: number, balance: number) => validateSetup({ ...original, startingPoint: { payment, balance } });
    expect(at(0, 1_000_000)).toHaveLength(1);
    expect(at(360, 1_000_000)).toHaveLength(1);
    expect(at(1.5, 1_000_000)).toHaveLength(1);
    expect(at(N, 0)).toHaveLength(1);
    expect(at(N, original.originalAmount + 1)).toHaveLength(1);
    expect(at(N, 1_000_000)).toEqual([]);
    expect(validateSetup({ ...original, startingPoint: null })).toEqual([]);
  });

  it('refuses a schedule that pays off before tracking starts', () => {
    const fast = { ...original, piPaymentOverride: 1_000_000, startingPoint: { payment: N, balance: 1_000_000 } };
    expect(() => generateSchedule(fast)).toThrow(SetupError);
  });

  it('counts payments before tracking as paid in the summary', () => {
    const s = summarize(setup, schedule, new Set(), today);
    expect(s.lastPaidPayment).toBe(N);
    expect(s.paymentsMade).toBe(N);
    expect(s.balance).toBe(setup.startingPoint!.balance);
    expect(s.nextPayment).toMatchObject({ payment: N + 1, dueDate: '2026-12-01' });
    expect(s.percentPaid).toBeCloseTo(((30_000_000 - setup.startingPoint!.balance) / 30_000_000) * 100, 2);
    expect(s.equity).toBe(37_500_000 - setup.startingPoint!.balance);
  });

  it('shows the extra paid before tracking as its own part of equity', () => {
    const e = analyzeEquity(setup, schedule, new Set(), today);
    expect(e.balance).toBe(setup.startingPoint!.balance);
    expect(e.parts.extraBeforeTracking).toBe(extraPaid);
    expect(e.parts.extraPrincipal).toBe(0);
    expect(e.parts.skipped).toBe(0);
    const p = e.parts;
    expect(p.startingEquity + p.principalPaid + p.extraPrincipal + p.extraBeforeTracking + p.marketChange + p.skipped).toBe(e.equity);
  });

  it('counts payments before tracking by due date in the paid breakouts', () => {
    const b = periodBreakouts(schedule.rows, new Map(), today, 'paid');
    expect(b.loanToDate.totals.payments).toBe(N);
    expect(b.yearToDate.totals.payments).toBe(11); // Jan-Nov 2026
    expect(b.loanToDate.totals.extraPrincipal).toBe(extraPaid);
    // ...but not in the month it happens to be recorded on.
    expect(b.month.totals.extraPrincipal).toBe(0);
    expect(b.yearToDate.totals.extraPrincipal).toBe(0);
    expect(b.month.totals.total).toBe(schedule.rows[N - 1]!.total - extraPaid);
  });

  it('leaves payments before tracking out of the escrow ledger', () => {
    const rep = escrowReport(schedule.rows, new Map(), [{ id: 1, date: '2026-11-01', kind: 'deposit', amount: 310_000, note: 'Balance per statement' }], today);
    expect(rep.lines.map((l) => l.kind)).toEqual(['deposit']);
    expect(rep.balance).toBe(310_000);
    expect(rep.monthly).toBe(45_000);
  });

  it('never locks a payment made before tracking', () => {
    expect(() => lockRow(schedule.rows[0]!)).toThrow();
    expect(lockRow(schedule.rows[N]!)).not.toHaveProperty('beforeTracking');
  });

  it('keeps the PMI dates on the original schedule', () => {
    const withPmi = { ...original, originalAmount: 33_000_000, pmiMonthly: 12_000 };
    const a = generateSchedule(withPmi);
    const b = generateSchedule({ ...withPmi, startingPoint: { payment: 24, balance: a.rows[23]!.endingBalance - 1_000_000 } });
    expect(b.pmi.auto78Scheduled).toEqual(a.pmi.auto78Scheduled);
    expect(b.pmi.request80.payment).toBeLessThan(a.pmi.request80.payment!);
  });
});
