# Storefront cutover and recovery rules

## Current state

The VPS backend at `api.realitymanual.com` is the **only active checkout**.
The Cloudflare Worker is staging-only and returns 404 for payment creation.
The next real order therefore uses the existing VPS path. Keep that container,
database, Stripe webhook, and BookVault worker running throughout migration.

## Safe cutover and short-term rollback

There must be exactly one backend accepting **new** payment-intent creation at
any time. Do not add a browser or edge-proxy rule that automatically sends a
timed-out `create-payment-intent` or `confirmPayment` request to the other
backend. A timeout does not prove Stripe did nothing, and the two databases
would not automatically know about each other's in-flight orders.

Before changing the active route:

1. Stop new checkout attempts briefly and display a clear no-charge message.
2. Reconcile pending Stripe PaymentIntents and every paid order on the active
   backend. Preserve order UUIDs and BookVault DocRefs; do not submit another
   print order just because a status response was lost.
3. Copy the final database delta to the target and compare order counts,
   payment-intent IDs, payment states, fulfillment references and email flags.
4. Confirm the Stripe webhook target and fulfillment worker on the new primary
   before reopening checkout. Keep the old primary available for already-paid
   work until its queue is drained or explicitly transferred.

If the Worker fails **before** a payment attempt, pause checkout and diagnose.
During the short cutover period, a controlled switch of new checkouts back to
the VPS is possible only after the same reconciliation.
If a payment attempt is uncertain, first look up its order/PaymentIntent in
Stripe and the active ledger; show the customer a “do not pay again” status
message rather than sending a second payment request. If the Worker fails
**after** payment, use the original order ID to recover its fulfillment;
never create a second Stripe charge or BookVault DocRef as a fallback.

Harvey does not want a permanent redundant checkout. Keep the VPS deployment
temporarily through the first verified Worker orders and until its outstanding
paid-order jobs have drained or been transferred. Verify payment, receipt,
BookVault scheduled payment/acceptance, dispatch email, and reporting before
retiring it. After that, an outage should pause checkout and trigger repair;
do not maintain an unsynchronized VPS copy as a pretend hot failover.
