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
- `/health` verifies D1. Checkout and webhook endpoints still return 404
  because `CHECKOUT_ENABLED` and `FULFILLMENT_ENABLED` are not set. Never set
  those flags until every remaining release gate below is satisfied.
- Ported code now includes D1 order creation/status, quote validation,
  opt-in recovery capture, Stripe PaymentIntent creation and signed webhooks,
  BookVault DocRef-safe submission/polling, customer receipt/shipping/refund
  emails, Stripe payment reconciliation, and guarded 24-hour refund handling.
  A five-minute scheduled sweep is inert while fulfillment is disabled.
- Unit and synthetic request tests cover the browser checkout contract,
  duplicate and mismatched webhooks, a paid order through receipt and
  BookVault acceptance, scheduled-payment drafts, and active-order refund
  refusal. These are **not** live-payment or live-BookVault acceptance tests.
- Analytics ingestion/summary, review unsubscribe/request scheduling, Resend
  purchaser contacts, and a PII-stripped report snapshot are now staged. A
  local Cloudflare-runtime smoke test passed with fake provider keys and a
  separate local D1 database; no live payment or print order was created.
- The report feed is closed until both an owner-installed bearer token and
  the known VPS egress IP match. A staging probe showed that trusting a
  client-supplied IP header alone is unsafe, so `REPORTS_ENABLED=false`.

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

Before private Content Studio reports can switch to D1, Harvey must run this
second **owner-only** command on the VPS. It generates and installs a new
report-only bearer token without printing it, leaves reporting switched off,
and does not affect live checkout:

```bash
sudo bash /srv/realitymanual-repo/storefront-worker/scripts/setup-report-auth.sh
```

The Project Manager agent must not run this credential-generation script.
After Harvey confirms it ran, verify secret **names only**, enable the
report feed, test the in-memory PII-stripped snapshot, and only then switch
`STOREFRONT_REPORT_SOURCE=worker` during the final controlled cutover.

See [FAILOVER.md](./FAILOVER.md) for the one-active-backend rule and temporary
cutover recovery plan. Harvey does not want a permanent redundant checkout.
The next real order still uses the VPS backend.

## Remaining release gates

1. Finish and test failure paths, retention, and authenticated Content Studio
   report access. All staged checkout, analytics, email, and report code remains
   disabled for production traffic; the report token owner step above remains.
2. Verify the scheduled D1 claim, retries, dispatch email, 24-hour deadline,
   and BookVault cost capture on Cloudflare's runtime with mocked providers.
   Never create a real charge or BookVault order merely to test.
3. Replace Content Studio's direct SQLite reads for Sales Analytics and Orders
   health with an authenticated read-only Worker report API; retain the
   Project Manager and inbound mailbox on the VPS.
4. Test staging with synthetic orders and mocked Stripe/BookVault/Resend
   providers. Never create a real charge or print order merely to test.
5. Before cutover, take a fresh consistent database snapshot and reconcile
   every payment/order since this staging copy. Route production traffic and
   the Stripe webhook only after all gates pass; keep a rollback route. Do
   not silently migrate against a stale snapshot or dual-write payments.

The VPS backend has a default-on `STOREFRONT_JOBS_ENABLED` handoff switch.
For the final data copy, pause new VPS checkout, set that switch false and
restart the backend before copying. The Worker prioritizes newly paid orders
over imported BookVault status polls. Do not set `FULFILLMENT_ENABLED=true`
on the Worker while the VPS jobs remain active for the same orders.

The existing `api.realitymanual.com` DNS A record is currently DNS-only.
Cloudflare Workers Routes require a proxied record. Harvey must change only
the Proxy status of that record in his dashboard; the scoped deployment
token cannot edit DNS. Turning proxy on alone leaves the VPS as the origin
until a Worker route is attached, so checkout need not switch at that step.

Run `npm test` in this directory for the current staging smoke tests.
