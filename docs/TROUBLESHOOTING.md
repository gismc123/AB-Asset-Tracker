# Troubleshooting

What to check when something doesn't work. Back to the [README](../README.md).

Work down the list. None of these steps touch your budget.

**`Bind for 0.0.0.0:5007 failed: port is already allocated`**
Something else is already using port 5007, often the add-on's own
containers from the other setup (A or B).
1. Make sure `.env` has the right `COMPOSE_FILE` for your setup, then run
   `docker compose up -d --remove-orphans`. That removes the leftover
   containers.
2. Still failing? See what holds the port:
   `docker ps --format '{{.Names}}\t{{.Ports}}' | grep 5007`. Stop that
   container, or set a different `PROXY_PORT` in `.env`.

**A second Actual container appeared (`...-actual-1`).**
`docker compose` ran setup B's file while you use setup A. Set
`COMPOSE_FILE=compose.existing-actual.yml` in `.env` and run
`docker compose up -d --remove-orphans`; the extra container is removed.
Your real Actual isn't affected. If an empty `actual-data/` folder was
created, you can delete it.

**The backend keeps restarting.**
Run `docker compose logs asset-tracker-backend | grep asset-tracker`.
- *"Missing required setting(s): ..."*: fill in the named settings in `.env`.
- *"... is not a known timezone"* or *"PORT must be ..."*: fix that setting.
- *"Authentication failed"*: check `ACTUAL_PASSWORD` and `ACTUAL_SERVER_URL`.
- *Certificate errors* (`self-signed certificate`, `unable to verify`): see
  [Actual uses a self-signed certificate](../README.md#actual-uses-a-self-signed-certificate).
- *"out-of-sync" / migration / version errors*: your Actual is newer than
  the API package; see [Compatibility](COMPATIBILITY.md).

**Loans is missing from the sidebar.**
1. Make sure you're on the proxy port (`:5007`), not Actual's (`:5006`).
   Through a Cloudflare Tunnel or reverse proxy, check that it points at
   port 5007.
2. Hard-reload the page (Ctrl+Shift+R / Cmd+Shift+R). Actual caches its page,
   and the first load after an update can be the old copy.
3. Make the window wider: Actual's mobile layout has no sidebar.
4. Open the browser console (F12 → Console) and look for `[asset-tracker]`.
   - *"Could not find a sidebar link to attach to"*: Actual changed its page
     layout. Actual itself is fine. Please
     [open an issue](https://github.com/gismc123/AB-Asset-Tracker/issues) with
     your Actual version and that line.
   - No `[asset-tracker]` lines at all: the script wasn't added. Check that
     the proxy is running (`docker compose ps`) and that
     `https://<this-machine>:5007/asset-tracker-addon/inject.js` loads.

**"Log in to Actual to see your loans."**
Log out of Actual and back in through the proxy port. The tracker uses the
same login.

**"Can't read from Actual right now"** on the loan screens.
The backend lost its connection to Actual. Check the backend log (see
above). Deleting `data/actual-cache/` and restarting the backend forces a
fresh download of the budget; your loan data isn't affected.

**Behind Cloudflare: a `502 Bad Gateway` or *Bad gateway* error page.**
`cloudflared` can't reach the add-on.
- Check the tunnel's service type matches `PROXY_TLS`: `HTTP` with
  `PROXY_TLS=off`, `HTTPS` with **No TLS Verify** with `PROXY_TLS=on`.
  An `HTTPS` service with `PROXY_TLS=off` (or the other way round) fails.
- With `PROXY_PORT=127.0.0.1:5007`, `cloudflared` has to run on this same
  machine and use `localhost`. If it runs in Docker without host
  networking, or on another machine, set `PROXY_PORT=5007` and use this
  machine's network address.

**Actual says it needs HTTPS, or the page stays blank, on `http://<this-machine>:5007`.**
With `PROXY_TLS=off` the add-on serves plain HTTP for a tunnel or reverse
proxy, and Actual doesn't run on plain `http://` addresses. Open it through
your Cloudflare name instead, or set `PROXY_TLS=on` to use it at home too.

**Actual shows a 502 page through the proxy.**
Actual is down or still starting. Check `docker ps` and Actual's own logs.
Going straight to Actual's port tells you whether the problem is Actual or
the proxy.

**The numbers don't match my statement.**
Compare one month on the Schedule screen. A one-cent split difference is
what the payment override and penny offset are for. Reconciled months are
locked to what you matched, and daily-interest loans use the date your bank
paid. Check the interest method, the rate (the note rate, not the APR), and
the first payment date.
