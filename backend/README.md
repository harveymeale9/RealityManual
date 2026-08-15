# Reality Manual — Backend

Node/Express API for realitymanual.com: shipping calculation, Stripe
PaymentIntents, order storage, Stripe webhook handling. SQLite (via
`better-sqlite3`) is the database — a single file, no server to run.

**Phase status:** this is Phase 1 (core paid flow). Lulu fulfillment,
first-party analytics, SEO admin, refunds, and the `/admin-dashboard` are
not built yet — see the "Deferred" note at the bottom.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` —
  get these from the Stripe Dashboard in **Test mode**
  (dashboard.stripe.com/test/apikeys). Never put live keys here during
  development.
- `CORS_ORIGIN` — the origin serving `/frontend` locally (e.g.
  `http://localhost:5500` for VS Code Live Server, or whatever
  `npx serve frontend` prints).
- `LULU_*` — leave blank for now; unused until the fulfillment phase.

## Database

No separate install step — the SQLite file is created and the schema
applied automatically the first time the app touches the DB. To run this
explicitly (and seed placeholder shipping rates) without starting the
server:

```bash
npm run db:migrate
```

This creates `backend/data/reality-manual.db`. It's gitignored — don't
commit it.

**Shipping rates are seeded with a flat $9.99 placeholder for every
country** (see `src/db/seedShippingRates.js`) purely so checkout is
testable end-to-end. These are not real Lulu-derived rates — update the
`shipping_rates` table with real values before going live:

```bash
sqlite3 backend/data/reality-manual.db \
  "UPDATE shipping_rates SET price_usd_cents = 650 WHERE country_code = 'US';"
```

(An Admin Dashboard shipping editor is planned for a later phase so this
won't require raw SQL going forward.)

## Running locally

```bash
npm start
```

Boots on `PORT` (default `4000`). Visit `http://localhost:4000/health` to
confirm it's up.

Then serve `/frontend` with any static file server, e.g.:

```bash
npx serve ../frontend
```

and make sure `frontend/js/config.js` → `API_BASE_URL` points at your
backend (`http://localhost:4000` by default) and `CORS_ORIGIN` in
`backend/.env` points back at wherever that static server is running.

## Testing the Stripe flow locally

You need the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward
webhooks to your machine:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Copy the `whsec_...` value it prints into `STRIPE_WEBHOOK_SECRET` in
`.env` and restart the server.

Walk the flow: landing page → Buy → checkout → pick a country → confirm the
shipping/total update → pay with Stripe's test card `4242 4242 4242 4242`
(any future expiry, any CVC, any ZIP) → you should land on `/confirmation`
and see it flip from "confirming your payment" to "Payment confirmed"
within a couple of seconds once the webhook lands.

To test a declined payment, use test card `4000 0000 0000 0002`.

## API surface (this phase)

- `POST /api/shipping/calculate` — `{ country_code }` → server-calculated
  book price / shipping / total (cents). The browser never sets these.
- `POST /api/checkout/create-payment-intent` — validates the full shipping
  form (including Lulu's 30-character name/street limits), creates the
  order row, creates a Stripe PaymentIntent, returns `client_secret`.
- `POST /api/webhooks/stripe` — Stripe-signed webhook, handles
  `payment_intent.succeeded` / `payment_intent.payment_failed`
  idempotently.
- `GET /api/orders/:id/status` — public, non-PII status polling endpoint
  for the confirmation page.

## Order status values (this phase)

```
PAYMENT_PENDING   order created, awaiting Stripe payment
PAYMENT_RECEIVED  Stripe webhook confirmed payment_intent.succeeded
FAILED            Stripe webhook reported payment_intent.payment_failed
```

`LULU_PENDING`, `COMPLETE`, and `REFUNDED` are added when the Lulu
integration phase starts — the `orders` table already has the
`lulu_order_id` column reserved so no migration will be needed then.

## Deferred to later phases

Lulu print job submission + webhook, first-party analytics
ingestion/reporting, SEO admin, `/admin-dashboard` (auth, orders view,
shipping editor, site settings, error log viewer), Stripe refunds.
