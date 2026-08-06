# Security notes

This repository is a demo.

Do not commit:

- `.env`
- Stripe secret keys
- MPP signing secrets
- Tempo private keys
- production payment credentials
- customer data

The browser buttons use server-side demo payer credentials so the flows can be shown without a wallet extension or terminal. Remove `/api/stream-stripe`, `/api/stream-tempo`, and all payer credentials before exposing the service publicly.

For production, use Fastly Secret Store, Config Store, a durable session-state service, strict spending limits, challenge binding, replay protection, and payment-provider controls appropriate for your application.
