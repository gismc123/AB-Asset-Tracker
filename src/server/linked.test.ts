import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { Store } from './db.js';
import { TrackerService } from './service.js';
import { AUTO_SETUP, CAR_CATEGORY, FakeSource } from './testing.js';

const TODAY = '2025-09-20';
let source: FakeSource;
let tracker: TrackerService;

/** A car loan on a vehicle bought for $36,000, with one value entered by hand. */
function carWithValue() {
  const { loan } = tracker.createLoan({
    nickname: 'Hatchback', type: 'auto', setup: AUTO_SETUP, categoryId: CAR_CATEGORY,
    asset: { name: 'Sample hatchback', kind: 'vehicle', originalValue: 3_600_000, valueTrend: 'manual' },
  });
  const asset = tracker.assets()[0]!;
  tracker.addAssetValue(asset.id, { date: '2025-08-01', value: 3_300_000, source: 'Pricing guide' });
  return { loan: tracker.loan(loan.id), asset };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  source = new FakeSource();
  // Made-up off-budget account: bought at 36,000.00, revalued down twice, one future-dated entry.
  source.addAccount('acct-car', 'Car value', [
    { date: '2025-03-10', amount: 3_600_000 },
    { date: '2025-06-30', amount: -250_000 },
    { date: '2025-09-01', amount: -125_050 },
    { date: '2025-12-31', amount: -999_999 },
  ]);
  source.addAccount('acct-loan', 'Car loan', [{ date: '2025-03-10', amount: -3_000_000 }]);
  source.addAccount('acct-checking', 'Checking', [{ date: '2025-01-01', amount: 100_000 }], false);
  tracker = new TrackerService(new Store(':memory:'), source, () => TODAY);
});

describe("asset value from an Actual account's balance", () => {
  it('reads nothing from Actual and changes nothing until an account is linked', async () => {
    const { loan } = carWithValue();
    await tracker.refreshLinked();
    expect(source.balanceReads).toBe(0);
    const s = loan.state();
    expect(s.assetValue).toEqual({ active: 'entered', account: null, problem: null });
    expect(s.summary!.asset).toMatchObject({ value: 3_300_000, valueSource: 'Pricing guide', valueEntered: true });
  });

  it("uses the account's balance, in cents and up to today, as the value", async () => {
    const { loan, asset } = carWithValue();
    tracker.updateAsset(asset.id, { actualAccountId: 'acct-car' });
    await tracker.refreshLinked();
    const s = loan.state();
    // 36,000.00 - 2,500.00 - 1,250.50; the December entry is in the future.
    const balance = 3_600_000 - 250_000 - 125_050;
    expect(s.assetValue).toMatchObject({ active: 'account', problem: null, account: { id: 'acct-car', name: 'Car value', balance, asOf: TODAY } });
    expect(s.summary!.asset).toMatchObject({ value: balance, valueDate: TODAY, valueSource: 'Actual account', valueEntered: true });
    expect(s.summary!.asset!.equity).toBe(balance - s.summary!.owed);
    expect(s.analysis!.equity).toMatchObject({ homeValue: balance, homeValueSource: 'Actual account', isEstimate: true });
    // The values entered by hand are kept as the fallback, and nothing is written to them.
    expect(s.asset!.values).toHaveLength(1);
    expect(s.asset!.actualAccountId).toBe('acct-car');
  });

  it('falls back to the values entered here, and says why', async () => {
    const { loan, asset } = carWithValue();
    tracker.updateAsset(asset.id, { actualAccountId: 'acct-car' });

    // Actual is down before the balance was ever read.
    source.down = true;
    await tracker.refreshLinked();
    let s = loan.state();
    expect(s.assetValue).toMatchObject({ active: 'entered', problem: expect.stringMatching(/Actual/) });
    expect(s.summary!.asset!.value).toBe(3_300_000);

    // Read once, then Actual goes down: the balance read earlier stays, flagged.
    source.down = false;
    await tracker.refreshLinked();
    // Balances are read again once they are 30 seconds old.
    vi.setSystemTime(Date.now() + 31_000);
    source.down = true;
    source.accounts[0]!.entries.push({ date: '2025-09-15', amount: -100_000 });
    await tracker.refreshLinked();
    s = loan.state();
    expect(s.assetValue).toMatchObject({ active: 'account', problem: expect.stringMatching(/Actual/) });
    expect(s.summary!.asset!.value).toBe(3_224_950);

    // A debt account has a negative balance and can't be a value.
    source.down = false;
    tracker.updateAsset(asset.id, { actualAccountId: 'acct-loan' });
    await tracker.refreshLinked();
    s = loan.state();
    expect(s.assetValue).toMatchObject({ active: 'entered', problem: expect.stringMatching(/negative/) });
    expect(s.summary!.asset!.value).toBe(3_300_000);

    // An account deleted in Actual.
    tracker.updateAsset(asset.id, { actualAccountId: 'acct-gone' });
    await tracker.refreshLinked();
    expect(loan.state().assetValue).toMatchObject({ active: 'entered', problem: expect.stringMatching(/isn't in the budget/) });

    // Unlinking goes back to the values entered here, with no problem shown.
    tracker.updateAsset(asset.id, { actualAccountId: null });
    await tracker.refreshLinked();
    expect(loan.state().assetValue).toEqual({ active: 'entered', account: null, problem: null });
  });

  it('keeps the link through other asset edits, and validates it', async () => {
    const { asset } = carWithValue();
    tracker.updateAsset(asset.id, { actualAccountId: 'acct-car' });
    expect(tracker.updateAsset(asset.id, { name: 'Renamed' }).actualAccountId).toBe('acct-car');
    expect(() => tracker.updateAsset(asset.id, { actualAccountId: 42 })).toThrow(/actualAccountId/);
    expect(() => tracker.updateAsset(asset.id, { actualAccountId: '' })).toThrow(/actualAccountId/);
  });

  it('works over HTTP: list accounts, link, read state and the summary endpoint', async () => {
    const app = createApp({ service: tracker, validateToken: async (t) => t === 'good', uiDir: '/nonexistent', summaryToken: 'summary-token-example-0123' });
    const authed = (r: request.Test) => r.set('x-actual-token', 'good');
    const { asset } = carWithValue();
    const accounts = await authed(request(app).get('/asset-tracker-api/accounts'));
    expect(accounts.body).toEqual([
      { id: 'acct-car', name: 'Car value', offBudget: true, closed: false },
      { id: 'acct-loan', name: 'Car loan', offBudget: true, closed: false },
      { id: 'acct-checking', name: 'Checking', offBudget: false, closed: false },
    ]);
    const linked = await authed(request(app).patch(`/asset-tracker-api/assets/${asset.id}`).send({ actualAccountId: 'acct-car' }));
    expect(linked.body.actualAccountId).toBe('acct-car');
    const state = await authed(request(app).get(`/asset-tracker-api/loans/1/state`));
    expect(state.body.assetValue.active).toBe('account');
    const summary = await request(app).get('/asset-tracker-api/v1/summary?loan=1').set('authorization', 'Bearer summary-token-example-0123');
    expect(summary.body.asset).toMatchObject({ value: 32_249.5, valueSource: 'Actual account', valueAsOf: TODAY });
    const list = await authed(request(app).get('/asset-tracker-api/loans'));
    expect(list.body[0].assetValue).toBe(3_224_950);
  });
});
