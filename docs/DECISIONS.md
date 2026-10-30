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
- **`COMPOSE_FILE` in `.env` picks the setup, defaulting to setup A.** Every command becomes plain `docker compose ...`; without it, a setup A user who forgot `-f` started setup B by accident (a stray Actual container and a port clash on 5007, seen on the first real upgrade).
- **The add-on services use `pull_policy: build`.** Compose no longer tries to pull images that only exist locally (the "pull access denied" warnings), and `docker compose up -d` after `git pull` rebuilds what changed.
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

## Backup and restore

- **One JSON file with every row of every tracker table, ids and timestamps included.** Restoring gives back exactly what was there, and loan ids stay the same, so a dashboard using `?loan=<id>` keeps working on a new install.
- **The file records its schema version; a restore loads it into a scratch database at that version, then runs the normal migrations.** A backup made today still restores after a later update changes the layout, with no separate converter to maintain.
- **Restore replaces everything rather than merging.** Merging would have to settle clashing ids and duplicate matches; replacing is predictable and matches what "restore" means.
- **The whole backup is checked (columns, constraints, references, JSON columns) before the live database is touched, and a `VACUUM INTO` copy named `<file>.backup-before-restore-<UTC time>` is written first.** A bad file changes nothing, and a good one can still be undone.
- **The restore request needs `confirm=replace` and a logged-in session, and only it accepts a body up to 50 MB, parsed after the login check.** Every other request keeps the 100 KB limit.
- **A command-line `backup-cli.js` in the backend image.** Scheduled backups can't log in to Actual, so `docker compose exec` is the way in for cron.
- **Actual's budget and `.env` are left out.** Actual has its own export, and `.env` holds passwords that shouldn't travel in a file people email to themselves.

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

- **A fourth PMI rule, `untilRemoved`, has no planned drop and no federal backstops; PMI ends only where a PMI change of zero is recorded.** Real servicers keep charging past 78% and the midpoint (the borrower wasn't current, they're slow, or the loan isn't covered by the HPA), and FHA MIP can last the life of the loan. The three original rules keep their backstops unchanged.
- **A recorded PMI removal is a PMI adjustment of 0 with no source month, at most one per loan, and it can't start on or before a reconciled month.** It reuses the adjustment the reconcile flow already writes, so the schedule logic needs no new case, and a reconciled month keeps the PMI it really paid.

## API

- **Summary is version 2.** Its shape changed (a list of loans, an `asset` block, `owed`, `payoff`, `pmi: null` without PMI), so the version had to move.
- **The all-loans summary leaves out archived loans and loans not set up yet.** A dashboard should show only loans with numbers to show.
- **`?token=` still works, with `Deprecation: true` and `Warning` headers and one log line.** Deprecated as asked, without breaking an existing dashboard overnight.
- **Deleting a loan needs `?confirm=<nickname>` and also deletes its asset, unless `keepAsset=1`.** A stray request can't delete data, and an orphaned asset would have no screen to manage it.
- **Archived loans stay in `GET /loans`, sorted last, and are hidden from the picker, sidebar and summary.** Archiving hides without losing history.
- **Escrow entries are refused (409) on loans with escrow off, and reconcile only offers escrow or PMI answers when the loan has them.** Those answers can't be right for such a loan.
- **New loans have no category until you pick one (or pass `categoryId` when creating).** Guessing a category could match the wrong payments.
- **`GET /health` says only whether Actual is connected.** It needs no login, and Actual's error text and sync times are for logged-in users (they're in the loan state).
- **A failed re-sync with Actual is a 503, like a failed first load, and is retried on the next request.** It happens on every Actual update or restart and shouldn't look like a tracker bug.
- **An asset value can be 0.** A totaled car or a written-off asset is worth nothing; the original value already allowed 0.
- **Removing a catch-up plan is refused (409) for a month that isn't a missed payment to catch up.** Otherwise it removed whichever plan came next, which may belong to another skip.

## UI

- **The chosen loan is remembered per browser in `localStorage`, and the page works without it.** It's a convenience, not data.
- **Personal loans have no asset by default, with an "Add an asset" button on their Totals screen.** Most personal loans don't buy anything with a resale value.
- **A new mortgage's original home value for PMI starts as the purchase price.** One number to type at first, editable under Setup when the lender used a lower appraisal.
- **`state.homeValues` is replaced by `state.asset.values`.** Values belong to the asset now, whatever its kind.

## Proxy

- **`PROXY_TLS=off` serves plain HTTP for a Cloudflare Tunnel or reverse proxy that handles HTTPS, and is off unless asked for.** The default stays HTTPS, because Actual needs a secure page and most installs open the port directly. With it off, no certificate is generated, and `X-Forwarded-Proto` comes from what's in front (or the connection itself).
- **Every `proxy_set_header` is at the server level.** A location with any of its own inherits none, so until now `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto` never reached Actual, and a client's own `X-Forwarded-Proto` passed straight through.
- **Listening on one address goes through `PROXY_PORT` (`127.0.0.1:5007`)** rather than a new setting. Compose already accepts it, and the default keeps listening on IPv4 and IPv6.
- **The proxy gzips responses itself.** It asks Actual for uncompressed pages so it can add the script tag, so without this Actual's large JavaScript went out uncompressed.

## Tests and docs

