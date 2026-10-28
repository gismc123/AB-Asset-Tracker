# Known limitations

What AB Asset Tracker doesn't do, or does only approximately. Most of these
are open to contributions; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Loans

- **Monthly payments only.** Biweekly, weekly or semimonthly schedules
  aren't modeled.
- **Fixed rates only.** Adjustable-rate loans, interest-only periods,
  balloon payments and loan modifications can't be modeled. For a loan
  already under way you can enter where it stands today, but rate changes
  aren't followed.
- **Daily interest uses a 365-day year**, including in leap years. Lenders
  that count 366 days in a leap year, or 360-day years, differ by a few
  cents a month; use a penny offset or follow your statement.
- **Extra principal paid on its own, between two payments, isn't dated.**
  Record it with the next regular payment (as extra principal). On a
  daily-interest loan that means the schedule charges a few days more
  interest on that amount than your lender does.
- **The payoff estimate is an estimate.** It adds simple daily interest from
  the last due date (not the date the bank paid) to what you owe. Your
  lender's payoff quote has the final word; enter it under Setup.
- **One yearly fee per loan**, charged with the first payment of each loan
  year, not by calendar year or quarter.

## Mortgages

- **PMI follows U.S. conventional-loan rules** (Homeowners Protection Act).
  FHA MIP, VA funding fees, USDA guarantee fees and lender-paid PMI aren't
  modeled.
- **Escrow is for mortgages only**, and its ledger starts empty for a loan
  that was already under way.

## Assets and equity

- **One asset per loan, and one loan per asset.** Two loans on the same
  home (for example a first mortgage and a home equity loan) can't share it,
  so combined equity across both isn't calculated.
- **Projected values are rough curves**, a fixed yearly percent. They are
  labeled estimates and never change today's equity; enter real values from
  an appraisal or pricing guide now and then.

## Actual integration

- **Read-only by design.** The tracker never creates transactions,
  schedules or categories in Actual.
- **One budget (one Sync ID) per install.**
- **Desktop layout only.** Narrow windows and phones use Actual's mobile
  layout, which has no sidebar, so Loans is hidden there.
- **The sidebar item depends on Actual's page markup.** A big Actual update
  can hide it until the add-on is updated; Actual keeps working either way.
- **One bank transaction per payment.** A payment made in two transactions
  can't be matched to one month, unless it is one split transaction in
  Actual.
- **Dollar formatting.** Amounts are shown as US dollars with two decimals.

## Summary endpoint

- **One shared token** for every dashboard; there are no per-client tokens
  or scopes.
