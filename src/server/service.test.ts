import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { HttpError, LoanService, TrackerService } from './service.js';
import { AUTO_SETUP, CAR_CATEGORY, FakeSource, MORTGAGE_CATEGORY, SAMPLE_SETUP } from './testing.js';

let store: Store;
let source: FakeSource;
let tracker: TrackerService;
let service: LoanService;

beforeEach(() => {
  store = new Store(':memory:');
  source = new FakeSource();
  tracker = new TrackerService(store, source, () => '2025-06-15');
  const { loan } = tracker.createLoan({ nickname: 'Mortgage', type: 'mortgage' });
  service = tracker.loan(loan.id);
  service.saveSetup(SAMPLE_SETUP);
  service.saveSettings({ categoryId: MORTGAGE_CATEGORY });
});

const row = (n: number) => service.state().schedule!.rows[n - 1]!;

async function expectHttp(p: Promise<unknown> | (() => unknown), status: number) {
  try {
    await (typeof p === 'function' ? p() : p);
    expect.unreachable('expected an HttpError');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
  }
}

describe('setup', () => {
  it('reports no schedule until the loan is set up', () => {
    const t = new TrackerService(new Store(':memory:'), source, () => '2025-06-15');
    const s = t.loan(t.createLoan({ nickname: 'Car', type: 'auto' }).loan.id).state();
    expect(s.setup).toBeNull();
    expect(s.schedule).toBeNull();
  });

  it('rejects an invalid setup with every problem listed', async () => {
    await expectHttp(() => service.saveSetup({ ...SAMPLE_SETUP, originalAmount: -5, termYears: 0 }), 400);
  });

  it('builds the schedule and opens the first unpaid month', () => {
    const s = service.state();
    expect(s.schedule!.rows).toHaveLength(360);
    expect(s.schedule!.currentPayment).toBe(1);
    expect(s.schedule!.rows.every((r) => r.status === 'scheduled')).toBe(true);
  });
});

