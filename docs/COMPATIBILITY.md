# Compatibility

Which versions of Actual the tracker works with. Back to the [README](../README.md).

| Component | Tested with |
|---|---|
| Actual server | `actualbudget/actual-server` **26.10.0** |
| `@actual-app/api` | **26.10.0** (pinned in `package.json`) |
| Node.js (backend image) | 22 (`node:22-bookworm-slim`) |
| nginx (proxy image) | 1.27 (`nginx:1.27-alpine`) |
| Browsers | Current Chrome, Firefox and Safari (desktop layout) |

Keep `@actual-app/api` on the same version as your Actual server. If a newer
Actual gives *"out-of-sync"* or version errors in the backend log, set
`@actual-app/api` in `package.json` to your Actual's version (shown at the
bottom of Actual's login screen), run `./scripts/npm.sh install`, then
`docker compose up -d`.