- **Migration golden files come from the last single-loan release, stored gzipped under `test/fixtures`.** They prove behavior to the cent and stay out of the Docker image.
- **Screenshots are generated from `dist/ui/preview.html` with Playwright at 1360 px wide.** Reproducible and always made-up data.

## v0.2.0

Defaults chosen while adding the v0.2.0 features. None of them changes the
numbers of a loan saved by v0.1.0; each new option is off until chosen.

### Loan types

- **Student loans are their own type, `student`, with no asset, PMI or escrow, like a personal loan.** A type of its own lets the picker, the sidebar icon and the summary endpoint say what the loan is. Dashboards may now see `type: "student"`; no existing value changed.
- **Migration 3 rebuilds the `loans` table to widen its type check, keeping every id and the AUTOINCREMENT counter.** SQLite can't change a CHECK in place; keeping the counter means a deleted loan's id is never handed to a new loan, so a dashboard's `?loan=<id>` can't silently point somewhere else.
- **A new student loan defaults to 120 monthly payments and monthly interest.** Ten years is the common standard plan; monthly interest stays the default for every type (the field's hint says many student loans use daily interest).

### Asset value from an Actual account

- **The link is per asset (`assets.actual_account_id`, migration 4) and empty for every existing asset.** Nothing changes until someone picks an account.
- **The balance is summed from the account's transactions up to today, with the same `getTransactions` read the reconcile screen uses.** Actual's own `getAccountBalance` runs inside its change-tracking wrapper; summing plain reads keeps every call to Actual a read. Future-dated transactions are left out, as Actual's own balance does.
- **The account's balance becomes the newest value, dated the day it was read; the values entered in the tracker stay as the fallback.** Equity, the chart, the projection and the summary endpoint all work from "the newest value" already, so nothing else had to learn about accounts, and unlinking loses nothing.
- **A negative balance is never used as a value; the entered values are used, with a note.** An asset account in Actual has a positive balance; a negative one means a debt account was picked by mistake.
- **When Actual can't be read, a balance read earlier is kept and flagged; with none, the entered values are used.** A dashboard or the Loans screen keeps working while Actual restarts, and says why the number may be old.
- **Balances are read only for linked accounts, at most every 30 seconds, and only on the loan list, loan state and summary requests.** A tracker with no links never asks Actual for a balance, so existing installs see no new traffic.
- **The summary endpoint's `valueSource` says `Actual account`, without the account's name.** The name is the user's own label and the endpoint never carried account details.

### Extra payments of their own

- **Extra payments live in their own table (`extra_payments`, migration 5), not in `months`.** A month keeps exactly one regular match, as before, and any number of extras sit beside it. Nothing about how v0.1.0 data is stored changes.
- **An extra is placed by its own date, not by the month it was added from.** On a monthly-interest loan it comes off after the last payment due on or before its date, so the next payment's interest is lower (how monthly-accrual servicers apply a curtailment). On a daily-interest loan it lands inside the interest period that contains its date, and interest is split at that day. The Reconcile screen says when an extra lands with another month.
- **Extras are part of `principal` but not of `total`.** `total` is what the regular transaction should be, so matching it is unchanged; principal, the balance, totals and every date after it include the extra.
- **A reconciled month's lock holds the regular payment only, and extras are applied on top.** Adding or removing an extra never changes a reconciled month, and undo removes exactly one extra.
- **An extra dated in a month that isn't reconciled yet still lowers today's balance, equity and payoff.** The money has left; waiting for the next reconciliation would understate equity.
- **A skipped month takes no extras; they carry to the next payment made.** Keeps the skip rules simple. On a daily loan the carried extra counts from the start of that next period (see KNOWN_LIMITATIONS).
- **Extras dated on or before the last payment made before tracking are ignored, and the service refuses them.** The statement balance used as the starting point already includes them.
- **An extra that would overpay the loan is refused.** The schedule caps extras at the balance; refusing at entry keeps the stored amount equal to what was applied.
- **Extras can come from Actual (any unused payment in the loan's category near the month) or be entered by hand.** An extra paid from another account or category still counts. A bank transaction can be used once, as a regular match or as one extra.

### Payoff date and what-if

- **Real extra principal already moved the payoff date in v0.1.0; v0.2.0 adds tests that pin it, for extras inside the regular payment and for extras of their own, along with the PMI request date.** Nothing to fix.
- **What-if runs on the server against the saved schedule, with every recorded payment, extra, skip and lock, and writes nothing.** The answer starts from where the loan really is, and a test checks the database is unchanged after it.
- **The monthly extra applies from the next payment not yet matched or skipped; the lump sum is a hypothetical extra payment on its own date.** It uses the same engine code as a real standing extra and a real extra payment, so tests prove "try it" and "make it real" give the same payoff to the cent.
- **The headline is the payoff date and how much sooner, then what's owed and equity on chosen dates; interest is shown smaller.** As asked: interest stays available but isn't the headline.
- **Comparison dates default to 1, 5 and 10 years from today, and can be changed.** Short, medium and long horizons without typing.
- **"Make this my standing extra" records a standing-extra change from the next unpaid payment, on top of any standing extra already in place, and can be removed from the same screen.** It uses the adjustment the reconcile flow already writes, so nothing new is stored; reconciled months keep what they paid. The lump sum is never saved: when it's really paid, it's recorded as an extra payment.
- **Equity on a future date uses the asset's projected curve when it has one, otherwise its value today.** The same value on both plans, so the difference is only what's owed.
