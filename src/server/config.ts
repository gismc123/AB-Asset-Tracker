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
  /** Problems worth logging that don't stop the service. */
  warnings: string[];
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

  const port = Number(env.PORT?.trim() || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('PORT must be a whole number from 1 to 65535');

  const tz = env.TZ?.trim();
  if (tz && !validTimeZone(tz)) {
    throw new ConfigError(`TZ "${tz}" is not a known timezone. Use a tz database name such as Etc/UTC or Europe/Berlin.`);
  }

  const warnings: string[] = [];
  const summaryToken = env.SUMMARY_TOKEN?.trim() || undefined;
  if (summaryToken && summaryToken.length < 16) {
    warnings.push('SUMMARY_TOKEN is shorter than 16 characters. Use a long random value, e.g. from `openssl rand -hex 24`.');
  }

  return {
    port,
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    actual: {
      serverURL,
      password,
      syncId,
      budgetPassword: env.ACTUAL_BUDGET_PASSWORD?.trim() || undefined,
    },
    summaryToken,
    uiDir: path.resolve(env.UI_DIR ?? './dist/ui'),
    warnings,
  };
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
