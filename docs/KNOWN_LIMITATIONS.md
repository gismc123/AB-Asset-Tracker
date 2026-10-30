# Known limitations

What AB Asset Tracker doesn't do, or does only approximately. Most of these
are open to contributions; see [CONTRIBUTING.md](../CONTRIBUTING.md). What
is planned, and in what order, is in the [roadmap](ROADMAP.md).

## Loans

- **Monthly payments only.** Biweekly, weekly or semimonthly schedules
  aren't modeled.
- **Fixed rates only.** Adjustable-rate loans, interest-only periods,
  balloon payments and loan modifications can't be modeled. For a loan
  already under way you can enter where it stands today, but rate changes
  aren't followed. A renegotiated rate has to be set up as a new loan
  that's already under way.
- **Daily interest uses a 365-day year**, including in leap years. Lenders
  that count 366 days in a leap year, or 360-day years, differ by a few
  cents a month; use a penny offset or follow your statement.
- **An extra payment made in a skipped month waits for the next payment
  made.** On a daily-interest loan it then counts from the start of that
  next interest period, so the schedule charges a few days more interest on
  it than your lender does.
- **The payoff estimate is an estimate.** It adds simple daily interest from
  the last due date (not the date the bank paid) to what you owe. Your
  lender's payoff quote has the final word; enter it under Setup.
- **One yearly fee per loan**, charged with the first payment of each loan
  year, not by calendar year or quarter. A charge your lender adds to the
  rate on the balance and collects inside the monthly payment (for example
  "rate plus 1% a year") matches better when you add it to the interest
  rate instead.
- **The lender's amortization table can be imported from CSV only.** PDF
  tables aren't read: save the table as CSV from a spreadsheet first. The
  table's balance column is used as a check, not copied, so after extra
  payments recorded here the tracker's balance (the real one) and the
  table's (which doesn't know about them) differ; re-import the lender's
  updated table, or remove the imported months from that point on.
- **No revolving credit.** Credit cards, lines of credit (including HELOCs)
  and 0% "pay in X months" installment plans aren't amortizing loans and
  can't be tracked.

## Mortgages

- **PMI dates follow U.S. conventional-loan rules** (Homeowners Protection
  Act). FHA MIP, VA funding fees, USDA guarantee fees and lender-paid PMI
  have no rules of their own. Insurance that lasts the life of the loan, or
  ends on a date you know, can be tracked with *Keep PMI until I record it
  removed* and a recorded removal.
- **PMI removal is a payment, not a date.** It's recorded from a payment
  number onward; a premium refund or a partial last month isn't modeled.
- **Escrow is for mortgages only**, and its ledger starts empty for a loan
  that was already under way.

## Assets and equity

- **One asset per loan, and one loan per asset.** Two loans on the same
  home (a first mortgage and a home equity loan, or a mortgage split into
  two parts) can't share it, so combined equity across both isn't
  calculated.
- **Projected values are rough curves**, a fixed yearly percent. They are
  labeled estimates and never change today's equity; enter real values from
  an appraisal or pricing guide now and then.

## Actual integration

- **Read-only by design.** The tracker never creates transactions,
  schedules or categories in Actual.
- **Your loan accounts in Actual aren't updated.** If you split each payment
  into principal, interest and escrow in Actual so a loan account's balance
  stays right, you still enter those splits yourself. The tracker works out
  the numbers but doesn't write them.
- **One budget (one Sync ID) per install.**
- **Every Actual user sees every loan.** With Actual's multi-user (OpenID)
  login, anyone who can log in to the server can see and change all loans,
  whichever budgets they can open in Actual. The tracker has no users or
  permissions of its own.
- **Desktop layout only.** Narrow windows and phones use Actual's mobile
  layout, which has no sidebar, so Loans is hidden there.
- **The sidebar item depends on Actual's page markup.** A big Actual update
  can hide it until the add-on is updated; Actual keeps working either way.
- **One bank transaction per payment.** A payment made in two transactions
  can't be matched to one month, unless it is one split transaction in
  Actual.
- **Dollar formatting.** Amounts are always shown with a `$` sign and US
  number formatting (`1,234.56`), whatever currency your budget is in. The
  math itself works for any currency with two decimals.
- **English only.**

## Summary endpoint

- **One shared token** for every dashboard; there are no per-client tokens
  or scopes.
