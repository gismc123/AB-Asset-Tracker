import type Database from 'better-sqlite3';

/**
 * Numbered schema migrations. Each one runs once, inside a transaction, and
 * is written so that running it again is harmless. Never edit a migration
 * that has shipped; add a new one instead.
 */
export interface Migration {
  version: number;
  description: string;
  up(db: Database.Database): void;
}

const tableExists = (db: Database.Database, name: string) =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

const count = (db: Database.Database, table: string) =>
  tableExists(db, table) ? (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n : 0;

/** The single-loan schema every release before multi-loan support created. */
const LEGACY_SCHEMA = `
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

/** Every per-loan table carries `loan_id`; assets and their values stand on their own. */
const MULTI_LOAN_SCHEMA = `
CREATE TABLE loans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('mortgage', 'auto', 'personal')),
  created_at TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);
CREATE TABLE loan_setup (
  loan_id    INTEGER PRIMARY KEY REFERENCES loans (id) ON DELETE CASCADE,
  setup      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE loan_settings (
  loan_id     INTEGER PRIMARY KEY REFERENCES loans (id) ON DELETE CASCADE,
  category_id TEXT
);
CREATE TABLE loan_details (
  loan_id INTEGER PRIMARY KEY REFERENCES loans (id) ON DELETE CASCADE,
  details TEXT NOT NULL
);
CREATE TABLE adjustments_v2 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id        INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  payment        INTEGER NOT NULL,
  amount         INTEGER NOT NULL,
  mode           TEXT,
  source_payment INTEGER,
  created_at     TEXT NOT NULL
);
CREATE TABLE months_v2 (
  loan_id            INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
  payment            INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('flagged', 'paid')),
  transaction_id     TEXT NOT NULL,
  transaction_date   TEXT NOT NULL,
  transaction_amount INTEGER NOT NULL,
  transaction_payee  TEXT,
  difference         INTEGER NOT NULL,
  resolution         TEXT,
  locked             TEXT,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (loan_id, payment)
);
CREATE TABLE escrow_entries_v2 (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id    INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE assets (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id              INTEGER REFERENCES loans (id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('home', 'vehicle', 'other')),
  original_value_cents INTEGER NOT NULL CHECK (original_value_cents >= 0),
  value_trend          TEXT NOT NULL CHECK (value_trend IN ('appreciating', 'depreciating', 'manual')),
  trend_rate_percent   REAL,
  acquired_date        TEXT,
  created_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX assets_loan ON assets (loan_id) WHERE loan_id IS NOT NULL;
CREATE TABLE asset_values (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id    INTEGER NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX asset_values_asset ON asset_values (asset_id, date);
`;

const FINISH_MULTI_LOAN = `
DROP TABLE adjustments;
DROP TABLE months;
DROP TABLE escrow_entries;
DROP TABLE home_values;
DROP TABLE loan;
ALTER TABLE adjustments_v2 RENAME TO adjustments;
ALTER TABLE months_v2 RENAME TO months;
ALTER TABLE escrow_entries_v2 RENAME TO escrow_entries;
CREATE INDEX adjustments_loan ON adjustments (loan_id);
CREATE UNIQUE INDEX months_transaction ON months (loan_id, transaction_id);
CREATE INDEX escrow_entries_loan ON escrow_entries (loan_id);
DELETE FROM meta WHERE key IN ('settings', 'details', 'schema_version');
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Single-loan schema (every release before multi-loan support)',
    up(db) {
      db.exec(LEGACY_SCHEMA);
      if (!columns(db, 'adjustments').includes('mode')) db.exec(`ALTER TABLE adjustments ADD COLUMN mode TEXT`);
    },
  },
  {
    version: 2,
    description: 'Multiple loans and assets: loans, assets, asset_values; loan_id on every per-loan table',
    up(db) {
      if (tableExists(db, 'loans')) return;
      const before = {
        adjustments: count(db, 'adjustments'),
        months: count(db, 'months'),
        escrow: count(db, 'escrow_entries'),
        homeValues: count(db, 'home_values'),
      };
      db.exec(MULTI_LOAN_SCHEMA);

      const legacyLoan = db.prepare(`SELECT setup, updated_at FROM loan WHERE id = 1`).get() as
        | { setup: string; updated_at: string }
        | undefined;
      const meta = (key: string) => (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
      const settings = meta('settings');
      const details = meta('details');
      const hasData = !!legacyLoan || !!settings || !!details || Object.values(before).some((n) => n > 0);

      if (hasData) {
        const now = new Date().toISOString();
        // Loan 1 keeps every id and timestamp it had, so nothing downstream can tell it moved.
        db.prepare(`INSERT INTO loans (id, nickname, type, created_at, archived) VALUES (1, 'Mortgage', 'mortgage', ?, 0)`).run(
          legacyLoan?.updated_at ?? now,
        );
        if (legacyLoan) {
          db.prepare(`INSERT INTO loan_setup (loan_id, setup, updated_at) VALUES (1, ?, ?)`).run(legacyLoan.setup, legacyLoan.updated_at);
        }
        if (settings) {
          const categoryId = (JSON.parse(settings) as { categoryId?: string | null }).categoryId ?? null;
          db.prepare(`INSERT INTO loan_settings (loan_id, category_id) VALUES (1, ?)`).run(categoryId);
        }
        if (details) db.prepare(`INSERT INTO loan_details (loan_id, details) VALUES (1, ?)`).run(details);

        db.exec(`
          INSERT INTO adjustments_v2 (id, loan_id, kind, payment, amount, mode, source_payment, created_at)
            SELECT id, 1, kind, payment, amount, mode, source_payment, created_at FROM adjustments;
          INSERT INTO months_v2 (loan_id, payment, status, transaction_id, transaction_date, transaction_amount,
                                 transaction_payee, difference, resolution, locked, updated_at)
            SELECT 1, payment, status, transaction_id, transaction_date, transaction_amount,
                   transaction_payee, difference, resolution, locked, updated_at FROM months;
          INSERT INTO escrow_entries_v2 (id, loan_id, date, kind, amount, note, created_at)
            SELECT id, 1, date, kind, amount, note, created_at FROM escrow_entries;
        `);

        if (legacyLoan || before.homeValues > 0) {
          const homeValue = legacyLoan ? (JSON.parse(legacyLoan.setup) as { originalHomeValue?: number }).originalHomeValue : undefined;
          db.prepare(
            `INSERT INTO assets (id, loan_id, name, kind, original_value_cents, value_trend, trend_rate_percent, acquired_date, created_at)
             VALUES (1, 1, 'Home', 'home', ?, 'manual', NULL, ?, ?)`,
          ).run(
            Number.isInteger(homeValue) && homeValue! >= 0 ? homeValue : 0,
            legacyLoan ? ((JSON.parse(legacyLoan.setup) as { openDate?: string }).openDate ?? null) : null,
            legacyLoan?.updated_at ?? now,
          );
          db.exec(`
            INSERT INTO asset_values (id, asset_id, date, value_cents, source, created_at)
              SELECT id, 1, date, value, source, created_at FROM home_values;
          `);
        }
      }

      const after = {
        adjustments: count(db, 'adjustments_v2'),
        months: count(db, 'months_v2'),
        escrow: count(db, 'escrow_entries_v2'),
        homeValues: count(db, 'asset_values'),
      };
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`Migration 2 copied a different number of rows than it found: ${JSON.stringify({ before, after })}`);
      }
      db.exec(FINISH_MULTI_LOAN);
    },
  },
  {
    version: 3,
    description: 'Student loans: allow loan type student',
    up(db) {
      const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'loans'`).get() as { sql: string }).sql;
      if (sql.includes(`'student'`)) return;
      // SQLite can't change a CHECK constraint in place, so the table is
      // rebuilt as its documented procedure says. Foreign keys are off while
      // migrations run, so dropping the old table cascades nothing, and the
      // other tables' references point at the new one once it is renamed.
      const before = count(db, 'loans');
      const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'loans'`).get() as { seq: number } | undefined;
      db.exec(`
        CREATE TABLE loans_v3 (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          nickname   TEXT NOT NULL,
          type       TEXT NOT NULL CHECK (type IN ('mortgage', 'auto', 'personal', 'student')),
          created_at TEXT NOT NULL,
          archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
        );
        INSERT INTO loans_v3 (id, nickname, type, created_at, archived) SELECT id, nickname, type, created_at, archived FROM loans;
        DROP TABLE loans;
        ALTER TABLE loans_v3 RENAME TO loans;
      `);
      if (count(db, 'loans') !== before) throw new Error('Migration 3 copied a different number of loans than it found');
      // Keep AUTOINCREMENT's high-water mark, so the id of a deleted loan is never reused.
      if (seq) {
        db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'loans'`).run();
        db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('loans', ?)`).run(seq.seq);
      }
    },
  },
  {
    version: 4,
    description: "Asset value from an Actual account's balance: assets.actual_account_id",
    up(db) {
      if (!columns(db, 'assets').includes('actual_account_id')) db.exec(`ALTER TABLE assets ADD COLUMN actual_account_id TEXT`);
    },
  },
  {
    version: 5,
    description: 'Extra principal paid in transactions of their own: extra_payments',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS extra_payments (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          loan_id           INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
          date              TEXT NOT NULL,
          amount            INTEGER NOT NULL CHECK (amount > 0),
          transaction_id    TEXT,
          transaction_payee TEXT,
          note              TEXT NOT NULL DEFAULT '',
          created_at        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS extra_payments_loan ON extra_payments (loan_id, date);
        CREATE UNIQUE INDEX IF NOT EXISTS extra_payments_transaction ON extra_payments (loan_id, transaction_id) WHERE transaction_id IS NOT NULL;
      `);
    },
  },
  {
    version: 6,
    description: "A lender's amortization table: bank_schedule",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bank_schedule (
          loan_id        INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
          payment        INTEGER NOT NULL CHECK (payment >= 1),
          due_date       TEXT,
          payment_amount INTEGER,
          principal      INTEGER NOT NULL CHECK (principal >= 0),
          interest       INTEGER NOT NULL CHECK (interest >= 0),
          balance        INTEGER,
          imported_at    TEXT NOT NULL,
          PRIMARY KEY (loan_id, payment)
        );
      `);
    },
  },
];

