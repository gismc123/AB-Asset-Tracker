import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { BackupError, exportBackup, readBackup, restoreBackup, type Backup } from './backup.js';
import { Store } from './db.js';
import { currentVersion, LATEST_VERSION, migrate } from './migrations.js';
import { TrackerService } from './service.js';
import { AUTO_SETUP, FakeSource, MORTGAGE_CATEGORY, SAMPLE_SETUP } from './testing.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-backup-'));
  dirs.push(dir);
  return dir;
}

/** A tracker with two loans, an asset with values, a reconciled month, a skip, escrow and details. */
function filledService(store = new Store(':memory:')) {
  const source = new FakeSource();
  const service = new TrackerService(store, source, () => '2025-06-15');
  const { loan: home } = service.createLoan({ nickname: 'Home', type: 'mortgage', setup: SAMPLE_SETUP, categoryId: MORTGAGE_CATEGORY });
  const { loan: car } = service.createLoan({ nickname: 'Car', type: 'auto', setup: AUTO_SETUP });
  const one = service.loan(home.id);
  source.add('t1', '2025-04-01', -one.state().schedule!.rows[0]!.total);
  return { service, source, store, home, car, one };
}

async function fill() {
  const f = filledService();
  await f.one.match(1, { transactionId: 't1' });
  f.one.skip(3, { mode: 'capitalize' });
  f.one.addEscrowEntry({ date: '2025-05-01', kind: 'propertyTax', amount: 120_000, note: 'County' });
  f.one.saveDetails({ fields: { loanNumber: 'SAMPLE-1' }, custom: [{ label: 'Gate code', value: '0000' }] });
  f.service.addAssetValue(f.store.assetForLoan(f.home.id)!.id, { date: '2025-06-01', value: 36_000_000, source: 'Appraisal' });
  await f.one.addExtraPayment({ date: '2025-04-20', amount: 50_000, note: 'Bonus' });
  f.service.setArchived(f.car.id, true);
  return f;
}

/** Everything a person can see, for comparing two trackers. */
const everything = (s: TrackerService) => ({
  loans: s.loans(),
  assets: s.assets(),
  states: s.loans().map((l) => {
    const { source: _s, ...state } = s.loan(l.loan.id).state();
    return state;
  }),
});

describe('backup and restore', () => {
  it('round-trips every loan, asset, month, skip, escrow entry and detail, ids included', async () => {
    const { service } = await fill();
    const backup = JSON.parse(JSON.stringify(service.backup())) as Backup;
    expect(backup).toMatchObject({ format: 'ab-asset-tracker-backup', formatVersion: 1, schemaVersion: LATEST_VERSION });
    expect(backup.counts).toMatchObject({ loans: 2, assets: 1, asset_values: 1, months: 1, escrow_entries: 1, loan_details: 1, extra_payments: 1 });
    expect(backup.tables).not.toHaveProperty('schema_version');

    const fresh = new TrackerService(new Store(':memory:'), new FakeSource(), () => '2025-06-15');
    const result = fresh.restore(backup, 'replace');
    expect(result).toEqual({ counts: backup.counts, safetyCopy: null });
    expect(everything(fresh)).toEqual(everything(service));
  });

  it('replaces what was there, and new rows continue after the restored ids', async () => {
    const { service } = await fill();
    const backup = service.backup();
    const other = filledService();
    other.service.createLoan({ nickname: 'Boat', type: 'personal' });
    other.service.restore(backup, 'replace');
    expect(other.service.loans().map((l) => l.loan.nickname)).toEqual(['Home', 'Car']);
    const { loan } = other.service.createLoan({ nickname: 'Next', type: 'personal' });
    expect(loan.id).toBeGreaterThan(2);
  });

  it('saves a copy of the current database before restoring', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'asset-tracker.sqlite');
    filledService(new Store(file));
    const empty = exportBackup(new Store(':memory:').db);
    const store = new Store(file);
    const result = restoreBackup(store, empty, new Date('2026-10-28T19:02:37Z'));
    expect(result.safetyCopy).toBe('asset-tracker.sqlite.backup-before-restore-2026-10-28T19-02-37Z');
    expect(store.listLoans()).toEqual([]);
    const copy = new Database(path.join(dir, result.safetyCopy!), { readonly: true });
    expect(copy.prepare(`SELECT COUNT(*) AS n FROM loans`).get()).toEqual({ n: 2 });
    copy.close();

    // Nothing in the tracker now, so the next restore has nothing to keep.
    expect(restoreBackup(store, empty).safetyCopy).toBeNull();
    store.close();
  });

  it('migrates a backup from an older schema forward', () => {
    // A version 1 (single-loan) database, as the last single-loan release left it.
    const old = new Database(':memory:');
    old.exec(fs.readFileSync(path.join(FIXTURES, 'legacy-a.sql'), 'utf8'));
    migrate(old, undefined, 1);
    expect(currentVersion(old)).toBe(1);
    const backup = exportBackup(old);
    old.close();
    expect(backup.schemaVersion).toBe(1);
    expect(backup.tables).toHaveProperty('home_values');

    const store = new Store(':memory:');
    restoreBackup(store, JSON.parse(JSON.stringify(backup)));
    expect(store.listLoans()).toMatchObject([{ id: 1, nickname: 'Mortgage', type: 'mortgage' }]);
    expect(store.assetForLoan(1)!.values.length).toBe(backup.counts.home_values);
    expect(store.loan(1).listMonths().length).toBe(backup.counts.months);
  });

  it('refuses a damaged or foreign file and leaves the data alone', async () => {
    const { service } = await fill();
    const good = JSON.parse(JSON.stringify(service.backup())) as Backup;
    const before = everything(service);
    const bad: [unknown, RegExp][] = [
      [null, /not an AB Asset Tracker backup/],
      [{ hello: 'world' }, /not an AB Asset Tracker backup/],
      [{ ...good, schemaVersion: LATEST_VERSION + 1 }, /newer version/],
      [{ ...good, formatVersion: 99 }, /newer version/],
      [{ ...good, schemaVersion: 'two' }, /version numbers/],
      [{ ...good, tables: { ...good.tables, nope: [] } }, /doesn't know: nope/],
      [{ ...good, tables: { ...good.tables, loans: [{ ...good.tables.loans![0], color: 'red' }] } }, /unknown column: color/],
      [{ ...good, tables: { ...good.tables, loans: [{ ...good.tables.loans![0], type: 'yacht' }] } }, /doesn't fit/],
      [{ ...good, tables: { ...good.tables, loans: [] } }, /point at a loan or asset/],
      [{ ...good, tables: { ...good.tables, loan_details: [{ loan_id: 1, details: '{oops' }] } }, /damaged data in details/],
      [{ ...good, tables: { ...good.tables, loans: [{ ...good.tables.loans![0], nickname: { x: 1 } }] } }, /not text, a number or null/],
    ];
    for (const [data, message] of bad) {
      expect(() => readBackup(data), String(message)).toThrow(BackupError);
      expect(() => service.restore(data, 'replace')).toThrow(message);
    }
    expect(everything(service)).toEqual(before);
  });

  it('needs confirm=replace', async () => {
    const { service } = await fill();
    expect(() => service.restore(service.backup(), undefined)).toThrow(/confirm=replace/);
  });
});

