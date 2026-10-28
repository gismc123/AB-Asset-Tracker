# AB Asset Tracker

> If this project is useful to you, you can help fund its development on
> [Patreon](https://patreon.com/IvanS1123). Thank you!

A **Loans** section for a self-hosted [Actual Budget](https://actualbudget.org)
server. It follows each of your loans (mortgages, car loans, personal loans)
and what they paid for: payment number, principal vs. interest, payoff date,
and equity, meaning what the home or vehicle is worth minus what you still
owe. Each month you match the payment that synced into Actual, and the
schedule stays in step with your lender.

It's an add-on that sits in front of Actual. Actual itself is never modified
and the tracker never writes to your budget. It is a community project, not
affiliated with or endorsed by the Actual Budget project.

![The Overview screen of a sample mortgage: payment number, balance, percent paid, equity, a balance chart and the PMI countdown, with the Loans list in the sidebar](docs/screenshots/overview.png)

> All numbers in this README, the screenshots, the tests, and the sample files are made up.

---

## Contents

- [Install](#install)
- [Update](#update)
- [Uninstall](#uninstall)
- [What it does](#what-it-does)
- [Using it](#using-it)
- [Configuration reference](#configuration-reference)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Read-only summary endpoint](#read-only-summary-endpoint)
- [How it works](#how-it-works)
- [Compatibility](#compatibility)
- [Development](#development)

---

## Install

About 10 minutes. You only do this once.

### Before you start

You need:

- [ ] A Linux, macOS or Windows machine (a Raspberry Pi works) with **Docker**
      and the **Compose plugin**. Check with `docker compose version`.
- [ ] **git**. Check with `git --version`.
- [ ] Your **Actual server password**, the one on Actual's login screen.
- [ ] Your budget's **Sync ID**: in Actual, *Settings → Show advanced
      settings → Sync ID*. (On a fresh install you get it in step 6.)

Then pick your setup:

| | Setup | Pick it if |
|---|---|---|
| **A** | **Existing Actual** | You already run Actual on this machine, for example from its own Docker container on port 5006. Most people. Your Actual container isn't touched. |
| **B** | **Fresh install** | You don't run Actual yet. This starts Actual and the add-on together. |

### Step 1: Download

```sh
git clone https://github.com/gismc123/AB-Asset-Tracker.git ab-asset-tracker
cd ab-asset-tracker
```

### Step 2: Create your settings file

```sh
cp .env.example .env
mkdir -p data certs
```

### Step 3: Fill in `.env`

Open `.env` in any editor (for example `nano .env`) and set these lines.
Leave everything else as it is.

**Setup A (existing Actual)**, for an Actual on the same machine on port 5006:

```ini
COMPOSE_FILE=compose.existing-actual.yml
ACTUAL_SERVER_URL=https://actual:5006
ACTUAL_UPSTREAM=https://actual:5006
ACTUAL_PASSWORD=your-actual-server-password
ACTUAL_SYNC_ID=your-budget-sync-id
TZ=Europe/Berlin
```

- Write `http://` instead of `https://` in both URLs if your Actual uses
  plain HTTP.
- Keep the host name `actual`: it means "this machine" inside the
  containers. If Actual runs on another machine, use its address instead
  (for example `https://192.0.2.10:5006`).
- If Actual uses a self-signed certificate, see
  [Actual's certificate is self-signed](#actual-uses-a-self-signed-certificate).

**Setup B (fresh install):**

```ini
COMPOSE_FILE=docker-compose.yml
ACTUAL_SERVER_URL=http://actual:5006
ACTUAL_UPSTREAM=http://actual:5006
TZ=Europe/Berlin
```

Leave `ACTUAL_PASSWORD` and `ACTUAL_SYNC_ID` empty for now; you fill them in
at step 6. Also create the folder for Actual's data: `mkdir -p actual-data`.

`TZ` is your timezone as a [tz database name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
(it decides what "today" is). `COMPOSE_FILE` tells Docker Compose which
setup you chose, so every command from here on is plain `docker compose`.

### Step 4: Start it

```sh
docker compose up -d
```

The first start builds two small images, which takes a few minutes (longer
on a Raspberry Pi). Later starts take seconds.

### Step 5: Open it

Open **`https://<this-machine>:5007`** in your browser. That's port **5007**,
the add-on's port, not Actual's 5006.

Your browser warns about the certificate the first time, because the add-on
made its own. Accept it to continue, or
[use a real certificate](#use-a-real-certificate).

Log in to Actual as usual. **Loans** appears in the sidebar.

### Step 6 (setup B only): Create your budget, then connect the tracker

1. In the page from step 5, set your Actual password and create (or import)
   your budget, as on any new Actual server.
2. Copy the Sync ID (*Settings → Show advanced settings → Sync ID*).
3. Put the password and Sync ID in `.env`:
   ```ini
   ACTUAL_PASSWORD=the-password-you-just-set
   ACTUAL_SYNC_ID=the-sync-id-you-copied
   ```
4. Run `docker compose up -d` again.

### Step 7: Check it worked

```sh
docker compose ps
docker compose logs asset-tracker-backend | grep asset-tracker
```

`docker compose ps` should show `asset-tracker-backend` as *healthy* and
`asset-tracker-proxy` as *running*. The log should end with
`[asset-tracker] connected to Actual and loaded the budget`.

If it doesn't, the log line above it says what's wrong; see
[Troubleshooting](#troubleshooting).

### Step 8: Add your first loan

Click **Loans** in Actual's sidebar. The welcome screen asks what kind of
loan to add, then shows only the fields that kind needs.

![The first-run welcome screen: a short explanation, then a choice of mortgage, auto loan or personal loan](docs/screenshots/first-run.png)

 Have your loan paperwork or a recent statement at hand. See [Adding a loan](#adding-a-loan)
for what each field means.

---

## Update

From the `ab-asset-tracker` folder:

```sh
git pull
docker compose up -d --remove-orphans
```

That rebuilds whatever changed and restarts only the add-on (and, for setup
B, Actual if its image changed). When an update changes the database layout,
the tracker first saves a copy of the old database next to it, named
`*.backup-v<N>-<time>`, and logs where it is.

**Updating Actual:** setup A, update Actual the way you always have; the
add-on doesn't need anything. Setup B: `docker compose pull actual && docker compose up -d actual`.

### Upgrading from "AB Mortgage Tracker"

This project used to be the single-loan *AB Mortgage Tracker*. If you ran
that version:

1. Add the `COMPOSE_FILE` line for your setup to `.env` (step 3 above):
   `COMPOSE_FILE=compose.existing-actual.yml` if you ran it in front of your
   own Actual, or `COMPOSE_FILE=docker-compose.yml` for the bundled setup.
2. Run the update:
   ```sh
   git pull
   docker compose up -d --remove-orphans
   ```
   `--remove-orphans` stops the old `mortgage-backend` and `mortgage-proxy`
   containers so the new proxy can take port 5007.

Your mortgage becomes loan 1 (nickname *Mortgage*, which you can change)
with every reconciled month, adjustment, home value, escrow entry and detail.
The database stays at `data/mortgage.sqlite`, with a copy from before the
upgrade saved next to it. The old URLs under `/mortgage-api` are gone (see
the [summary endpoint](#read-only-summary-endpoint) for the new address).

Want the folder to match the new name too? Stop, move, start:

```sh
docker compose down
cd .. && mv <old-folder-name> ab-asset-tracker && cd ab-asset-tracker
docker compose up -d
```

---

## Uninstall

From the `ab-asset-tracker` folder:

```sh
docker compose down --rmi local
```

That removes the add-on's containers and images. Your Actual server and
budget aren't affected (for setup B, Actual's own container stops too, and
its data stays in `actual-data/`). Keep `data/` if you might come back;
otherwise delete the folder.

If you used setup A, keep using Actual on its own port (5006) as before.

---

## What it does

**Loans** sits in Actual's sidebar under the regular items, with each loan
listed beneath it the way Actual lists accounts: equity is the headline
number, and what you owe is underneath. Click a loan to open it.

<img src="docs/screenshots/sidebar.png" alt="The Loans list in Actual's sidebar: a mortgage, a car loan and a personal loan, each with equity and the amount owed" width="240" />
<img src="docs/screenshots/sidebar-dark.png" alt="The same Loans list in the dark theme" width="240" />

Every loan is one of three types. The type only decides which parts are
switched on; the math underneath is the same amortizing loan.

| Type | Optional parts | Equity is measured against | Its value screen |
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
equity is **$49,167**. PMI is scheduled to come off in June 2034, 106
payments from now.

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
year, so the equity chart follows that curve, and the screen shows the
projected value today ($32,112) next to the value you entered.

![Vehicle screen of a sample car loan: vehicle value with a projected estimate, what you owe, equity, loan-to-value, how equity was built, and the vehicle's value history](docs/screenshots/vehicle.png)

A personal loan with no asset gets a payoff card and a **Totals** screen
instead:

<details>
<summary>Personal loan overview</summary>

![Overview of a sample personal loan: payment 8 of 36, balance, percent paid, payoff today, and a payoff card with total interest and yearly fees](docs/screenshots/personal.png)

![The Totals screen of a personal loan: principal, interest and yearly fees by month, quarter, year, loan to date and life of loan, with a button to add an asset](docs/screenshots/totals-personal.png)

</details>

It follows Actual's light and dark theme and **privacy mode**: with privacy
mode on (the eye icon in Actual's top bar), every dollar amount on the loan
screens and in the sidebar list turns into Actual's privacy squiggle until
you hover over it.

<details>
<summary>Privacy mode</summary>

![The Overview screen with privacy mode on: every dollar amount, on the screen and in the sidebar list, is hidden](docs/screenshots/privacy.png)

</details>

<details>
<summary>Dark theme</summary>

![The mortgage Overview screen in Actual's dark theme](docs/screenshots/overview-dark.png)

![The car loan's Vehicle screen in the dark theme](docs/screenshots/vehicle-dark.png)

![The Escrow screen in the dark theme](docs/screenshots/escrow-dark.png)

</details>

Under the hood:

- **The schedule generates itself** from the setup and rolls forward month
  by month. Reconciled months are *locked*: their real amounts are frozen,
  and later months recalculate from them.
- **Money is exact.** Everything is stored in whole cents (Actual's own
  unit), so the schedule matches your statement to the penny.
- **Read-only toward Actual.** The tracker reads categories and
  transactions through the official [`@actual-app/api`](https://actualbudget.org/docs/api/)
  and keeps its own data in a small SQLite file in `data/`. No code path in
  the tracker writes to your budget.

---

## Using it

### Adding a loan

Open **Loans** and click **+ Add loan** (with no loans yet, the welcome
screen starts there). Pick the type:

![The Add a loan screen: cards for mortgage, auto loan and personal loan](docs/screenshots/add-loan-type.png)

Then fill in only what that type needs:

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
| Interest | Monthly (most mortgages) or daily simple interest (many car and personal loans). See [Interest: monthly or daily](#interest-monthly-or-daily). |
| Standing extra principal | Added to every payment, 0 if none. |
| Already paying on this loan? | For a loan you've been paying for a while. See [below](#a-loan-thats-already-under-way). |

What the loan paid for (the **asset**):

| Field | Notes |
|---|---|
| Name | e.g. *Home*, *2024 hatchback*. |
| Purchase price | Equity starts from this until you enter a newer value. |
| Value over time | *Only the values I enter*, or a projected yearly drop or rise (an estimate, used for the chart). |

Mortgage only:

| Field | Notes |
|---|---|
| PMI on/off, monthly PMI, PMI start date | A blank start date means PMI starts with the first payment. |
| Original home value (for PMI) | Starts as the purchase price. Lenders usually use the **lower of the purchase price and the appraisal**, so check yours and change it under Setup if needed. It moves every PMI date. |
| When to drop PMI | See [PMI](#pmi-mortgages). |
| Escrow on/off, monthly escrow | Taxes and insurance collected with the payment. |

<details>
<summary>The Setup screen of a mortgage</summary>

![A mortgage's Setup screen: loan terms, the already-paying card, PMI with the removal rule, escrow, and extras](docs/screenshots/setup-mortgage.png)

</details>

Optional, any loan (under **Fees and payoff quote**):

| Field | Notes |
|---|---|
| Down payment | Shown with how your equity was built. |
| One-off fees | Processing, origination, credit insurance and the like. Mark whether each was added to the loan. Counted in the cost of the loan. |
| Yearly fee | A percent of the original amount or of the remaining balance, charged with the first payment of each loan year (payments 1, 13, 25 and so on). Part of that month's payment. |
| Payoff quote | An amount from your lender and its good-through date. Used for *payoff today* instead of the estimate until it expires. |

![The Extras, fees and payoff card: standing extra principal, down payment, one-off fees, a yearly fee of 0.5% of the balance, and a payoff quote](docs/screenshots/setup-fees.png)

A yearly fee shows up in its own column on the Schedule:

<details>
<summary>Schedule with a yearly fee</summary>

![A personal loan's schedule with a Fee column: $60.00 with payment 1 and $42.24 with payment 13](docs/screenshots/schedule-personal.png)

</details>

The final payment absorbs the few cents of rounding left at the end of the
term, the way lenders do it, so it can differ slightly from the others.

Paid off or sold? **Archive** the loan under Setup to hide it from the
picker, the sidebar and the summary while keeping its history. **Delete**
removes it and everything recorded for it (you type its name to confirm).

![The "This loan" card under Setup: nickname with Rename, Archive, and Delete this loan](docs/screenshots/loan-settings.png)

#### A loan that's already under way

If you've been paying on the loan for years, you don't have to reconcile
every month since it started. On the Setup screen:

1. Enter the **original** terms from your loan documents, as above. Use
   today's monthly escrow, and today's PMI (0 if it's gone).
2. Tick **Already paying on this loan?** and enter, from a recent statement,
   the **due date of your last payment** and the **principal balance after
   it** (the unpaid principal, not the payoff amount).

![The "Already paying on this loan?" card: last payment due date, principal balance, and how much extra principal that implies](docs/screenshots/setup-underway.png)

Every payment up to that one is marked **Before tracking**: it counts as
made, with the original schedule's amounts, and has nothing to reconcile.
Reconcile starts with the next payment, and the payment number, percent
paid, equity and life-of-loan totals stay measured from the original loan.

You don't need to know when you paid extra principal. Whatever the original
schedule doesn't explain is recorded as **extra before tracking**. The
interest on payments before tracking comes from the original schedule, so
it's an estimate (a little high if you paid extra back then). If your
balance comes out *higher* than the original schedule by more than a few
dollars, check the rate, term and payment; a loan modification or an
adjustable rate can't be modeled this way.

For a mortgage with escrow, the escrow ledger starts empty. Add your escrow
balance from the same statement as a **Deposit** on the Escrow screen.

### The monthly routine

Once a month, after your bank has synced the payment into Actual:

1. Open the loan and go to **Reconcile**. It opens the first unpaid month.
2. The first time, **pick the category** this loan's payments are booked to
   in Actual (it's remembered per loan).
3. The screen lists transactions in that category within about three weeks
   of the due date, exact matches first. **Click the right one.**

   ![Reconcile, before matching: the loan's category, one bank transaction of $2,833.12 shown as $250 over the schedule, and the scheduled breakdown](docs/screenshots/reconcile-match.png)

4. **If the amount matches the schedule,** the month flips to **Paid**, its
   real amounts are locked, and you're done.
5. **If it differs,** the month is **Flagged** and you're asked what the
   difference is:

   | Answer | What changes |
   |---|---|
   | **Rounding offset** | Up to $1.00. The cents go to this month's principal only. |
   | **Extra principal** | The extra goes to the balance this month. Tick *keep paying this every month* to make it a standing extra. Later interest and the payoff date recalculate. |
   | **Escrow changed** | Mortgages with escrow. New escrow amount from this month on, typically after your yearly escrow analysis. |
   | **PMI changed** | Mortgages with PMI. New PMI amount from this month on. If the servicer stopped charging PMI, this records it at $0. |

   ![Reconcile, after matching: the month is flagged $250 over, with extra principal suggested](docs/screenshots/reconcile.png)

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

![The Skipping this payment? panel: missed now and caught up later, interest added to the balance, or deferred to payoff](docs/screenshots/reconcile-skip.png)

| Choice | What the schedule does |
|---|---|
| **Missed now, caught up later** | You miss payments for a while and pay them back later. Nothing is forgiven. The whole missed payment (including PMI and escrow on a mortgage) becomes *past due*. No interest is added and the loan's length doesn't change. |
| **Interest is added to the balance** | Nothing is paid that month. The month's interest is added to what you owe, the same monthly payment continues, and the loan runs a little longer. Typical of skip-a-payment offers. |
| **Payment is deferred to payoff** | Nothing is paid that month. The missed principal and interest go into a separate, interest-free balance due in one lump sum at payoff (or when the asset is sold). Typical after forbearance. |

**Catching up.** For a *missed now, caught up later* month, set a
**catch-up plan** on the same screen: *starting with* a later payment,
*spread over* a number of payments (1 pays it all at once). Consecutive
missed months share one plan. Until you set one, the past-due amount is held
until the final payment. You can change or remove the plan any time.

A skipped month has no bank transaction, so it counts as done once its due
date passes. Equity counts deferred and past-due amounts as still owed. A
yearly fee that falls on a skipped month moves to the next payment made.
**Undo skip** removes a skip. Lenders differ, so check your approval letter.

### Equity, assets and values

**Equity is the asset's value minus what you owe** (the balance plus any
deferred or past-due amounts). The value is the latest one you've entered on
the value screen (an appraisal, a tax assessment, a pricing guide, an online
estimate), or the purchase price until you enter one.

**Projected value.** An asset can also have a yearly trend: a drop for
vehicles (15% a year is offered as a starting point) or a rise for a home.
The projection is only an estimate. It shapes the equity chart (starting
from the values you entered) and shows a *projected today* figure next to
your latest value; the headline equity always uses the value you entered.
Set it on the value screen, where you can also rename the asset and change
what it cost:

![The About the vehicle card: name, kind, original value, date bought, and a projected yearly drop of 15%](docs/screenshots/asset-editor.png)

**Vehicles** usually lose value faster than the loan is paid down at first,
so equity can start below zero. The first milestone for a vehicle is *worth
more than you owe*.

**Where your payments went.** The table on the value screen has two modes.
*Paid* counts reconciled payments by the date your bank paid them, the same
way a year-end lender statement (such as Form 1098) counts interest.
*Scheduled* counts every payment by its due date. The *Life of loan* column
always includes the payments still to come.

**Payoff today** (on loans without PMI, and in the summary) is your lender's
payoff quote while it's good, or else an estimate: what you owe plus simple
interest per day since the last payment. Ask your lender for an exact quote
before paying a loan off.

**Escrow** (mortgages). Escrow from each reconciled payment is added
automatically. The bills it pays never pass through your bank, so record
them from your servicer's statements: property tax, homeowners or flood
insurance, HOA dues, other bills, surplus refunds, and deposits (the initial
escrow deposit at closing, or a shortage payment). The *Yearly cushion*
compares a year of collections at today's monthly amount with the bills paid
in the last 12 months; a negative cushion usually means your payment will go
up at the next escrow analysis.

**Loan details.** The **Details** screen is for reference information. It's
stored only in the add-on's database, never sent to Actual, and never
included in the summary endpoint. Account, policy, VIN and certificate
numbers stay masked until you click into them. The fields follow the loan
type:

<details>
<summary>Details for a mortgage and for a car loan</summary>

![A mortgage's Details screen: servicer, loan, insurance and taxes, PMI, and notes](docs/screenshots/details-mortgage.png)

![A car loan's Details screen: lender, vehicle (VIN, plate), insurance, and notes](docs/screenshots/details-vehicle.png)

</details>

### Interest: monthly or daily

Each loan uses one of two methods, chosen under Setup:

- **Monthly** (the default; how most mortgages are serviced): each month's
  interest is the balance times the yearly rate divided by 12.
- **Daily simple interest** (common for car and personal loans): each
  payment's interest is the balance times the yearly rate divided by 365,
  times the days since the previous payment (from the loan open date for the
  first). Once a payment is matched to a bank transaction, **the date your
  bank paid it is used**: paying a few days early means less interest and
  more principal that month. Extra principal sent with a payment lowers the
  balance from that day. The scheduled last payment settles whatever is
  left, so it can differ from the others.

Daily interest uses a 365-day year, including in leap years. See
[Known limitations](docs/KNOWN_LIMITATIONS.md) for lenders that count days
differently.

### PMI (mortgages)

> **Confirm your own loan's terms.** The tracker assumes a **conventional**
> U.S. loan, where PMI follows the Homeowners Protection Act. FHA (MIP), VA,
> USDA, and lender-paid PMI follow different rules.

- **At 80% of the original home value** you may *ask* the servicer to cancel
  PMI. Extra principal gets you there sooner.
- **At 78% of the original home value, on the *original* schedule,** PMI
  must end *automatically*, as long as you're current. Extra payments don't
  move this date.
- **At the midpoint of the term** (e.g. payment 180 of 360) PMI must end
  regardless.

The PMI countdown shows all three dates and how many payments sooner extra
principal gets you to 80%. Under Setup you choose when the schedule drops
PMI:

| Setting | Schedule removes PMI after… |
|---|---|
| **Automatic at 78% (recommended)** | the payment where the original schedule reaches 78%. |
| Automatic at 78% of my real balance | your real balance (with extras) reaches 78%. Only if your servicer confirms they do this. |
| I will request removal at 80% | your real balance reaches 80%. Pick this once you plan to send the request. |

Whatever you pick, PMI never stays on the schedule past the 78% automatic
date or the midpoint. If the servicer stops (or keeps) charging PMI on a
different month, reconcile that month and answer **PMI changed**. No PMI at
all? Turn it off under Setup.

---

## Configuration reference

All settings live in `.env`; `.env.example` documents each one. `.env` is
gitignored, so it never ends up in the repo. The backend checks its
settings at startup and stops with a message naming anything missing or
invalid. After changing `.env`, run `docker compose up -d`.

| Setting | Required | Default | What it is |
|---|---|---|---|
| `COMPOSE_FILE` | **yes** | `compose.existing-actual.yml` | Which setup: `compose.existing-actual.yml` (A) or `docker-compose.yml` (B). |
| `ACTUAL_SERVER_URL` | **yes** | none | How the backend reaches Actual **from inside Docker**. |
| `ACTUAL_UPSTREAM` | **yes** | none | Where the proxy sends normal Actual traffic. Almost always the same as `ACTUAL_SERVER_URL`. |
| `ACTUAL_PASSWORD` | **yes** | none | Your Actual server password. |
| `ACTUAL_SYNC_ID` | **yes** | none | Which budget to read. |
| `ACTUAL_BUDGET_PASSWORD` | no | empty | Only if the budget uses end-to-end encryption. |
| `ACTUAL_CA_CERT` | no | empty | Path *inside the backend container* to Actual's certificate, if it's self-signed. See [below](#actual-uses-a-self-signed-certificate). |
| `PROXY_PORT` | no | `5007` | The port you open in the browser. |
| `ACTUAL_CERT_DIR` | no | `./certs` | Host folder with the proxy's certificate and key (and Actual's CA cert, if any). |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | no | `tls.crt` / `tls.key` | File names of the proxy's certificate and key inside `ACTUAL_CERT_DIR`. |
| `ACTUAL_DATA_DIR` | no | `./actual-data` | Setup B only: where Actual stores its data. |
| `ACTUAL_IMAGE` | no | `docker.io/actualbudget/actual-server:latest` | Setup B only: which Actual image to run. Pin a tag to update on your own schedule. |
| `BACKEND_PORT` | no | `3100` | Port the backend listens on inside the Docker network. |
| `SUMMARY_TOKEN` | no | empty (off) | Turns on the [read-only summary endpoint](#read-only-summary-endpoint). |
| `TZ` | no | `Etc/UTC` | Your timezone as a tz database name, used to decide what "today" is. |

The tracker's own data lives in `./data`:

| File | What it is |
|---|---|
| `asset-tracker.sqlite` | Loans, setup, reconciliation, assets. **Back this up.** (Installs from before the rename use `mortgage.sqlite`.) |
| `*.sqlite.backup-v<N>-<time>` | A copy made automatically before an update changed the database layout. Safe to delete once you're happy. |
| `actual-cache/` | A local copy of the budget that the tracker downloads from Actual. Safe to delete; it's downloaded again. |

### Use a real certificate

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

### Actual uses a self-signed certificate

The backend has to trust Actual's certificate to read your budget:

1. Copy Actual's certificate into this folder's `certs/`, e.g.
   `certs/actual-ca.crt`.
2. Set `ACTUAL_CA_CERT=/certs/actual-ca.crt` in `.env` (that's the path
   inside the container).
3. Make sure the certificate lists the host name used in
   `ACTUAL_SERVER_URL` (with setup A, usually `actual`).
4. Run `docker compose up -d`.

---

## FAQ

### General

**Does this change my Actual budget?**
No. The tracker only reads categories and transactions. It never creates,
changes or deletes anything in your budget, and Actual's own files and
container aren't modified.

**Is this an official Actual Budget project?**
No. It's a community add-on that works with Actual. Please report problems
with it here, not to the Actual project.

**Do I have to change any Actual settings?**
No. You just open Actual through the add-on's port (5007) instead of
Actual's own (5006).

**Can I still use Actual directly on port 5006?**
Yes, Actual keeps working there, just without the Loans section. Only the
proxy port shows it.

**Does it work in Actual's phone layout or the desktop app?**
No. It needs Actual's desktop web layout in a browser (the sidebar is where
it lives). On a narrow window or a phone, Actual switches to its mobile
layout and Loans is hidden. The Actual desktop app doesn't load pages
through the proxy, so it doesn't show Loans either.

**Does it work on a Raspberry Pi?**
Yes. It's developed and tested on one. The first build takes a few minutes.

**Can I track more than one budget?**
One install reads one budget (one Sync ID). For a second budget, clone the
project into a second folder, give it its own `.env` with a different
`PROXY_PORT`, and start it there.

**Which countries does it work for?**
Amounts are shown in dollars with two decimals, and the PMI rules are U.S.
rules. The loan math itself (amortization, interest, fees, equity) works for
any fixed-rate loan with monthly payments.

**How do I support the project?**
Star it on GitHub, report bugs, or help fund it on
[Patreon](https://patreon.com/IvanS1123).

### Data, privacy and backups

**Where is my loan data stored?**
In `data/` inside this folder, in a SQLite file (`asset-tracker.sqlite`, or
`mortgage.sqlite` on older installs). Nothing is stored in Actual.

**Is any of my data sent anywhere?**
No. The tracker talks only to your own Actual server. It has no analytics
and makes no other outside connections.

**Who can see my loans?**
Anyone who can log in to your Actual server through the proxy port. The
tracker checks every request against Actual's own login.

**How do I back up and restore?**
To back up, stop the backend so the database is quiet, copy `data/`, and
start it again:

```sh
docker compose stop asset-tracker-backend
cp -r data /somewhere/safe/tracker-backup
docker compose start asset-tracker-backend
```

To restore, stop the backend, replace `data/` with your copy, and start it
again. Back up Actual separately (*Settings → Export data*).

**What are the `.backup-v...` files in `data/`?**
Automatic copies made before an update changed the database layout. Keep
them until you've checked the update went well, then delete them if you
like.

**Can I delete `data/actual-cache/`?**
Yes. It's the tracker's downloaded copy of your budget, fetched again on the
next start. Your loan data isn't in it.

### Loans

**Which kinds of loans can I track?**
Mortgages, auto loans and personal loans. Any other fixed-rate loan with
monthly payments (student loan, boat or RV loan, equipment loan) works as a
*personal loan*; add an asset to it if it paid for something with a resale
value.

**I've been paying on my loan for years. Do I have to enter every payment?**
No. Enter the original terms, tick *Already paying on this loan?*, and enter
your last payment date and balance from a recent statement. See
[A loan that's already under way](#a-loan-thats-already-under-way).

**My statement's payment is a cent different from the calculated one.**
Type the statement's exact principal-and-interest amount into the payment
field under Setup. For a one-off cent of difference in the split, use the
penny offset on that month.

**How do I know if my loan uses daily interest?**
Your loan agreement says "simple interest" or describes interest accruing
daily. Many car and personal loans do; most mortgages don't. If you're not
sure, start with monthly; if your statements' interest changes when you pay
early or late, switch to daily.

**I pay every two weeks.**
Only monthly schedules are supported. If your lender collects biweekly but
applies it monthly, reconcile the month against one combined transaction; a
true biweekly schedule isn't modeled.

**My rate changes (an ARM) or I refinanced.**
Rate changes can't be modeled. After a refinance, archive the old loan and
add the new one (use *Already paying on this loan?* if you set it up late).

**I made an extra principal payment as its own transaction.**
Match the regular payment as usual, then record the extra as *extra
principal* with that month or the next one. On a daily-interest loan that
charges a few days more interest than your lender does; see
[Known limitations](docs/KNOWN_LIMITATIONS.md).

**My bank splits the payment into principal, interest and escrow categories.**
Keep the whole loan payment in one category in Actual (one transaction, or a
split whose loan lines all use the same category). The tracker only looks at
the category you pick, so a payment spread over several categories won't
match.

**Why does my car still show its purchase price?**
Equity uses the latest value you entered. Add one on the Vehicle screen from
a pricing guide now and then. The *projected today* figure is only an
estimate based on the yearly drop you set.

**Can a home equity loan and a mortgage share the same home?**
Not yet. Each asset belongs to one loan, so combined equity across two
loans on the same home isn't calculated. Track the second loan as a
personal loan without an asset.

**What's the difference between archive and delete?**
Archive hides a loan (paid off, sold, refinanced) and keeps its history; you
can unarchive it any time. Delete removes the loan and everything recorded
for it, and can't be undone.

### Setup and networking

**Can I use a port other than 5007?**
Yes. Set `PROXY_PORT` in `.env` and run `docker compose up -d`.

**Actual runs on another machine.**
Set `ACTUAL_SERVER_URL` and `ACTUAL_UPSTREAM` to that machine's address, e.g.
`https://192.0.2.10:5006`, and use setup A. The add-on can run anywhere that
can reach Actual.

**Can I put it behind my own reverse proxy (Caddy, Traefik, Nginx Proxy Manager)?**
Yes. Point your reverse proxy at `https://<this-machine>:5007` instead of at
Actual, and tell it not to verify the add-on's self-signed certificate (or
give the add-on a real one). Keep WebSocket support on, as for Actual.

**Can I reach it remotely (VPN, Tailscale)?**
Yes, the same way you reach Actual: open the proxy port (5007) over your
VPN instead of Actual's.

**I see a certificate warning every time.**
That's the self-signed certificate. Accept it once per browser, or
[use a real certificate](#use-a-real-certificate).

### Updates

**How do I update?**
`git pull` then `docker compose up -d --remove-orphans`. See [Update](#update).

**Will updating Actual break it?**
Normally not: Actual runs from its own unchanged image. The sidebar item
depends on Actual's page layout, so after a big Actual release, reload the
page once and check that Loans is still there. If it isn't, see
[Troubleshooting](#troubleshooting).

**Does an update ever touch my data?**
Only the tracker's own database, and only when an update changes its layout.
A copy of the old database is always saved first.

---

## Troubleshooting

Work down the list. None of these steps touch your budget.

**`Bind for 0.0.0.0:5007 failed: port is already allocated`**
Something else is already using port 5007, usually the add-on's own
containers under an older name (for example `mortgage-proxy` from before the
rename).
1. Make sure `.env` has the right `COMPOSE_FILE` for your setup, then run
   `docker compose up -d --remove-orphans`. That removes the old containers.
2. Still failing? See what holds the port:
   `docker ps --format '{{.Names}}\t{{.Ports}}' | grep 5007`. Stop that
   container, or set a different `PROXY_PORT` in `.env`.

**`pull access denied for ab-asset-tracker-...`**
Harmless on older versions: Compose looked online for images that are built
locally, then built them. Current versions build without looking online.

**A second Actual container appeared (`...-actual-1`).**
`docker compose` ran setup B's file while you use setup A. Set
`COMPOSE_FILE=compose.existing-actual.yml` in `.env` and run
`docker compose up -d --remove-orphans`; the extra container is removed.
Your real Actual isn't affected. If an empty `actual-data/` folder was
created, you can delete it.

**The backend keeps restarting.**
Run `docker compose logs asset-tracker-backend | grep asset-tracker`.
- *"Missing required setting(s): ..."*: fill in the named settings in `.env`.
- *"... is not a known timezone"* or *"PORT must be ..."*: fix that setting.
- *"Authentication failed"*: check `ACTUAL_PASSWORD` and `ACTUAL_SERVER_URL`.
- *Certificate errors* (`self-signed certificate`, `unable to verify`): see
  [Actual uses a self-signed certificate](#actual-uses-a-self-signed-certificate).
- *"out-of-sync" / migration / version errors*: your Actual is newer than
  the API package; see [Compatibility](#compatibility).

**Loans is missing from the sidebar.**
1. Make sure you're on the proxy port (`:5007`), not Actual's (`:5006`).
2. Hard-reload the page (Ctrl+Shift+R / Cmd+Shift+R). Actual caches its page,
   and the first load after an update can be the old copy.
3. Make the window wider: Actual's mobile layout has no sidebar.
4. Open the browser console (F12 → Console) and look for `[asset-tracker]`.
   - *"Could not find a sidebar link to attach to"*: Actual changed its page
     layout. Actual itself is fine. Please
     [open an issue](https://github.com/gismc123/AB-Asset-Tracker/issues) with
     your Actual version and that line.
   - No `[asset-tracker]` lines at all: the script wasn't added. Check that
     the proxy is running (`docker compose ps`) and that
     `https://<this-machine>:5007/asset-tracker-addon/inject.js` loads.

**"Log in to Actual to see your loans."**
Log out of Actual and back in through the proxy port. The tracker uses the
same login.

**"Can't read from Actual right now"** on the loan screens.
The backend lost its connection to Actual. Check the backend log (see
above). Deleting `data/actual-cache/` and restarting the backend forces a
fresh download of the budget; your loan data isn't affected.

**Actual shows a 502 page through the proxy.**
Actual is down or still starting. Check `docker ps` and Actual's own logs.
Going straight to Actual's port tells you whether the problem is Actual or
the proxy.

**The numbers don't match my statement.**
Compare one month on the Schedule screen. A one-cent split difference is
what the payment override and penny offset are for. Reconciled months are
locked to what you matched, and daily-interest loans use the date your bank
paid. Check the interest method, the rate (the note rate, not the APR), and
the first payment date.

---

## Read-only summary endpoint

For dashboards (a wall display, a home automation panel) there's one
read-only JSON endpoint. It's **off** until you set `SUMMARY_TOKEN` in
`.env` to a long random string (e.g. from `openssl rand -hex 24`) and run
`docker compose up -d`. Send the token in the `Authorization` header:

```sh
curl -k -H "Authorization: Bearer <SUMMARY_TOKEN>" "https://<this-machine>:5007/asset-tracker-api/v1/summary"
curl -k -H "Authorization: Bearer <SUMMARY_TOKEN>" "https://<this-machine>:5007/asset-tracker-api/v1/summary?loan=2"
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
  rest of the API. To change the token, edit `SUMMARY_TOKEN` and run
  `docker compose up -d`.
- The older `?token=<SUMMARY_TOKEN>` query form still works but is
  **deprecated** (query strings end up in logs and browser history): those
  responses carry a `Deprecation: true` header, and the backend logs a
  warning once.

---

## How it works

```
 browser ──HTTPS──▶  asset-tracker-proxy (nginx) ──▶  Actual (stock image, untouched)
                         │
                         ├── /asset-tracker-addon/*  ─┐
                         └── /asset-tracker-api/*    ─┴─▶ asset-tracker-backend (Node) ──read-only──▶ Actual API
```

1. **The proxy passes everything through.** Every request goes to Actual
   as-is. The only change: on Actual's HTML pages it adds one line just
   before `</head>`:
   ```html
   <script src="/asset-tracker-addon/inject.js" defer></script>
   ```
   The script is served from the same address as Actual, which Actual's own
   security policy already allows.
2. **The script finds the sidebar defensively.** It looks for Actual's
   sidebar links by their addresses (`/schedules`, then `/reports`, then
   `/budget`), copies one so the new item matches Actual's look and theme,
   and inserts **Loans** right after it, with the list of loans below. React
   redraws the sidebar often, so a watcher puts them back when they
   disappear.
3. **Clicking it opens the screens beside the sidebar,** inside Actual's
   window, in an isolated layer (a *shadow root*) so Actual's styles and the
   tracker's can't interfere. The address gets `#loans` added: Back closes
   the screens, Forward reopens them, and a reload or bookmark opens them
   again. Clicking any other sidebar item takes you back to Actual.
4. **It fails quietly.** If Actual's page changes so much that no sidebar
   link can be found, the script adds nothing and logs one line to the
   browser console. Actual keeps working exactly as before.
5. **Who can see the data?** The backend only answers requests that carry a
   valid Actual login. The script reads the session token Actual's web app
   already keeps in your browser, and the backend checks it with your Actual
   server (`/account/validate`).

---

## Compatibility

| Component | Tested with |
|---|---|
| Actual server | `actualbudget/actual-server` **26.10.0** |
| `@actual-app/api` | **26.10.0** (pinned in `package.json`) |
| Node.js (backend image) | 22 (`node:22-bookworm-slim`) |
| nginx (proxy image) | 1.27 (`nginx:1.27-alpine`) |
| Browsers | Current Chrome, Firefox and Safari (desktop layout) |

Keep `@actual-app/api` on the same version as your Actual server. If a newer
Actual gives *"out-of-sync"* or version errors in the backend log, set
`@actual-app/api` in `package.json` to your Actual's version (shown at the
bottom of Actual's login screen), run `./scripts/npm.sh install`, then
`docker compose up -d`.

---

## Development

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
migration tests load databases made by the last single-loan release
(`test/fixtures`) and check the migrated loan matches its numbers exactly.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes, and
[docs/DECISIONS.md](docs/DECISIONS.md) and
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for the reasoning and
the gaps.

### Project layout

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
docker-compose.yml           Setup B: stock Actual + add-on
compose.existing-actual.yml  Setup A: add-on in front of an Actual you already run
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