describe('reconciliation flow', () => {
  it('lists matching transactions near the due date, exact match first', async () => {
    const total = row(1).total;
    source.add('t-far', '2025-07-15', -total); // outside the window
    source.add('t-off', '2025-03-30', -(total + 5_000));
    source.add('t-exact', '2025-04-01', -total);
    source.add('t-refund', '2025-04-02', 1_000);
    source.add('t-other', '2025-04-01', -total, 'cat-utilities');

    const c = await service.candidates(1, undefined);
    expect(c.map((t) => t.id)).toEqual(['t-exact', 't-off']);
    expect(c[0]).toMatchObject({ matchesSchedule: true, difference: 0, paid: total });
    expect(c[1]).toMatchObject({ matchesSchedule: false, difference: 5_000 });
  });

  it('flips an exact match straight to paid and locks the amounts', async () => {
    source.add('t1', '2025-04-01', -row(1).total);
    const result = await service.match(1, { transactionId: 't1' });
    expect(result).toMatchObject({ status: 'paid', difference: 0, suggestions: [] });

    const s = service.state();
    expect(s.schedule!.rows[0]!.status).toBe('paid');
    expect(s.schedule!.rows[0]!.locked).toBe(true);
    expect(s.schedule!.currentPayment).toBe(2);
    expect(s.summary!.lastPaidPayment).toBe(1);
  });

  it('keeps a paid month unchanged when the setup is edited later', async () => {
    const before = row(1);
    source.add('t1', '2025-04-01', -before.total);
    await service.match(1, { transactionId: 't1' });
    service.saveSetup({ ...SAMPLE_SETUP, escrowMonthly: 50_000 });
    expect(row(1).escrow).toBe(before.escrow);
    expect(row(2).escrow).toBe(50_000);
  });

  it('flags a mismatch and asks what the difference is', async () => {
    source.add('t1', '2025-04-01', -(row(1).total + 3));
    const result = await service.match(1, { transactionId: 't1' });
    expect(result.status).toBe('flagged');
    expect(result.difference).toBe(3);
    expect(result.suggestions[0]).toBe('rounding');
    expect(row(1).status).toBe('flagged');
  });

  it('suggests escrow or PMI for a short payment', async () => {
    source.add('t1', '2025-04-01', -(row(1).total - 2_500));
    const result = await service.match(1, { transactionId: 't1' });
    expect(result.suggestions).toEqual(['escrow', 'pmi']);
  });

  it('rounding: offsets this month only, then marks it paid', async () => {
    const bank = row(1).total + 3;
    source.add('t1', '2025-04-01', -bank);
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'rounding' });
    expect(row(1)).toMatchObject({ status: 'paid', total: bank, pennyOffset: 3 });
    expect(row(2).pennyOffset).toBe(0);
  });

  it('escrow change: recalculates every later month', async () => {
    source.add('t1', '2025-04-01', -(row(1).total + 4_000));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'escrow' });
    expect(row(1).escrow).toBe(45_250);
    expect(row(2).escrow).toBe(45_250);
    expect(row(300).escrow).toBe(45_250);
  });

  it('PMI change: recalculates every later month until the drop', async () => {
    source.add('t1', '2025-04-01', -(row(1).total - 1_000));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'pmi' });
    expect(row(1).pmi).toBe(13_800);
    expect(row(2).pmi).toBe(13_800);
  });

  it('extra principal: one-time, later balances recalculate', async () => {
    const plain2 = row(2);
    source.add('t1', '2025-04-01', -(row(1).total + 100_000));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'extraPrincipal' });
    expect(row(1).extraPrincipal).toBe(100_000);
    expect(row(2).extraPrincipal).toBe(0);
    expect(row(2).interest).toBeLessThan(plain2.interest);
  });

  it('extra principal: standing, repeats every later month', async () => {
    source.add('t1', '2025-04-01', -(row(1).total + 20_000));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'extraPrincipal', standing: true });
    expect(row(2).extraPrincipal).toBe(20_000);
    expect(row(50).extraPrincipal).toBe(20_000);
  });

  it('refuses an answer that cannot explain the difference and stays flagged', async () => {
    source.add('t1', '2025-04-01', -(row(1).total + 5_000));
    await service.match(1, { transactionId: 't1' });
    await expectHttp(() => service.resolve(1, { resolution: 'rounding' }), 400);
    expect(row(1).status).toBe('flagged');
    expect(store.loan(1).listAdjustments()).toHaveLength(0);
  });

  it('undo removes the match and the adjustments it created', async () => {
    source.add('t1', '2025-04-01', -(row(1).total + 4_000));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'escrow' });
    service.unmatch(1);
    expect(row(1).status).toBe('scheduled');
    expect(row(2).escrow).toBe(41_250);
    expect(store.loan(1).listAdjustments()).toHaveLength(0);
  });

  it('will not reuse one transaction for two months', async () => {
    source.add('t1', '2025-04-01', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    await expectHttp(service.match(2, { transactionId: 't1' }), 409);
    const c = await service.candidates(2, undefined, true);
    expect(c.find((t) => t.id === 't1')?.usedByPayment).toBe(1);
  });

  it('will not re-match a paid month without undoing it first', async () => {
    source.add('t1', '2025-04-01', -row(1).total);
    source.add('t2', '2025-04-02', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    await expectHttp(service.match(1, { transactionId: 't2' }), 409);
  });

  it('requires a category', async () => {
    service.saveSettings({ categoryId: null });
    await expectHttp(service.candidates(1, undefined), 400);
  });
});

describe('manual penny offset', () => {
  it('sets, replaces, and clears an offset', () => {
    service.setOffset(3, { amount: 2 });
    expect(row(3).pennyOffset).toBe(2);
    service.setOffset(3, { amount: -1 });
    expect(row(3).pennyOffset).toBe(-1);
    service.setOffset(3, { amount: 0 });
    expect(row(3).pennyOffset).toBe(0);
  });

  it('rejects anything bigger than a dollar', async () => {
    await expectHttp(() => service.setOffset(3, { amount: 250 }), 400);
  });
});

