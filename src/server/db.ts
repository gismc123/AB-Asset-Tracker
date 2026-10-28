import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  Adjustment,
  AdjustmentKind,
  AssetKind,
  AssetValue,
  Cents,
  EscrowEntry,
  EscrowKind,
  ISODate,
  LoanSetup,
  LockedPayment,
  Resolution,
  SkipMode,
  ValueTrend,
} from '../engine/index.js';
import { migrate } from './migrations.js';

/**
 * The tracker's own database. It holds only what the tracker owns: loans and
 * their setup, schedule adjustments, the reconciliation status of each
 * month, escrow entries, loan details, and assets with their values.
 * Actual's data is never copied here beyond the matched transaction's id,
 * date, amount and payee, kept so the month can show what it was matched to.
 */

export type LoanType = 'mortgage' | 'auto' | 'personal';
export const LOAN_TYPES: LoanType[] = ['mortgage', 'auto', 'personal'];

export interface LoanRecord {
  id: number;
  nickname: string;
  type: LoanType;
  createdAt: string;
  archived: boolean;
}

export type MonthStatus = 'flagged' | 'paid';

export interface MonthRecord {
  payment: number;
  status: MonthStatus;
  transactionId: string;
  transactionDate: ISODate;
  /** Positive cents that left the account. */
  transactionAmount: Cents;
  transactionPayee: string | null;
  /** actual - scheduled at the time it was matched. */
  difference: Cents;
  resolution: Resolution | null;
  locked: LockedPayment | null;
  updatedAt: string;
}

export interface StoredAdjustment {
  id: number;
  adjustment: Adjustment;
  /** Month whose reconciliation created it; null for manual entries. */
  sourcePayment: number | null;
  createdAt: string;
}

export interface Settings {
  /** The Actual category this loan's payments are booked to. */
  categoryId: string | null;
}

export interface StoredAssetValue extends AssetValue {
  id: number;
}

export interface AssetRecord {
  id: number;
  loanId: number | null;
  name: string;
  kind: AssetKind;
  originalValue: Cents;
  valueTrend: ValueTrend;
  trendRatePercent: number | null;
  acquiredDate: ISODate | null;
  /** Oldest first. */
  values: StoredAssetValue[];
}

export type AssetInput = Omit<AssetRecord, 'id' | 'values'>;

/** Reference details about the loan. Free text; every field optional. */
export interface LoanDetails {
  fields: Partial<Record<LoanDetailField, string>>;
  /** Anything else worth keeping, as label/value pairs. */
  custom: { label: string; value: string }[];
}

export const LOAN_DETAIL_FIELDS = [
  'servicerName',
  'servicerPhone',
  'servicerWebsite',
  'servicerAddress',
  'loanNumber',
  'lenderName',
  'loanType',
  'mersMin',
  'propertyAddress',
  'vin',
  'licensePlate',
  'insuranceCarrier',
  'insurancePolicyNumber',
  'insuranceAgent',
  'taxParcelNumber',
  'taxAuthority',
  'pmiCompany',
  'pmiCertificateNumber',
  'notes',
] as const;
export type LoanDetailField = (typeof LOAN_DETAIL_FIELDS)[number];

const SINGLE_PAYMENT_KINDS: AdjustmentKind[] = ['pennyOffset', 'extraPrincipal'];

function toAdjustment(kind: AdjustmentKind, payment: number, amount: Cents, mode: string | null): Adjustment {
  if (kind === 'skip') return { kind, payment, mode: mode === 'defer' || mode === 'catchUp' ? mode : 'capitalize' };
  if (kind === 'catchUpPlan') return { kind, fromPayment: payment, months: amount };
  return (SINGLE_PAYMENT_KINDS.includes(kind) ? { kind, payment, amount } : { kind, fromPayment: payment, amount }) as Adjustment;
}

export interface StoreOptions {
  /** Called with the backup path when an existing database is backed up before a migration. */
  onBackup?(file: string): void;
}

export class Store {
  readonly db: Database.Database;

  constructor(
    readonly file: string,
    options: StoreOptions = {},
  ) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrate(this.db, (from) => {
      if (file === ':memory:') return;
      const target = backupPath(file, from);
      // A consistent copy even with a WAL file next to it.
      this.db.prepare(`VACUUM INTO ?`).run(target);
      options.onBackup?.(target);
    });
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close() {
    this.db.close();
  }

  // --- loans ------------------------------------------------------------------

  listLoans(): LoanRecord[] {
    return (this.db.prepare(`SELECT * FROM loans ORDER BY archived, id`).all() as LoanRow[]).map(fromLoanRow);
  }

