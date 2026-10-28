import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { currentVersion, LATEST_VERSION, migrate } from './migrations.js';
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
