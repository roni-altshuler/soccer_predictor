# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for anything that could
put users or data at risk.

- Use GitHub's [private vulnerability reporting](https://github.com/roni-altshuler/soccer_predictor/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email the maintainer at `shenorrlab@technion.ac.il` with `[SECURITY]` in the subject.

Please include: a description, reproduction steps or a proof of concept, the affected
route/component, and the potential impact. We aim to acknowledge reports within **5 business days**
and to provide a remediation timeline after triage.

## Supported versions

This is a single actively-developed application deployed from `main`. Only the latest `main` is
supported; fixes are rolled forward rather than backported.

## Scope

In scope: the application code in this repository (Next.js frontend, FastAPI backend, API routes,
CI workflows).

Out of scope: vulnerabilities in third-party providers (ESPN, FotMob, FBref, etc.), and findings
that require a compromised developer machine or privileged local access.

## Secrets & configuration

- **No secrets in the repo.** Configuration is via environment variables (e.g. `DATABASE_URL`,
  `ODDS_API_KEY`, `THE_ODDS_API_KEY`, `NEXT_PUBLIC_SITE_URL`). Never commit `.env*` files or keys.
- Server-only secrets must **not** use the `NEXT_PUBLIC_` prefix (that exposes them to the client
  bundle). Only non-sensitive, client-safe values may use it.
- The committed `backend/data/predictions/*.json` contain model predictions only — no PII.

## Handling third-party data

Pitchverse reads public endpoints (ESPN/FotMob/etc.). Per project convention, provider fields are
never synthesized or placeholdered; missing data is omitted and labelled via `DataSourceBadge`.
Licensed odds ingestion stays disabled unless a provider key is configured, and is used only for
audit-only no-vig calibration comparison — never for betting advice.

## Disclosure

We follow coordinated disclosure: please give us a reasonable window to ship a fix before any
public write-up. Credit is offered to reporters who wish to be acknowledged.
