-- AB Asset Tracker v0.1.0 database (schema version 2), made-up sample data.
PRAGMA foreign_keys = OFF;
CREATE TABLE "adjustments" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id        INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  payment        INTEGER NOT NULL,
  amount         INTEGER NOT NULL,
  mode           TEXT,
  source_payment INTEGER,
  created_at     TEXT NOT NULL
);
CREATE TABLE asset_values (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id    INTEGER NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL
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
CREATE TABLE "escrow_entries" (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id    INTEGER NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE loan_details (
  loan_id INTEGER PRIMARY KEY REFERENCES loans (id) ON DELETE CASCADE,
  details TEXT NOT NULL
);
CREATE TABLE loan_settings (
  loan_id     INTEGER PRIMARY KEY REFERENCES loans (id) ON DELETE CASCADE,
  category_id TEXT
);
CREATE TABLE loan_setup (
  loan_id    INTEGER PRIMARY KEY REFERENCES loans (id) ON DELETE CASCADE,
  setup      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE loans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('mortgage', 'auto', 'personal')),
  created_at TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE "months" (
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
CREATE TABLE schema_version (
    version     INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  );
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (1, 1, 'pennyOffset', 2, 2, NULL, 2, '2026-10-30T03:31:57.319Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (2, 1, 'extraPrincipal', 3, 30000, NULL, 3, '2026-10-30T03:31:57.435Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (3, 1, 'escrow', 4, 43125, NULL, 4, '2026-10-30T03:31:57.518Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (4, 1, 'standingExtra', 6, 10000, NULL, 6, '2026-10-30T03:31:57.620Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (5, 1, 'skip', 9, 0, 'catchUp', NULL, '2026-10-30T03:31:57.675Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (6, 1, 'catchUpPlan', 11, 3, NULL, NULL, '2026-10-30T03:31:57.709Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (7, 1, 'pennyOffset', 8, -1, NULL, NULL, '2026-10-30T03:31:57.799Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (8, 2, 'extraPrincipal', 3, 20000, NULL, 3, '2026-10-30T03:31:57.956Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (9, 3, 'skip', 5, 0, 'capitalize', NULL, '2026-10-30T03:31:58.127Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (10, 3, 'skip', 7, 0, 'defer', NULL, '2026-10-30T03:31:58.138Z');
INSERT INTO "adjustments" ("id", "loan_id", "kind", "payment", "amount", "mode", "source_payment", "created_at") VALUES (11, 4, 'pmi', 80, 0, NULL, NULL, '2026-10-30T03:31:58.255Z');
INSERT INTO "asset_values" ("id", "asset_id", "date", "value_cents", "source", "created_at") VALUES (1, 1, '2025-09-01', 36800000, 'Online estimate', '2026-10-30T03:31:57.818Z');
INSERT INTO "asset_values" ("id", "asset_id", "date", "value_cents", "source", "created_at") VALUES (2, 2, '2025-08-15', 3150000, 'Pricing guide', '2026-10-30T03:31:58.049Z');
INSERT INTO "assets" ("id", "loan_id", "name", "kind", "original_value_cents", "value_trend", "trend_rate_percent", "acquired_date", "created_at") VALUES (1, 1, 'Home', 'home', 35500000, 'manual', NULL, '2025-02-14', '2026-10-30T03:31:57.175Z');
INSERT INTO "assets" ("id", "loan_id", "name", "kind", "original_value_cents", "value_trend", "trend_rate_percent", "acquired_date", "created_at") VALUES (2, 2, 'Hatchback', 'vehicle', 3600000, 'depreciating', 15, '2025-03-10', '2026-10-30T03:31:57.823Z');
INSERT INTO "assets" ("id", "loan_id", "name", "kind", "original_value_cents", "value_trend", "trend_rate_percent", "acquired_date", "created_at") VALUES (3, 4, 'Home', 'home', 27000000, 'manual', NULL, '2019-05-20', '2026-10-30T03:31:58.177Z');
INSERT INTO "escrow_entries" ("id", "loan_id", "date", "kind", "amount", "note", "created_at") VALUES (1, 1, '2025-02-14', 'deposit', 164000, 'Initial deposit', '2026-10-30T03:31:57.733Z');
INSERT INTO "escrow_entries" ("id", "loan_id", "date", "kind", "amount", "note", "created_at") VALUES (2, 1, '2025-06-20', 'homeownersInsurance', 216000, 'Annual premium', '2026-10-30T03:31:57.752Z');
INSERT INTO "loan_details" ("loan_id", "details") VALUES (1, '{"fields":{"servicerName":"Sample Home Loans","loanNumber":"0000123456"},"custom":[{"label":"Escrow analysis","value":"Every April"}]}');
INSERT INTO "loan_settings" ("loan_id", "category_id") VALUES (1, 'cat-mortgage');
INSERT INTO "loan_settings" ("loan_id", "category_id") VALUES (2, 'cat-car');
INSERT INTO "loan_settings" ("loan_id", "category_id") VALUES (3, 'cat-personal');
INSERT INTO "loan_settings" ("loan_id", "category_id") VALUES (4, 'cat-rental');
INSERT INTO "loan_setup" ("loan_id", "setup", "updated_at") VALUES (1, '{"originalAmount":32000000,"annualRatePercent":6.5,"termYears":30,"openDate":"2025-02-14","firstPaymentDate":"2025-04-01","paymentDay":1,"piPaymentOverride":null,"originalHomeValue":35500000,"pmiMonthly":14800,"pmiStartDate":null,"pmiRemovalRule":"auto78Scheduled","escrowMonthly":41250,"extraPrincipal":0,"startingPoint":null}', '2026-10-30T03:31:57.175Z');
INSERT INTO "loan_setup" ("loan_id", "setup", "updated_at") VALUES (2, '{"originalAmount":3000000,"annualRatePercent":6.9,"termYears":5,"openDate":"2025-03-10","firstPaymentDate":"2025-04-10","paymentDay":10,"piPaymentOverride":null,"originalHomeValue":0,"pmiMonthly":0,"pmiStartDate":null,"pmiRemovalRule":"auto78Scheduled","escrowMonthly":0,"extraPrincipal":0,"startingPoint":null,"termMonths":60,"modules":{"pmi":false,"escrow":false},"interestMethod":"daily","downPayment":600000,"fees":[{"label":"Processing fee","amount":29900,"financed":false},{"label":"Credit insurance","amount":45000,"financed":true}]}', '2026-10-30T03:31:57.829Z');
INSERT INTO "loan_setup" ("loan_id", "setup", "updated_at") VALUES (3, '{"originalAmount":1200000,"annualRatePercent":11.5,"termYears":3,"openDate":"2025-01-20","firstPaymentDate":"2025-02-20","paymentDay":20,"piPaymentOverride":null,"originalHomeValue":0,"pmiMonthly":0,"pmiStartDate":null,"pmiRemovalRule":"auto78Scheduled","escrowMonthly":0,"extraPrincipal":0,"startingPoint":null,"termMonths":36,"modules":{"pmi":false,"escrow":false},"yearlyFee":{"basis":"balance","percent":0.5},"payoffQuote":{"amount":900000,"goodThrough":"2025-09-30"}}', '2026-10-30T03:31:58.054Z');
INSERT INTO "loan_setup" ("loan_id", "setup", "updated_at") VALUES (4, '{"originalAmount":24000000,"annualRatePercent":4.25,"termYears":30,"openDate":"2019-05-20","firstPaymentDate":"2019-07-01","paymentDay":1,"piPaymentOverride":null,"originalHomeValue":27000000,"pmiMonthly":9900,"pmiStartDate":null,"pmiRemovalRule":"untilRemoved","escrowMonthly":30000,"extraPrincipal":0,"startingPoint":{"payment":70,"balance":20500000}}', '2026-10-30T03:31:58.176Z');
INSERT INTO "loans" ("id", "nickname", "type", "created_at", "archived") VALUES (1, 'Mortgage', 'mortgage', '2026-10-30T03:31:57.152Z', 0);
INSERT INTO "loans" ("id", "nickname", "type", "created_at", "archived") VALUES (2, 'Hatchback', 'auto', '2026-10-30T03:31:57.822Z', 0);
INSERT INTO "loans" ("id", "nickname", "type", "created_at", "archived") VALUES (3, 'Kitchen loan', 'personal', '2026-10-30T03:31:58.051Z', 0);
INSERT INTO "loans" ("id", "nickname", "type", "created_at", "archived") VALUES (4, 'Rental', 'mortgage', '2026-10-30T03:31:58.164Z', 1);
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 1, 'paid', 'm1', '2025-03-31', 258312, 'Sample Servicer', 0, NULL, '{"payment":1,"interest":173333,"scheduledPrincipal":28929,"extraPrincipal":0,"pennyOffset":0,"principal":28929,"principalAndInterest":202262,"pmi":14800,"escrow":41250,"fee":0,"total":258312,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.268Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 2, 'paid', 'm2', '2025-04-30', 258314, 'Sample Servicer', 2, 'rounding', '{"payment":2,"interest":173177,"scheduledPrincipal":29085,"extraPrincipal":0,"pennyOffset":2,"principal":29087,"principalAndInterest":202262,"pmi":14800,"escrow":41250,"fee":0,"total":258314,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.340Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 3, 'paid', 'm3', '2025-05-30', 288312, 'Sample Servicer', 30000, 'extraPrincipal', '{"payment":3,"interest":173019,"scheduledPrincipal":29243,"extraPrincipal":30000,"pennyOffset":0,"principal":59243,"principalAndInterest":202262,"pmi":14800,"escrow":41250,"fee":0,"total":288312,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.445Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 4, 'paid', 'm4', '2025-07-01', 260187, 'Sample Servicer', 1875, 'escrow', '{"payment":4,"interest":172698,"scheduledPrincipal":29564,"extraPrincipal":0,"pennyOffset":0,"principal":29564,"principalAndInterest":202262,"pmi":14800,"escrow":43125,"fee":0,"total":260187,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.531Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 5, 'paid', 'm5', '2025-08-01', 260187, 'Sample Servicer', 0, NULL, '{"payment":5,"interest":172538,"scheduledPrincipal":29724,"extraPrincipal":0,"pennyOffset":0,"principal":29724,"principalAndInterest":202262,"pmi":14800,"escrow":43125,"fee":0,"total":260187,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.577Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 6, 'paid', 'm6', '2025-08-29', 270187, 'Sample Servicer', 10000, 'extraPrincipal', '{"payment":6,"interest":172377,"scheduledPrincipal":29885,"extraPrincipal":10000,"pennyOffset":0,"principal":39885,"principalAndInterest":202262,"pmi":14800,"escrow":43125,"fee":0,"total":270187,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.630Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 7, 'flagged', 'm7', '2025-10-01', 265187, 'Sample Servicer', -5000, NULL, NULL, '2026-10-30T03:31:57.667Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (2, 1, 'paid', 'a1', '2025-04-08', 59262, 'Sample Auto Finance', 0, NULL, '{"payment":1,"interest":16447,"scheduledPrincipal":42815,"extraPrincipal":0,"pennyOffset":0,"principal":42815,"principalAndInterest":59262,"pmi":0,"escrow":0,"fee":0,"total":59262,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.876Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (2, 2, 'paid', 'a2', '2025-05-12', 59262, 'Sample Auto Finance', 0, NULL, '{"payment":2,"interest":19007,"scheduledPrincipal":40255,"extraPrincipal":0,"pennyOffset":0,"principal":40255,"principalAndInterest":59262,"pmi":0,"escrow":0,"fee":0,"total":59262,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.910Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (2, 3, 'paid', 'a3', '2025-06-10', 79262, 'Sample Auto Finance', 20000, 'extraPrincipal', '{"payment":3,"interest":15991,"scheduledPrincipal":43271,"extraPrincipal":20000,"pennyOffset":0,"principal":63271,"principalAndInterest":59262,"pmi":0,"escrow":0,"fee":0,"total":79262,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:57.962Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (2, 4, 'paid', 'a4', '2025-07-09', 59262, 'Sample Auto Finance', 0, NULL, '{"payment":4,"interest":15644,"scheduledPrincipal":43618,"extraPrincipal":0,"pennyOffset":0,"principal":43618,"principalAndInterest":59262,"pmi":0,"escrow":0,"fee":0,"total":59262,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.013Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (2, 5, 'paid', 'a5', '2025-08-11', 59262, 'Sample Auto Finance', 0, NULL, '{"payment":5,"interest":17530,"scheduledPrincipal":41732,"extraPrincipal":0,"pennyOffset":0,"principal":41732,"principalAndInterest":59262,"pmi":0,"escrow":0,"fee":0,"total":59262,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.048Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (3, 1, 'paid', 'p1', '2025-02-20', 45571, 'Sample Servicer', 0, NULL, '{"payment":1,"interest":11500,"scheduledPrincipal":28071,"extraPrincipal":0,"pennyOffset":0,"principal":28071,"principalAndInterest":39571,"pmi":0,"escrow":0,"fee":6000,"total":45571,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.075Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (3, 2, 'paid', 'p2', '2025-03-20', 39571, 'Sample Servicer', 0, NULL, '{"payment":2,"interest":11231,"scheduledPrincipal":28340,"extraPrincipal":0,"pennyOffset":0,"principal":28340,"principalAndInterest":39571,"pmi":0,"escrow":0,"fee":0,"total":39571,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.087Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (3, 3, 'paid', 'p3', '2025-04-20', 39571, 'Sample Servicer', 0, NULL, '{"payment":3,"interest":10959,"scheduledPrincipal":28612,"extraPrincipal":0,"pennyOffset":0,"principal":28612,"principalAndInterest":39571,"pmi":0,"escrow":0,"fee":0,"total":39571,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.107Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (3, 4, 'paid', 'p4', '2025-05-20', 39571, 'Sample Servicer', 0, NULL, '{"payment":4,"interest":10685,"scheduledPrincipal":28886,"extraPrincipal":0,"pennyOffset":0,"principal":28886,"principalAndInterest":39571,"pmi":0,"escrow":0,"fee":0,"total":39571,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.124Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (3, 6, 'paid', 'p6', '2025-07-20', 39571, 'Sample Servicer', 0, NULL, '{"payment":6,"interest":10508,"scheduledPrincipal":29063,"extraPrincipal":0,"pennyOffset":0,"principal":29063,"principalAndInterest":39571,"pmi":0,"escrow":0,"fee":0,"total":39571,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.162Z');
INSERT INTO "months" ("loan_id", "payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (4, 71, 'paid', 'u71', '2025-05-01', 157966, 'Sample Servicer', 0, NULL, '{"payment":71,"interest":72604,"scheduledPrincipal":45462,"extraPrincipal":0,"pennyOffset":0,"principal":45462,"principalAndInterest":118066,"pmi":9900,"escrow":30000,"fee":0,"total":157966,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-30T03:31:58.242Z');
INSERT INTO "schema_version" ("version", "description", "applied_at") VALUES (1, 'Single-loan schema (every release before multi-loan support)', '2026-10-30T03:31:57.138Z');
INSERT INTO "schema_version" ("version", "description", "applied_at") VALUES (2, 'Multiple loans and assets: loans, assets, asset_values; loan_id on every per-loan table', '2026-10-30T03:31:57.148Z');
CREATE INDEX adjustments_loan ON adjustments (loan_id);
CREATE INDEX asset_values_asset ON asset_values (asset_id, date);
CREATE UNIQUE INDEX assets_loan ON assets (loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX escrow_entries_loan ON escrow_entries (loan_id);
CREATE UNIQUE INDEX months_transaction ON months (loan_id, transaction_id);
