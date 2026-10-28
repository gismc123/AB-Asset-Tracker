# Decisions

Defaults chosen while turning the single-loan mortgage tracker into AB Asset
Tracker, each with the reason in one line. Items marked **(you)** were
decided by the maintainer; the rest are defaults that can be revisited.

## Name and compatibility

- **Name AB Asset Tracker (you).** Slugs follow it: package `ab-asset-tracker`, URL prefixes `/asset-tracker-api` and `/asset-tracker-addon`, services `asset-tracker-backend` and `asset-tracker-proxy`, images `ab-asset-tracker-*:local`. Short prefixes keep URLs readable; "Actual" stays out of every name so nothing reads as an official Actual project.
- **Sidebar label "Loans".** Type-neutral and matches the list of loans shown beneath it.
- **No aliases for the old single-loan paths or the `/mortgage-*` prefixes (you).** There is one existing install and nothing else calls the old URLs, so aliases would only add code to remove later.
- **Git history left as is (you).** The only personal detail in history is commit author metadata, which is normal for a public repository.
- **Compose project name not pinned.** It keeps coming from the folder, so `--remove-orphans` finds and stops the old-named containers on upgrade.
- **Database file `asset-tracker.sqlite`, with `mortgage.sqlite` used in place when it exists.** Nothing has to be moved or copied, so an upgrade can't lose the file.
- **Internal CSS class prefix `.mt-` kept.** It lives inside a shadow root, so renaming it has no visible effect and would only churn every component.

## Configuration

- **`TZ` defaults to `Etc/UTC`.** Neutral for a public project; the previous example was one specific US zone. An invalid name stops the backend with a clear message.
- **`BACKEND_PORT`, `ACTUAL_IMAGE`, `TLS_CERT_FILE` and `TLS_KEY_FILE` are configurable.** They are host-facing or user-replaceable values; the proxy's in-container port 8443 and Docker's DNS address stay fixed because nothing outside the container sees them.
- **`TLS_CERT_FILE` / `TLS_KEY_FILE` are now passed to the proxy.** The old README documented them, but compose never forwarded them, so setting them did nothing.
- **A `SUMMARY_TOKEN` under 16 characters is a warning, not an error.** It still works, and a startup failure over token length would be surprising.

## Data model and migration

- **Migration 1 is the old single-loan schema.** New and old databases then take the same path through migration 2, so the upgrade code runs in every test.
- **Old tables are dropped after copying, inside one transaction, only if row counts match.** The new tables hold every row and a full backup is written first, so keeping duplicates would only invite confusion.
- **Backup with `VACUUM INTO` next to the database, named `<file>.backup-v<from>-<UTC time>`.** It is a consistent copy even with a WAL file beside it, and the name says which version it came from.
- **Loan 1 keeps the old ids and timestamps; its `created_at` is the old setup's save time.** Nothing downstream can tell the data moved.
- **Asset 1 is "Home", trend `manual`, bought on the loan's open date, valued at the old original home value.** That reproduces the old equity numbers exactly.
- **Setup, settings and details are separate one-row-per-loan tables.** Each per-loan record gets its own `loan_id` foreign key with `ON DELETE CASCADE`, as the brief asked.
- **A bank transaction can be matched once per loan (unique on `loan_id, transaction_id`).** Each loan has its own category, so overlap is unlikely, and a global rule would block a legitimate split payment.
- **At most one asset per loan; assets also store `trend_rate_percent` and `acquired_date`.** One asset keeps equity unambiguous; the two extra columns drive the projected value curve.

## Engine

- **Missing `modules` means PMI and escrow are on.** Every loan saved before modules existed is a mortgage.
- **New mortgages start with PMI and escrow on; auto and personal loans have both off and can't turn them on.** PMI and escrow are mortgage concepts.
- **Non-mortgage terms are entered in months; `termYears` is still stored as months / 12 rounded up.** Car and personal loans are quoted in months, and older readers of the setup still get a sensible year count.
- **The yearly fee rides with payments 1, 13, 25 and so on; it moves to the next payment made when it falls on a skipped month; reconciled months keep whatever they were locked with.** It follows the loan year, never disappears, and never rewrites history.
- **One-off fees and the down payment are informational.** They're counted in the cost of the loan and in how equity was built, but never change the balance (a financed fee is already in the amount borrowed).
- **Payoff today is the lender's quote while it's good, else what's owed plus a 365-day per diem since the last settled due date.** That is how payoff quotes are usually built; the screen labels it an estimate.
- **Daily simple interest is implemented as an option (365-day year).** It could be done exactly and tested: interest runs between payment dates, using the bank date of matched payments (paid or flagged), and the scheduled last payment settles the loan.
- **Interest method defaults to monthly for every type in the wizard.** It is the safer guess for a schedule; the field explains when to pick daily.
- **Headline equity uses the latest entered value, or the purchase price.** As the brief asked; the projection never changes today's number.
- **Projected values compound by the day from the latest value on or before the date (or the purchase price on the acquired date), with 365.25-day years, and with a projection every point of the equity chart uses the curve.** Smooth curves that restart whenever you enter a real value, with no jump at today (a jump showed up in the first real-Actual test, when past points used the entered value and future points the curve).
- **The wizard offers 15% a year as a vehicle's starting depreciation.** A common rule of thumb for the first years; it is editable and always labeled an estimate.
- **Milestones: homes keep 20/22/25/50/75/100% (the PMI lines); other assets get 0/25/50/75/100%.** "Worth more than you owe" is the milestone that matters for vehicles.
- **A mortgage with no asset row falls back to the home described by its setup, and saving a mortgage's setup records that home.** A mortgage always has a home, and this keeps equity working for loans created by API without an asset.

## API

- **Summary is version 2.** Its shape changed (a list of loans, an `asset` block, `owed`, `payoff`, `pmi: null` without PMI), so the version had to move.
- **The all-loans summary leaves out archived loans and loans not set up yet.** A dashboard should show only loans with numbers to show.
- **`?token=` still works, with `Deprecation: true` and `Warning` headers and one log line.** Deprecated as asked, without breaking an existing dashboard overnight.
- **Deleting a loan needs `?confirm=<nickname>` and also deletes its asset, unless `keepAsset=1`.** A stray request can't delete data, and an orphaned asset would have no screen to manage it.
- **Archived loans stay in `GET /loans`, sorted last, and are hidden from the picker, sidebar and summary.** Archiving hides without losing history.
- **Escrow entries are refused (409) on loans with escrow off, and reconcile only offers escrow or PMI answers when the loan has them.** Those answers can't be right for such a loan.
- **New loans have no category until you pick one (or pass `categoryId` when creating).** Guessing a category could match the wrong payments.

## UI

- **The chosen loan is remembered per browser in `localStorage`, and the page works without it.** It's a convenience, not data.
- **Personal loans have no asset by default, with an "Add an asset" button on their Totals screen.** Most personal loans don't buy anything with a resale value.
- **A new mortgage's original home value for PMI starts as the purchase price.** One number to type at first, editable under Setup when the lender used a lower appraisal.
- **`state.homeValues` is replaced by `state.asset.values`.** Values belong to the asset now, whatever its kind.

## Tests and docs

- **Migration golden files come from the last single-loan release, stored gzipped under `test/fixtures`.** They prove behavior to the cent and stay out of the Docker image.
- **Screenshots are generated from `dist/ui/preview.html` with Playwright at 1360 px wide.** Reproducible and always made-up data.
