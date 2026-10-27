# Actual Mortgage Tracker

A **Mortgage** tab for a stock [Actual Budget](https://actualbudget.org) server.

> Status: under construction. Sections below are filled in as each part is built.

## Contents

1. What it does
2. Quick start (Docker)
3. How the Mortgage tab gets into Actual
4. Configuration
5. The monthly workflow
6. PMI behavior
7. Upgrading Actual safely
8. Troubleshooting after an Actual update
9. Development

## Project layout

```
src/engine/   Pure amortization + PMI + reconciliation math (no I/O, unit tested)
src/server/   Node/TypeScript backend: Actual API (read-only), SQLite storage, HTTP API
src/ui/       Mortgage screens as self-contained React components
src/inject/   The one script the proxy injects into Actual's page
proxy/        nginx reverse proxy that passes Actual through and injects the script
examples/     Made-up sample loan data (never real numbers)
```
