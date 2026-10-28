# Security policy

AB Asset Tracker holds loan numbers, balances and other private details, so
security reports are welcome and taken seriously.

## Supported versions

Security fixes go into the latest release only. Update to it before
reporting.

## Reporting a vulnerability

Please don't open a public issue. Report it privately instead: open the
**Security** tab of this repository and click **Report a vulnerability**.
Only the maintainer can see the report.

Useful to include:

- what an attacker can do, and what they need first (network access to the
  proxy port, an Actual login, a summary token);
- the steps to reproduce, against a test Actual server with made-up data;
- the tracker version (or commit) and your Actual server version.

Please leave out real loan numbers, passwords, tokens and sync IDs.

This is a one-person project, so a reply can take a few days. Once a fix is
out, the report can be published with credit to you, if you'd like.

## What counts

- Reading or changing tracker data without a valid Actual login.
- Anything that makes the tracker write to an Actual budget. It is meant to
  be read-only.
- The summary token giving access to more than the read-only summary.
- Settings from `.env` (the Actual password, the summary token) leaking
  through the API, logs or the browser.

## What doesn't

- Anything that needs a valid Actual login: anyone who can log in to Actual
  can see and change every loan, by design (see
  [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)).
- Problems in Actual Budget itself. Report those to the
  [Actual project](https://github.com/actualbudget/actual/security).
