# AB Asset Tracker v0.2.0

The features people asked for most after v0.1.0: extra payments on their
own date, a what-if calculator, student loans, more kinds of fees, your
lender's own amortization table, and two optional links to accounts in
Actual. Every new option is off until you choose it, so your existing
loans show exactly the same numbers after the update.

## What's new

- **Student loans.** A loan type of their own, with no asset, PMI or escrow,
  like a personal loan.
- **Extra payments on their own date.** A month can now have its regular
  payment plus any number of extra principal payments made separately,
  picked from Actual or entered by hand. Each one applies on its own date
  and can be removed on its own; later interest, the payoff date and PMI
  dates follow the real balance. They show on Reconcile and under their
  month on the Schedule.
- **What if.** A new screen to try a higher monthly payment, a one-time lump
  sum, or both, without saving anything: the new payoff date next to the
  current one, how much sooner, and what you'd owe and your equity on dates
  you choose. One click makes the monthly amount your standing extra.
- **Daily interest that counts the days of an extra payment.** On a loan set
  to daily interest, an extra payment cuts interest only from the day it was
  made.
- **More kinds of fees.** One-off fees can have a date and be paid
  separately or added to the balance (interest accrues on them). The yearly
  fee can be charged in the payment or separately. Fees show on the Schedule
  and in every total.
- **Effective rate.** The Overview shows the loan's effective yearly rate
  with its fees, next to the note rate, labeled an estimate and explained.
- **Import your lender's amortization table** from a CSV file, with column
  mapping and a preview before anything is saved. Those months use the
  lender's interest and principal exactly and carry a *bank table* badge.
  PDF tables aren't supported; save them as CSV first.
- **Asset value from an Actual account.** Use the balance of an account in
  Actual (for example an off-budget account you keep at the car's value) as
  the asset's value. The values you entered stay as the fallback, and the
  screen says which one is in use.
- **Balance cross-check.** Link the Actual account that tracks a loan's
  balance, and the Overview says whether it matches the tracker, or by how
  much it differs.
- **Clearer README.** What the add-on is, what it needs, and what it doesn't
  do (the Actual desktop app and phone layout aren't supported) are now at
  the top.

The tracker is still read-only toward Actual. The two account links only
read balances, and only for accounts you pick.

## Upgrading from v0.1.0

1. **Back up first.** Open **Loans**, click **Backup**, and **Download
   backup**. Or from the `ab-asset-tracker` folder:
   ```sh
   docker compose exec -T -u node asset-tracker-backend node dist/server/backup-cli.js export > tracker-backup-v0.1.0.json
   ```
2. Update as usual:
   ```sh
   git pull
   docker compose up -d --remove-orphans
   ```

On its first start the tracker upgrades its database (five small
steps) and first saves a copy of the old one next to it in
`data/`, named `*.backup-v2-<time>`. The log says where. Your loans,
reconciled months, skips, escrow entries, assets and details are kept as
they are, and their numbers don't change; this is checked by a test that
upgrades a v0.1.0 database and compares every loan to the cent.

To go back to v0.1.0, check out the `v0.1.0` tag, stop the tracker, put the
`*.backup-v2-*` copy back in place of the database (or restore your backup
file from the Backup screen after reinstalling v0.1.0), and start it again.
A backup made with v0.2.0 can't be restored into v0.1.0.

For dashboards, the summary endpoint is still version 2 with the same
fields. Two new values can appear: `type` can be `student`, and
`valueSource` is `Actual account` when an asset's value comes from a linked
account.

## Compatibility

Built and tested against `@actual-app/api` 26.10.0, the same as v0.1.0.

## Known limitations

See [docs/KNOWN_LIMITATIONS.md](https://github.com/gismc123/AB-Asset-Tracker/blob/main/docs/KNOWN_LIMITATIONS.md). In short:
monthly payments only, fixed rates, PMI dates from U.S. conventional-loan
rules, one asset per loan, CSV (not PDF) for lender tables, every Actual
user sees every loan, and Actual in a desktop browser only (no desktop app,
no phone layout).
