# AB Asset Tracker v0.2.3

Two fixes: account names in Actual's sidebar no longer change size while
a loan is open, and the loan screens no longer show a connection error
after Actual is back up.

## Fixed

- **Account names in the sidebar keep their look while a loan is open.**
  If you opened **Loans** while viewing an account, that account (and
  *All accounts*) was drawn in the larger, bolder font of Actual's main
  menu and shifted to the right, and *Loans* itself turned small. The
  sidebar now looks exactly as Actual draws it, with only *Loans*
  highlighted, and everything goes back when you leave the loan screens.
- **No more false "Can't read from Actual right now" after a restart.**
  When the machine running Actual and the tracker restarted, the tracker
  could try to reach Actual a few seconds before Actual was ready. The
  loan screens then kept showing *Authentication failed: network-failure*
  even though Actual was working. The tracker now keeps trying in the
  background after it starts, and checks again each time a loan screen
  loads, so the message only appears when Actual really can't be reached.

## Upgrading from v0.2.2

1. **Back up first.** Open **Loans**, click **Backup**, and **Download
   backup**.
2. Update as usual, from the `ab-asset-tracker` folder:
   ```sh
   git pull
   docker compose up -d --remove-orphans
   ```

There are no database changes, and nothing you've already reconciled
changes. To go back to v0.2.2, check out the `v0.2.2` tag and rebuild.

The summary endpoint is unchanged (still version 2, same fields).

Release notes for earlier versions are in
[past-releases/](https://github.com/gismc123/AB-Asset-Tracker/tree/main/past-releases).

## Compatibility

Built and tested against `@actual-app/api` 26.10.0 and Actual 26.10.0,
the same as v0.2.2.

## Known limitations

See [docs/KNOWN_LIMITATIONS.md](https://github.com/gismc123/AB-Asset-Tracker/blob/main/docs/KNOWN_LIMITATIONS.md).
Amounts are still shown in US dollar format whatever your budget's
currency; following Actual's currency setting is planned (see
[docs/ROADMAP.md](https://github.com/gismc123/AB-Asset-Tracker/blob/main/docs/ROADMAP.md)).
