# Feature status

Where each requested feature stood when work on v0.2.0 started, checked
against the code and the test suite of v0.1.0 (201 tests passing), not
against the README. "Where" points at the code that implements it.

| # | Request | Status at v0.1.0 | Where / what was missing |
|---|---|---|---|
| 1 | Loan types: auto, personal, student | Partly implemented | Mortgage, auto and personal work end to end: add-loan wizard (`src/ui/components/AddLoanWizard.tsx`), schedule and modules (`src/engine/amortize.ts`), reconcile without PMI or escrow answers (`src/engine/reconcile.ts`), equity against a vehicle (`src/engine/equity.ts`), summary endpoint (`src/server/app.ts`), tested in `src/engine/loan-types.test.ts` and `src/server/service.test.ts`. **Missing: a student loan type.** The database only allows `mortgage`, `auto` and `personal`. |
| 2 | Asset value from an Actual account's balance | Not implemented | Asset values are manual entries only (`asset_values`). The Actual adapter (`src/server/actual.ts`) reads categories and transactions, not accounts or balances. |
| 3 | Several payments in one month, principal-only extras | Not implemented | A month matches exactly one bank transaction (`months` is keyed by loan and payment). Extra principal is only the part of the regular payment above the schedule, or a standing amount. An extra paid on its own can't be recorded or dated. |
| 4a | Payoff date moves up with real extra principal | Implemented | Extra principal from reconciliation (one-time or standing) reduces the balance and the schedule ends sooner (`amortize`), and the payoff date is the last row (`summarize`). Tested in `amortize.test.ts` ("standing extra shortens the loan"). |
| 4b | What-if calculator | Not implemented | Listed as a known limitation and on the roadmap. |
| 5 | Daily interest accrual per loan | Partly implemented | `interestMethod: 'daily'` exists per loan, with a 365-day year, interest up to the bank date of matched payments, tested in `loan-types.test.ts`. **Missing: a mid-month extra payment can't reduce interest for the days after it**, because extras can't be dated (see 3). |
| 6 | Fees: one-off and recurring yearly | Partly implemented | One-off fees exist but are informational only, with no date, and can't be added to the balance. A yearly fee as a percent of the original amount or of the balance exists, but always rides in the monthly payment (`applyYearlyFee`). **Missing: dated one-off fees, fees added to the balance, a yearly fee charged separately.** |
| 7 | Effective annual rate | Not implemented | Only the nominal rate is shown. |
| 8 | Import a lender's amortization table | Not implemented | Interest is always calculated. Penny offsets and the P&I override exist and must keep working. |
| 9 | README: what it is, requirements, desktop app | Partly implemented | The README says it is an add-on, read-only and not affiliated. The desktop app and phone layout are only mentioned in `docs/FAQ.md`. **Missing: a "What is this?" paragraph, a Requirements section and a Known limitations section near the top.** |
| 10 | Balance cross-check against an Actual loan account | Not implemented | No link from a loan to an Actual account. |

## What v0.2.0 adds

See [RELEASE_NOTES_v0.2.0.md](../RELEASE_NOTES_v0.2.0.md) for the user-facing
summary and [DECISIONS.md](DECISIONS.md) for the defaults chosen.
