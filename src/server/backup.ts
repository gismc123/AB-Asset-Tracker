import Database from 'better-sqlite3';
import { copyPath, type Store } from './db.js';
import { currentVersion, LATEST_VERSION, migrate } from './migrations.js';

/**
 * Whole-tracker backups as one JSON file. A backup holds every row of the
 * tracker's tables exactly as stored (ids and timestamps included), tagged
 * with the schema version it came from. Restoring loads it into a scratch
 * database at that version and migrates it forward like any old database,
 * so a backup made today still restores after an update changes the layout.
 */

export const BACKUP_FORMAT = 'ab-asset-tracker-backup';
export const BACKUP_FORMAT_VERSION = 1;

export type BackupRow = Record<string, string | number | null>;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  /** Rows per table, for a quick look at what's inside. */
  counts: Record<string, number>;
  tables: Record<string, BackupRow[]>;
}

export interface RestoreResult {
  counts: Record<string, number>;
  /** File name (in the data folder) of the copy made before restoring; null when there was nothing to keep. */
  safetyCopy: string | null;
}

/** A backup file that can't be restored. The message says why, in plain words. */
export class BackupError extends Error {}

/** Columns that hold JSON text; a backup with broken JSON in them is refused. */
const JSON_COLUMNS: [table: string, column: string][] = [
  ['loan_setup', 'setup'],
  ['loan_details', 'details'],
  ['months', 'locked'],
];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Every table holding the user's data, i.e. all but SQLite's own and the migration log. */
function dataTables(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
    .map((t) => t.name)
    .filter((name) => name !== 'schema_version' && !name.startsWith('sqlite_'));
}

const columnsOf = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((c) => c.name);

function dump(db: Database.Database): Backup['tables'] {
  // One read transaction, so every table comes from the same moment.
  return db.transaction(() =>
    Object.fromEntries(dataTables(db).map((t) => [t, db.prepare(`SELECT * FROM ${quote(t)} ORDER BY rowid`).all() as BackupRow[]])),
  )();
}

const countsOf = (tables: Backup['tables']) => Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));

export function exportBackup(db: Database.Database, now = new Date()): Backup {
  const tables = dump(db);
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: currentVersion(db),
    exportedAt: now.toISOString(),
    counts: countsOf(tables),
    tables,
  };
}

/** `ab-asset-tracker-backup-2026-10-28.json` */
export const backupFileName = (b: Pick<Backup, 'exportedAt'>) => `ab-asset-tracker-backup-${b.exportedAt.slice(0, 10)}.json`;

/**
 * Replace every row in `db` with `tables`. Runs in one transaction, with
 * foreign keys checked before it commits, so a bad backup changes nothing.
 */
function load(db: Database.Database, tables: Record<string, unknown>) {
  const known = dataTables(db);
  for (const name of Object.keys(tables)) {
    if (!known.includes(name)) throw new BackupError(`The backup has a table this version of the tracker doesn't know: ${name}`);
  }
  // Rows go in table by table, so references are checked once at the end.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const name of known) db.prepare(`DELETE FROM ${quote(name)}`).run();
      for (const [name, rows] of Object.entries(tables)) {
        if (!Array.isArray(rows)) throw new BackupError(`The backup's ${name} table is not a list of rows`);
        const columns = columnsOf(db, name);
        rows.forEach((row: unknown, i) => {
          const where = `${name}, row ${i + 1}`;
          if (!isObject(row)) throw new BackupError(`The backup's ${where} is not an object`);
          const keys = Object.keys(row);
          for (const k of keys) {
            if (!columns.includes(k)) throw new BackupError(`The backup's ${where} has an unknown column: ${k}`);
            const v = row[k];
            if (v !== null && typeof v !== 'string' && typeof v !== 'number') {
              throw new BackupError(`The backup's ${where} has a value that is not text, a number or null in ${k}`);
            }
          }
          db.prepare(`INSERT INTO ${quote(name)} (${keys.map(quote).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
            ...keys.map((k) => row[k]),
          );
        });
      }
      const problems = db.pragma('foreign_key_check') as unknown[];
      if (problems.length) throw new BackupError(`The backup has ${problems.length} rows that point at a loan or asset it doesn't contain`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Check a backup and bring it to the current schema, without touching the
 * live database. Returns its rows, ready to load.
 */
export function readBackup(data: unknown): Backup['tables'] {
  if (!isObject(data) || data.format !== BACKUP_FORMAT) throw new BackupError('This is not an AB Asset Tracker backup file');
  const { formatVersion, schemaVersion, tables } = data;
  if (typeof formatVersion !== 'number' || typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new BackupError('The backup file is missing its version numbers');
  }
  if (formatVersion > BACKUP_FORMAT_VERSION || schemaVersion > LATEST_VERSION) {
    throw new BackupError('This backup was made by a newer version of the tracker. Update the tracker, then restore it.');
  }
  if (!isObject(tables)) throw new BackupError('The backup file has no tables');

  const scratch = new Database(':memory:');
  try {
    migrate(scratch, undefined, schemaVersion);
    load(scratch, tables);
    migrate(scratch);
    for (const [table, column] of JSON_COLUMNS) {
      const rows = scratch.prepare(`SELECT ${quote(column)} AS v FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`).all() as { v: string }[];
      for (const { v } of rows) {
        try {
          JSON.parse(v);
        } catch {
          throw new BackupError(`The backup's ${table} table has damaged data in ${column}`);
        }
      }
    }
    return dump(scratch);
  } catch (e) {
    if (e instanceof Database.SqliteError) throw new BackupError(`The backup doesn't fit the tracker's database: ${e.message}`);
    throw e;
  } finally {
    scratch.close();
  }
}

/**
 * Replace everything in the tracker with a backup. The backup is checked in
 * full first, and a database with anything in it is copied next to itself
 * before anything changes, so a restore can always be undone.
 */
export function restoreBackup(store: Store, data: unknown, now = new Date()): RestoreResult {
  const tables = readBackup(data);
  let safetyCopy: string | null = null;
  const hasData = Object.values(countsOf(dump(store.db))).some((n) => n > 0);
  if (store.file !== ':memory:' && hasData) {
    safetyCopy = copyPath(store.file, 'before-restore', now);
    store.copyTo(safetyCopy);
  }
  load(store.db, tables);
  return { counts: countsOf(tables), safetyCopy: safetyCopy && safetyCopy.split(/[\\/]/).pop()! };
}
