import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Adjustment, AdjustmentKind, Cents, EscrowEntry, EscrowKind, HomeValueEstimate, ISODate, LoanSetup, LockedPayment, SkipMode } from '../engine/index.js';
import type { Resolution } from '../engine/index.js';

/**
 * The tracker's own database. It holds only what the tracker owns: the loan
 * setup, schedule adjustments, the reconciliation status of each month,
 * home value estimates, escrow entries, and the loan details you record.
 * Actual's data is never copied here beyond the matched transaction's id,
 * date, amount and payee, kept so the month can show what it was matched to.
 */

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
  categoryId: string | null;
}

export interface StoredHomeValue extends HomeValueEstimate {
  id: number;
}

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loan (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  setup      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS adjustments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL,
  payment        INTEGER NOT NULL,
  amount         INTEGER NOT NULL,
  source_payment INTEGER,
  created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS months (
  payment            INTEGER PRIMARY KEY,
  status             TEXT NOT NULL CHECK (status IN ('flagged', 'paid')),
  transaction_id     TEXT NOT NULL,
  transaction_date   TEXT NOT NULL,
  transaction_amount INTEGER NOT NULL,
  transaction_payee  TEXT,
  difference         INTEGER NOT NULL,
  resolution         TEXT,
  locked             TEXT,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS months_transaction ON months (transaction_id);
CREATE TABLE IF NOT EXISTS home_values (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  value      INTEGER NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS escrow_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const SINGLE_PAYMENT_KINDS: AdjustmentKind[] = ['pennyOffset', 'extraPrincipal'];

function toAdjustment(kind: AdjustmentKind, payment: number, amount: Cents, mode: string | null): Adjustment {
  if (kind === 'skip') return { kind, payment, mode: mode === 'defer' ? 'defer' : 'capitalize' };
  return (SINGLE_PAYMENT_KINDS.includes(kind) ? { kind, payment, amount } : { kind, fromPayment: payment, amount }) as Adjustment;
}

export class Store {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Bring a database created by an older version up to date. */
  private migrate() {
    const columns = (this.db.prepare(`PRAGMA table_info(adjustments)`).all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('mode')) this.db.exec(`ALTER TABLE adjustments ADD COLUMN mode TEXT`);
    this.db
      .prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', '2') ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
      .run();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // --- loan setup ---------------------------------------------------------

  getSetup(): LoanSetup | null {
    const row = this.db.prepare(`SELECT setup FROM loan WHERE id = 1`).get() as { setup: string } | undefined;
    return row ? (JSON.parse(row.setup) as LoanSetup) : null;
  }

  saveSetup(setup: LoanSetup) {
    this.db
      .prepare(
        `INSERT INTO loan (id, setup, updated_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET setup = excluded.setup, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(setup), new Date().toISOString());
  }

  // --- settings -------------------------------------------------------------

  getSettings(): Settings {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'settings'`).get() as { value: string } | undefined;
    return { categoryId: null, ...(row ? (JSON.parse(row.value) as Partial<Settings>) : {}) };
  }

  saveSettings(settings: Settings) {
    this.db
      .prepare(`INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(settings));
  }

  // --- adjustments ------------------------------------------------------------

  listAdjustments(): StoredAdjustment[] {
    const rows = this.db.prepare(`SELECT * FROM adjustments ORDER BY id`).all() as {
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
    const amount = 'amount' in a ? a.amount : 0;
    const mode = a.kind === 'skip' ? a.mode : null;
    const result = this.db
      .prepare(`INSERT INTO adjustments (kind, payment, amount, mode, source_payment, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(a.kind, payment, amount, mode, sourcePayment, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  setSkip(payment: number, mode: SkipMode | null) {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM adjustments WHERE kind = 'skip' AND payment = ?`).run(payment);
      if (mode) this.addAdjustment({ kind: 'skip', payment, mode }, null);
    });
  }

  deleteAdjustmentsFrom(sourcePayment: number) {
    this.db.prepare(`DELETE FROM adjustments WHERE source_payment = ?`).run(sourcePayment);
  }

  /** Remove the hand-entered penny offset for one month (reconciliation offsets stay). */
  deleteManualOffset(payment: number) {
    this.db.prepare(`DELETE FROM adjustments WHERE kind = 'pennyOffset' AND payment = ? AND source_payment IS NULL`).run(payment);
  }

  // --- months -----------------------------------------------------------------

  listMonths(): MonthRecord[] {
    return (this.db.prepare(`SELECT * FROM months ORDER BY payment`).all() as MonthRow[]).map(fromMonthRow);
  }

  getMonth(payment: number): MonthRecord | null {
    const row = this.db.prepare(`SELECT * FROM months WHERE payment = ?`).get(payment) as MonthRow | undefined;
    return row ? fromMonthRow(row) : null;
  }

  monthForTransaction(transactionId: string): number | null {
    const row = this.db.prepare(`SELECT payment FROM months WHERE transaction_id = ?`).get(transactionId) as
      | { payment: number }
      | undefined;
    return row?.payment ?? null;
  }

  saveMonth(m: Omit<MonthRecord, 'updatedAt'>) {
    this.db
      .prepare(
        `INSERT INTO months (payment, status, transaction_id, transaction_date, transaction_amount, transaction_payee,
                             difference, resolution, locked, updated_at)
         VALUES (@payment, @status, @transactionId, @transactionDate, @transactionAmount, @transactionPayee,
                 @difference, @resolution, @locked, @updatedAt)
         ON CONFLICT (payment) DO UPDATE SET
           status = excluded.status, transaction_id = excluded.transaction_id,
           transaction_date = excluded.transaction_date, transaction_amount = excluded.transaction_amount,
           transaction_payee = excluded.transaction_payee, difference = excluded.difference,
           resolution = excluded.resolution, locked = excluded.locked, updated_at = excluded.updated_at`,
      )
      .run({ ...m, locked: m.locked ? JSON.stringify(m.locked) : null, updatedAt: new Date().toISOString() });
  }

  deleteMonth(payment: number) {
    this.db.prepare(`DELETE FROM months WHERE payment = ?`).run(payment);
  }

  // --- home value estimates -----------------------------------------------------

  listHomeValues(): StoredHomeValue[] {
    return this.db.prepare(`SELECT id, date, value, source FROM home_values ORDER BY date, id`).all() as StoredHomeValue[];
  }

  addHomeValue(v: HomeValueEstimate): number {
    const result = this.db
      .prepare(`INSERT INTO home_values (date, value, source, created_at) VALUES (?, ?, ?, ?)`)
      .run(v.date, v.value, v.source, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  deleteHomeValue(id: number): boolean {
    return this.db.prepare(`DELETE FROM home_values WHERE id = ?`).run(id).changes > 0;
  }

  // --- escrow entries ---------------------------------------------------------------

  listEscrowEntries(): EscrowEntry[] {
    return this.db.prepare(`SELECT id, date, kind, amount, note FROM escrow_entries ORDER BY date, id`).all() as EscrowEntry[];
  }

  addEscrowEntry(e: Omit<EscrowEntry, 'id'>): number {
    const result = this.db
      .prepare(`INSERT INTO escrow_entries (date, kind, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(e.date, e.kind satisfies EscrowKind, e.amount, e.note, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  deleteEscrowEntry(id: number): boolean {
    return this.db.prepare(`DELETE FROM escrow_entries WHERE id = ?`).run(id).changes > 0;
  }

  // --- loan details -------------------------------------------------------------------

  getDetails(): LoanDetails {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'details'`).get() as { value: string } | undefined;
    return { fields: {}, custom: [], ...(row ? (JSON.parse(row.value) as Partial<LoanDetails>) : {}) };
  }

  saveDetails(details: LoanDetails) {
    this.db
      .prepare(`INSERT INTO meta (key, value) VALUES ('details', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(details));
  }

  close() {
    this.db.close();
  }
}

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
