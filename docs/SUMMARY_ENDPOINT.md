# Read-only summary endpoint

A read-only JSON endpoint for dashboards. Back to the [README](../README.md).

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
- `type` is `mortgage`, `auto`, `personal` or `student`.
- `balance` is after the last reconciled payment, less any
  [extra payment](../README.md#extra-payments) of its own already made since.
- When the asset's value comes from a linked Actual account, `valueSource`
  is `"Actual account"` and `valueAsOf` is the day its balance was read.
  The account's name isn't included. If Actual can't be read, the last
  balance read (or the latest value entered in the tracker) is used, so the
  endpoint keeps answering.
- `paymentNumber` is the last *reconciled* payment. `balance` is after that
  payment; `scheduledBalance` is what the schedule expects by today.
  `nextPayment.daysUntil` is negative when that payment's due date has
  passed and it isn't reconciled yet.
- `equity` is the asset's latest value minus `owed`. `asset` and `equity`
  are `null` for a loan without an asset. `pmi` is `null` unless the loan
  has PMI; for a mortgage it holds `active`, `monthly`, `dropDate`,
  `paymentsUntilDrop`, `daysUntilDrop`, `requestRemovalDate`,
  `automaticRemovalDate` and `removalRule`. With `removalRule`
  `"untilRemoved"` and no removal recorded, `dropDate`, `paymentsUntilDrop`
  and `daysUntilDrop` are `null`: PMI stays until it's removed.
- Loan details (servicer, account numbers, notes) are never included.
- The endpoint never changes anything, and its token can't be used for the
  rest of the API. To change the token, edit `SUMMARY_TOKEN` and run
  `docker compose up -d`.
- The older `?token=<SUMMARY_TOKEN>` query form still works but is
  **deprecated** (query strings end up in logs and browser history): those
  responses carry a `Deprecation: true` header, and the backend logs a
  warning once.
