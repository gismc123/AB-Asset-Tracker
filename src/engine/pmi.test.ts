import { describe, expect, it } from 'vitest';
import { generateSchedule, type LoanSetup, type PmiMilestone, type ScheduleRow } from './index.js';

// Made-up sample loan with 10% down, so PMI applies. Not real numbers.
const loan: LoanSetup = {
  originalAmount: 31_500_000,
  annualRatePercent: 6.75,
  termYears: 30,
  openDate: '2025-05-20',
  firstPaymentDate: '2025-07-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 35_000_000,
  pmiMonthly: 13_100,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 38_000,
  extraPrincipal: 0,
};

function expectCrossing(rows: ScheduleRow[], m: PmiMilestone) {
  expect(m.payment).not.toBeNull();
  const row = rows[m.payment! - 1]!;
  expect(row.endingBalance).toBeLessThanOrEqual(m.thresholdBalance);
  expect(row.beginningBalance).toBeGreaterThan(m.thresholdBalance);
  expect(m.dueDate).toBe(row.dueDate);
}

describe('PMI thresholds', () => {
  const s = generateSchedule(loan);

  it('uses 80% and 78% of the original home value', () => {
    expect(s.pmi.request80.thresholdBalance).toBe(28_000_000);
    expect(s.pmi.auto78Scheduled.thresholdBalance).toBe(27_300_000);
  });

  it('finds the exact payment where each threshold is crossed', () => {
    expectCrossing(s.rows, s.pmi.request80);
    expectCrossing(s.rows, s.pmi.auto78Actual);
    expect(s.pmi.request80.payment!).toBeLessThan(s.pmi.auto78Actual.payment!);
  });

  it('charges PMI through the 78% payment and drops it after', () => {
    const at78 = s.pmi.auto78Scheduled.payment!;
    expect(s.pmi.hasPmi).toBe(true);
    expect(s.pmi.dropPayment).toBe(at78 + 1);
    expect(s.rows[at78 - 1]!.pmi).toBe(13_100);
    expect(s.rows[at78]!.pmi).toBe(0);
    expect(s.rows[at78]!.total).toBe(s.rows[at78]!.principalAndInterest + 38_000);
    for (const r of s.rows.slice(at78)) expect(r.pmi).toBe(0);
    expect(s.totals.pmi).toBe(13_100 * at78);
  });

  it('respects a PMI start date', () => {
    const late = generateSchedule({ ...loan, pmiStartDate: '2025-09-01' });
    expect(late.rows[0]!.pmi).toBe(0);
    expect(late.rows[1]!.pmi).toBe(0);
    expect(late.rows[2]!.pmi).toBe(13_100);
  });

  it('has no PMI when the loan starts at or below 78%', () => {
    const low = generateSchedule({ ...loan, originalAmount: 27_000_000 });
    expect(low.pmi.request80.payment).toBe(0);
    expect(low.pmi.auto78Scheduled.payment).toBe(0);
    expect(low.pmi.hasPmi).toBe(false);
    expect(low.totals.pmi).toBe(0);
  });

  it('treats the home value as an editable input', () => {
    const appraisedLower = generateSchedule({ ...loan, originalHomeValue: 34_000_000 });
    expect(appraisedLower.pmi.request80.payment!).toBeGreaterThan(s.pmi.request80.payment!);
  });
});

describe('extra principal and PMI', () => {
  const plain = generateSchedule(loan);
  const extra = generateSchedule({ ...loan, extraPrincipal: 30_000 });

  it('pulls the 80% and actual-78% dates earlier', () => {
    expect(extra.pmi.request80.payment!).toBeLessThan(plain.pmi.request80.payment!);
    expect(extra.pmi.auto78Actual.payment!).toBeLessThan(plain.pmi.auto78Actual.payment!);
    expect(extra.pmi.paymentsSavedByExtra).toBe(plain.pmi.request80.payment! - extra.pmi.request80.payment!);
    expect(extra.pmi.paymentsSavedByExtra).toBeGreaterThan(0);
  });

  it('does not move the federal automatic (original schedule) date', () => {
    expect(extra.pmi.auto78Scheduled.payment).toBe(plain.pmi.auto78Scheduled.payment);
  });

  it('drops PMI at 80% under the request rule', () => {
    const r = generateSchedule({ ...loan, extraPrincipal: 30_000, pmiRemovalRule: 'request80' });
    expect(r.pmi.dropPayment).toBe(r.pmi.request80.payment! + 1);
    expect(r.rows[r.pmi.request80.payment!]!.pmi).toBe(0);
  });

  it('drops PMI at real 78% under the actual-balance rule', () => {
    const r = generateSchedule({ ...loan, extraPrincipal: 30_000, pmiRemovalRule: 'auto78Actual' });
    expect(r.pmi.dropPayment).toBe(r.pmi.auto78Actual.payment! + 1);
  });

  it('a one-time lump sum can cross 80% immediately', () => {
    const r = generateSchedule(
      { ...loan, pmiRemovalRule: 'request80' },
      { adjustments: [{ kind: 'extraPrincipal', payment: 6, amount: 4_000_000 }] },
    );
    expect(r.pmi.request80.payment).toBe(6);
    expect(r.pmi.dropPayment).toBe(7);
  });
});

