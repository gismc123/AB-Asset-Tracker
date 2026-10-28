import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('config', () => {
  it('has no default Actual URL or password', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ACTUAL_SERVER_URL: 'https://pi.test:5006', ACTUAL_SYNC_ID: 'x' })).toThrow(/ACTUAL_PASSWORD/);
    expect(() => loadConfig({ ACTUAL_PASSWORD: 'p', ACTUAL_SYNC_ID: 'x' })).toThrow(/ACTUAL_SERVER_URL/);
  });

  it('reads a complete configuration', () => {
    const c = loadConfig({
      ACTUAL_SERVER_URL: 'https://pi.test:5006/',
      ACTUAL_PASSWORD: 'example-only',
      ACTUAL_SYNC_ID: 'sync-id',
      SUMMARY_TOKEN: '',
    });
    expect(c.actual.serverURL).toBe('https://pi.test:5006');
    expect(c.actual.budgetPassword).toBeUndefined();
    expect(c.summaryToken).toBeUndefined();
  });

  it('names every missing required setting at once', () => {
    expect(() => loadConfig({})).toThrow(/ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID/);
  });

  it('rejects a bad port or timezone, and warns about a short summary token', () => {
    const base = { ACTUAL_SERVER_URL: 'https://pi.test:5006', ACTUAL_PASSWORD: 'p', ACTUAL_SYNC_ID: 'x' };
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, TZ: 'Mars/Olympus' })).toThrow(/TZ/);
    expect(loadConfig({ ...base, TZ: 'Etc/UTC' }).port).toBe(3100);
    expect(loadConfig({ ...base, SUMMARY_TOKEN: 'short' }).warnings[0]).toMatch(/SUMMARY_TOKEN/);
  });
});
