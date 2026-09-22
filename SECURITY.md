# Security policy

## Report a security issue

Do not open a public GitHub issue for a suspected vulnerability.

Report security issues privately through [Fastly's security issue reporting process](https://www.fastly.com/security/report-security-issue). Include the affected version or commit, reproduction steps, impact, and any suggested remediation. The project team will review the report and coordinate remediation and disclosure with affected parties.

Security reports are handled separately from normal bug reports and feature requests.

## Security updates

Security fixes are prioritized by the project team and released on a best-effort basis under the project's [Tier 2 support policy](SUPPORT.md). Updates and disclosures will be published through GitHub releases and GitHub security advisories when appropriate.

This repository is a demonstration and is not a production payment proxy. Before exposing a derived service publicly:

- Store private keys, Stripe secrets, MPP signing secrets, and Fastly API tokens in Fastly Secret Store.
- Remove the server-side payer helpers at `/api/stream-stripe` and `/api/stream-tempo`.
- Replace the sequential KV adapter with an atomic session-state implementation.
- Add replay controls, request binding, budgets, timeouts, rate limits, and appropriate payment-provider controls.

Never commit `.env` files, credentials, private keys, tokens, customer data, or production payment information.
