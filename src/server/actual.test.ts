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
