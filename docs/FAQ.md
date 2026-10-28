# FAQ

Answers to common questions about AB Asset Tracker. Back to the [README](../README.md).

## General

**Does this change my Actual budget?**
No. The tracker only reads categories and transactions. It never creates,
changes or deletes anything in your budget, and Actual's own files and
container aren't modified.

**Is this an official Actual Budget project?**
No. It's a community add-on that works with Actual. Please report problems
with it here, not to the Actual project.

**Do I have to change any Actual settings?**
No. You just open Actual through the add-on's port (5007) instead of
Actual's own (5006).

**Can I still use Actual directly on port 5006?**
Yes, Actual keeps working there, just without the Loans section. Only the
proxy port shows it.

**Does it work in Actual's phone layout or the desktop app?**
No. It needs Actual's desktop web layout in a browser (the sidebar is where
it lives). On a narrow window or a phone, Actual switches to its mobile
layout and Loans is hidden. The Actual desktop app doesn't load pages
through the proxy, so it doesn't show Loans either.

**Does it work on a Raspberry Pi?**
Yes. It's developed and tested on one. The first build takes a few minutes.

**Can I track more than one budget?**
One install reads one budget (one Sync ID). For a second budget, clone the
project into a second folder, give it its own `.env` with a different
`PROXY_PORT`, and start it there.

**Which countries does it work for?**
Amounts are shown in dollars with two decimals, and the PMI rules are U.S.
rules. The loan math itself (amortization, interest, fees, equity) works for
any fixed-rate loan with monthly payments.

