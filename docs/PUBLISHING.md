# Publishing checklist

Nothing in this file has been applied. These are suggestions for the
maintainer to review and run by hand.

## Repository

- **Suggested name:** `AB-Asset-Tracker` (renamed from `AB-Mortgage-Tracker`;
  GitHub redirects the old URL after a rename).
- **Suggested description:**
  > Loans and assets for a self-hosted Actual Budget: mortgages, car and
  > personal loans, amortization, equity and monthly reconciliation. A
  > read-only add-on; Actual itself is never modified.
- **Suggested topics:** `actual-budget`, `loans`, `mortgage`,
  `amortization`, `self-hosted`. Optional extras: `personal-finance`,
  `docker`, `equity`.
- **Website field:** leave empty, or link the README's screenshots section.

## Before making it public

1. Review the `feature/multi-loan` branch and merge it into `main`.
2. Rename the repository to `AB-Asset-Tracker` (the README's clone command
   and issue links already use that name, and the local `origin` remote
   already points there).
3. Git history: the author name and email on existing commits were left as
   they are (decision in `docs/DECISIONS.md`). No secrets, private IPs,
   sync IDs or addresses were found in the history.
4. Check that `.env`, `data/`, `certs/` and `actual-data/` are not tracked:
   `git ls-files .env data certs actual-data` should print nothing.

## Commands (for reference, not run)

```sh
# rename and describe the repository
gh repo rename AB-Asset-Tracker
gh repo edit --description "Loans and assets for a self-hosted Actual Budget: mortgages, car and personal loans, amortization, equity and monthly reconciliation. A read-only add-on; Actual itself is never modified."
gh repo edit --add-topic actual-budget --add-topic loans --add-topic mortgage --add-topic amortization --add-topic self-hosted

# make it public (irreversible in practice: forks and clones can't be recalled)
gh repo edit --visibility public --accept-visibility-change-consequences

# tag and release
git tag -a v0.1.0 -m "AB Asset Tracker v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --title "AB Asset Tracker v0.1.0" --notes-file RELEASE_NOTES_v0.1.0.md
```