export const LATEST_VERSION = MIGRATIONS.at(-1)!.version;

export function currentVersion(db: Database.Database): number {
  if (!tableExists(db, 'schema_version')) return 0;
  return (db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`).get() as { v: number }).v;
}

/**
 * Apply every pending migration up to `upTo`. `backup` runs first, once,
 * when there is anything to migrate in a database that already has data in
 * it. Returns the versions applied.
 */
export function migrate(db: Database.Database, backup?: (fromVersion: number) => void, upTo = LATEST_VERSION): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  )`);
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from && m.version <= upTo);
  if (!pending.length) return [];
  const hasData = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT IN ('schema_version') AND name NOT LIKE 'sqlite_%' LIMIT 1`).get();
  if (hasData && backup) backup(from);

  // Rebuilding tables needs foreign keys off; they're checked before committing.
  db.pragma('foreign_keys = OFF');
  try {
    for (const m of pending) {
      db.transaction(() => {
        m.up(db);
        const problems = db.pragma('foreign_key_check') as unknown[];
        if (problems.length) throw new Error(`Migration ${m.version} left ${problems.length} broken references`);
        db.prepare(`INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)`).run(
          m.version,
          m.description,
          new Date().toISOString(),
        );
      })();
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return pending.map((m) => m.version);
}