**How do I support the project?**
Star it on GitHub, report bugs, or help fund it on
[Patreon](https://patreon.com/IvanS1123). See
[Support the project](../README.md#support-the-project).

## Data, privacy and backups

**Where is my loan data stored?**
In `data/` inside this folder, in a SQLite file, `asset-tracker.sqlite`. Nothing is stored in Actual.

**Is any of my data sent anywhere?**
No. The tracker talks only to your own Actual server. It has no analytics
and makes no other outside connections.

**Who can see my loans?**
Anyone who can log in to your Actual server through the proxy port. The
tracker checks every request against Actual's own login. With Actual's
multi-user (OpenID) login, that means every user sees every loan.

**How do I back up and restore?**
Click **Backup** next to the loan tabs, then *Download backup*. To restore,
pick the file under *Restore* on the same screen. See
[Backing up and restoring](../README.md#backing-up-and-restoring), which also covers the
command line. Back up Actual separately (*Settings → Export data*).

You can also copy the whole `data/` folder. Stop the backend first so the
database is quiet:

```sh
docker compose stop asset-tracker-backend
cp -r data /somewhere/safe/tracker-backup
docker compose start asset-tracker-backend
```

To restore that copy, stop the backend, replace `data/` with it, and start
it again.

**What are the `.backup-before-restore-...` files in `data/`?**
The data a restore replaced, saved just before it. To undo a restore, stop
the backend, move your database (`asset-tracker.sqlite`, plus
any `-wal` and `-shm` files beside it) out of `data/`, copy the `.backup-before-restore-...` file in under the
database's name, and start the backend again. Delete these files once
you're happy.

**What are the `.backup-v...` files in `data/`?**
Automatic copies made before an update changed the database layout. Keep
them until you've checked the update went well, then delete them if you
like.

**Can I delete `data/actual-cache/`?**
Yes. It's the tracker's downloaded copy of your budget, fetched again on the
next start. Your loan data isn't in it.

## Loans

**Which kinds of loans can I track?**
Mortgages, auto loans and personal loans. Any other fixed-rate loan with
monthly payments (student loan, boat or RV loan, equipment loan) works as a
*personal loan*; add an asset to it if it paid for something with a resale
value.

**I've been paying on my loan for years. Do I have to enter every payment?**
No. Enter the original terms, tick *Already paying on this loan?*, and enter
your last payment date and balance from a recent statement. See
[A loan that's already under way](../README.md#a-loan-thats-already-under-way).

**My statement's payment is a cent different from the calculated one.**
Type the statement's exact principal-and-interest amount into the payment
field under Setup. For a one-off cent of difference in the split, use the
penny offset on that month.

**How do I know if my loan uses daily interest?**
Your loan agreement says "simple interest" or describes interest accruing
daily. Many car and personal loans do; most mortgages don't. If you're not
sure, start with monthly; if your statements' interest changes when you pay
early or late, switch to daily.

**I pay every two weeks.**
Only monthly schedules are supported. If your lender collects biweekly but
applies it monthly, reconcile the month against one combined transaction; a
true biweekly schedule isn't modeled.

**My rate changes (an ARM) or I refinanced.**
Rate changes can't be modeled. After a refinance, archive the old loan and
add the new one (use *Already paying on this loan?* if you set it up late).

**I made an extra principal payment as its own transaction.**
Match the regular payment as usual, then record the extra as *extra
principal* with that month or the next one. On a daily-interest loan that
charges a few days more interest than your lender does; see
[Known limitations](KNOWN_LIMITATIONS.md).

**My bank splits the payment into principal, interest and escrow categories.**
Keep the whole loan payment in one category in Actual (one transaction, or a
split whose loan lines all use the same category). The tracker only looks at
the category you pick, so a payment spread over several categories won't
match.

**Why does my car still show its purchase price?**
Equity uses the latest value you entered. Add one on the Vehicle screen from
a pricing guide now and then. The *projected today* figure is only an
estimate based on the yearly drop you set.

**Can a home equity loan and a mortgage share the same home?**
Not yet. Each asset belongs to one loan, so combined equity across two
loans on the same home isn't calculated. Track the second loan as a
personal loan without an asset.

**What's the difference between archive and delete?**
Archive hides a loan (paid off, sold, refinanced) and keeps its history; you
can unarchive it any time. Delete removes the loan and everything recorded
for it, and can't be undone.

## Setup and networking

**Can I use a port other than 5007?**
Yes. Set `PROXY_PORT` in `.env` and run `docker compose up -d`.

**Actual runs on another machine.**
Set `ACTUAL_SERVER_URL` and `ACTUAL_UPSTREAM` to that machine's address, e.g.
`https://192.0.2.10:5006`, and use setup A. The add-on can run anywhere that
can reach Actual.

**Can I put it behind my own reverse proxy (Caddy, Traefik, Nginx Proxy Manager)?**
Yes. Point your reverse proxy at port 5007 instead of at Actual. Either set
`PROXY_TLS=off` and use `http://<this-machine>:5007`, or keep HTTPS and tell
the reverse proxy not to verify the add-on's self-signed certificate. Keep
WebSocket support on, as for Actual. See
[Behind a Cloudflare Tunnel or another HTTPS proxy](../README.md#behind-a-cloudflare-tunnel-or-another-https-proxy).

**I use a Cloudflare Tunnel, and Cloudflare manages the certificate.**
Point the tunnel at the add-on's port instead of Actual's, and set
`PROXY_TLS=off`. Step by step:
[Behind a Cloudflare Tunnel or another HTTPS proxy](../README.md#behind-a-cloudflare-tunnel-or-another-https-proxy).

**Can I reach it remotely (VPN, Tailscale, Cloudflare Tunnel)?**
Yes, the same way you reach Actual: use the proxy port (5007) instead of
Actual's. For a tunnel or anything else that handles HTTPS for you, see
[Behind a Cloudflare Tunnel or another HTTPS proxy](../README.md#behind-a-cloudflare-tunnel-or-another-https-proxy).

**I see a certificate warning every time.**
That's the self-signed certificate. Accept it once per browser, or
[use a real certificate](../README.md#use-a-real-certificate).

## Updates

**How do I update?**
`git pull` then `docker compose up -d --remove-orphans`. See [Update](../README.md#update).

**Will updating Actual break it?**
Normally not: Actual runs from its own unchanged image. The sidebar item
depends on Actual's page layout, so after a big Actual release, reload the
page once and check that Loans is still there. If it isn't, see
[Troubleshooting](TROUBLESHOOTING.md).

**Does an update ever touch my data?**
Only the tracker's own database, and only when an update changes its layout.
A copy of the old database is always saved first.
