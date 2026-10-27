import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { HttpError, MortgageService } from './service.js';
import { FakeSource, MORTGAGE_CATEGORY, SAMPLE_SETUP } from './testing.js';

let store: Store;
let source: FakeSource;
let service: MortgageService;

beforeEach(() => {
  store = new Store(':memory:');
  source = new FakeSource();
  service = new MortgageService(store, source, () => '2025-06-15');
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
    const empty = new MortgageService(new Store(':memory:'), source, () => '2025-06-15');
    const s = empty.state();
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
    expect(store.listAdjustments()).toHaveLength(0);
  });

  it('undo removes the match and the adjustments it created', async () => {
    source.add('t1', '2025-04-01', -(row(1).total + 4_000));
    await service.match(1, { transactionId: 't1' });
    service.resolve(1, { resolution: 'escrow' });
    service.unmatch(1);
    expect(row(1).status).toBe('scheduled');
    expect(row(2).escrow).toBe(41_250);
    expect(store.listAdjustments()).toHaveLength(0);
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
    expect(store.listAdjustments().filter((a) => a.adjustment.kind === 'skip')).toHaveLength(1);
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
    expect(store.listAdjustments().at(-1)!.adjustment).toEqual({ kind: 'skip', payment: 3, mode: 'defer' });
  });
});

describe('equity, periods and escrow in state', () => {
  it('reports equity from the original value until an estimate is added', () => {
    let s = service.state();
    expect(s.analysis!.equity).toMatchObject({ isEstimate: false, homeValue: SAMPLE_SETUP.originalHomeValue });
    s = service.addHomeValue({ date: '2025-06-01', value: 37_000_000, source: 'Online estimate' });
    expect(s.analysis!.equity).toMatchObject({ isEstimate: true, homeValue: 37_000_000, homeValueSource: 'Online estimate' });
    expect(s.summary!.marketEquity).toBe(37_000_000 - s.summary!.balance);
    const id = s.homeValues[0]!.id;
    expect(service.deleteHomeValue(id).homeValues).toHaveLength(0);
  });

  it('validates home values', async () => {
    await expectHttp(() => service.addHomeValue({ date: 'June', value: 1 }), 400);
    await expectHttp(() => service.addHomeValue({ date: '2025-06-01', value: -5 }), 400);
    await expectHttp(() => service.addHomeValue({ date: '2025-06-01', value: 12.5 }), 400);
    await expectHttp(() => service.deleteHomeValue(12345), 404);
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