describe('federal backstops', () => {
  it('ends PMI at the loan midpoint when 78% comes later', () => {
    // Made-up underwater-at-purchase example so 78% is reached after the midpoint.
    const s = generateSchedule({ ...loan, originalAmount: 29_100_000, originalHomeValue: 27_000_000, annualRatePercent: 7 });
    expect(s.pmi.auto78Scheduled.payment!).toBeGreaterThan(180);
    expect(s.pmi.midpoint.payment).toBe(180);
    expect(s.pmi.dropPayment).toBe(181);
    expect(s.rows[179]!.pmi).toBe(13_100);
    expect(s.rows[180]!.pmi).toBe(0);
  });

  it('never keeps PMI past the automatic date, even under the request rule', () => {
    const s = generateSchedule({ ...loan, pmiRemovalRule: 'request80' });
    expect(s.pmi.dropPayment!).toBeLessThanOrEqual(s.pmi.auto78Scheduled.payment! + 1);
  });
});

describe('PMI changes', () => {
  it('a new PMI amount applies from its payment until the drop', () => {
    const s = generateSchedule(loan, { adjustments: [{ kind: 'pmi', fromPayment: 13, amount: 12_500 }] });
    expect(s.rows[11]!.pmi).toBe(13_100);
    expect(s.rows[12]!.pmi).toBe(12_500);
    expect(s.rows[s.pmi.dropPayment! - 1]!.pmi).toBe(0);
  });

  it('PMI of zero recorded early moves the drop date up', () => {
    const s = generateSchedule(loan, { adjustments: [{ kind: 'pmi', fromPayment: 40, amount: 0 }] });
    expect(s.pmi.dropPayment).toBe(40);
  });

  it('a PMI charge recorded after the planned drop overrides the plan', () => {
    const planned = generateSchedule(loan).pmi.dropPayment!;
    const s = generateSchedule(loan, { adjustments: [{ kind: 'pmi', fromPayment: planned + 1, amount: 13_100 }] });
    expect(s.rows[planned - 1]!.pmi).toBe(0);
    expect(s.rows[planned]!.pmi).toBe(13_100);
  });
});

describe('keeping PMI until it is removed', () => {
  const kept = generateSchedule({ ...loan, pmiRemovalRule: 'untilRemoved' });
  const standard = generateSchedule(loan);

  it('charges PMI past 78% and the midpoint, through the last payment', () => {
    expect(kept.rows[kept.pmi.auto78Scheduled.payment!]!.pmi).toBe(13_100);
    expect(kept.rows[kept.pmi.midpoint.payment]!.pmi).toBe(13_100);
    expect(kept.rows.every((r) => r.pmi === 13_100)).toBe(true);
    expect(kept.pmi.hasPmi).toBe(true);
    expect(kept.pmi.dropPayment).toBeNull();
    expect(kept.pmi.dropDate).toBeNull();
    expect(kept.totals.pmi).toBe(13_100 * kept.rows.length);
  });

  it('still reports the milestones, for reference', () => {
    expect(kept.pmi.request80).toEqual(standard.pmi.request80);
    expect(kept.pmi.auto78Scheduled).toEqual(standard.pmi.auto78Scheduled);
    expect(kept.pmi.midpoint).toEqual(standard.pmi.midpoint);
  });

  it('stops PMI where a PMI change of zero is recorded', () => {
    const removed = generateSchedule({ ...loan, pmiRemovalRule: 'untilRemoved' }, { adjustments: [{ kind: 'pmi', fromPayment: 200, amount: 0 }] });
    expect(removed.rows[198]!.pmi).toBe(13_100);
    expect(removed.rows.slice(199).every((r) => r.pmi === 0)).toBe(true);
    expect(removed.pmi.dropPayment).toBe(200);
  });

  it('lets a recorded removal end PMI early under the other rules too', () => {
    const early = generateSchedule(loan, { adjustments: [{ kind: 'pmi', fromPayment: 50, amount: 0 }] });
    expect(early.pmi.dropPayment).toBe(50);
    expect(early.rows[48]!.pmi).toBe(13_100);
    expect(early.rows[49]!.pmi).toBe(0);
  });
});
