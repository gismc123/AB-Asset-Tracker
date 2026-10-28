# Development

Building, testing and the code layout, for contributors. Back to the [README](../README.md).

The math lives in `src/engine`, has no dependencies, and is fully unit
tested. All money is integer cents.

```sh
npm install && npm test        # with Node 22+
npm run typecheck
npm run build                  # dist/server (backend) + dist/ui (inject.js, preview)
```

No Node on the machine (e.g. a Raspberry Pi with only Docker)? Use the
wrapper, which runs the same commands in the official Node image:

```sh
./scripts/npm.sh install
./scripts/npm.sh test
./scripts/npm.sh run build
```

**Preview the screens without Actual.** After a build, open
`dist/ui/preview.html` in a browser. It runs the real components against an
in-memory mock with three made-up loans and a mock sidebar. Add
`?theme=dark`, `?empty` (first-run screen), `?privacy`, or `?loan=2`.

**Tests use no real Actual server or data.** Backend tests run against an
in-memory database and a fake Actual source (`src/server/testing.ts`). The
migration tests load databases in the tracker's first schema
(`test/fixtures`) and check the migrated loan matches its numbers exactly.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to propose changes, and
[docs/DECISIONS.md](DECISIONS.md),
[docs/KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and
[docs/ROADMAP.md](ROADMAP.md) for the reasoning, the gaps, and what's
planned.

## Project layout

```
src/engine/      Amortization, interest, fees, skips, PMI, reconciliation, equity, assets, escrow, period totals (pure, tested)
src/server/      Backend: config, read-only Actual adapter, SQLite store and migrations, services, HTTP API
src/ui/          Loan screens (React), sidebar list, API client, styles, preview
src/inject/      The one script the proxy injects into Actual's page
proxy/           nginx image: TLS, pass-through, one-line injection
test/fixtures/   Databases in the first schema, for the migration tests
examples/        Made-up sample loans (cents)
scripts/         UI build, Docker-only npm wrapper
docs/            Screenshots, decisions, known limitations, publishing notes
docker-compose.yml           Setup B: stock Actual + add-on
compose.existing-actual.yml  Setup A: add-on in front of an Actual you already run
compose.addon.yml            The two add-on services (used by both)
```

## API (for the UI)

All under `/asset-tracker-api`, and all except `health` and `v1/summary`
need the `x-actual-token` header of a logged-in Actual session. Money is in
cents.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness, and whether Actual is connected (no error text; that's in the loan state) |
| `GET /v1/summary[?loan=<id>]` | Read-only dashboard summary (own token, see above) |
| `GET /categories` | Actual's category groups |
| `GET /loans` | Every loan with what it owes, its equity and next payment |
| `POST /loans` | `{ nickname, type, setup?, asset?, categoryId? }`: add a loan |
| `PATCH /loans/:loanId` | `{ nickname?, type?, archived? }` |
| `POST /loans/:loanId/archive`, `/unarchive` | Hide or show a loan |
| `DELETE /loans/:loanId?confirm=<nickname>[&keepAsset=1]` | Delete a loan and its records (its asset too, unless `keepAsset`) |
| `GET /loans/:loanId/state` | Setup, schedule with statuses, summary, equity, periods, escrow, asset, details |
| `PUT /loans/:loanId/setup` | Save the loan setup |
| `PUT /loans/:loanId/settings` | `{ categoryId }`: the loan's Actual category |
| `GET /loans/:loanId/months/:n/candidates?categoryId=&wide=1` | Transactions near payment *n*'s due date |
| `POST /loans/:loanId/months/:n/match` | `{ transactionId }` → paid, or flagged with suggestions |
| `POST /loans/:loanId/months/:n/resolve` | `{ resolution: rounding\|escrow\|pmi\|extraPrincipal, standing? }` |
| `POST /loans/:loanId/months/:n/unmatch` | Undo a match and the adjustments it created |
| `PUT /loans/:loanId/months/:n/offset` | `{ amount }`, manual penny offset (±100) |
| `POST /loans/:loanId/months/:n/skip` | `{ mode: catchUp\|capitalize\|defer }` |
| `POST /loans/:loanId/months/:n/unskip` | Undo a skip |
| `PUT /loans/:loanId/months/:n/catch-up` | `{ fromPayment, months }`: plan to pay back missed payment *n* |
| `DELETE /loans/:loanId/months/:n/catch-up` | Remove that plan |
| `PUT /loans/:loanId/pmi/removal` | `{ fromPayment }`: PMI stopped from this payment on (replaces an earlier record) |
| `DELETE /loans/:loanId/pmi/removal` | Remove that record |
| `POST /loans/:loanId/escrow/entries` | `{ date, kind, amount, note }`: an escrow bill or deposit |
| `DELETE /loans/:loanId/escrow/entries/:id` | Remove an escrow entry |
| `PUT /loans/:loanId/details` | `{ fields, custom }`: save loan details |
| `GET /assets` | Every asset with its values |
| `POST /assets` | `{ name, kind, originalValue, valueTrend?, trendRatePercent?, acquiredDate?, loanId? }` |
| `PATCH /assets/:assetId` | Change any of those fields |
| `DELETE /assets/:assetId` | Remove an asset and its values |
| `POST /assets/:assetId/values` | `{ date, value, source }`: add a value |
| `DELETE /assets/:assetId/values/:valueId` | Remove a value |
| `GET /backup` | Everything in the tracker as a backup file (JSON attachment) |
| `POST /restore?confirm=replace` | Body: a backup file. Replaces everything, after saving a copy of the database |
