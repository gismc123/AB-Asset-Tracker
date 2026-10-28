# Roadmap

What's planned for AB Asset Tracker after v0.1.0, roughly in order. Most of
it comes from early feedback by people who track loans in Actual. Today's
gaps are listed in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md); this page
says which ones will be closed and how.

Nothing here has a date. Order can change with feedback, and contributions
are welcome on any item: open an issue first for the larger ones (see
[CONTRIBUTING.md](../CONTRIBUTING.md)).

## Next

The gaps people hit first.

### Currency and number formatting

Every amount shows as `$1,234.56`, because the format is fixed to US
dollars (`src/ui/format.ts`). People outside the US see the wrong symbol and
separators even though the math is right.

- A currency and number format setting (symbol, symbol position, thousands
  and decimal separators), used on every screen and in the sidebar list.
- Follow Actual's own number format setting where the tracker can read it.
- The summary endpoint keeps returning plain numbers; it gains a `currency`
  field so dashboards can format them.

### What-if calculator

"When would I be done if I paid $200 more a month?" is one of the most asked
questions, and today the only way to answer it is to change the real
schedule.

- On the Overview, try a higher monthly payment, a one-time lump sum on a
  chosen date, or both.
- See the new payoff date, months saved and interest saved next to the
  current plan, with both balance curves on one chart.
- Nothing is saved unless you choose to turn the extra into a standing
  extra principal.
- The engine already recalculates from any point, so this is mostly a new
  screen on top of it.

### Several loans on one asset

A mortgage split into two parts, or a first mortgage plus a home equity
loan, can't share one home today, so equity is wrong for both.

- Let an asset be linked to more than one loan. Equity is the asset's value
  minus what all its loans still owe.
- The asset screen lists each loan's balance and the combined loan-to-value.
- A database migration, and a change to the decision "at most one asset per
  loan" in [DECISIONS.md](DECISIONS.md). Existing one-to-one links come
  through unchanged.
- The summary endpoint gains the combined numbers per asset without changing
  the per-loan fields.

### Payment split ready to copy into Actual

People who keep a loan account's balance right in Actual split every payment
into principal, interest and escrow by hand, every month. The tracker
already knows those numbers but, being read-only, can't enter them.

- On Reconcile, after a month is matched, show the split exactly as Actual's
  split transaction needs it: principal (as a transfer to the loan account),
  interest, escrow, PMI and fees, each with a copy button.
- Explain the two common ways to set up the loan account in Actual (on or
  off budget) in the README.
- This keeps the read-only rule. Writing the split for you is under
  [Needs discussion](#needs-discussion).

## Later

### Extra payments on their own date

An extra principal payment made between two regular payments has to be
recorded with a regular month. On a daily-interest loan that charges a few
days more interest than the lender does.

- Record an extra payment with its own date, matched to its own bank
  transaction.
- Daily-interest loans charge interest up to that date on the old balance
  and after it on the new one. Monthly-interest loans apply it with the next
  payment, as lenders do.

### Rate changes

Adjustable-rate mortgages, renegotiated rates and loans whose rate is reset
after a fixed period can't be followed today.

- A rate change from a given payment onward, with the payment recalculated
  or kept, as the lender does it.
- The schedule, payoff date and interest totals follow the new rate.
- Later: interest-only periods and balloon payments.

### Other payment frequencies

Biweekly, semimonthly and weekly schedules, for lenders that apply each
payment when it arrives. Lenders that collect biweekly but apply the money
monthly can already be followed; see the README's FAQ.

### Day-count conventions

Daily interest uses a 365-day year. Add 366 days in leap years and 360-day
years (30/360 and actual/360) as a per-loan setting.

### Mortgage insurance outside conventional U.S. loans

FHA mortgage insurance premium (MIP), which follows different rules from
PMI, and a plain monthly insurance amount with an end date for loans
elsewhere.

### Narrow screens

A layout for Actual's mobile view, which has no sidebar, so loans can be
checked from a phone.

### Proposing loans for Actual itself

The longer-term aim is a built-in loans feature in Actual, with loans shown
as assets with equity instead of only a negative balance. This add-on is the
working prototype to point at.

- Start with Actual's maintainers (an existing feature request or their
  community channels) before any code, to agree on whether and how it fits.
- The screens are React components behind a small client interface and
  could move across. The data could not: it lives in the tracker's own
  SQLite file, and in Actual it would have to live in the synced budget
  file. That is the real work, and the maintainers' call.

## Needs discussion

Ideas that came up but conflict with a ground rule or need a design first.
They won't start without an issue and agreement on the approach.

- **Writing the payment split into Actual.** An opt-in mode, off by default,
  that creates the principal, interest and escrow split on the matched
  transaction. It would break the "read-only toward Actual" rule in
  [CONTRIBUTING.md](../CONTRIBUTING.md), so it needs a clear case for why
  copying the split by hand isn't enough, and strict limits on what it may
  touch.
- **Revolving credit.** Credit cards, lines of credit and 0% "pay in X
  months" plans: when the balance must be paid off and what the monthly
  autopay should be. These work differently from amortizing loans and might
  belong in a separate tool.
- **More than one budget per install.**
- **Per-dashboard tokens** for the summary endpoint, instead of one shared
  token.
- **Other languages.**

## Not planned

- **Bank or lender connections.** The tracker gets payments from Actual and
  nowhere else.
- **Forecasting refinances or future rates.** The tracker follows the loan
  you have, not the one you might get.

## Suggest something

Open a [feature request](https://github.com/gismc123/AB-Asset-Tracker/issues/new/choose).
Say what kind of loan it is, how your lender handles it, and what you do
today instead. Please use made-up numbers.
