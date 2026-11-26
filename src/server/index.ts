import { todayISO } from '../engine/index.js';
import { ActualApiSource } from './actual.js';
import { createApp } from './app.js';
import { actualTokenValidator } from './auth.js';
import { ConfigError, loadConfig } from './config.js';
import { databaseFile, Store } from './db.js';
import { TrackerService } from './service.js';

/** Tries at 5, 10, 15... seconds apart, at most a minute: about 15 minutes in all. */
const WARM_UP_ATTEMPTS = 20;

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`[asset-tracker] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  for (const w of config.warnings) console.warn(`[asset-tracker] ${w}`);

  const dbFile = databaseFile(config.dataDir);
  console.log(`[asset-tracker] database: ${dbFile}`);
  const store = new Store(dbFile, {
    onBackup: (file) => console.log(`[asset-tracker] upgrading the database; a copy of the old one is at ${file}`),
  });
  const source = new ActualApiSource({ ...config.actual, dataDir: config.dataDir });
  const service = new TrackerService(store, source, () => todayISO());
  const app = createApp({
    service,
    validateToken: actualTokenValidator(config.actual.serverURL),
    uiDir: config.uiDir,
    summaryToken: config.summaryToken,
  });

  const server = app.listen(config.port, () => {
    console.log(`[asset-tracker] listening on :${config.port}, Actual at ${config.actual.serverURL} (read-only)`);
  });

  // Warm up the Actual connection so the first page load is quick. After a
  // reboot Actual may still be starting, and loan screens without a linked
  // account never ask it for anything, so a single try would leave its
  // error on screen. Keep trying for about a quarter of an hour; requests
  // that need Actual retry on their own after that. Never fatal.
  let warmUpTimer: NodeJS.Timeout | undefined;
  const warmUp = (attempt: number) => {
    source.getCategories().then(
      () => console.log('[asset-tracker] connected to Actual and loaded the budget'),
      (err: Error) => {
        if (attempt === 1) console.warn(`[asset-tracker] Actual not reachable yet, will keep trying: ${err.message}`);
        if (attempt < WARM_UP_ATTEMPTS) warmUpTimer = setTimeout(() => warmUp(attempt + 1), Math.min(60_000, 5_000 * attempt));
        else console.warn(`[asset-tracker] still can't reach Actual: ${err.message}`);
      },
    );
  };
  warmUp(1);

  const stop = async () => {
    clearTimeout(warmUpTimer);
    server.close();
    await source.close().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main();
