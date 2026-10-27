import { describe, expect, it } from 'vitest';
import {
  dueDateFor,
  generateSchedule,
  lockRow,
  SetupError,
  standardPayment,
  toCents,
  type Adjustment,
  type LoanSetup,
  type LockedPayment,
} from './index.js';

// Made-up sample loan. Not real numbers.
const base: LoanSetup = {
  originalAmount: 30_000_000,
  annualRatePercent: 6.5,
  termYears: 30,
  openDate: '2025-02-14',
  firstPaymentDate: '2025-04-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 37_500_000,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 0,
  extraPrincipal: 0,
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('money helpers', () => {
  it('computes textbook monthly payments', () => {
    expect(standardPayment(30_000_000, 6.5, 360)).toBe(189_620);
    expect(standardPayment(20_000_000, 4, 360)).toBe(95_483);
    expect(standardPayment(12_000_000, 0, 120)).toBe(100_000);
  });

  it('parses user-entered dollars into cents', () => {
    expect(toCents('1,234.56')).toBe(123_456);
    expect(toCents('$1234.5')).toBe(123_450);
    expect(toCents('0.07')).toBe(7);
    expect(toCents(19.99)).toBe(1_999);
    expect(toCents('abc')).toBeNull();
    expect(toCents('')).toBeNull();
  });
});

describe('due dates', () => {
  it('rolls forward month by month', () => {
    expect(dueDateFor('2025-04-01', 1, 1)).toBe('2025-04-01');
    expect(dueDateFor('2025-04-01', 1, 10)).toBe('2026-01-01');
    expect(dueDateFor('2025-04-01', 1, 360)).toBe('2055-03-01');
  });

  it('clamps the payment day to short months', () => {
    expect(dueDateFor('2025-01-31', 31, 2)).toBe('2025-02-28');
    expect(dueDateFor('2027-01-31', 31, 2)).toBe('2027-02-28');
    expect(dueDateFor('2028-01-31', 31, 2)).toBe('2028-02-29');
    expect(dueDateFor('2025-01-31', 31, 3)).toBe('2025-03-31');
  });
});

describe('schedule math', () => {
  const s = generateSchedule(base);

  it('splits the first payment into interest and principal', () => {
    const first = s.rows[0]!;
    expect(s.piPayment).toBe(189_620);
    expect(first.interest).toBe(162_500); // 300,000 * 6.5% / 12
    expect(first.scheduledPrincipal).toBe(27_120);
    expect(first.endingBalance).toBe(30_000_000 - 27_120);
  });

  it('pays off exactly over the term', () => {
    expect(s.rows).toHaveLength(360);
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
    expect(sum(s.rows.map((r) => r.principal))).toBe(base.originalAmount);
    expect(s.totals.principal).toBe(base.originalAmount);
  });

  it('chains balances with no gaps', () => {
    for (let i = 1; i < s.rows.length; i++) {
      expect(s.rows[i]!.beginningBalance).toBe(s.rows[i - 1]!.endingBalance);
    }
  });

  it('keeps every payment equal except the final one', () => {
    for (const r of s.rows.slice(0, -1)) expect(r.principalAndInterest).toBe(189_620);
    const last = s.rows.at(-1)!;
    // 360 months of sub-cent rounding add up to a few dollars on the last payment.
    expect(Math.abs(last.principalAndInterest - 189_620)).toBeLessThan(189_620 * 0.01);
  });

  it('handles a zero-percent loan', () => {
    const z = generateSchedule({ ...base, originalAmount: 12_000_000, annualRatePercent: 0, termYears: 10 });
    expect(z.rows).toHaveLength(120);
    expect(z.totals.interest).toBe(0);
    expect(z.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('uses the P&I override to match a bank statement', () => {
    const o = generateSchedule({ ...base, piPaymentOverride: 189_625 });
    expect(o.calculatedPiPayment).toBe(189_620);
    expect(o.piPayment).toBe(189_625);
    expect(o.rows[0]!.scheduledPrincipal).toBe(27_125);
    expect(o.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('adds escrow into the monthly total but never into principal', () => {
    const e = generateSchedule({ ...base, escrowMonthly: 41_250 });
    expect(e.rows[0]!.total).toBe(189_620 + 41_250);
    expect(e.rows[0]!.principal).toBe(27_120);
    expect(e.totals.escrow).toBe(41_250 * 360);
  });

  it('rejects a payment that cannot cover interest', () => {
    expect(() => generateSchedule({ ...base, piPaymentOverride: 150_000 })).toThrow(SetupError);
  });

  it('reports every setup problem at once', () => {
    try {
      generateSchedule({ ...base, originalAmount: 0, termYears: 0, firstPaymentDate: '2025-02-30' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SetupError);
      expect((e as SetupError).problems.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('extra principal', () => {
  const plain = generateSchedule(base);

  it('standing extra shortens the loan and cuts interest', () => {
    const x = generateSchedule({ ...base, extraPrincipal: 20_000 });
    expect(x.rows[0]!.extraPrincipal).toBe(20_000);
    expect(x.rows[0]!.principal).toBe(27_120 + 20_000);
    expect(x.rows.length).toBeLessThan(plain.rows.length);
    expect(x.totals.interest).toBeLessThan(plain.totals.interest);
    expect(x.totals.principal).toBe(base.originalAmount);
    expect(x.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('one-time extra affects only its month directly and later balances', () => {
    const adj: Adjustment[] = [{ kind: 'extraPrincipal', payment: 3, amount: 500_000 }];
    const x = generateSchedule(base, { adjustments: adj });
    expect(x.rows[1]!.extraPrincipal).toBe(0);
    expect(x.rows[2]!.extraPrincipal).toBe(500_000);
    expect(x.rows[3]!.extraPrincipal).toBe(0);
    expect(x.rows[2]!.endingBalance).toBe(plain.rows[2]!.endingBalance - 500_000);
    expect(x.rows[3]!.interest).toBeLessThan(plain.rows[3]!.interest);
  });

  it('a standing-extra change takes effect from its payment onward', () => {
    const adj: Adjustment[] = [{ kind: 'standingExtra', fromPayment: 13, amount: 10_000 }];
    const x = generateSchedule({ ...base, extraPrincipal: 5_000 }, { adjustments: adj });
    expect(x.rows[11]!.extraPrincipal).toBe(5_000);
    expect(x.rows[12]!.extraPrincipal).toBe(10_000);
    expect(x.rows[100]!.extraPrincipal).toBe(10_000);
  });

  it('never overpays the final balance', () => {
    const x = generateSchedule({ ...base, extraPrincipal: 5_000_000 });
    for (const r of x.rows) expect(r.endingBalance).toBeGreaterThanOrEqual(0);
    expect(x.rows.at(-1)!.endingBalance).toBe(0);
    expect(x.totals.principal).toBe(base.originalAmount);
  });
});

describe('penny offsets', () => {
  const plain = generateSchedule(base);

  it('moves a few cents into principal for one month only', () => {
    const x = generateSchedule(base, { adjustments: [{ kind: 'pennyOffset', payment: 5, amount: 3 }] });
    const r = x.rows[4]!;
    expect(r.pennyOffset).toBe(3);
    expect(r.principal).toBe(plain.rows[4]!.principal + 3);
    expect(r.total).toBe(plain.rows[4]!.total + 3);
    expect(r.endingBalance).toBe(plain.rows[4]!.endingBalance - 3);
    expect(x.rows[5]!.pennyOffset).toBe(0);
    expect(x.rows.at(-1)!.endingBalance).toBe(0);
    expect(x.totals.principal).toBe(base.originalAmount);
  });

  it('supports negative offsets when the bank took a cent less', () => {
    const x = generateSchedule(base, { adjustments: [{ kind: 'pennyOffset', payment: 1, amount: -2 }] });
    expect(x.rows[0]!.total).toBe(plain.rows[0]!.total - 2);
    expect(x.rows[0]!.endingBalance).toBe(plain.rows[0]!.endingBalance + 2);
    expect(x.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('stacks multiple offsets on the same month', () => {
    const x = generateSchedule(base, {
      adjustments: [
        { kind: 'pennyOffset', payment: 2, amount: 1 },
        { kind: 'pennyOffset', payment: 2, amount: 1 },
      ],
    });
    expect(x.rows[1]!.pennyOffset).toBe(2);
  });
});

describe('escrow changes', () => {
  it('applies a new escrow amount from its payment forward', () => {
    const x = generateSchedule(
      { ...base, escrowMonthly: 40_000 },
      { adjustments: [{ kind: 'escrow', fromPayment: 13, amount: 43_500 }] },
    );
    expect(x.rows[11]!.escrow).toBe(40_000);
    expect(x.rows[12]!.escrow).toBe(43_500);
    expect(x.rows[200]!.escrow).toBe(43_500);
  });

  it('a later correction replaces an earlier one', () => {
    const x = generateSchedule(
      { ...base, escrowMonthly: 40_000 },
      {
        adjustments: [
          { kind: 'escrow', fromPayment: 13, amount: 43_500 },
          { kind: 'escrow', fromPayment: 25, amount: 41_000 },
        ],
      },
    );
    expect(x.rows[24]!.escrow).toBe(41_000);
  });
});

describe('locked (reconciled) months', () => {
  it('keep their amounts even if the setup changes later', () => {
    const first = generateSchedule({ ...base, escrowMonthly: 40_000 });
    const locked = new Map<number, LockedPayment>([
      [1, lockRow(first.rows[0]!)],
      [2, lockRow(first.rows[1]!)],
    ]);
    const edited = generateSchedule({ ...base, escrowMonthly: 45_000 }, { locked });
    expect(edited.rows[0]!.escrow).toBe(40_000);
    expect(edited.rows[0]!.locked).toBe(true);
    expect(edited.rows[1]!.escrow).toBe(40_000);
    expect(edited.rows[2]!.escrow).toBe(45_000);
    expect(edited.rows[2]!.beginningBalance).toBe(first.rows[1]!.endingBalance);
  });
});
