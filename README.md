# Actual Mortgage Tracker

A **Mortgage** tab for a stock [Actual Budget](https://actualbudget.org) server.
It follows a home loan end to end: payment number, principal vs. interest,
percent paid, equity, PMI, and the dates PMI can come off. Each month you
match the payment that synced into Actual, and the schedule stays in step
with your bank.

It's an add-on. Actual itself is never modified, so updating Actual is the
same one command it always was.

> All numbers in this README, the tests, and the sample files are made up.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Quick start (Docker)](#2-quick-start-docker)
3. [How the Mortgage tab gets into Actual](#3-how-the-mortgage-tab-gets-into-actual)
4. [Configuration](#4-configuration)
5. [The monthly workflow](#5-the-monthly-workflow)
   (and [skipping a payment](#skipping-a-payment))
5a. [Equity, escrow and loan details](#5a-equity-escrow-and-loan-details)
6. [PMI behavior](#6-pmi-behavior)
7. [Upgrading Actual safely](#7-upgrading-actual-safely)
8. [Troubleshooting after an Actual update](#8-troubleshooting-after-an-actual-update)
9. [The read-only summary endpoint](#9-the-read-only-summary-endpoint)
10. [Development](#10-development)
11. [Project layout](#11-project-layout)

---

## 1. What it does

The Mortgage tab sits in Actual's sidebar, under the regular items. It has seven screens:

| Screen | What you see |
|---|---|
| **Overview** | Payment number (e.g. *4 of 360*), current balance, percent paid, equity, a balance-over-time chart with the 80% / 78% PMI lines, the PMI countdown, and where this month's payment goes. |
| **Equity** | Home value, what you owe, equity and loan-to-value. How the equity was built (down payment, principal paid, extra principal, home value change). Equity over time, the dates you reach 20%, 22%, 25%, 50%, 75% and 100% equity, and a table of principal, interest, PMI and escrow for this month, this quarter, the year to date, the loan to date, and the life of the loan. |
| **Escrow** | The escrow account: escrow from each payment, the tax and insurance bills the servicer pays from it, a running balance, totals by year, and whether a year of collections covers a year of bills. |
| **Reconcile** | One month at a time. Pick your mortgage category, click the matching transaction, and the month is marked paid. If the amount is off, you're asked why. You can also mark a month as skipped here. |
| **Schedule** | Every payment: due date, principal, interest, extra principal, PMI, escrow, total, balance, and status (*scheduled*, *flagged*, *paid*, or *skipped*). Click any row to reconcile it. |
| **Details** | Reference details: servicer, loan number, lender, insurance, tax parcel, PMI certificate, notes, and fields of your own. |
| **Setup** | The loan details you enter once, with a live preview of the payment and PMI dates. |

It follows Actual's light/dark theme and **privacy mode**: with privacy mode on
(the eye icon in Actual's top bar), every dollar amount on the Mortgage screens
turns into a squiggle until you hover over it, using Actual's own privacy
font, exactly like Actual's numbers.

Under the hood:

- **The schedule generates itself** from the setup and rolls forward month by
  month. Reconciled months are *locked*: their real amounts are frozen, and
  later months recalculate from them.
- **Money is exact.** Everything is stored in whole cents (Actual's own
  unit), so the schedule matches your statement to the penny.
- **Read-only toward Actual.** The tracker reads categories and
  transactions through the official [`@actual-app/api`](https://actualbudget.org/docs/api/)
  and stores its own data (loan setup, adjustments, month status, home value
  estimates, escrow entries, loan details) in a small SQLite file of its own. No code path in the tracker writes to your budget.

## 2. Quick start (Docker)

You need Docker with the Compose plugin (`docker compose version` should
print a version). Pick the setup that matches you.

### A. You already run Actual (most people)

This puts the add-on *in front of* the Actual you already have. Your existing
Actual container isn't stopped, restarted, or reconfigured, and it keeps
working on its usual port.

```sh
git clone <this repo> actual-mortgage-tracker
cd actual-mortgage-tracker
cp .env.example .env
nano .env            # fill in the values below
mkdir -p data certs
docker compose -f compose.existing-actual.yml up -d --build
```

In `.env`, for an Actual on the same machine that publishes port 5006 over HTTPS:

```ini
ACTUAL_SERVER_URL=https://actual:5006
ACTUAL_UPSTREAM=https://actual:5006
ACTUAL_PASSWORD=your-actual-server-password
ACTUAL_SYNC_ID=your-budget-sync-id
PROXY_PORT=5007
```

The compose file maps the name `actual` to your Docker host, so both
containers reach your server at `https://actual:5006`. If Actual uses plain
HTTP, write `http://` in both URLs instead.

Then open **`https://<your-server>:5007`** (not 5006) and log in as usual.
The Mortgage item appears in the sidebar.

### B. Fresh install: Actual and the add-on together

```sh
cp .env.example .env
nano .env
mkdir -p data certs actual-data
docker compose up -d --build
```

```ini
ACTUAL_SERVER_URL=http://actual:5006
ACTUAL_UPSTREAM=http://actual:5006
ACTUAL_PASSWORD=the-password-you-set-in-actual
ACTUAL_SYNC_ID=your-budget-sync-id
```

The first time, open `https://<your-server>:5007`, create your Actual
password and budget, put the password and Sync ID in `.env`, and run
`docker compose up -d` again so the backend picks them up.

### Finding the Sync ID

In Actual: **Settings → Show advanced settings → Sync ID**. It looks like
`1a2b3c4d-....`. One Sync ID is one budget file.

### The certificate warning

Browsers only let Actual run on HTTPS (or `localhost`). The proxy serves
HTTPS. If `certs/` doesn't contain `tls.crt` and `tls.key`, it creates a
self-signed pair on first start, so your browser will warn once. Accept it,
or put your own certificate in `certs/` as `tls.crt` + `tls.key` (or set
`TLS_CERT_FILE` / `TLS_KEY_FILE` on the proxy) and restart it.

## 3. How the Mortgage tab gets into Actual

```
 browser ──HTTPS──▶  mortgage-proxy (nginx) ──▶  actual (stock image, untouched)
                         │
                         ├── /mortgage-addon/*  ─┐
                         └── /mortgage-api/*    ─┴─▶ mortgage-backend (Node) ──read-only──▶ Actual API
```

1. **The proxy passes everything through.** Every request you make goes to
   Actual as-is. The only change: on Actual's HTML pages it adds one line just
   before `</head>`:
   ```html
   <script src="/mortgage-addon/inject.js" defer></script>
   ```
   The script is served from the same address as Actual, which Actual's own
   security policy already allows. No Actual setting changes.
2. **The script finds the sidebar defensively.** It looks for Actual's
   sidebar links by their addresses (`/schedules`, then `/reports`, then
   `/budget`), copies one so the new item matches Actual's look and theme,
   and inserts **Mortgage** right after it. React redraws the sidebar often,
   so a watcher puts the item back whenever it disappears.
3. **Clicking it opens the screens beside the sidebar,** inside Actual's
   window, in an isolated layer (a *shadow root*) so Actual's styles and the
   tracker's can't interfere with each other. Colors come from Actual's
   theme, so light and dark mode both work. Clicking any other sidebar item
   takes you back.

   Actual doesn't know about a Mortgage page, so the screens cover whatever
   page you were on. To behave like a real page anyway, the address gets
   `#mortgage` added (for example `/schedules#mortgage`): the browser's Back
   button closes Mortgage, Forward reopens it, and a reload or bookmark opens
   it again. While it's open, the sidebar highlights Mortgage instead of the
   page underneath.
4. **It fails quietly.** If Actual's markup changes so much that no sidebar
   link can be found, the script adds nothing and logs one line to the
   browser console:
   `[mortgage-tab] Could not find a sidebar link to attach to. Actual works normally; the Mortgage tab is hidden.`
   Actual itself keeps working exactly as before.
5. **Who can see the data?** The backend only answers requests that carry a
   valid Actual login. The script reads the session token Actual's web app
   already stores in your browser, and the backend checks it with your
   Actual server (`/account/validate`). If you can't log in to Actual, you
   can't see the mortgage data.

The screens are ordinary React components (`src/ui/components`) that only
talk to the backend through a small client interface, so they could move into
Actual itself later without the proxy.

## 4. Configuration

All settings live in `.env` (copy it from `.env.example`). `.env` is
gitignored, so it never ends up in the repo.

| Setting | Required | What it is |
|---|---|---|
| `ACTUAL_SERVER_URL` | **yes** | How the backend reaches Actual **from inside Docker**. There's no default, so the backend won't start without it. |
| `ACTUAL_PASSWORD` | **yes** | Your Actual server password. |
| `ACTUAL_SYNC_ID` | **yes** | Which budget to read (see above). |
| `ACTUAL_BUDGET_PASSWORD` | no | Only if the budget uses end-to-end encryption. |
| `ACTUAL_CA_CERT` | no | Path *inside the backend container* to Actual's certificate, if it's self-signed. `certs/` on the host is mounted at `/certs`, so copy the cert there and use e.g. `/certs/actual-ca.crt`. The certificate must list the host name in `ACTUAL_SERVER_URL` (e.g. `actual`). |
| `ACTUAL_UPSTREAM` | **yes** | Where the proxy sends normal Actual traffic. Usually the same as `ACTUAL_SERVER_URL`. |
| `PROXY_PORT` | no | Port to open in the browser for Actual *with* the tab. Default `5007`. |
| `ACTUAL_CERT_DIR` | no | Host folder with the proxy's `tls.crt`/`tls.key` (and the optional Actual CA cert). Default `./certs`. |
| `ACTUAL_DATA_DIR` | no | Bundled setup only: where Actual stores its data. Default `./actual-data`. |
| `SUMMARY_TOKEN` | no | Turns on the [read-only summary endpoint](#9-the-read-only-summary-endpoint). Empty = off. |
| `TZ` | no | Your timezone, used to decide what "today" is. Example: `America/Chicago`. |

The tracker's own data lives in `./data`:

- `data/mortgage.sqlite`: loan setup, adjustments, and month status. **Back this up.**
- `data/actual-cache/`: a local copy of the budget that `@actual-app/api`
  downloads. It's safe to delete; it's downloaded again on the next start.

### Loan setup fields

Entered once on the **Setup** screen, from your closing documents:

| Field | Notes |
|---|---|
| Original loan amount | The amount borrowed. |
| Interest rate | Annual percent, e.g. `6.5`. |
| Term | In years. |
| Loan open (closing) date | Informational. Must be on or before the first payment. |
| First payment date | From the note / first statement. |
| Payment due day | Day of the month. 29–31 move to the last day of short months. |
| Principal & interest payment | Left blank, it's calculated with the standard formula. If your statement differs by a cent, type the statement's exact amount here. |
| Original home value | Used for the PMI test. Lenders usually use the **lower of the purchase price and the appraisal**. Check yours. |
| Monthly PMI / PMI start date | 0 if you have no PMI. A blank start date means PMI starts with the first payment. |
| Monthly escrow | Taxes and insurance collected with the payment. |
| Standing extra principal | Added to every payment, 0 if none. |

The final payment absorbs the few cents of rounding left over at the end of
the term, the way lenders do it, so it can differ slightly from the others.

## 5. The monthly workflow

Once a month, after your bank has synced the payment into Actual:

1. Open **Mortgage → Reconcile**. It opens the first unpaid month on its own.
2. The first time, **pick your mortgage category** (it's remembered).
3. The tab lists transactions in that category within about three weeks of
   the due date, exact matches first. **Click the right one.**
4. **If the amount matches the schedule,** the month flips to **Paid**, its
   real amounts are locked, and you're done.
5. **If it differs,** the month is **Flagged** and you're asked what the
   difference is. Each answer changes the schedule differently:

   | Answer | What changes |
   |---|---|
   | **Rounding offset** | Up to $1.00. The cents go to this month's principal only. |
   | **Escrow changed** | New escrow amount from this month on, typically after your yearly escrow analysis. |
   | **PMI changed** | New PMI amount from this month on. If the servicer stopped charging PMI, this records it at $0. |
   | **Extra principal** | The extra goes to the balance this month. Tick *keep paying this every month* to make it a standing extra. Later interest, the payoff date, and the PMI dates all recalculate. |

   The answer that fits best is highlighted, and answers that can't explain
   the difference are disabled. Afterwards the month is marked **Paid**.
6. Made a mistake? **Undo reconciliation** on a paid month (or **Unmatch** on
   a flagged one) removes the match *and* any schedule change it made.

**Penny offset.** Rarely, a bank's interest split differs by a cent without the
total changing. Each unreconciled month has a small *Penny offset* field
(under the transaction list) for that. You'll almost never need it.

**Missed a month?** Months don't have to be reconciled in order. The Schedule
screen shows every month's status; click any row to reconcile it.

### Skipping a payment

If your servicer approves skipping a payment (a hardship grace period, a
skip-a-payment offer, forbearance, or a deferral), open that month in
**Reconcile**, expand **Skipping this payment?**, and pick how your servicer
handles it:

| Choice | What the schedule does |
|---|---|
| **Missed now, caught up later** | A grace period, e.g. after a job loss: you may miss payments for a while (often up to 60 days) and pay them back later. Nothing is forgiven. The whole missed payment, including PMI and escrow, becomes *past due*. No interest is added and the loan's length doesn't change. |
| **Interest is added to the balance** | Nothing is paid that month. The month's interest is added to what you owe, the same monthly payment continues, and the loan runs a little longer. Typical of skip-a-payment offers. |
| **Payment is deferred to payoff** | Nothing is paid that month. The missed principal and interest go into a separate, interest-free balance that's due in one lump sum when the loan is paid off (or the home is sold). Typical after forbearance. |

**Catching up.** For a *missed now, caught up later* month, set a **catch-up
plan** on the same screen: *starting with* a later payment, *spread over* a
number of payments (1 pays it all at once). Consecutive missed months share
one plan. Those months then expect the larger amount when you reconcile them,
the catch-up is split back into principal, interest, PMI and escrow (so the
escrow ledger and the yearly totals stay right), and the Overview shows
what's still past due. Until you set a plan, the schedule holds the past-due
amount until the final payment. You can change or remove the plan any time.
Ask your servicer how long the grace period lasts, and get it in writing that
there are no late fees or credit reporting.

With the other two choices, no PMI or escrow is collected for the skipped
month. A skipped month has no bank transaction, so it counts as done once its
due date passes. Equity counts deferred and past-due amounts as still owed.
**Undo skip** removes a skip (and a catch-up plan with nothing left to repay).
Servicers differ, so check the terms in your approval letter.

## 5a. Equity, escrow and loan details

**Home value.** Equity starts out measured against the original home value
from Setup. Add estimates on the **Equity** screen (an appraisal, the tax
assessment, an online estimate) and the newest one is used for equity and
loan-to-value. PMI dates always use the original value, as lenders do. If your
estimate puts the loan-to-value at 80% or less while PMI is still on, the
screen points out that many conventional loans allow removal based on a new
appraisal. Your servicer sets the exact rules.

**Where your payments went.** The table on the Equity screen has two modes.
*Paid* counts reconciled payments by the date your bank paid them, the same
way your servicer's year-end Form 1098 counts interest. *Scheduled* counts
every payment by its due date, paid or not. The *Life of loan* column is
always the full schedule, including payments still to come.

**Escrow.** Escrow from each reconciled payment is added automatically. The
bills it pays never pass through your bank, so record them from your
servicer's statements or annual escrow analysis: property tax, homeowners or
flood insurance, HOA dues, other bills, surplus refunds to you, and deposits
(the initial escrow deposit at closing, or a shortage payment). Start with
the initial deposit from your closing disclosure. The *Yearly cushion* compares
a year of escrow collections at today's monthly amount with the bills paid
in the last 12 months. A negative cushion usually means the next escrow
analysis will raise your payment.

**Loan details.** The **Details** screen is a place for reference
information: servicer, loan number, contact details, insurance policy, tax
parcel, PMI certificate, notes. It's stored only in the add-on's own
database, is never sent to Actual, and is never included in the dashboard
summary. Account, policy and certificate numbers stay masked until you click
into them.

## 6. PMI behavior

> **Important: confirm your own loan's terms.** The tracker assumes a
> **conventional** loan, where PMI follows the U.S. Homeowners Protection
> Act. FHA (MIP), VA, USDA, and lender-paid PMI follow different rules.
> Check your loan documents and your lender's **PMI disclosure**, and
> confirm which value your lender treats as the original home value.

For a conventional loan:

- **At 80% of the original home value** you may *ask* the servicer to cancel
  PMI. Extra principal gets you there sooner. Servicers usually also require
  a good payment history and may ask for proof the home hasn't lost value.
- **At 78% of the original home value, based on the *original* schedule,**
  PMI must end *automatically*, as long as you're current on payments.
  Because it follows the original schedule, extra payments don't move this
  date (though they may get you to 80% well before it).
- **At the midpoint of the loan term** (e.g. after payment 180 of 360) PMI
  must end regardless.

The PMI countdown shows all three dates, the payment numbers, and how many
payments sooner extra principal gets you to 80%.

**When does the schedule drop PMI?** You choose on the Setup screen:

| Setting | Schedule removes PMI after… |
|---|---|
| **Automatic at 78% (recommended)** | the payment where the original schedule reaches 78%. The conservative choice. |
| Automatic at 78% of my real balance | your real balance (with extras) reaches 78%. Use only if your servicer confirms they do this. |
| I will request removal at 80% | your real balance reaches 80%. Pick this once you plan to send the request. |

Whatever you pick, PMI never stays on the schedule past the 78% automatic
date or the midpoint. Once it drops, it's removed from the monthly total.
Your bank statement has the final word: if the servicer stops (or keeps)
charging PMI on a different month, reconcile that month and answer **PMI
changed**, and the schedule follows the bank from then on.

The **original home value** is an editable input. Lenders usually use the
lower of the purchase price and the appraisal, and that one number moves
every PMI date.

## 7. Upgrading Actual safely

Actual runs from its own unmodified image in its own container. Your monthly
routine stays the same, and only Actual is touched.

**Setup A (your existing Actual):** nothing changes. Update Actual from its own
folder the way you always have, e.g.

```sh
cd ~/actual && docker compose pull && docker compose up -d
```

**Setup B (bundled):** from this folder:

```sh
docker compose pull actual && docker compose up -d actual
```

That pulls the newest stock Actual image and recreates only the `actual`
container. The proxy and backend keep running, and the proxy finds the new
container on its own.

Good habits:

- **Back up first.** Actual: *Settings → Export data*. Tracker: copy `data/mortgage.sqlite`.
- After updating, reload the page once and check that the Mortgage item is
  still in the sidebar.
- The backend uses `@actual-app/api` **26.10.0**, matching the Actual server
  it was tested with. Small Actual updates normally keep working. After a
  bigger one, update the API version too (see below).

### Updating the add-on itself

```sh
git pull
docker compose -f compose.existing-actual.yml up -d --build   # setup A
docker compose up -d --build mortgage-backend mortgage-proxy  # setup B
```

## 8. Troubleshooting after an Actual update

Work down this list. None of these steps touch your budget.

**The Mortgage item is gone from the sidebar.**
1. Make sure you're on the proxy port (`:5007`), not Actual's own port.
2. Hard-reload the page (Ctrl+Shift+R / Cmd+Shift+R). Actual caches its page
   in a service worker, and the first load after an update can be the old copy.
3. Open the browser console (F12 → Console) and look for `[mortgage-tab]`.
   - *"Could not find a sidebar link to attach to"*: Actual changed its
     sidebar markup. Actual itself is fine. The fix is in
     `src/inject/inject.tsx` (`ANCHOR_ROUTES` / `findTemplateLink`). Please
     open an issue with your Actual version.
   - No `[mortgage-tab]` lines at all: the script wasn't injected. Check that
     the proxy is running (`docker compose ps`) and that
     `https://<server>:5007/mortgage-addon/inject.js` loads.
4. Narrow windows and phones use Actual's mobile layout, which has no sidebar,
   so the tab is hidden there by design.

**The tab opens but says it can't read from Actual.**
- `docker compose logs mortgage-backend` shows the reason.
- *"out-of-sync" / migration / version errors*: the new Actual is ahead of the
  API package. Set `@actual-app/api` in `package.json` to the version of your
  Actual server (shown at the bottom of Actual's login screen), then
  `npm install` (or `./scripts/npm.sh install`) and rebuild the backend.
- *"Authentication failed"*: check `ACTUAL_PASSWORD` and `ACTUAL_SERVER_URL` in `.env`.
- *Certificate errors* (`self-signed certificate`,
  `unable to verify`): set `ACTUAL_CA_CERT` (see Configuration) and make sure
  the certificate lists the host name used in `ACTUAL_SERVER_URL`.
- Deleting `data/actual-cache/` forces a fresh download of the budget copy.
  Your mortgage data in `mortgage.sqlite` isn't affected.

**"Log in to Actual to use the Mortgage tab."** Log out of Actual and back in
through the proxy port. The tab uses the same login.

**Actual shows a 502 page through the proxy.** Actual is down or still
starting. Check `docker ps` and Actual's own logs. Going straight to
Actual's port tells you whether the problem is Actual or the proxy.

**Something looks wrong in the numbers.** Compare one month with your
statement on the Schedule screen. A one-cent split difference is what the
P&I override and penny offset are for. Remember that reconciled months are
locked to what you matched.

## 9. The read-only summary endpoint

For dashboards (for example a future MagicMirror module) there's one
read-only JSON endpoint. It's **off** until you set `SUMMARY_TOKEN` in `.env`
to a long random string (e.g. from `openssl rand -hex 24`).

```sh
curl -k "https://<server>:5007/mortgage-api/v1/summary?token=<SUMMARY_TOKEN>"
# or: -H "Authorization: Bearer <SUMMARY_TOKEN>"
```

Example response (made-up numbers):

```json
{
  "version": 1,
  "asOf": "2025-07-20",
  "paymentNumber": 4,
  "totalPayments": 360,
  "nextPayment": { "number": 5, "dueDate": "2025-08-01", "amount": 2583.12, "daysUntil": 12 },
  "balance": 318833.42,
  "deferredBalance": 0,
  "pastDue": 0,
  "scheduledBalance": 318833.42,
  "percentPaid": 0.36,
  "equity": 36166.58,
  "equityPercent": 10.19,
  "homeValue": { "value": 368000, "asOf": "2025-06-01" },
  "marketEquity": 49166.58,
  "marketEquityPercent": 13.36,
  "payoffDate": "2055-03-01",
  "pmi": {
    "active": true,
    "monthly": 148,
    "dropDate": "2034-06-01",
    "paymentsUntilDrop": 106,
    "daysUntilDrop": 3238,
    "requestRemovalDate": "2033-03-01",
    "automaticRemovalDate": "2034-05-01"
  }
}
```

- Money is in dollars, dates are `YYYY-MM-DD`.
- `paymentNumber` is the last *reconciled* payment. `balance` is after that
  payment; `scheduledBalance` is what the schedule expects by today.
- `equity` is original home value minus what's owed (balance plus any
  deferred or past-due payments). `homeValue`, `marketEquity` and `marketEquityPercent`
  use your latest home value estimate and are `null` until you add one.
- Loan details (servicer, account numbers, notes) are never included.
- The endpoint never changes anything, and its token can't be used for the
  rest of the API.

## 10. Development

The math lives in `src/engine`, has no dependencies, and is fully unit
tested. All money is integer cents.

```sh
npm install && npm test        # with Node 22+
npm run typecheck
npm run build                  # dist/server (backend) + dist/ui (inject.js, preview)
```

No Node on the machine (e.g. a Raspberry Pi with only Docker)? Use the wrapper,
which runs the same commands in the official Node image:

```sh
./scripts/npm.sh install
./scripts/npm.sh test
./scripts/npm.sh run build
```

**Preview the screens without Actual.** After `npm run build`, open
`dist/ui/preview.html` in a browser. It runs the real components against an
in-memory mock with sample data (`?theme=dark` for dark mode, `?empty` for
first-run setup, `?privacy` for privacy mode).

**Tests use no real Actual server or data.** Backend tests run against an
in-memory database and a fake Actual source (`src/server/testing.ts`).

## 11. Project layout

```
src/engine/      Amortization, skips, PMI milestones, reconciliation, equity, escrow, period totals (pure, tested)
src/server/      Backend: config, read-only Actual adapter, SQLite store, service, HTTP API
src/ui/          Mortgage screens (React) + API client + styles
src/inject/      The one script the proxy injects into Actual's page
proxy/           nginx image: TLS, pass-through, one-line injection
examples/        Made-up sample loan (cents)
scripts/         UI build, Docker-only npm wrapper
docker-compose.yml           Bundled: stock Actual + add-on
compose.existing-actual.yml  Add-on in front of an Actual you already run
compose.addon.yml            The two add-on services (used by both)
```

### API (for the UI)

All under `/mortgage-api`, and all except `health` and `v1/summary` need the
`x-actual-token` header of a logged-in Actual session.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness + Actual connection status |
| `GET /state` | Setup, schedule with statuses, PMI info, summary |
| `PUT /loan` | Save loan setup (cents) |
| `PUT /settings` | `{ categoryId }`, the mortgage category |
| `GET /categories` | Actual's category groups |
| `GET /months/:n/candidates?categoryId=&wide=1` | Transactions near payment *n*'s due date |
| `POST /months/:n/match` | `{ transactionId }` → paid, or flagged with suggestions |
| `POST /months/:n/resolve` | `{ resolution: rounding\|escrow\|pmi\|extraPrincipal, standing? }` |
| `POST /months/:n/unmatch` | Undo a match and the adjustments it created |
| `PUT /months/:n/offset` | `{ amount }`, manual penny offset in cents (±100) |
| `POST /months/:n/skip` | `{ mode: catchUp\|capitalize\|defer }`, mark payment *n* as skipped |
| `POST /months/:n/unskip` | Undo a skip |
| `PUT /months/:n/catch-up` | `{ fromPayment, months }`, plan to pay back missed payment *n* |
| `DELETE /months/:n/catch-up` | Remove that plan |
| `POST /home-values` | `{ date, value, source }`, add a home value estimate (cents) |
| `DELETE /home-values/:id` | Remove an estimate |
| `POST /escrow/entries` | `{ date, kind, amount, note }`, record an escrow bill or deposit (cents) |
| `DELETE /escrow/entries/:id` | Remove an escrow entry |
| `PUT /details` | `{ fields, custom }`, save loan details |
| `GET /v1/summary` | Read-only dashboard summary (own token) |

## License

MIT. See [LICENSE](LICENSE). Not affiliated with or endorsed by the Actual Budget project.