describe('skipped payments', () => {
  it('marks a month skipped, moves on to the next one, and can be undone', () => {
    const s = service.skip(1, { mode: 'capitalize' });
    expect(s.schedule!.rows[0]).toMatchObject({ status: 'skipped', skipped: 'capitalize', total: 0 });
    expect(s.schedule!.currentPayment).toBe(2);
    const undone = service.unskip(1);
    expect(undone.schedule!.rows[0]).toMatchObject({ status: 'scheduled', skipped: null });
  });

  it('replaces the mode when skipped again', () => {
    service.skip(2, { mode: 'capitalize' });
    const s = service.skip(2, { mode: 'defer' });
    expect(s.schedule!.rows[1]!.skipped).toBe('defer');
    expect(store.loan(1).listAdjustments().filter((a) => a.adjustment.kind === 'skip')).toHaveLength(1);
  });

  it('refuses bad modes, matched months, and matching a skipped month', async () => {
    await expectHttp(() => service.skip(1, { mode: 'later' }), 400);
    await expectHttp(() => service.skip(999, { mode: 'defer' }), 404);
    source.add('t1', '2025-04-01', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    await expectHttp(() => service.skip(1, { mode: 'defer' }), 409);
    service.skip(2, { mode: 'defer' });
    source.add('t2', '2025-05-01', -row(3).total);
    await expectHttp(service.match(2, { transactionId: 't2' }), 409);
  });

  it('survives a reopen (the skip mode is stored)', () => {
    service.skip(3, { mode: 'defer' });
    expect(store.loan(1).listAdjustments().at(-1)!.adjustment).toEqual({ kind: 'skip', payment: 3, mode: 'defer' });
  });
});

describe('equity, periods and escrow in state', () => {
  it('reports equity from the original value until an estimate is added', () => {
    let s = service.state();
    expect(s.analysis!.equity).toMatchObject({ isEstimate: false, homeValue: SAMPLE_SETUP.originalHomeValue });
    // Saving a mortgage's setup records its home.
    const asset = s.asset!;
    expect(asset).toMatchObject({ kind: 'home', originalValue: SAMPLE_SETUP.originalHomeValue, loanId: service.loan.id });
    const updated = tracker.addAssetValue(asset.id, { date: '2025-06-01', value: 37_000_000, source: 'Online estimate' });
    s = service.state();
    expect(s.analysis!.equity).toMatchObject({ isEstimate: true, homeValue: 37_000_000, homeValueSource: 'Online estimate' });
    expect(s.summary!.marketEquity).toBe(37_000_000 - s.summary!.balance);
    expect(s.summary!.asset).toMatchObject({ value: 37_000_000, valueEntered: true, equity: 37_000_000 - s.summary!.owed });
    tracker.deleteAssetValue(asset.id, updated.values[0]!.id);
    expect(service.state().asset!.values).toHaveLength(0);
  });

  it('validates asset values', async () => {
    const id = service.state().asset!.id;
    await expectHttp(() => tracker.addAssetValue(id, { date: 'June', value: 1 }), 400);
    await expectHttp(() => tracker.addAssetValue(id, { date: '2025-06-01', value: -5 }), 400);
    await expectHttp(() => tracker.addAssetValue(id, { date: '2025-06-01', value: 12.5 }), 400);
    await expectHttp(() => tracker.deleteAssetValue(id, 12345), 404);
    await expectHttp(() => tracker.addAssetValue(999, { date: '2025-06-01', value: 1 }), 404);
  });

  it('accepts a value of zero, for an asset that is a total loss', () => {
    const id = service.state().asset!.id;
    tracker.addAssetValue(id, { date: '2025-06-01', value: 0, source: 'Total loss' });
    const s = service.state().summary!;
    expect(s.asset).toMatchObject({ value: 0, equity: -s.owed, equityPercent: 0 });
  });

  it('puts paid escrow and recorded bills into the escrow ledger', async () => {
    source.add('t1', '2025-03-30', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    let s = service.addEscrowEntry({ date: '2025-04-20', kind: 'homeownersInsurance', amount: 150_000, note: 'Annual premium' });
    s = service.addEscrowEntry({ date: '2025-02-14', kind: 'deposit', amount: 200_000 });
    const esc = s.analysis!.escrow;
    expect(esc.lines.map((l) => l.kind)).toEqual(['deposit', 'payment', 'homeownersInsurance']);
    expect(esc.lines[1]).toMatchObject({ date: '2025-03-30', amount: SAMPLE_SETUP.escrowMonthly });
    expect(esc.balance).toBe(200_000 + SAMPLE_SETUP.escrowMonthly - 150_000);
    const id = esc.lines[2]!.entryId!;
    expect(service.deleteEscrowEntry(id).analysis!.escrow.lines).toHaveLength(2);
    await expectHttp(() => service.addEscrowEntry({ date: '2025-04-20', kind: 'groceries', amount: 100 }), 400);
  });

  it('breaks out paid amounts by period, dated by the bank', async () => {
    source.add('t1', '2025-03-30', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    const p = service.state().analysis!.periods;
    expect(p.paid.yearToDate.totals.payments).toBe(1);
    expect(p.paid.month.totals.payments).toBe(0); // paid in March; today is June
    expect(p.scheduled.yearToDate.totals.payments).toBe(3); // Apr, May, Jun due
  });
});

describe('loan details', () => {
  it('saves known fields and custom pairs, dropping blanks and unknown keys', () => {
    const s = service.saveDetails({
      fields: { servicerName: ' Sample Servicing Co ', loanNumber: '0000-1111', bogus: 'x', lenderName: '' },
      custom: [{ label: 'Escrow analysis month', value: 'March' }, { label: '', value: '' }],
    });
    expect(s.details).toEqual({
      fields: { servicerName: 'Sample Servicing Co', loanNumber: '0000-1111' },
      custom: [{ label: 'Escrow analysis month', value: 'March' }],
    });
  });

  it('rejects oversized input', async () => {
    await expectHttp(() => service.saveDetails({ fields: { notes: 'x'.repeat(5000) } }), 400);
    await expectHttp(() => service.saveDetails({ fields: {}, custom: Array.from({ length: 31 }, () => ({ label: 'a', value: 'b' })) }), 400);
  });
});

describe('catch-up plans', () => {
  it('spreads missed payments over later months and cleans up when the skip goes', () => {
    service.skip(2, { mode: 'catchUp' });
    service.skip(3, { mode: 'catchUp' });
    const s = service.setCatchUpPlan(3, { fromPayment: 5, months: 2 });
    const rows = s.schedule!.rows;
    expect(rows[4]!.catchUp!.total + rows[5]!.catchUp!.total).toBe(rows[1]!.pastDue + rows[2]!.pastDue);
    expect(s.summary!.pastDue).toBe(rows[1]!.pastDue + rows[2]!.pastDue); // both due dates passed (today 2025-06-15)

    // Changing the plan replaces it.
    service.setCatchUpPlan(2, { fromPayment: 6, months: 3 });
    expect(store.loan(1).listAdjustments().filter((a) => a.adjustment.kind === 'catchUpPlan')).toHaveLength(1);

    service.unskip(2);
    expect(store.loan(1).listAdjustments().filter((a) => a.adjustment.kind === 'catchUpPlan')).toHaveLength(1);
    service.unskip(3);
    expect(store.loan(1).listAdjustments().filter((a) => a.adjustment.kind === 'catchUpPlan')).toHaveLength(0);
  });

  it('validates the plan', async () => {
    await expectHttp(() => service.setCatchUpPlan(2, { fromPayment: 4, months: 1 }), 409); // not skipped
    service.skip(2, { mode: 'catchUp' });
    await expectHttp(() => service.setCatchUpPlan(2, { fromPayment: 2, months: 1 }), 400);
    await expectHttp(() => service.setCatchUpPlan(2, { fromPayment: 4, months: 0 }), 400);
    await expectHttp(() => service.setCatchUpPlan(2, { fromPayment: 359, months: 5 }), 400);
    service.skip(5, { mode: 'capitalize' });
    await expectHttp(() => service.setCatchUpPlan(2, { fromPayment: 4, months: 3 }), 409);
    source.add('t3', '2025-06-01', -row(3).total);
    await service.match(3, { transactionId: 't3' });
    await expectHttp(() => service.setCatchUpPlan(2, { fromPayment: 3, months: 1 }), 409);
  });

  it('a catch-up month reconciles against the larger amount', async () => {
    service.skip(1, { mode: 'catchUp' });
    service.setCatchUpPlan(1, { fromPayment: 2, months: 1 });
    source.add('t2', '2025-05-01', -row(2).total);
    expect(row(2).catchUp!.total).toBe(row(1).pastDue);
    expect((await service.match(2, { transactionId: 't2' })).status).toBe('paid');
    expect(service.state().summary!.pastDue).toBe(0);
  });

  it('only clears a plan from the missed month it repays', async () => {
    service.skip(2, { mode: 'catchUp' });
    service.setCatchUpPlan(2, { fromPayment: 5, months: 2 });
    const plans = () => store.loan(1).listAdjustments().filter((a) => a.adjustment.kind === 'catchUpPlan');
    await expectHttp(() => service.clearCatchUpPlan(4), 409);
    expect(plans()).toHaveLength(1);
    service.clearCatchUpPlan(2);
    expect(plans()).toHaveLength(0);
  });
});

describe('keeping PMI until it is removed', () => {
  beforeEach(() => {
    service.saveSetup({ ...SAMPLE_SETUP, pmiRemovalRule: 'untilRemoved' });
  });
  const pmiChanges = (s: ReturnType<LoanService['state']>) => s.adjustments.filter((a) => a.adjustment.kind === 'pmi');

  it('keeps PMI in every payment and says so in the summary', () => {
    const s = service.state();
    expect(s.setup!.pmiRemovalRule).toBe('untilRemoved');
    expect(s.schedule!.rows.every((r) => r.pmi === SAMPLE_SETUP.pmiMonthly)).toBe(true);
    expect(s.summary!.pmi).toMatchObject({ active: true, dropPayment: null, paymentsUntilDrop: null, removalRule: 'untilRemoved' });
  });

  it('records the removal, replaces it, and undoes it', () => {
    let s = service.setPmiRemoval({ fromPayment: 100 });
    expect(s.schedule!.rows[98]!.pmi).toBe(SAMPLE_SETUP.pmiMonthly);
    expect(s.schedule!.rows[99]!.pmi).toBe(0);
    expect(s.schedule!.pmi.dropPayment).toBe(100);
    s = service.setPmiRemoval({ fromPayment: 120 });
    expect(s.schedule!.pmi.dropPayment).toBe(120);
    expect(pmiChanges(s)).toHaveLength(1);
    s = service.clearPmiRemoval();
    expect(s.schedule!.pmi.dropPayment).toBeNull();
    expect(pmiChanges(s)).toHaveLength(0);
  });

  it("can't start on or before a reconciled month, which keeps the PMI it paid", async () => {
    source.add('t1', '2025-04-01', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    await expectHttp(() => service.setPmiRemoval({ fromPayment: 1 }), 409);
    const s = service.setPmiRemoval({ fromPayment: 2 });
    expect(s.schedule!.rows[0]!.pmi).toBe(SAMPLE_SETUP.pmiMonthly);
    expect(s.schedule!.pmi.dropPayment).toBe(2);
  });

  it('leaves PMI changes made while reconciling alone', async () => {
    source.add('t1', '2025-04-01', -(row(1).total - SAMPLE_SETUP.pmiMonthly));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'pmi' });
    expect(pmiChanges(service.clearPmiRemoval())).toHaveLength(1);
  });

  it('rejects a bad payment number, and a loan without PMI', async () => {
    await expectHttp(() => service.setPmiRemoval({ fromPayment: 0 }), 400);
    await expectHttp(() => service.setPmiRemoval({ fromPayment: 9_999 }), 404);
    service.saveSetup({ ...SAMPLE_SETUP, modules: { pmi: false, escrow: true } });
    await expectHttp(() => service.setPmiRemoval({ fromPayment: 10 }), 409);
  });
});

describe('a loan already under way', () => {
  // Payments 1 and 2 (Apr and May 2025) were made before tracking; today is June 15.
  const underway = (balance = 31_500_000) => ({ ...SAMPLE_SETUP, startingPoint: { payment: 2, balance } });

  it('counts earlier payments as made and opens the first tracked one', () => {
    service.saveSetup(underway());
    const s = service.state();
    expect(s.setup!.startingPoint).toEqual({ payment: 2, balance: 31_500_000 });
    expect(s.schedule!.rows.slice(0, 2).map((r) => r.status)).toEqual(['history', 'history']);
    expect(row(3).status).toBe('scheduled');
    expect(s.schedule!.currentPayment).toBe(3);
    expect(s.summary).toMatchObject({ lastPaidPayment: 2, balance: 31_500_000 });
    expect(s.summary!.nextPayment!.payment).toBe(3);
  });

  it('has nothing to reconcile, skip or offset before tracking', async () => {
    service.saveSetup(underway());
    source.add('t1', '2025-04-01', -row(1).total);
    await expectHttp(service.candidates(1, undefined), 409);
    await expectHttp(service.match(1, { transactionId: 't1' }), 409);
    await expectHttp(() => service.skip(2, { mode: 'capitalize' }), 409);
    await expectHttp(() => service.setOffset(2, { amount: 1 }), 409);
    expect((await service.candidates(3, undefined)).length).toBe(0);
  });

  it('refuses a starting point after a month that is already reconciled or changed', async () => {
    source.add('t1', '2025-04-01', -row(1).total);
    await service.match(1, { transactionId: 't1' });
    await expectHttp(() => service.saveSetup(underway()), 409);
    service.unmatch(1);
    service.skip(2, { mode: 'capitalize' });
    await expectHttp(() => service.saveSetup(underway()), 409);
    service.unskip(2);
    service.saveSetup(underway());
    expect(row(1).status).toBe('history');
  });

  it('can be turned off again', () => {
    service.saveSetup(underway());
    service.saveSetup({ ...SAMPLE_SETUP, startingPoint: null });
    expect(service.state().schedule!.currentPayment).toBe(1);
    expect(row(1).status).toBe('scheduled');
  });

  it('rejects a malformed starting point', async () => {
    await expectHttp(() => service.saveSetup({ ...SAMPLE_SETUP, startingPoint: 'soon' }), 400);
    await expectHttp(() => service.saveSetup({ ...SAMPLE_SETUP, startingPoint: { payment: 2 } }), 400);
    await expectHttp(() => service.saveSetup(underway(0)), 400);
  });
});

describe('other loan types', () => {
  function carLoan(setup = AUTO_SETUP) {
    const { loan } = tracker.createLoan({ nickname: 'Car', type: 'auto', setup, categoryId: CAR_CATEGORY });
    return tracker.loan(loan.id);
  }

  it('creates a car loan without a home and offers no escrow or PMI answers', async () => {
    const car = carLoan();
    const s = car.state();
    expect(s.asset).toBeNull();
    expect(s.analysis!.equity).toBeNull();
    expect(s.summary!.asset).toBeNull();
    expect(s.settings.categoryId).toBe(CAR_CATEGORY);
    source.add('c1', '2025-04-10', -(s.schedule!.rows[0]!.total + 5_000), CAR_CATEGORY);
    const m = await car.match(1, { transactionId: 'c1' });
    expect(m.suggestions).toEqual(['extraPrincipal']);
    await expectHttp(() => car.resolve(1, { resolution: 'escrow' }), 400);
    await expectHttp(() => car.addEscrowEntry({ date: '2025-05-01', kind: 'propertyTax', amount: 1 }), 409);
  });

  it('works out daily interest to the day the bank paid', async () => {
    const car = carLoan({ ...AUTO_SETUP, interestMethod: 'daily', annualRatePercent: 7.3, originalAmount: 2_500_000 });
    const due = car.state().schedule!.rows[0]!;
    // Paid five days early: same total, less interest, more principal.
    source.add('c1', '2025-04-05', -due.total, CAR_CATEGORY);
    expect(await car.match(1, { transactionId: 'c1' })).toMatchObject({ status: 'paid' });
    const paid = car.state().schedule!.rows[0]!;
    expect(paid.locked).toBe(true);
    expect(paid.interest).toBe(due.interest - 2_500_000 * 0.0002 * 5);
    expect(paid.principal).toBe(due.principal + 2_500_000 * 0.0002 * 5);
    // The next month runs from April 5.
    const next = car.state().schedule!.rows[1]!;
    expect(next.interest).toBe(Math.round(paid.endingBalance * 0.0002 * 35));
  });

  it('keeps PMI and escrow answers for a mortgage', async () => {
    source.add('m1', '2025-04-01', -(row(1).total + 5_000));
    expect((await service.match(1, { transactionId: 'm1' })).suggestions).toEqual(['extraPrincipal', 'escrow', 'pmi']);
  });

  it('saves the new optional setup fields', () => {
    const car = carLoan();
    const s = car.saveSetup({
      ...AUTO_SETUP,
      downPayment: 600_000,
      fees: [{ label: 'Processing', amount: 29_900, financed: false }],
      yearlyFee: { basis: 'balance', percent: 0.25 },
      payoffQuote: { amount: 2_500_000, goodThrough: '2025-06-30' },
    });
    expect(s.setup).toMatchObject({ downPayment: 600_000, yearlyFee: { basis: 'balance', percent: 0.25 } });
    expect(s.schedule!.rows[0]!.fee).toBe(Math.round(3_000_000 * 0.0025));
    expect(s.summary!.payoff).toMatchObject({ source: 'quote', amount: 2_500_000 });
    expect(s.summary!.oneOffFees).toBe(29_900);
  });

  it('turns a term in months into whole years for older readers', () => {
    const s = carLoan({ ...AUTO_SETUP, termMonths: 18, termYears: 0 }).state();
    expect(s.setup).toMatchObject({ termMonths: 18, termYears: 2 });
    expect(s.schedule!.rows).toHaveLength(18);
  });
});
