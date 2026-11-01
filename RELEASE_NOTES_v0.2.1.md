# AB Asset Tracker v0.2.1

A fix for skipped payments on daily-interest loans, a way to bring
reconciled months up to date after you change a loan's setup, and a clearer
What if screen.

## Fixed

- **A skipped month on a daily-interest loan no longer charges interest on
  interest.** On a simple-interest loan (most car loans), a month skipped as
  *interest is added to the balance* added that month's interest to what you
  owe, so the next months charged interest on it, and the balance drifted
  from the lender's by cents. Now the interest keeps building from your last
  payment and your next payment pays it first, the way simple-interest
  lenders do it. Checked against a real lender's statement: every balance
  matches to the cent. Monthly-interest loans, such as most mortgages, are
  unchanged.
- **The payoff estimate on a daily-interest loan counts interest from the
  day your last payment was made**, not its due date, so it no longer
  counts days you've already paid interest for. After a skipped month it
  counts from your last payment, including the interest that built up.

## What's new

- **Recalculate reconciled months.** Reconciled months keep the amounts
  they were locked with, so changing the rate, term or fees only changed
  the months still to come. Now, when the current setup would work
  reconciled months out differently, the Overview, Reconcile and Setup
  screens say so, with what your balance would be. **Review** shows each
  month's interest, principal and balance before and after;
  **Recalculate** locks the new amounts. What you paid always stays what
  your bank shows. If the setup now expects a different payment than you
  made, the difference goes to principal, and the review says so.
- **A clearer What if screen.** It starts with what you pay now. Type an
  extra amount or click one (*Round up to* an even payment, or a few
  dollars more), and the answer is one line, such as *Paid off in Nov 2029,
  3 months sooner, and you'd pay $207 less interest*, over a table of the
  monthly payment, payoff month, payments left and interest still to pay.
  **Keep it** adds the extra to your schedule. What you'd owe on particular
  dates is folded away under the chart.

## Upgrading from v0.2.0

1. **Back up first.** Open **Loans**, click **Backup**, and **Download
   backup**.
2. Update as usual, from the `ab-asset-tracker` folder:
   ```sh
   git pull
   docker compose up -d --remove-orphans
   ```

There are no database changes. Loans without a skipped month on a
daily-interest loan show the same balances as before; their payoff
estimates may be a few dollars lower.

**If you skipped a month on a daily-interest loan and reconciled payments
after it,** the payment right after the skip was locked with the old math.
Until you recalculate, that loan's balance is off by roughly a month's
interest, and the Overview shows a notice. Click **Review**, check the
months, and **Recalculate**.

To go back to v0.2.0, check out the `v0.2.0` tag and rebuild. Months you
recalculated keep their new amounts.

The summary endpoint is unchanged (still version 2, same fields).

## Compatibility

Built and tested against `@actual-app/api` 26.10.0, the same as v0.2.0.

## Known limitations

See [docs/KNOWN_LIMITATIONS.md](https://github.com/gismc123/AB-Asset-Tracker/blob/main/docs/KNOWN_LIMITATIONS.md). New in
this release: when four or more months in a row are skipped on a
daily-interest loan and the built-up interest is more than the next
payment, the rest is added to the balance, where some lenders keep it as
unpaid interest.
