CREATE TABLE adjustments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL,
  payment        INTEGER NOT NULL,
  amount         INTEGER NOT NULL,
  source_payment INTEGER,
  created_at     TEXT NOT NULL
, mode TEXT);
CREATE TABLE escrow_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE home_values (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  value      INTEGER NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE loan (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  setup      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE months (
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
CREATE UNIQUE INDEX months_transaction ON months (transaction_id);
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (1, 'pmi', 8, 0, 8, '2026-10-28T19:03:44.626Z', NULL);
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (2, 'skip', 10, 0, NULL, '2026-10-28T19:03:44.655Z', 'capitalize');
INSERT INTO "loan" ("id", "setup", "updated_at") VALUES (1, '{"originalAmount":32000000,"annualRatePercent":6.5,"termYears":30,"openDate":"2025-02-14","firstPaymentDate":"2025-04-01","paymentDay":1,"piPaymentOverride":202264,"originalHomeValue":35500000,"pmiMonthly":14800,"pmiStartDate":null,"pmiRemovalRule":"request80","escrowMonthly":41250,"extraPrincipal":0,"startingPoint":{"payment":6,"balance":31500000}}', '2026-10-28T19:03:44.558Z');
INSERT INTO "meta" ("key", "value") VALUES ('schema_version', '2');
INSERT INTO "meta" ("key", "value") VALUES ('settings', '{"categoryId":"cat-mortgage"}');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (7, 'paid', 'b7', '2025-10-01', 258314, 'Sample Mortgage Servicer', 0, NULL, '{"payment":7,"interest":170625,"scheduledPrincipal":31639,"extraPrincipal":0,"pennyOffset":0,"principal":31639,"principalAndInterest":202264,"pmi":14800,"escrow":41250,"total":258314,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-28T19:03:44.592Z');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (8, 'paid', 'b8', '2025-11-03', 243514, 'Sample Mortgage Servicer', -14800, 'pmi', '{"payment":8,"interest":170454,"scheduledPrincipal":31810,"extraPrincipal":0,"pennyOffset":0,"principal":31810,"principalAndInterest":202264,"pmi":0,"escrow":41250,"total":243514,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-28T19:03:44.635Z');
