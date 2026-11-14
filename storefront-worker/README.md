# Storefront Worker migration (staging only)

This directory is the deliberately inert first stage of moving the Reality
Manual storefront backend off the VPS. The production API, Stripe webhook,
checkout, and BookVault worker still run at `api.realitymanual.com` on the VPS.
Do not point production traffic here yet.

## What is deployed

- Worker `rm-storefront-api-staging` at
  `https://rm-storefront-api-staging.harveymeale9.workers.dev`.
- D1 database `rm-storefront-staging` (a one-time copy of the live database,
  not a live replica). Keep all customer rows private.
- Existing R2 bucket `reality-manual-media`, with the current 83,530,009-byte
  VSL at the content-addressed `storefront/reality-manual-vsl-c1a7775e.mp4`
  key. The Worker serves `/media/reality-manual-vsl-1080p.mp4` with byte ranges.
- `/health` verifies D1. All other API routes deliberately return 404.
- `src/orderStore.js` is the first ported D1 component, with atomic payment
  state transitions. It is tested but not yet wired to a public route.
- `src/shipping.js` ports the live UK BookVault quote and fresh GBP/USD
  conversion; it is tested but not yet exposed as a staging route.
- `src/stripeClient.js` uses Stripe's fetch HTTP client, async Web Crypto
  webhook verification, and order-ID idempotency keys. It is tested but not
  connected to the public Worker yet.

## Owner-only credential step

Harvey must run this exact command in his VPS terminal:

```bash
sudo bash /srv/realitymanual-repo/storefront-worker/scripts/copy-live-secrets-to-staging.sh
```

The script reads the existing private `.env` and Cloudflare token and pipes
four secrets into the **staging** Worker without displaying values. The agent
must not execute this step or generate new credentials. No secret is committed
to Git. The script does not affect the live API or any other Worker.

Harvey ran this script on 2026-11-14; a names-only check confirmed all four
secrets are present in the staging Worker. Their values were not inspected.

See [FAILOVER.md](./FAILOVER.md) for the one-active-backend rule and the VPS
rollback plan. The next real order still uses the VPS backend.

## Remaining release gates

1. Port the checkout, shipping quote, Stripe webhook, order status, recovery
   consent, analytics, review unsubscribe, and transactional email routes to
   Workers/D1 with tests against real request/response contracts.
2. Port the durable BookVault fulfillment, Stripe reconciliation, dispatch
   polling, review-request, analytics aggregation, and pruning timers to
   scheduled Workers/Queues with atomic claims. Preserve the 24-hour
   paid-first policy, BookVault batch-payment handling, idempotent email and
   refund rules, and duplicate-payment protection.
3. Replace Content Studio's direct SQLite reads for Sales Analytics and Orders
   health with an authenticated read-only Worker report API; retain the
   Project Manager and inbound mailbox on the VPS.
4. Test staging with synthetic orders and mocked Stripe/BookVault/Resend
   providers. Never create a real charge or print order merely to test.
5. Before cutover, take a fresh consistent database snapshot and reconcile
   every payment/order since this staging copy. Route production traffic and
   the Stripe webhook only after all gates pass; keep a rollback route. Do
   not silently migrate against a stale snapshot or dual-write payments.

Run `npm test` in this directory for the current staging smoke tests.
