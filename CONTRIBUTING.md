# Contributing to AB Asset Tracker

Thanks for helping. Bug reports, fixes and small features are all welcome.
For anything large (a new loan type, a new screen, a change to the database
or the summary endpoint), please open an issue first so we can agree on the
shape before you spend time on it.

## Ground rules

- **Read-only toward Actual.** Nothing in the tracker may create, change or
  delete anything in a budget. `src/server/actual.ts` is the only file that
  talks to `@actual-app/api`, and its interface has no write methods. Keep it
  that way.
- **Money is integer cents** everywhere: in the engine, the database and
  the API. Convert to dollars only for display and in the public summary.
- **The engine stays pure.** `src/engine` has no dependencies and no I/O.
  Every behavior change there comes with a unit test.
- **Made-up numbers only.** Tests, fixtures, screenshots, examples and
  issues must never contain real loan numbers, account numbers, names,
  addresses, sync IDs, passwords or tokens.
- **Never commit** `.env`, `data/`, `certs/` or `actual-data/`. They are in
  `.gitignore`; please don't force-add them.
- **Database changes are migrations.** Add a new numbered entry to
  `src/server/migrations.ts`; never edit one that has shipped. Migrations
  must be idempotent, and a test should prove existing data comes through
  unchanged.
- **The summary endpoint is a public contract.** Add fields freely, but
  never rename or remove one without bumping its `version`.

## Getting set up

You need Node 22.12+ (or only Docker: `./scripts/npm.sh` runs every npm
command inside the official Node image).

```sh
npm install
npm test             # unit and backend tests (no real Actual needed)
npm run typecheck
npm run build        # dist/server and dist/ui
```

Open `dist/ui/preview.html` after a build to see every screen with made-up
data (`?theme=dark`, `?empty`, `?privacy`, `?loan=2`).

To try it against a real Actual, point `.env` at a **test** Actual server
with a throwaway budget, set `COMPOSE_FILE` for your setup, then run
`docker compose up -d`.

## Making a change

1. Branch from `main`.
2. Keep commits small and focused, with a message that says what changed
   and why.
3. Run `npm test`, `npm run typecheck` and `npm run build` before you push.
   CI runs the same checks, and builds both Docker images, on every pull
   request.
4. If the change is visible, include a screenshot from the preview page.
5. Update the README when behavior, settings or the API change.

Write user-facing text in plain, short sentences. Avoid jargon where an
everyday word works, and say what the user should do next when something
goes wrong.

## Reporting bugs

Use the **Bug report** issue template. The most useful details are your
Actual version, which setup you use (existing Actual or bundled), the steps
to reproduce, and any `[asset-tracker]` line from the browser console.
Please remove anything personal from logs and screenshots first.

## Security

If you find a way to read loan data without an Actual login, or to make the
tracker write to a budget, please don't open a public issue. See
[SECURITY.md](SECURITY.md) for how to report it privately.
