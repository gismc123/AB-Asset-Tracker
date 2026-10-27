import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  actual: {
    serverURL: string;
    password: string;
    syncId: string;
    budgetPassword: string | undefined;
  };
  /** Token for the read-only summary endpoint. Empty = endpoint disabled. */
  summaryToken: string | undefined;
  uiDir: string;
}

export class ConfigError extends Error {}

/**
 * Read configuration from the environment. There is deliberately no default
 * Actual URL or password: a missing value is an error, so the service can
 * never silently connect to the wrong instance.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? '';
  };

  const serverURL = required('ACTUAL_SERVER_URL').replace(/\/+$/, '');
  const password = required('ACTUAL_PASSWORD');
  const syncId = required('ACTUAL_SYNC_ID');
  if (missing.length) {
    throw new ConfigError(
      `Missing required setting(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in (see README, "Configuration").',
    );
  }
  if (!/^https?:\/\//.test(serverURL)) throw new ConfigError('ACTUAL_SERVER_URL must start with http:// or https://');

  return {
    port: Number(env.PORT ?? 3100),
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    actual: {
      serverURL,
      password,
      syncId,
      budgetPassword: env.ACTUAL_BUDGET_PASSWORD?.trim() || undefined,
    },
    summaryToken: env.SUMMARY_TOKEN?.trim() || undefined,
    uiDir: path.resolve(env.UI_DIR ?? './dist/ui'),
  };
}
