# AB Asset Tracker

A **Loans** section for a stock [Actual Budget](https://actualbudget.org)
server. It follows each of your loans end to end (mortgages, car loans,
personal loans) and what they paid for: payment number, principal vs.
interest, payoff date, and equity, meaning what the home or vehicle is worth
minus what you still owe. Each month you match the payment that synced into
Actual, and the schedule stays in step with your lender.

It's an add-on. Actual itself is never modified, so updating Actual is the
same one command it always was. It is a community project, not affiliated
with or endorsed by the Actual Budget project.

![The Overview screen of a sample mortgage: payment number, balance, percent paid, equity, a balance chart and the PMI countdown, with the Loans list in the sidebar](docs/screenshots/overview.png)

> All numbers in this README, the screenshots, the tests, and the sample files are made up.

> **Installed this as "AB Mortgage Tracker" before?** See
> [Upgrading from the old name](#upgrading-from-the-old-name). Your data
> carries over as loan 1.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Quick start (Docker)](#2-quick-start-docker)
3. [How the Loans section gets into Actual](#3-how-the-loans-section-gets-into-actual)
4. [Configuration](#4-configuration)
5. [Adding a loan](#5-adding-a-loan)
6. [The monthly workflow](#6-the-monthly-workflow)
7. [Equity, assets and values](#7-equity-assets-and-values)
8. [Interest: monthly or daily](#8-interest-monthly-or-daily)
9. [PMI behavior (mortgages)](#9-pmi-behavior-mortgages)
10. [Upgrading](#10-upgrading)
11. [Troubleshooting](#11-troubleshooting)
12. [The read-only summary endpoint](#12-the-read-only-summary-endpoint)
13. [Compatibility](#13-compatibility)
14. [Development](#14-development)
15. [Project layout and API](#15-project-layout-and-api)

---

## 1. What it does

**Loans** sits in Actual's sidebar under the regular items, with each of
your loans listed beneath it the way Actual lists accounts: equity is the
headline number, and what you owe is underneath. Click a loan to open it.

<img src="docs/screenshots/sidebar.png" alt="The Loans list in Actual's sidebar: a mortgage, a car loan and a personal loan, each with equity and the amount owed" width="240" />

Every loan is one of three types. The type only decides which parts are
switched on; the math underneath is the same amortizing loan.

| Type | Optional parts | What equity is measured against | Its value screen |
|---|---|---|---|
| **Mortgage** | PMI, escrow (both on by default, each can be turned off) | The home | **Equity** |
| **Auto loan** | none | The vehicle, with an optional depreciation curve | **Vehicle** |
| **Personal loan** | none | Nothing by default; you can add an asset | **Totals** (or **Asset**) |

Each loan has these screens:

| Screen | What you see |
|---|---|
| **Overview** | Payment number (e.g. *4 of 360*), balance, percent paid, equity, a balance chart, and either the PMI countdown (mortgages with PMI) or a payoff card: payments left, payoff today, total interest and fees. |
| **Equity / Vehicle / Asset / Totals** | The asset's value, what you owe, equity and loan-to-value; how the equity was built; equity over time and milestones; the asset's value history; and a table of principal, interest, fees, PMI and escrow for this month, this quarter, the year, the loan so far and the life of the loan. A loan without an asset shows just the table and a button to add one. |
| **Escrow** | Mortgages with escrow only. Escrow from each payment, the tax and insurance bills paid from it, a running balance, totals by year, and whether a year of collections covers a year of bills. |
| **Reconcile** | One month at a time. Pick the loan's category, click the matching transaction, and the month is marked paid. If the amount is off, you're asked why. You can also mark a month as skipped here. |
| **Schedule** | Every payment: due date, principal, interest, extra principal, PMI, escrow and fees where the loan has them, total, balance, and status (*scheduled*, *flagged*, *paid*, *skipped*, or *before tracking*). Click any row to reconcile it. |
| **Details** | Reference details that fit the loan type: servicer, account number, lender, insurance, and for a mortgage the property, tax parcel and PMI certificate, or for a vehicle the VIN and plate. Plus notes and fields of your own. |
| **Setup** | The loan terms you enter once, with a live preview, plus rename, archive and delete. |

### Example: a mortgage

A $320,000 loan at 6.5% for 30 years on a $355,000 home, with $148 a month
of PMI and $412.50 of escrow. The payment is **$2,583.12**: $2,022.62 of
principal and interest, plus PMI and escrow. After four payments the balance
is $318,833.42. A September online estimate puts the home at $368,000, so
equity is **$49,167**. PMI is scheduled to come off in June 2034, 106 payments
from now.

**Reconcile.** Match the payment that synced into Actual. When it differs
from the schedule, pick what the difference is:

![Reconcile screen with a payment $250 over the schedule, offering extra principal, escrow changed, PMI changed and rounding as explanations](docs/screenshots/reconcile.png)

<details>
<summary><b>Equity</b>, <b>Escrow</b> and <b>Schedule</b> screens</summary>

![Equity screen: home value, what you owe, how the equity was built, equity milestones, and where your payments went](docs/screenshots/equity.png)

![Escrow screen: escrow balance, yearly cushion, balance chart, totals by year, and the ledger of payments and bills](docs/screenshots/escrow.png)

![Schedule screen listing payments with principal, interest, PMI, escrow, total, balance and status](docs/screenshots/schedule.png)

</details>

### Example: a car loan

A $30,000 loan at 6.9% for 60 months on a $36,000 hatchback, with $6,000
down and a $299 processing fee, using daily simple interest. After six
payments you owe $27,439.32. A September pricing guide values the car at
$32,500, so equity is **$5,061**. The car is set to lose an estimated 15% a
year, so the equity chart ahead follows that curve, and the screen shows
the projected value today ($32,112) next to the value you entered.

![Vehicle screen of a sample car loan: vehicle value with a projected estimate, what you owe, equity, loan-to-value, how equity was built, and the vehicle's value history](docs/screenshots/vehicle.png)

A personal loan with no asset gets a payoff card and a **Totals** screen
instead:

<details>
<summary>Personal loan overview</summary>

![Overview of a sample personal loan: payment 8 of 36, balance, percent paid, payoff today, and a payoff card with total interest and yearly fees](docs/screenshots/personal.png)

</details>

It follows Actual's light and dark theme and **privacy mode**: with privacy
mode on (the eye icon in Actual's top bar), every dollar amount on the loan
screens and in the sidebar list turns into Actual's privacy squiggle until
you hover over it.

<details>
<summary>Dark theme</summary>

![The Overview screen in Actual's dark theme](docs/screenshots/overview-dark.png)

</details>

Under the hood:

- **The schedule generates itself** from the setup and rolls forward month
  by month. Reconciled months are *locked*: their real amounts are frozen,
  and later months recalculate from them.
- **Money is exact.** Everything is stored in whole cents (Actual's own
  unit), so the schedule matches your statement to the penny.
- **Read-only toward Actual.** The tracker reads categories and
  transactions through the official [`@actual-app/api`](https://actualbudget.org/docs/api/)
  and stores its own data (loans and their setup, reconciliation status,
  adjustments, assets and their values, escrow entries, loan details) in a
  small SQLite file of its own. No code path in the tracker writes to your
  budget.

## 2. Quick start (Docker)

You need Docker with the Compose plugin (`docker compose version` should
print a version) and git. Pick the setup that matches you.

### A. You already run Actual (most people)

This puts the add-on *in front of* the Actual you already have. Your
existing Actual container isn't stopped, restarted, or reconfigured, and it
keeps working on its usual port.

```sh
git clone https://github.com/<owner>/<repo>.git ab-asset-tracker
cd ab-asset-tracker
cp .env.example .env
nano .env            # fill in the values below
mkdir -p data certs
docker compose -f compose.existing-actual.yml up -d --build
```

In `.env`, for an Actual on the same machine that publishes port 5006 over
HTTPS:

```ini
ACTUAL_SERVER_URL=https://actual:5006
ACTUAL_UPSTREAM=https://actual:5006
ACTUAL_PASSWORD=your-actual-server-password
ACTUAL_SYNC_ID=your-budget-sync-id
PROXY_PORT=5007
```

The compose file maps the name `actual` to your Docker host, so both
containers reach your server at `https://actual:5006`. If Actual uses plain
HTTP, write `http://` in both URLs instead. If its certificate is
self-signed, also set `ACTUAL_CA_CERT` (see [Configuration](#4-configuration)).

Then open **`https://<your-server>:5007`** (not 5006) and log in as usual.
**Loans** appears in the sidebar.

### B. Fresh install: Actual and the add-on together

```sh
git clone https://github.com/<owner>/<repo>.git ab-asset-tracker
cd ab-asset-tracker
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
password and budget, then put the password and Sync ID in `.env` and run
`docker compose up -d` again so the backend picks them up. Until then the
backend stops with a message naming the missing setting; Actual itself
works the whole time.

### Finding the Sync ID

In Actual: **Settings → Show advanced settings → Sync ID**. One Sync ID is
one budget file.

### The certificate warning

Browsers only let Actual run on HTTPS (or `localhost`). The proxy serves
HTTPS. If `certs/` has no certificate, the proxy creates a self-signed one
on first start, so your browser warns once. Accept it, or use a real
certificate as described in [Using a real certificate](#using-a-real-certificate).

## 3. How the Loans section gets into Actual

```
 browser ──HTTPS──▶  asset-tracker-proxy (nginx) ──▶  actual (stock image, untouched)
                         │
                         ├── /asset-tracker-addon/*  ─┐
                         └── /asset-tracker-api/*    ─┴─▶ asset-tracker-backend (Node) ──read-only──▶ Actual API
```

1. **The proxy passes everything through.** Every request you make goes to
   Actual as-is. The only change: on Actual's HTML pages it adds one line
   just before `</head>`:
   ```html
   <script src="/asset-tracker-addon/inject.js" defer></script>
   ```
   The script is served from the same address as Actual, which Actual's own
   security policy already allows. No Actual setting changes.
2. **The script finds the sidebar defensively.** It looks for Actual's
   sidebar links by their addresses (`/schedules`, then `/reports`, then
   `/budget`), copies one so the new item matches Actual's look and theme,
   and inserts **Loans** right after it, with the list of loans below. React
   redraws the sidebar often, so a watcher puts them back whenever they
   disappear.
3. **Clicking it opens the screens beside the sidebar,** inside Actual's
   window, in an isolated layer (a *shadow root*) so Actual's styles and the
   tracker's can't interfere with each other. Colors come from Actual's
   theme. The address gets `#loans` added (for example `/schedules#loans`):
   the browser's Back button closes the screens, Forward reopens them, and a
   reload or bookmark opens them again. Clicking any other sidebar item takes
   you back to Actual.
4. **It fails quietly.** If Actual's markup changes so much that no sidebar
   link can be found, the script adds nothing and logs one line to the
   browser console:
   `[asset-tracker] Could not find a sidebar link to attach to. Actual works normally; the Loans item is hidden.`
5. **Who can see the data?** The backend only answers requests that carry a
   valid Actual login. The script reads the session token Actual's web app
   already stores in your browser, and the backend checks it with your
   Actual server (`/account/validate`). If you can't log in to Actual, you
   can't see the loan data.

## 4. Configuration

All settings live in `.env` (copy it from `.env.example`, which documents
each one). `.env` is gitignored, so it never ends up in the repo. The
backend checks its settings at startup and stops with a message naming any
required setting that is missing or invalid.

| Setting | Required | Default | What it is |
|---|---|---|---|
| `ACTUAL_SERVER_URL` | **yes** | none | How the backend reaches Actual **from inside Docker**. |
| `ACTUAL_PASSWORD` | **yes** | none | Your Actual server password. |
| `ACTUAL_SYNC_ID` | **yes** | none | Which budget to read (see above). |
| `ACTUAL_UPSTREAM` | **yes** | none | Where the proxy sends normal Actual traffic. Usually the same as `ACTUAL_SERVER_URL`. |
| `ACTUAL_BUDGET_PASSWORD` | no | empty | Only if the budget uses end-to-end encryption. |
| `ACTUAL_CA_CERT` | no | empty | Path *inside the backend container* to Actual's certificate, if it's self-signed. `certs/` on the host is mounted at `/certs`, so copy the cert there and use e.g. `/certs/actual-ca.crt`. The certificate must list the host name in `ACTUAL_SERVER_URL` (e.g. `actual`). |
| `PROXY_PORT` | no | `5007` | Port to open in the browser for Actual *with* the Loans section. |
| `ACTUAL_CERT_DIR` | no | `./certs` | Host folder with the proxy's certificate and key (and the optional Actual CA cert). |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | no | `tls.crt` / `tls.key` | File names of the proxy's certificate and key inside `ACTUAL_CERT_DIR`. |
| `ACTUAL_DATA_DIR` | no | `./actual-data` | Bundled setup only: where Actual stores its data. |
| `ACTUAL_IMAGE` | no | `docker.io/actualbudget/actual-server:latest` | Bundled setup only: which Actual image to run. Pin a tag to update on your own schedule. |
| `BACKEND_PORT` | no | `3100` | Port the backend listens on inside the Docker network. |
| `SUMMARY_TOKEN` | no | empty (off) | Turns on the [read-only summary endpoint](#12-the-read-only-summary-endpoint). |
| `TZ` | no | `Etc/UTC` | Your timezone as a tz database name (e.g. `Europe/Berlin`), used to decide what "today" is. |

The tracker's own data lives in `./data`:

- `data/asset-tracker.sqlite`: loans, setup, reconciliation, assets.
  **Back this up.** (Installs from before the rename keep using
  `data/mortgage.sqlite`.)
- `data/*.sqlite.backup-v<N>-<time>`: a copy of the database made
  automatically before an upgrade changes its layout. Safe to delete once
  you're happy with the upgrade.
- `data/actual-cache/`: a local copy of the budget that `@actual-app/api`
  downloads. It's safe to delete; it's downloaded again on the next start.

### Using a real certificate

The self-signed certificate is fine on a home network, but every new browser
warns about it. To avoid that, give the proxy a certificate your browsers
already trust:

- **A public name** (for example from Let's Encrypt, via certbot or your
  router or NAS): copy the full chain and the private key into `certs/`,
  then set `TLS_CERT_FILE=fullchain.pem` and `TLS_KEY_FILE=privkey.pem` in
  `.env` (or name the files `tls.crt` and `tls.key`). The name you open in
  the browser must match the certificate.
- **A local name** (for example with [mkcert](https://github.com/FiloSottile/mkcert)
  or your own small CA): create a certificate for the host name you use, put
  it in `certs/` the same way, and install the CA on your devices.

Then run `docker compose restart asset-tracker-proxy` (after every renewal
too). The proxy never overwrites certificate files that are already there.

## 5. Adding a loan

Open **Loans** and click **+ Add loan** (with no loans yet, the welcome
screen starts there). Pick the type, then fill in only what that type needs:

![Adding a car loan: nickname, vehicle, price paid, value over time and yearly change, then the loan terms](docs/screenshots/add-loan.png)

Fields every loan has, from its paperwork:

| Field | Notes |
|---|---|
| Nickname | How it shows in the picker and the sidebar. |
| Original loan amount | The amount borrowed. |
| Interest rate | The note rate as an annual percent, e.g. `6.5`. Not the APR, which includes fees. |
| Term | Years for a mortgage; number of monthly payments for other loans. |
| Loan open date | Closing or contract date. Must be on or before the first payment. |
| First payment date | From the note or the first statement. |
| Payment due day | Day of the month. 29 to 31 move to the last day of short months. |
| Monthly payment (P&I) | Left blank, it's calculated with the standard formula. If your statement differs by a cent, type the statement's exact amount here. |
| Interest | Monthly (most mortgages) or daily simple interest (many car and personal loans). See [section 8](#8-interest-monthly-or-daily). |
| Standing extra principal | Added to every payment, 0 if none. |
| Already paying on this loan? | For a loan you've been paying for a while. See [below](#a-loan-thats-already-under-way). |

What the loan paid for (the **asset**):

| Field | Notes |
|---|---|
| Name | e.g. *Home*, *2024 hatchback*. |
| Purchase price | Equity starts from this until you enter a newer value. |
| Value over time | *Only the values I enter*, or a projected yearly drop or rise (an estimate, used only for the chart ahead). |

Mortgage only:

| Field | Notes |
|---|---|
| PMI on/off, monthly PMI, PMI start date | A blank start date means PMI starts with the first payment. |
| Original home value (for PMI) | Starts as the purchase price. Lenders usually use the **lower of the purchase price and the appraisal**, so check yours and change it under Setup if needed. It moves every PMI date. |
| When to drop PMI | See [section 9](#9-pmi-behavior-mortgages). |
| Escrow on/off, monthly escrow | Taxes and insurance collected with the payment. |

Optional, any loan (under **Fees and payoff quote**):

| Field | Notes |
|---|---|
| Down payment | Shown with how your equity was built. |
| One-off fees | Processing, origination, credit insurance and the like. Mark whether each was added to the loan. Counted in the cost of the loan. |
| Yearly fee | A percent of the original amount or of the remaining balance, charged with the first payment of each loan year (payments 1, 13, 25 and so on). Part of that month's payment. |
| Payoff quote | An amount from your lender and its good-through date. Used for *payoff today* instead of the estimate until it expires. |

The final payment absorbs the few cents of rounding left at the end of the
term, the way lenders do it, so it can differ slightly from the others.

Paid off or sold? **Archive** the loan under Setup to hide it from the
picker, the sidebar and the summary while keeping its history. **Delete**
removes it and everything recorded for it (you type its name to confirm).

### A loan that's already under way

If you've been paying on the loan for years before setting up the tracker,
you don't have to reconcile every month since it started. On the Setup
screen:

1. Enter the **original** terms from your loan documents, as above. Use
   today's monthly escrow, and today's PMI (0 if it's gone).
2. Tick **Already paying on this loan?** and enter, from a recent statement,
   the **due date of your last payment** and the **principal balance after
   it** (the unpaid principal, not the payoff amount).

![The "Already paying on this loan?" card: last payment due date, principal balance, and how much extra principal that implies](docs/screenshots/setup-underway.png)

Every payment up to that one is marked **Before tracking**. Those payments
count as made, with the original schedule's amounts, and have nothing to
reconcile. Reconcile starts with the next payment, and the payment number,
percent paid, equity and life-of-loan totals stay measured from the
original loan.

You don't need to know when you paid extra principal. Whatever the original
schedule doesn't explain is recorded as **extra before tracking** on the
last payment before tracking. The interest on payments before tracking comes
from the original schedule, so it's an estimate (a little high if you paid
extra back then). If your balance comes out *higher* than the original
schedule by more than a few dollars of rounding, check the rate, term and
payment; a loan modification or an adjustable rate can't be modeled this
way.

For a mortgage with escrow, the escrow ledger starts empty. Add your escrow
balance from the same statement as a **Deposit** on the Escrow screen.

## 6. The monthly workflow

Once a month, after your bank has synced the payment into Actual:

1. Open the loan and go to **Reconcile**. It opens the first unpaid month on
   its own.
2. The first time, **pick the category** this loan's payments are booked to
   in Actual (it's remembered per loan).
3. The screen lists transactions in that category within about three weeks
   of the due date, exact matches first. **Click the right one.**
4. **If the amount matches the schedule,** the month flips to **Paid**, its
   real amounts are locked, and you're done.
5. **If it differs,** the month is **Flagged** and you're asked what the
   difference is. Each answer changes the schedule differently:

   | Answer | What changes |
   |---|---|
   | **Rounding offset** | Up to $1.00. The cents go to this month's principal only. |
   | **Extra principal** | The extra goes to the balance this month. Tick *keep paying this every month* to make it a standing extra. Later interest and the payoff date recalculate. |
   | **Escrow changed** | Mortgages with escrow. New escrow amount from this month on, typically after your yearly escrow analysis. |
   | **PMI changed** | Mortgages with PMI. New PMI amount from this month on. If the servicer stopped charging PMI, this records it at $0. |

   The answer that fits best is highlighted, and answers that can't explain
   the difference are disabled. Afterwards the month is marked **Paid**.
6. Made a mistake? **Undo reconciliation** on a paid month (or **Unmatch**
   on a flagged one) removes the match *and* any schedule change it made.

**Penny offset.** Rarely, a lender's interest split differs by a cent
without the total changing. Each unreconciled month has a small *Penny
offset* field (under the transaction list) for that.

**Missed a month?** Months don't have to be reconciled in order. The
Schedule screen shows every month's status; click any row to reconcile it.

### Skipping a payment

If your lender approves skipping a payment (a hardship grace period, a
skip-a-payment offer, forbearance, or a deferral), open that month in
**Reconcile**, expand **Skipping this payment?**, and pick how your lender
handles it:

| Choice | What the schedule does |
|---|---|
| **Missed now, caught up later** | A grace period: you miss payments for a while and pay them back later. Nothing is forgiven. The whole missed payment (including PMI and escrow on a mortgage) becomes *past due*. No interest is added and the loan's length doesn't change. |
| **Interest is added to the balance** | Nothing is paid that month. The month's interest is added to what you owe, the same monthly payment continues, and the loan runs a little longer. Typical of skip-a-payment offers. |
| **Payment is deferred to payoff** | Nothing is paid that month. The missed principal and interest go into a separate, interest-free balance that's due in one lump sum at payoff (or when the asset is sold). Typical after forbearance. |

**Catching up.** For a *missed now, caught up later* month, set a
**catch-up plan** on the same screen: *starting with* a later payment,
*spread over* a number of payments (1 pays it all at once). Consecutive
missed months share one plan. Until you set a plan, the schedule holds the
past-due amount until the final payment. You can change or remove the plan
any time.

A skipped month has no bank transaction, so it counts as done once its due
date passes. Equity counts deferred and past-due amounts as still owed. A
yearly fee that falls on a skipped month moves to the next payment that is
made. **Undo skip** removes a skip. Lenders differ, so check the terms in
your approval letter.

## 7. Equity, assets and values

**Equity is the asset's value minus what you owe** (the balance plus any
deferred or past-due amounts). The value is the latest one you've entered
on the value screen (an appraisal, a tax assessment, a pricing guide, an
online estimate), or the purchase price until you enter one.

**Projected value.** An asset can also have a yearly trend: a drop for
vehicles (15% a year is offered as a starting point) or a rise for a home.
The projection is only an estimate. It draws the equity chart ahead and
shows a *projected today* figure next to your latest value; the headline
equity always uses the value you entered. Enter a fresh value from a pricing
guide now and then and the curve restarts from it.

**Vehicles** usually lose value faster than the loan is paid down at first,
so equity can start below zero ("underwater"). The first milestone for a
vehicle is *worth more than you owe*.

**Homes.** PMI dates always use the original home value from Setup, as
lenders do. If your latest value puts the loan-to-value at 80% or less while
PMI is still on, the screen points out that many conventional loans allow
removal based on a new appraisal. Your servicer sets the exact rules.

**Where your payments went.** The table on the value screen has two modes.
*Paid* counts reconciled payments by the date your bank paid them, the same
way a year-end lender statement (such as Form 1098) counts interest.
*Scheduled* counts every payment by its due date, paid or not. The *Life of
loan* column is always the full schedule, including payments still to come.

**Payoff today** (on loans without PMI, and in the summary) is your lender's
payoff quote while it's good, or else an estimate: what you owe plus simple
interest per day since the last payment settled. Ask your lender for an
exact quote before paying a loan off.

**Escrow** (mortgages). Escrow from each reconciled payment is added
automatically. The bills it pays never pass through your bank, so record
them from your servicer's statements or annual escrow analysis: property
tax, homeowners or flood insurance, HOA dues, other bills, surplus refunds
to you, and deposits (the initial escrow deposit at closing, or a shortage
payment). The *Yearly cushion* compares a year of escrow collections at
today's monthly amount with the bills paid in the last 12 months. A
negative cushion usually means the next escrow analysis will raise your
payment.

**Loan details.** The **Details** screen is a place for reference
information. It's stored only in the add-on's own database, is never sent
to Actual, and is never included in the summary endpoint. Account, policy,
VIN and certificate numbers stay masked until you click into them.

## 8. Interest: monthly or daily

Each loan uses one of two methods, chosen under Setup:

- **Monthly** (the default; how most mortgages are serviced): each month's
  interest is the balance times the yearly rate divided by 12, whatever the
  calendar.
- **Daily simple interest** (common for car and personal loans): each
  payment's interest is the balance times the yearly rate divided by 365,
  times the days since the previous payment (from the loan open date for
  the first). Once a payment is matched to a bank transaction, **the date
  your bank paid it is used**: paying a few days early means less interest
  and more principal that month, and the next month's interest runs from
  that date. Extra principal sent with a payment lowers the balance from the
  day of that payment. The scheduled last payment settles whatever is left,
  so it can differ from the others by more than a few cents.

Daily interest uses a 365-day year, including in leap years. A lender that
counts 366 days in a leap year, or 360-day years, will differ slightly;
reconcile the month with a penny offset, or follow your statement. Extra
principal paid on its own, between two payments, isn't modeled on its own
date; see [Known limitations](docs/KNOWN_LIMITATIONS.md).

## 9. PMI behavior (mortgages)

> **Important: confirm your own loan's terms.** The tracker assumes a
> **conventional** loan, where PMI follows the U.S. Homeowners Protection
> Act. FHA (MIP), VA, USDA, and lender-paid PMI follow different rules.
> Check your loan documents and your lender's **PMI disclosure**, and
> confirm which value your lender treats as the original home value.

For a conventional loan:

- **At 80% of the original home value** you may *ask* the servicer to
  cancel PMI. Extra principal gets you there sooner. Servicers usually also
  require a good payment history and may ask for proof the home hasn't lost
  value.
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
date or the midpoint. Your bank statement has the final word: if the
servicer stops (or keeps) charging PMI on a different month, reconcile that
month and answer **PMI changed**, and the schedule follows the bank from
then on. A mortgage without PMI (for example with 20% down) turns the PMI
part off under Setup.

## 10. Upgrading

### Upgrading Actual safely

Actual runs from its own unmodified image in its own container. Your
routine stays the same, and only Actual is touched.

**Setup A (your existing Actual):** nothing changes. Update Actual from its
own folder the way you always have, e.g.

```sh
cd ~/actual && docker compose pull && docker compose up -d
```

**Setup B (bundled):** from this folder:

```sh
docker compose pull actual && docker compose up -d actual
```

That pulls the newest stock Actual image (or the tag in `ACTUAL_IMAGE`) and
recreates only the `actual` container. The proxy and backend keep running.

Good habits:

- **Back up first.** Actual: *Settings → Export data*. Tracker: copy
  `data/asset-tracker.sqlite` (or `data/mortgage.sqlite` on an older install).
- After updating, reload the page once and check that **Loans** is still in
  the sidebar.
- See [Compatibility](#13-compatibility) for the versions this release was
  tested with. After a bigger Actual update, update the API package too (see
  [Troubleshooting](#11-troubleshooting)).

### Updating the add-on itself

```sh
git pull
docker compose -f compose.existing-actual.yml up -d --build   # setup A
docker compose up -d --build asset-tracker-backend asset-tracker-proxy  # setup B
```

When a new version changes the database layout, the backend first saves a
copy of the old database next to it (`*.backup-v<N>-<time>`) and logs where
it is.

### Upgrading from the old name

This project used to be the single-loan "AB Mortgage Tracker"
(`actual-mortgage-tracker`), with containers `mortgage-backend` and
`mortgage-proxy` and URLs under `/mortgage-api`. To move to this version
from the same folder:

```sh
git pull
docker compose -f compose.existing-actual.yml up -d --build --remove-orphans   # setup A
docker compose up -d --build --remove-orphans                                  # setup B
```

`--remove-orphans` stops the old-named containers so the new proxy can take
port 5007. Your `.env` keeps working as it is. Your existing mortgage
becomes loan 1 (nickname *Mortgage*, which you can change) with its home as
asset 1; every reconciled month, adjustment, home value estimate, escrow
entry and detail carries over unchanged. The database stays at
`data/mortgage.sqlite`, and a copy of it from before the upgrade is saved
next to it. Anything that called `/mortgage-api/v1/summary` needs the new
address and response shape (see [section 12](#12-the-read-only-summary-endpoint)).

## 11. Troubleshooting

Work down this list. None of these steps touch your budget.

**Loans is gone from the sidebar.**
1. Make sure you're on the proxy port (`:5007`), not Actual's own port.
2. Hard-reload the page (Ctrl+Shift+R / Cmd+Shift+R). Actual caches its page
   in a service worker, and the first load after an update can be the old
   copy.
3. Open the browser console (F12 → Console) and look for `[asset-tracker]`.
   - *"Could not find a sidebar link to attach to"*: Actual changed its
     sidebar markup. Actual itself is fine. The fix is in
     `src/inject/inject.tsx` (`ANCHOR_ROUTES` / `findSidebarLinks`). Please
     open an issue with your Actual version and that console line.
   - No `[asset-tracker]` lines at all: the script wasn't injected. Check
     that the proxy is running (`docker compose ps`) and that
     `https://<server>:5007/asset-tracker-addon/inject.js` loads.
4. Narrow windows and phones use Actual's mobile layout, which has no
   sidebar, so the section is hidden there by design.

**The screens open but say they can't read from Actual.**
- `docker compose logs asset-tracker-backend` shows the reason.
- *"Missing required setting(s)"*: fill in the named settings in `.env`.
- *"out-of-sync" / migration / version errors*: the new Actual is ahead of
  the API package. Set `@actual-app/api` in `package.json` to the version of
  your Actual server (shown at the bottom of Actual's login screen), then
  `npm install` (or `./scripts/npm.sh install`) and rebuild the backend.
- *"Authentication failed"*: check `ACTUAL_PASSWORD` and `ACTUAL_SERVER_URL`.
- *Certificate errors* (`self-signed certificate`, `unable to verify`): set
  `ACTUAL_CA_CERT` (see Configuration) and make sure the certificate lists
  the host name used in `ACTUAL_SERVER_URL`.
- Deleting `data/actual-cache/` forces a fresh download of the budget copy.
  Your loan data isn't affected.

**"Log in to Actual to see your loans."** Log out of Actual and back in
through the proxy port. The tracker uses the same login.

**Actual shows a 502 page through the proxy.** Actual is down or still
starting. Check `docker ps` and Actual's own logs. Going straight to
Actual's port tells you whether the problem is Actual or the proxy.

**Something looks wrong in the numbers.** Compare one month with your
statement on the Schedule screen. A one-cent split difference is what the
payment override and penny offset are for. Remember that reconciled months
are locked to what you matched, and that daily-interest loans use the date
your bank paid.

## 12. The read-only summary endpoint

For dashboards (a wall display, a home automation panel) there's one
read-only JSON endpoint. It's **off** until you set `SUMMARY_TOKEN` in
`.env` to a long random string (e.g. from `openssl rand -hex 24`). Send the
token in the `Authorization` header:

```sh
curl -k -H "Authorization: Bearer <SUMMARY_TOKEN>" "https://<server>:5007/asset-tracker-api/v1/summary"
curl -k -H "Authorization: Bearer <SUMMARY_TOKEN>" "https://<server>:5007/asset-tracker-api/v1/summary?loan=2"
```

Without `?loan`, you get every loan that is set up and not archived:

```json
{ "version": 2, "asOf": "2025-10-12", "loans": [ { "id": 1, "nickname": "Mortgage", "...": "..." } ] }
```

With `?loan=<id>`, you get that one loan. Example for the made-up car loan:

```json
{
  "version": 2,
  "id": 2,
  "nickname": "Hatchback",
  "type": "auto",
  "asOf": "2025-10-12",
  "paymentNumber": 6,
  "totalPayments": 60,
  "nextPayment": { "number": 7, "dueDate": "2025-10-10", "amount": 592.62, "daysUntil": -2 },
  "balance": 27439.32,
  "deferredBalance": 0,
  "pastDue": 0,
  "owed": 27439.32,
  "scheduledBalance": 27012.69,
  "percentPaid": 8.54,
  "asset": {
    "name": "Sample hatchback",
    "kind": "vehicle",
    "value": 32500,
    "valueAsOf": "2025-09-15",
    "valueSource": "Pricing guide",
    "valueEntered": true,
    "projectedValue": 32111.89
  },
  "equity": 5060.68,
  "equityPercent": 15.57,
  "payoff": { "amount": 27605.31, "source": "estimate", "asOf": "2025-10-12" },
  "payoffDate": "2030-03-10",
  "pmi": null
}
```

- Money is in dollars, dates are `YYYY-MM-DD`.
- `paymentNumber` is the last *reconciled* payment. `balance` is after that
  payment; `scheduledBalance` is what the schedule expects by today.
  `nextPayment.daysUntil` is negative when that payment's due date has
  passed and it isn't reconciled yet.
- `equity` is the asset's latest value minus `owed`. `asset` and `equity`
  are `null` for a loan without an asset. `pmi` is `null` unless the loan
  has PMI; for a mortgage it holds `active`, `monthly`, `dropDate`,
  `paymentsUntilDrop`, `daysUntilDrop`, `requestRemovalDate` and
  `automaticRemovalDate`.
- Loan details (servicer, account numbers, notes) are never included.
- The endpoint never changes anything, and its token can't be used for the
  rest of the API.
- The older `?token=<SUMMARY_TOKEN>` query form still works but is
  **deprecated** (query strings end up in logs and browser history): those
  responses carry a `Deprecation: true` header, and the backend logs a
  warning once.

## 13. Compatibility

| Component | Tested with |
|---|---|
| Actual server | `actualbudget/actual-server` **26.10.0** |
| `@actual-app/api` | **26.10.0** (pinned in `package.json`) |
| Node.js (backend image) | 22 (`node:22-bookworm-slim`) |
| nginx (proxy image) | 1.27 (`nginx:1.27-alpine`) |
| Browsers | Current Chrome, Firefox and Safari (desktop layout) |

Keep `@actual-app/api` on the same version as your Actual server. Small
Actual updates normally keep working; the sidebar integration depends on
Actual's page layout, so after a big Actual release check the
[troubleshooting](#11-troubleshooting) steps.

## 14. Development

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

**Preview the screens without Actual.** After `npm run build`, open
`dist/ui/preview.html` in a browser. It runs the real components against an
in-memory mock with three made-up loans (a mortgage, a car loan and a
personal loan) and a mock sidebar. Add `?theme=dark` for dark mode,
`?empty` for the first-run screen, `?privacy` for privacy mode, and
`?loan=2` to open a given loan.

**Tests use no real Actual server or data.** Backend tests run against an
in-memory database and a fake Actual source (`src/server/testing.ts`). The
migration tests load databases made by the last single-loan release
(`test/fixtures`) and check the migrated loan matches its numbers exactly.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes.

## 15. Project layout and API

```
src/engine/      Amortization, interest, fees, skips, PMI, reconciliation, equity, assets, escrow, period totals (pure, tested)
src/server/      Backend: config, read-only Actual adapter, SQLite store and migrations, services, HTTP API
src/ui/          Loan screens (React), sidebar list, API client, styles, preview
src/inject/      The one script the proxy injects into Actual's page
proxy/           nginx image: TLS, pass-through, one-line injection
test/fixtures/   Databases from the last single-loan release, for the migration tests
examples/        Made-up sample loans (cents)
scripts/         UI build, Docker-only npm wrapper
docs/            Screenshots, decisions, known limitations, publishing notes
docker-compose.yml           Bundled: stock Actual + add-on
compose.existing-actual.yml  Add-on in front of an Actual you already run
compose.addon.yml            The two add-on services (used by both)
```

### API (for the UI)

All under `/asset-tracker-api`, and all except `health` and `v1/summary`
need the `x-actual-token` header of a logged-in Actual session. Money is in
cents.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness + Actual connection status |
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
| `POST /loans/:loanId/escrow/entries` | `{ date, kind, amount, note }`: an escrow bill or deposit |
| `DELETE /loans/:loanId/escrow/entries/:id` | Remove an escrow entry |
| `PUT /loans/:loanId/details` | `{ fields, custom }`: save loan details |
| `GET /assets` | Every asset with its values |
| `POST /assets` | `{ name, kind, originalValue, valueTrend?, trendRatePercent?, acquiredDate?, loanId? }` |
| `PATCH /assets/:assetId` | Change any of those fields |
| `DELETE /assets/:assetId` | Remove an asset and its values |
| `POST /assets/:assetId/values` | `{ date, value, source }`: add a value |
| `DELETE /assets/:assetId/values/:valueId` | Remove a value |

## License

MIT. See [LICENSE](LICENSE). Not affiliated with or endorsed by the Actual
Budget project.
