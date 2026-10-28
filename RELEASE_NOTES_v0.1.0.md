# AB Asset Tracker v0.1.0

The first public release. AB Asset Tracker adds a **Loans** section to a
stock Actual Budget server, for mortgages, car loans and personal loans, and
the homes and vehicles they paid for. It runs as two small containers in
front of Actual and only ever reads from your budget.

## What's in it

- **Several loans, three types.** Mortgages (with optional PMI and escrow),
  auto loans and personal loans, each with its own schedule, category,
  reconciliation and details. Add, rename, archive and delete loans.
- **Loans in Actual's sidebar.** Each loan is listed under the Loans item
  with its equity as the headline number and what you owe underneath. It
  follows Actual's light and dark theme and privacy mode.
- **Add-loan wizard and first-run welcome.** Pick the type, then fill in
  only the fields that type needs.
- **Monthly reconciliation.** Match the payment that synced into Actual;
  explain a difference as rounding, extra principal, an escrow change or a
  PMI change, and the rest of the schedule recalculates. Skipped payments
  (caught up later, interest added, or deferred to payoff) and catch-up
  plans are supported.
- **Assets and equity.** Equity is the asset's latest value minus what you
  owe. Record values over time, and optionally project a yearly drop (for
  vehicles) or rise, always labeled as an estimate.
- **Interest, fees and payoff.** Monthly or daily simple interest (daily
  uses the real date each payment cleared), a down payment, one-off fees, a
  yearly fee on the original amount or the balance, and a payoff amount
  from your lender's quote or an estimate.
- **Backup and restore.** Download everything in the tracker as one JSON
  file and load it back, on the same install or a new one. A copy of the
  current data is saved before a restore replaces it. Also available from
  the command line for scheduled backups.
- **Read-only summary endpoint** for dashboards, with every loan or one at
  a time, behind its own token sent as a Bearer header.
- **Preview page** with made-up sample loans, for trying the screens without
  Actual.

## Compatibility

Tested with Actual server 26.10.0 and `@actual-app/api` 26.10.0.

## Known limitations

See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). In short:
monthly payments only, fixed rates, U.S. conventional PMI rules, one asset
per loan, and the desktop layout of Actual.
