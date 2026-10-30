import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActualApiSource, SourceUnavailable } from './actual.js';

/** Stand-in for @actual-app/api with just what the source calls. */
function fakeApi() {
  return {
    init: vi.fn(async () => undefined),
    downloadBudget: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
    getCategoryGroups: vi.fn(async () => [{ id: 'grp', name: 'Housing', categories: [{ id: 'cat', name: 'Mortgage' }] }]),
    getAccounts: vi.fn(async () => [{ id: 'acct', name: 'Car value', offbudget: true, closed: false }, { id: 'old', name: 'Old', offbudget: false, closed: true }]),
    getTransactions: vi.fn(async (_id: string, _start: string, _end: string) => [
      { id: 't1', date: '2025-01-01', amount: 2_000_000 },
      { id: 't2', date: '2025-02-01', amount: -50_000, tombstone: true },
      // A split: the parent carries the total of its lines, which are not listed separately.
      { id: 't3', date: '2025-03-01', amount: -30_000, subtransactions: [{ id: 't3a', date: '2025-03-01', amount: -10_000 }, { id: 't3b', date: '2025-03-01', amount: -20_000 }] },
    ]),
    shutdown: vi.fn(async () => undefined),
  };
}

function sourceWith(api: ReturnType<typeof fakeApi>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-tracker-actual-'));
  const conn = { serverURL: 'http://actual.invalid', password: 'test', syncId: 'test', budgetPassword: undefined, dataDir };
  return new ActualApiSource(conn, async () => api as never);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ActualApiSource', () => {
  it('lists accounts and sums a balance up to a date, without deleted transactions', async () => {
    const api = fakeApi();
    const source = sourceWith(api);
    expect(await source.getAccounts()).toEqual([
      { id: 'acct', name: 'Car value', offBudget: true, closed: false },
      { id: 'old', name: 'Old', offBudget: false, closed: true },
    ]);
    expect(await source.getAccountBalance('acct', '2025-09-20')).toBe(2_000_000 - 30_000);
    expect(api.getTransactions).toHaveBeenCalledWith('acct', '1900-01-01', '2025-09-20');
  });

  it('reports a failed first load as Actual being unavailable', async () => {
    const api = fakeApi();
    api.downloadBudget.mockRejectedValueOnce(new Error('Could not find budget'));
    const source = sourceWith(api);
    await expect(source.getCategories()).rejects.toBeInstanceOf(SourceUnavailable);
    expect(source.status()).toMatchObject({ connected: false, error: 'Could not find budget' });
  });

  it('reports a failed re-sync as Actual being unavailable, then recovers on the next request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const api = fakeApi();
    const source = sourceWith(api);
    await source.getCategories();
    expect(source.status().connected).toBe(true);

    vi.setSystemTime(Date.now() + 31_000);
    api.sync.mockRejectedValueOnce(new Error('network-failure'));
    await expect(source.getCategories()).rejects.toBeInstanceOf(SourceUnavailable);
    expect(source.status()).toMatchObject({ connected: false, error: 'network-failure' });

    await expect(source.getCategories()).resolves.toHaveLength(1);
    expect(source.status()).toMatchObject({ connected: true, error: null });
    expect(api.sync).toHaveBeenCalledTimes(2);
  });
});
