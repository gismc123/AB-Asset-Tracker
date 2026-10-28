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
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (1, 'pennyOffset', 2, 2, 2, '2026-10-28T19:03:44.161Z', NULL);
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (2, 'standingExtra', 3, 35000, 3, '2026-10-28T19:03:44.253Z', NULL);
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (3, 'escrow', 4, 43367, 4, '2026-10-28T19:03:44.308Z', NULL);
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (4, 'skip', 5, 0, NULL, '2026-10-28T19:03:44.332Z', 'catchUp');
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (5, 'skip', 6, 0, NULL, '2026-10-28T19:03:44.360Z', 'defer');
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (6, 'catchUpPlan', 8, 2, NULL, '2026-10-28T19:03:44.387Z', NULL);
INSERT INTO "adjustments" ("id", "kind", "payment", "amount", "source_payment", "created_at", "mode") VALUES (7, 'pennyOffset', 9, -1, NULL, '2026-10-28T19:03:44.443Z', NULL);
INSERT INTO "escrow_entries" ("id", "date", "kind", "amount", "note", "created_at") VALUES (1, '2025-02-14', 'deposit', 164000, 'Initial deposit at closing', '2026-10-28T19:03:44.494Z');
INSERT INTO "escrow_entries" ("id", "date", "kind", "amount", "note", "created_at") VALUES (2, '2025-06-20', 'homeownersInsurance', 216000, 'Annual premium', '2026-10-28T19:03:44.506Z');
INSERT INTO "home_values" ("id", "date", "value", "source", "created_at") VALUES (1, '2025-06-01', 36100000, 'Tax assessment', '2026-10-28T19:03:44.457Z');
INSERT INTO "home_values" ("id", "date", "value", "source", "created_at") VALUES (2, '2025-09-01', 36800000, 'Online estimate', '2026-10-28T19:03:44.478Z');
INSERT INTO "loan" ("id", "setup", "updated_at") VALUES (1, '{"originalAmount":32000000,"annualRatePercent":6.5,"termYears":30,"openDate":"2025-02-14","firstPaymentDate":"2025-04-01","paymentDay":1,"piPaymentOverride":null,"originalHomeValue":35500000,"pmiMonthly":14800,"pmiStartDate":null,"pmiRemovalRule":"auto78Scheduled","escrowMonthly":41250,"extraPrincipal":5000,"startingPoint":null}', '2026-10-28T19:03:44.053Z');
INSERT INTO "meta" ("key", "value") VALUES ('schema_version', '2');
INSERT INTO "meta" ("key", "value") VALUES ('settings', '{"categoryId":"cat-mortgage"}');
INSERT INTO "meta" ("key", "value") VALUES ('details', '{"fields":{"servicerName":"Sample Servicing Co","loanNumber":"SAMPLE-0000-1111","notes":"Made-up notes"},"custom":[{"label":"Branch","value":"Sample branch"}]}');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (1, 'paid', 'a1', '2025-03-30', 263312, 'Sample Mortgage Servicer', 0, NULL, '{"payment":1,"interest":173333,"scheduledPrincipal":28929,"extraPrincipal":5000,"pennyOffset":0,"principal":33929,"principalAndInterest":202262,"pmi":14800,"escrow":41250,"total":263312,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-28T19:03:44.118Z');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (2, 'paid', 'a2', '2025-04-29', 263314, 'Sample Mortgage Servicer', 2, 'rounding', '{"payment":2,"interest":173150,"scheduledPrincipal":29112,"extraPrincipal":5000,"pennyOffset":2,"principal":34114,"principalAndInterest":202262,"pmi":14800,"escrow":41250,"total":263314,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-28T19:03:44.173Z');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (3, 'paid', 'a3', '2025-05-30', 293312, 'Sample Mortgage Servicer', 30000, 'extraPrincipal', '{"payment":3,"interest":172965,"scheduledPrincipal":29297,"extraPrincipal":35000,"pennyOffset":0,"principal":64297,"principalAndInterest":202262,"pmi":14800,"escrow":41250,"total":293312,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-28T19:03:44.261Z');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (4, 'paid', 'a4', '2025-07-01', 295429, 'Sample Mortgage Servicer', 2117, 'escrow', '{"payment":4,"interest":172616,"scheduledPrincipal":29646,"extraPrincipal":35000,"pennyOffset":0,"principal":64646,"principalAndInterest":202262,"pmi":14800,"escrow":43367,"total":295429,"skipped":null,"capitalizedInterest":0,"deferred":0,"deferredRepaid":0,"pastDue":0,"catchUp":null}', '2026-10-28T19:03:44.315Z');
INSERT INTO "months" ("payment", "status", "transaction_id", "transaction_date", "transaction_amount", "transaction_payee", "difference", "resolution", "locked", "updated_at") VALUES (7, 'flagged', 'a7', '2025-10-01', 296428, 'Sample Mortgage Servicer', 999, NULL, NULL, '2026-10-28T19:03:44.433Z');
