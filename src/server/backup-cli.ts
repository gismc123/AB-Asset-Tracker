import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BackupError, exportBackup, restoreBackup } from './backup.js';
import { databaseFile, Store } from './db.js';

/**
 * Back up or restore from the command line, for scripts and scheduled
 * backups. Inside the backend container:
 *
 *   node dist/server/backup-cli.js export > backup.json
 *   node dist/server/backup-cli.js import < backup.json
 *
 * Uses DATA_DIR like the server, and is safe to run while it's running.
 */

const USAGE = `Usage:
  backup-cli.js export [file]   write a backup to file, or to standard output
  backup-cli.js import [file]   replace everything with a backup from file, or from standard input`;

function main([command, file]: string[]) {
  const dbFile = databaseFile(path.resolve(process.env.DATA_DIR ?? './data'));

  if (command === 'export') {
    if (!fs.existsSync(dbFile)) throw new BackupError(`There is no tracker database at ${dbFile} yet`);
    const db = new Database(dbFile, { readonly: true });
    const json = JSON.stringify(exportBackup(db), null, 2);
    db.close();
    if (file) fs.writeFileSync(file, json);
    else process.stdout.write(json + '\n');
    console.error(`[asset-tracker] backup written${file ? ` to ${file}` : ''}`);
    return;
  }

  if (command === 'import') {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file ?? 0, 'utf8'));
    } catch {
      throw new BackupError('The backup file is not valid JSON');
    }
    const store = new Store(dbFile);
    try {
      const { counts, safetyCopy } = restoreBackup(store, data);
      console.error(`[asset-tracker] restored ${counts.loans ?? 0} loans and ${counts.assets ?? 0} assets`);
      if (safetyCopy) console.error(`[asset-tracker] the data it replaced was saved as ${safetyCopy} in the data folder`);
    } finally {
      store.close();
    }
    return;
  }

  console.error(USAGE);
  process.exit(2);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof BackupError)) throw e;
  console.error(`[asset-tracker] ${e.message}`);
  process.exit(1);
}
