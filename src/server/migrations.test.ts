import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { databaseFile, DB_FILE, LEGACY_DB_FILE, Store } from './db.js';
import { currentVersion, LATEST_VERSION, migrate } from './migrations.js';
import { summaryForDisplay } from './app.js';
import { TrackerService } from './service.js';
import { FakeSource } from './testing.js';

/**
 * The fixtures in test/fixtures were produced by the last single-loan
 * release: a dump of its database after a realistic run of reconciliations,
 * skips, escrow entries and home values, plus exactly what its service
 * returned. Migrating that database must reproduce those numbers to the cent.
 */
const FIXTURES = fileURLToPath(new URL('../../test/fixtures', import.meta.url));
const TODAY = { 'legacy-a': '2025-10-15', 'legacy-b': '2026-03-10' } as const;
type Fixture = keyof typeof TODAY;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function legacyFile(name: Fixture): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-migrate-'));
  dirs.push(dir);
  const file = path.join(dir, 'mortgage.sqlite');
  const db = new Database(file);
  db.exec(fs.readFileSync(path.join(FIXTURES, `${name}.sql`), 'utf8'));
  db.close();
  return file;
}

const golden = (name: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, `${name}.json.gz`))).toString('utf8'));

function sourceFor(name: Fixture) {
  const source = new FakeSource();
  source.transactions = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.txns.json`), 'utf8'));
  return source;
}

describe('migrating a single-loan database', () => {
  for (const name of ['legacy-a', 'legacy-b'] as const) {
    it(`${name}: loan 1 reproduces the old state and summary to the cent`, () => {
      const file = legacyFile(name);
      const backups: string[] = [];
      const store = new Store(file, { onBackup: (f) => backups.push(f) });
      const service = new TrackerService(store, sourceFor(name), () => TODAY[name]).loan(1);

      // Every field the old release returned must come back unchanged. New
      // fields (fees, assets, payoff) may be added alongside. Home value
      // estimates now live on the loan's asset.
      const { homeValues, ...oldState } = golden(`${name}.state`);
      const state = service.state();
      expect(state).toMatchObject(oldState);
      expect(state.asset!.values).toEqual(homeValues);
      expect(service.summary()).toMatchObject(golden(`${name}.summary`));

      expect(store.listLoans()).toMatchObject([{ id: 1, nickname: 'Mortgage', type: 'mortgage', archived: false }]);
      const asset = store.assetForLoan(1)!;
      expect(asset).toMatchObject({ id: 1, loanId: 1, name: 'Home', kind: 'home', valueTrend: 'manual' });
      expect(asset.originalValue).toBe(store.loan(1).getSetup()!.originalHomeValue);

      // The backup is the untouched old database.
      expect(backups).toHaveLength(1);
      const backup = new Database(backups[0]!, { readonly: true });
      expect(backup.prepare(`SELECT COUNT(*) AS n FROM loan`).get()).toEqual({ n: 1 });
      backup.close();
      store.close();
    });
  }

  it('moves home values, escrow entries, adjustments and months under loan 1, keeping their ids', () => {
    const file = legacyFile('legacy-a');
    const old = new Database(file, { readonly: true });
    const oldHomeValues = old.prepare(`SELECT id, date, value, source, created_at FROM home_values ORDER BY id`).all();
    const oldAdjustments = old.prepare(`SELECT id, kind, payment, amount, mode, source_payment, created_at FROM adjustments ORDER BY id`).all();
    const oldEscrow = old.prepare(`SELECT * FROM escrow_entries ORDER BY id`).all();
    const oldMonths = old.prepare(`SELECT * FROM months ORDER BY payment`).all();
    old.close();

    const store = new Store(file);
    const db = store.db;
    expect(db.prepare(`SELECT id, date, value_cents AS value, source, created_at FROM asset_values WHERE asset_id = 1 ORDER BY id`).all()).toEqual(oldHomeValues);
    expect(db.prepare(`SELECT id, kind, payment, amount, mode, source_payment, created_at FROM adjustments WHERE loan_id = 1 ORDER BY id`).all()).toEqual(oldAdjustments);
    expect(db.prepare(`SELECT id, date, kind, amount, note, created_at FROM escrow_entries WHERE loan_id = 1 ORDER BY id`).all()).toEqual(oldEscrow);
    expect(db.prepare(`SELECT payment, status, transaction_id, transaction_date, transaction_amount, transaction_payee, difference, resolution, locked, updated_at FROM months WHERE loan_id = 1 ORDER BY payment`).all()).toEqual(oldMonths);
    expect(store.loan(1).getSettings().categoryId).toBe('cat-mortgage');
    expect(store.loan(1).getDetails().fields.loanNumber).toBe('SAMPLE-0000-1111');
    // The old single-loan tables are gone; their rows live in the new ones.
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain('loan');
    expect(tables).not.toContain('home_values');
    expect(db.prepare(`SELECT key FROM meta`).all()).toEqual([]);
    store.close();
  });

  it('is idempotent: reopening does nothing and makes no second backup', () => {
    const file = legacyFile('legacy-b');
    const backups: string[] = [];
    new Store(file, { onBackup: (f) => backups.push(f) }).close();
    const store = new Store(file, { onBackup: (f) => backups.push(f) });
    expect(backups).toHaveLength(1);
    expect(currentVersion(store.db)).toBe(LATEST_VERSION);
    expect(migrate(store.db)).toEqual([]);
    // Running every migration body again changes nothing either.
    const before = store.db.prepare(`SELECT COUNT(*) AS n FROM months`).get();
    store.db.prepare(`DELETE FROM schema_version`).run();
    expect(() => migrate(store.db)).not.toThrow();
    expect(store.db.prepare(`SELECT COUNT(*) AS n FROM months`).get()).toEqual(before);
    store.close();
  });

  it('keeps using a database from before the rename, and names a new one after the project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-file-'));
    dirs.push(dir);
    expect(databaseFile(dir)).toBe(path.join(dir, DB_FILE));
    fs.writeFileSync(path.join(dir, LEGACY_DB_FILE), '');
    expect(databaseFile(dir)).toBe(path.join(dir, LEGACY_DB_FILE));
    fs.writeFileSync(path.join(dir, DB_FILE), '');
    expect(databaseFile(dir)).toBe(path.join(dir, DB_FILE));
  });

  it('creates an empty, fully migrated database without a backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-new-'));
    dirs.push(dir);
    const backups: string[] = [];
    const store = new Store(path.join(dir, 'tracker.sqlite'), { onBackup: (f) => backups.push(f) });
    expect(backups).toEqual([]);
    expect(currentVersion(store.db)).toBe(LATEST_VERSION);
    expect(store.listLoans()).toEqual([]);
    expect(store.listAssets()).toEqual([]);
    store.close();
  });

  it('rolls back and leaves the old database untouched when a migration fails', () => {
    const file = legacyFile('legacy-a');
    const db = new Database(file);
    // A table in the way makes migration 2 fail partway through.
    db.exec(`CREATE TABLE assets (x INTEGER)`);
    db.close();
    expect(() => new Store(file)).toThrow();
    const check = new Database(file, { readonly: true });
    expect(check.prepare(`SELECT COUNT(*) AS n FROM loan`).get()).toEqual({ n: 1 });
    expect(check.prepare(`SELECT COUNT(*) AS n FROM months`).get()).toEqual({ n: 5 });
    check.close();
  });
});

/**
 * test/fixtures/v0.1.0.* is a database written by v0.1.0 (schema version 2)
 * after a realistic run on four made-up loans: a mortgage with every kind of
 * reconciliation answer, a skip with a catch-up plan, escrow and a value; a
 * daily-interest car loan with fees and a depreciating vehicle; a personal
 * loan with a yearly fee and two kinds of skip; and an archived mortgage
 * tracked from partway through with PMI kept until removed. Next to it is
 * exactly what v0.1.0 returned for each loan, the loan list and the summary
 * endpoint. Every later release must open that database and return the same
 * numbers to the cent. New fields may be added alongside.
 */
describe('upgrading a v0.1.0 database', () => {
  const v010 = golden('v0.1.0.golden') as {
    today: string;
    loans: unknown[];
    states: Record<string, Record<string, unknown>>;
    summaries: Record<string, unknown>;
    endpoint: unknown[];
  };

  function v010File(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-v010-'));
    dirs.push(dir);
    const file = path.join(dir, DB_FILE);
    const db = new Database(file);
    db.exec(fs.readFileSync(path.join(FIXTURES, 'v0.1.0.sql'), 'utf8'));
    db.close();
    return file;
  }

  function v010Source() {
    const source = new FakeSource();
    source.transactions = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'v0.1.0.txns.json'), 'utf8'));
    return source;
  }

  it('reproduces every loan, match, total and summary to the cent', () => {
    const file = v010File();
    const store = new Store(file);
    const service = new TrackerService(store, v010Source(), () => v010.today);
    expect(Object.keys(v010.states)).toHaveLength(4);
    for (const [id, state] of Object.entries(v010.states)) {
      const loan = service.loan(Number(id));
      expect(loan.state()).toMatchObject(state);
      expect(loan.summary()).toMatchObject(v010.summaries[id]!);
    }
    expect(service.loans()).toMatchObject(v010.loans);
    expect(service.summaries().map(({ loan, summary }) => summaryForDisplay(loan, summary))).toMatchObject(v010.endpoint);
    store.close();
  });

  it('allows student loans, keeps loan ids, and never reuses a deleted loan\'s id', () => {
    const file = v010File();
    const raw = new Database(file);
    // Deleted under v0.1.0: AUTOINCREMENT remembers id 4 was used.
    raw.pragma('foreign_keys = ON');
    raw.prepare(`DELETE FROM loans WHERE id = 4`).run();
    raw.close();

    const backups: string[] = [];
    const store = new Store(file, { onBackup: (f) => backups.push(f) });
    expect(backups).toHaveLength(1);
    expect(store.listLoans().map((l) => [l.id, l.type])).toEqual([[1, 'mortgage'], [2, 'auto'], [3, 'personal']]);
    // Rows that pointed at the loans still do, and cascades still work.
    expect(store.db.pragma('foreign_key_check')).toEqual([]);
    const student = store.createLoan({ nickname: 'Student loan', type: 'student' });
    expect(student.id).toBe(5);
    expect(store.loan(2).listMonths().length).toBeGreaterThan(0);
    store.deleteLoan(2);
    expect(store.loan(2).listMonths()).toEqual([]);
    expect(store.db.prepare(`SELECT loan_id FROM assets WHERE id = 2`).get()).toEqual({ loan_id: null });
    expect(() => store.createLoan({ nickname: 'Boat', type: 'boat' as never })).toThrow(/CHECK/);
    store.close();
  });

  it('leaves every v0.1.0 row as it was', () => {
    const file = v010File();
    const old = new Database(file, { readonly: true });
    const tables = (old.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version'`).all() as { name: string }[]).map((t) => t.name);
    const before = Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));
    old.close();

    const store = new Store(file);
    for (const t of tables) {
      const after = store.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Record<string, unknown>[];
      // New columns may be added with a default; every old column keeps its value.
      expect(after, t).toMatchObject(before[t] as Record<string, unknown>[]);
    }
    store.close();
  });
});