  getLoan(id: number): LoanRecord | null {
    const row = this.db.prepare(`SELECT * FROM loans WHERE id = ?`).get(id) as LoanRow | undefined;
    return row ? fromLoanRow(row) : null;
  }

  createLoan(loan: { nickname: string; type: LoanType }): LoanRecord {
    const result = this.db
      .prepare(`INSERT INTO loans (nickname, type, created_at, archived) VALUES (?, ?, ?, 0)`)
      .run(loan.nickname, loan.type, new Date().toISOString());
    return this.getLoan(Number(result.lastInsertRowid))!;
  }

  updateLoan(id: number, patch: Partial<Pick<LoanRecord, 'nickname' | 'type' | 'archived'>>) {
    const current = this.getLoan(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db
      .prepare(`UPDATE loans SET nickname = ?, type = ?, archived = ? WHERE id = ?`)
      .run(next.nickname, next.type, next.archived ? 1 : 0, id);
    return this.getLoan(id);
  }

  /** Removes the loan and everything recorded against it. A linked asset is kept, unlinked. */
  deleteLoan(id: number): boolean {
    return this.db.prepare(`DELETE FROM loans WHERE id = ?`).run(id).changes > 0;
  }

  /** Data scoped to one loan. */
  loan(loanId: number): LoanStore {
    return new LoanStore(this.db, loanId);
  }

  // --- assets -----------------------------------------------------------------

  listAssets(): AssetRecord[] {
    const rows = this.db.prepare(`SELECT * FROM assets ORDER BY id`).all() as AssetRow[];
    return rows.map((r) => fromAssetRow(r, this.listAssetValues(r.id)));
  }

  getAsset(id: number): AssetRecord | null {
    const row = this.db.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow | undefined;
    return row ? fromAssetRow(row, this.listAssetValues(row.id)) : null;
  }

  assetForLoan(loanId: number): AssetRecord | null {
    const row = this.db.prepare(`SELECT * FROM assets WHERE loan_id = ?`).get(loanId) as AssetRow | undefined;
    return row ? fromAssetRow(row, this.listAssetValues(row.id)) : null;
  }

  createAsset(a: AssetInput): AssetRecord {
    const result = this.db
      .prepare(
        `INSERT INTO assets (loan_id, name, kind, original_value_cents, value_trend, trend_rate_percent, acquired_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.loanId, a.name, a.kind, a.originalValue, a.valueTrend, a.trendRatePercent, a.acquiredDate, new Date().toISOString());
    return this.getAsset(Number(result.lastInsertRowid))!;
  }

  updateAsset(id: number, a: AssetInput): AssetRecord | null {
    const changes = this.db
      .prepare(
        `UPDATE assets SET loan_id = ?, name = ?, kind = ?, original_value_cents = ?, value_trend = ?,
                trend_rate_percent = ?, acquired_date = ? WHERE id = ?`,
      )
      .run(a.loanId, a.name, a.kind, a.originalValue, a.valueTrend, a.trendRatePercent, a.acquiredDate, id).changes;
    return changes ? this.getAsset(id) : null;
  }

  deleteAsset(id: number): boolean {
    return this.db.prepare(`DELETE FROM assets WHERE id = ?`).run(id).changes > 0;
  }

  listAssetValues(assetId: number): StoredAssetValue[] {
    return this.db
      .prepare(`SELECT id, date, value_cents AS value, source FROM asset_values WHERE asset_id = ? ORDER BY date, id`)
      .all(assetId) as StoredAssetValue[];
  }

  addAssetValue(assetId: number, v: AssetValue): number {
    const result = this.db
      .prepare(`INSERT INTO asset_values (asset_id, date, value_cents, source, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(assetId, v.date, v.value, v.source, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  deleteAssetValue(assetId: number, id: number): boolean {
    return this.db.prepare(`DELETE FROM asset_values WHERE id = ? AND asset_id = ?`).run(id, assetId).changes > 0;
  }
}

/** Everything recorded against one loan. Every query is filtered by `loan_id`. */
export class LoanStore {
  constructor(
    private readonly db: Database.Database,
    readonly loanId: number,
  ) {}

  // --- loan setup ---------------------------------------------------------

  getSetup(): LoanSetup | null {
    const row = this.db.prepare(`SELECT setup FROM loan_setup WHERE loan_id = ?`).get(this.loanId) as { setup: string } | undefined;
    return row ? (JSON.parse(row.setup) as LoanSetup) : null;
  }

  saveSetup(setup: LoanSetup) {
    this.db
      .prepare(
        `INSERT INTO loan_setup (loan_id, setup, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (loan_id) DO UPDATE SET setup = excluded.setup, updated_at = excluded.updated_at`,
      )
      .run(this.loanId, JSON.stringify(setup), new Date().toISOString());
  }

  // --- settings -------------------------------------------------------------

  getSettings(): Settings {
    const row = this.db.prepare(`SELECT category_id FROM loan_settings WHERE loan_id = ?`).get(this.loanId) as
      | { category_id: string | null }
      | undefined;
    return { categoryId: row?.category_id ?? null };
  }

  saveSettings(settings: Settings) {
    this.db
      .prepare(
        `INSERT INTO loan_settings (loan_id, category_id) VALUES (?, ?)
         ON CONFLICT (loan_id) DO UPDATE SET category_id = excluded.category_id`,
      )
      .run(this.loanId, settings.categoryId);
  }

  // --- adjustments ------------------------------------------------------------

  listAdjustments(): StoredAdjustment[] {
    const rows = this.db.prepare(`SELECT * FROM adjustments WHERE loan_id = ? ORDER BY id`).all(this.loanId) as {
      id: number;
      kind: AdjustmentKind;
      payment: number;
      amount: number;
      mode: string | null;
      source_payment: number | null;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      adjustment: toAdjustment(r.kind, r.payment, r.amount, r.mode),
      sourcePayment: r.source_payment,
      createdAt: r.created_at,
    }));
  }

  addAdjustment(a: Adjustment, sourcePayment: number | null): number {
    const payment = 'payment' in a ? a.payment : a.fromPayment;
    const amount = 'amount' in a ? a.amount : a.kind === 'catchUpPlan' ? a.months : 0;
    const mode = a.kind === 'skip' ? a.mode : null;
    const result = this.db
      .prepare(`INSERT INTO adjustments (loan_id, kind, payment, amount, mode, source_payment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(this.loanId, a.kind, payment, amount, mode, sourcePayment, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  deleteAdjustment(id: number) {
    this.db.prepare(`DELETE FROM adjustments WHERE id = ? AND loan_id = ?`).run(id, this.loanId);
  }

  setSkip(payment: number, mode: SkipMode | null) {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM adjustments WHERE loan_id = ? AND kind = 'skip' AND payment = ?`).run(this.loanId, payment);
      if (mode) this.addAdjustment({ kind: 'skip', payment, mode }, null);
    })();
  }

  deleteAdjustmentsFrom(sourcePayment: number) {
    this.db.prepare(`DELETE FROM adjustments WHERE loan_id = ? AND source_payment = ?`).run(this.loanId, sourcePayment);
  }

  /** Remove the hand-entered penny offset for one month (reconciliation offsets stay). */
  deleteManualOffset(payment: number) {
    this.db
      .prepare(`DELETE FROM adjustments WHERE loan_id = ? AND kind = 'pennyOffset' AND payment = ? AND source_payment IS NULL`)
      .run(this.loanId, payment);
  }

  // --- months -----------------------------------------------------------------

  listMonths(): MonthRecord[] {
    return (this.db.prepare(`SELECT * FROM months WHERE loan_id = ? ORDER BY payment`).all(this.loanId) as MonthRow[]).map(fromMonthRow);
  }

  getMonth(payment: number): MonthRecord | null {
    const row = this.db.prepare(`SELECT * FROM months WHERE loan_id = ? AND payment = ?`).get(this.loanId, payment) as MonthRow | undefined;
    return row ? fromMonthRow(row) : null;
  }

  monthForTransaction(transactionId: string): number | null {
    const row = this.db.prepare(`SELECT payment FROM months WHERE loan_id = ? AND transaction_id = ?`).get(this.loanId, transactionId) as
      | { payment: number }
      | undefined;
    return row?.payment ?? null;
  }

  saveMonth(m: Omit<MonthRecord, 'updatedAt'>) {
    this.db
      .prepare(
        `INSERT INTO months (loan_id, payment, status, transaction_id, transaction_date, transaction_amount, transaction_payee,
                             difference, resolution, locked, updated_at)
         VALUES (@loanId, @payment, @status, @transactionId, @transactionDate, @transactionAmount, @transactionPayee,
                 @difference, @resolution, @locked, @updatedAt)
         ON CONFLICT (loan_id, payment) DO UPDATE SET
           status = excluded.status, transaction_id = excluded.transaction_id,
           transaction_date = excluded.transaction_date, transaction_amount = excluded.transaction_amount,
           transaction_payee = excluded.transaction_payee, difference = excluded.difference,
           resolution = excluded.resolution, locked = excluded.locked, updated_at = excluded.updated_at`,
      )
      .run({ ...m, loanId: this.loanId, locked: m.locked ? JSON.stringify(m.locked) : null, updatedAt: new Date().toISOString() });
  }

  deleteMonth(payment: number) {
    this.db.prepare(`DELETE FROM months WHERE loan_id = ? AND payment = ?`).run(this.loanId, payment);
  }

  // --- escrow entries ---------------------------------------------------------------

  listEscrowEntries(): EscrowEntry[] {
    return this.db
      .prepare(`SELECT id, date, kind, amount, note FROM escrow_entries WHERE loan_id = ? ORDER BY date, id`)
      .all(this.loanId) as EscrowEntry[];
  }

  addEscrowEntry(e: Omit<EscrowEntry, 'id'>): number {
    const result = this.db
      .prepare(`INSERT INTO escrow_entries (loan_id, date, kind, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(this.loanId, e.date, e.kind satisfies EscrowKind, e.amount, e.note, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  deleteEscrowEntry(id: number): boolean {
    return this.db.prepare(`DELETE FROM escrow_entries WHERE id = ? AND loan_id = ?`).run(id, this.loanId).changes > 0;
  }

  // --- loan details -------------------------------------------------------------------

  getDetails(): LoanDetails {
    const row = this.db.prepare(`SELECT details FROM loan_details WHERE loan_id = ?`).get(this.loanId) as { details: string } | undefined;
    return { fields: {}, custom: [], ...(row ? (JSON.parse(row.details) as Partial<LoanDetails>) : {}) };
  }

  saveDetails(details: LoanDetails) {
    this.db
      .prepare(`INSERT INTO loan_details (loan_id, details) VALUES (?, ?) ON CONFLICT (loan_id) DO UPDATE SET details = excluded.details`)
      .run(this.loanId, JSON.stringify(details));
  }
}

/** The tracker's database file. */
export const DB_FILE = 'asset-tracker.sqlite';
/** What the database was called before the project was renamed. */
export const LEGACY_DB_FILE = 'mortgage.sqlite';

/**
 * Where the database lives in `dataDir`. An install from before the rename
 * keeps using its `mortgage.sqlite` in place, so nothing is moved or copied.
 */
export function databaseFile(dataDir: string): string {
  const current = path.join(dataDir, DB_FILE);
  const legacy = path.join(dataDir, LEGACY_DB_FILE);
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

/** `data/asset-tracker.sqlite` → `data/asset-tracker.sqlite.backup-v1-2026-10-28T19-02-37Z` */
export function backupPath(file: string, fromVersion: number, now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${file}.backup-v${fromVersion}-${stamp}`;
}

interface LoanRow {
  id: number;
  nickname: string;
  type: LoanType;
  created_at: string;
  archived: number;
}

const fromLoanRow = (r: LoanRow): LoanRecord => ({
  id: r.id,
  nickname: r.nickname,
  type: r.type,
  createdAt: r.created_at,
  archived: r.archived === 1,
});

interface AssetRow {
  id: number;
  loan_id: number | null;
  name: string;
  kind: AssetKind;
  original_value_cents: number;
  value_trend: ValueTrend;
  trend_rate_percent: number | null;
  acquired_date: string | null;
}

const fromAssetRow = (r: AssetRow, values: StoredAssetValue[]): AssetRecord => ({
  id: r.id,
  loanId: r.loan_id,
  name: r.name,
  kind: r.kind,
  originalValue: r.original_value_cents,
  valueTrend: r.value_trend,
  trendRatePercent: r.trend_rate_percent,
  acquiredDate: r.acquired_date,
  values,
});

interface MonthRow {
  payment: number;
  status: MonthStatus;
  transaction_id: string;
  transaction_date: string;
  transaction_amount: number;
  transaction_payee: string | null;
  difference: number;
  resolution: Resolution | null;
  locked: string | null;
  updated_at: string;
}

function fromMonthRow(r: MonthRow): MonthRecord {
  return {
    payment: r.payment,
    status: r.status,
    transactionId: r.transaction_id,
    transactionDate: r.transaction_date,
    transactionAmount: r.transaction_amount,
    transactionPayee: r.transaction_payee,
    difference: r.difference,
    resolution: r.resolution,
    locked: r.locked ? (JSON.parse(r.locked) as LockedPayment) : null,
    updatedAt: r.updated_at,
  };
}
