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
});