describe('backup over HTTP', () => {
  const GOOD = 'good-token';
  const API = '/asset-tracker-api';
  const appFor = (service: TrackerService) =>
    createApp({ service, validateToken: async (t) => t === GOOD, uiDir: '/nonexistent', summaryToken: undefined });

  it('downloads as a dated attachment and restores into another tracker', async () => {
    const { service } = await fill();
    const res = await request(appFor(service)).get(`${API}/backup`).set('x-actual-token', GOOD);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="?ab-asset-tracker-backup-\d{4}-\d{2}-\d{2}\.json/);

    const fresh = new TrackerService(new Store(':memory:'), new FakeSource(), () => '2025-06-15');
    const app = appFor(fresh);
    const restored = await request(app).post(`${API}/restore?confirm=replace`).set('x-actual-token', GOOD).send(res.body);
    expect(restored.status).toBe(200);
    expect(restored.body.counts.loans).toBe(2);
    expect(everything(fresh)).toEqual(everything(service));
  });

  it('needs a login, confirm=replace, and a real backup', async () => {
    const { service } = await fill();
    const app = appFor(service);
    const backup = service.backup();
    expect((await request(app).get(`${API}/backup`)).status).toBe(401);
    expect((await request(app).post(`${API}/restore?confirm=replace`).send(backup)).status).toBe(401);
    expect((await request(app).post(`${API}/restore`).set('x-actual-token', GOOD).send(backup)).status).toBe(400);
    const junk = await request(app).post(`${API}/restore?confirm=replace`).set('x-actual-token', GOOD).send({ hello: 1 });
    expect(junk.status).toBe(400);
    expect(junk.body.error).toMatch(/not an AB Asset Tracker backup/);
  });

  it('accepts a backup larger than the usual request limit', async () => {
    const { service } = await fill();
    const backup = service.backup();
    const padded = { ...backup, tables: { ...backup.tables, meta: Array.from({ length: 3000 }, (_, i) => ({ key: `pad-${i}`, value: 'x'.repeat(100) })) } };
    const res = await request(appFor(service)).post(`${API}/restore?confirm=replace`).set('x-actual-token', GOOD).send(padded);
    expect(res.status).toBe(200);
    // Everything else still has the small limit.
    const big = await request(appFor(service)).post(`${API}/loans`).set('x-actual-token', GOOD).send({ nickname: 'x'.repeat(200_000), type: 'auto' });
    expect(big.status).toBe(413);
  });
});
