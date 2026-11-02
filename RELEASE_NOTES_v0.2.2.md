# AB Asset Tracker v0.2.2

A fix for reconciling loans whose payments are booked as deposits in
Actual, and clearer column names when importing a lender's table.

## Fixed

- **Payments booked as deposits now show up on Reconcile.** If you record
  each loan payment as money going into the loan's own account in Actual
  (instead of a payment out of checking), the payment never appeared in the
  list, even with *Search ±60 days*, so the month couldn't be reconciled.
  Those transactions are now listed, marked *deposit*, after the payments,
  and can be matched to a month or added as an extra payment.
  ([#2](https://github.com/gismc123/AB-Asset-Tracker/issues/2))
- **Clearer columns when importing a lender's amortization table.**
  *Payment #* and *Payment* looked like the same column twice. They're now
  *Payment number* and *Payment amount*, with a note saying which columns
  are required: interest, plus principal or the payment amount. Files are
  read the same way as before.
  ([#3](https://github.com/gismc123/AB-Asset-Tracker/issues/3))

## Upgrading from v0.2.1

1. **Back up first.** Open **Loans**, click **Backup**, and **Download
   backup**.
2. Update as usual, from the `ab-asset-tracker` folder:
   ```sh
   git pull
   docker compose up -d --remove-orphans
   ```

There are no database changes, and nothing you've already reconciled
changes. To go back to v0.2.1, check out the `v0.2.1` tag and rebuild.

The summary endpoint is unchanged (still version 2, same fields).

## Compatibility

Built and tested against `@actual-app/api` 26.10.0, the same as v0.2.1.

## Known limitations

See [docs/KNOWN_LIMITATIONS.md](https://github.com/gismc123/AB-Asset-Tracker/blob/main/docs/KNOWN_LIMITATIONS.md).
Amounts are still shown in US dollar format whatever your budget's
currency; following Actual's currency setting is planned (see
[docs/ROADMAP.md](https://github.com/gismc123/AB-Asset-Tracker/blob/main/docs/ROADMAP.md)).
