import path from 'node:path';
import { todayISO } from '../engine/index.js';
import { ActualApiSource } from './actual.js';
import { createApp } from './app.js';
import { actualTokenValidator } from './auth.js';
import { ConfigError, loadConfig } from './config.js';
import { Store } from './db.js';
import { TrackerService } from './service.js';

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`[mortgage] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  for (const w of config.warnings) console.warn(`[mortgage] ${w}`);

  const store = new Store(path.join(config.dataDir, 'mortgage.sqlite'), {
    onBackup: (file) => console.log(`[mortgage] upgrading the database; a copy of the old one is at ${file}`),
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
    console.log(`[mortgage] listening on :${config.port}, Actual at ${config.actual.serverURL} (read-only)`);
  });

  // Warm up the Actual connection so the first page load is quick. Failures
  // are logged and retried on the next request, never fatal.
  source.getCategories().then(
    () => console.log('[mortgage] connected to Actual and loaded the budget'),
    (err: Error) => console.warn(`[mortgage] Actual not reachable yet: ${err.message}`),
  );

  const stop = async () => {
    server.close();
    await source.close().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main();
