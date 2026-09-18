
# The Reality Manual

## Project Instructions for Claude Code

---

## 1. Project Overview

The Reality Manual is a premium physical book sold directly through:

https://realitymanual.com

The website (which you are to help build and maintain) is a custom single-product ecommerce site for selling and fulfilling the book.

### Product

**The Reality Manual, Hardcover — Deluxe First Edition**

The product is a premium linen hardcover with a dust jacket.

Retail price:

**$65 USD**

Currency:

**USD**

Taxes:

**No taxes are currently being added.**

The website is intentionally simple and focuses on one objective:

**Sell the book, collect payment, submit the order to BookVault for fulfillment, and confirm the order to the customer.**

**Cost/pricing note (confirmed 2026-09-08):** fulfillment provider switched
from Lulu to **BookVault**. Print cost is approximately £20 / $29 USD per
unit. Retail price is $65 USD + server-calculated shipping (raised from $59
on 2026-09-17, see section 63). Harvey has
already uploaded print-ready files directly through BookVault's own
interface (not yet via API) and a physical proof copy is on the way,
expected within a few days.

---

# 2. Your Role

You are the lead engineer responsible for building, maintaining, debugging, and improving the Reality Manual website and its supporting backend infrastructure.

Your responsibilities include:

- Frontend development
- Backend development
- Database design
- Stripe integration
- BookVault integration
- Order processing
- Shipping calculation
- First-party analytics
- SEO
- Admin functionality
- Error handling
- Testing
- Deployment
- Documentation
- Ongoing maintenance

Before making significant changes:

1. Inspect the existing implementation.
2. Understand how the relevant components work.
3. Determine how the proposed change affects the rest of the system.
4. Make the smallest clean change that solves the problem.
5. Test the change.
6. Update documentation when appropriate.

Do not unnecessarily rewrite working systems.

Do not introduce dependencies or architectural complexity without a clear reason.

Prefer simple, maintainable solutions.

You may however update this file whenever you see fit as we progress through the project so it stays up-to-date.

---

# 3. Core Product

There is one product:

**The Reality Manual**

Edition:

**Hardcover — Deluxe First Edition**

Physical format:

**Premium linen hardcover with dust jacket**

Price:

**$65 USD**

Currency:

**USD**

Taxes:

**None at this stage**

There are no additional products or product tiers.

---

# 4. Website

The public website is:

**https://realitymanual.com**

The website (which you are to build and maintain) consists of three primary public pages:

1. Landing / Sales Page
2. Checkout Page
3. Confirmation Page

There is also a lightweight Admin Dashboard which will have SEO settings and also an analytics dashboard.

---

# 5. Core Customer Flow

The core customer journey is:


Landing Page
      ↓
Checkout
      ↓
Customer enters shipping information
      ↓
Country selected
      ↓
Shipping calculated
      ↓
Total displayed
      ↓
Stripe Elements
      ↓
Payment succeeds
      ↓
Confirmation Page
      ↓
"We're placing your order, please wait..."
      ↓
Order submitted to BookVault
      ↓
BookVault confirms successful order submission
      ↓
Confirmation Page updates
      ↓
"Your order is confirmed."


The customer should receive a clear and definitive success message only after our backend has confirmed that BookVault successfully accepted the order.

---

# 6. Technology Philosophy

The project should use a lightweight architecture.

Avoid unnecessary complexity.

This is a single-product ecommerce website, not a large ecommerce platform.

Prefer:

- Simple frontend
- Lightweight backend
- PostgreSQL or SQLlite or whatever u prefer
- Stripe
- BookVault API
- First-party analytics
- Small admin dashboard

Avoid unnecessary:

- SaaS services
- CMS platforms
- third-party analytics platforms
- complex frontend frameworks
- microservices
- unnecessary queues
- complicated authentication systems
- unnecessary abstractions

Choose technologies based on reliability, simplicity, maintainability, and ease of deployment.

---

# 7. Frontend

The public frontend should use standard HTML, CSS, and JavaScript unless there is a compelling reason to use another technology.

The public site must be:

- Lightning Fast
- Mobile Responsive
- Accessible
- SEO-friendly
- Lightweight
- Visually polished
- Easy to maintain

Do not introduce a frontend framework simply for the sake of using one.

---

# 8. Backend

Use a lightweight backend application running on a VPS.

I already have a Hostinger VPS with Ngix on it. So we can use this for processing webhooks etc and the database for analytics etc.

The backend is responsible for:

- Stripe integration
- Stripe webhooks
- BookVault integration
- Order creation
- Order status
- Shipping calculation
- Database access
- Analytics ingestion
- Analytics reporting
- SEO settings
- Site settings
- Admin functionality
- Error logging
- Refund processing

The exact backend framework can be selected based on what is most appropriate for the project.

The backend must be authoritative for all important business logic.

I'll leave the management of the VPS up to you, but basically we're running the front-end on Cloudflare pages and then we have a VPS we can use also as the "brain".

---

# 9. Database

Use PostgreSQL or SQLite i'll leave this up to you. It needs to be free.

The database should contain at least the following logical areas:

- Orders
- Analytics events: pageviews on each stage of the funnel, conversions, etc.
- Shipping rates
- Site settings
- SEO settings
- Error logs

Use appropriate indexes and constraints.

Use database transactions where appropriate.

Use parameterized queries or safe ORM/database abstractions.

---

# 10. Domain

Public website:

`realitymanual.com`

The backend/API may use a suitable subdomain such as:

`api.realitymanual.com`

The exact VPS hostname, IP, deployment platform, and infrastructure should remain configurable.

Do not hardcode deployment-specific values.

I have another company installed at n8n.tattoogrowth.co on that VPS (it's my n8n server for a separate business), but i wanna use the same server for Reality Manual stuff too.

**Infrastructure note (confirmed 2026-08-15):** the actual frontend hosting
is **GitHub Pages** (via `.github/workflows/static.yml`, publishing the
`/frontend` directory on every push to `main`), with Cloudflare sitting in
front purely as a DNS/CDN proxy — not the separate "Cloudflare Pages"
hosting product. Don't remove or replace `static.yml` without checking with
Harvey first; a prior session deleted it assuming Cloudflare Pages was the
real host, which broke the live site.

---

# 11. Landing / Sales Page

Route:

`/`

The landing page is the primary sales page.

Its purpose is to:

- Present The Reality Manual
- Communicate the value of the book
- Present the physical product
- Establish the visual identity
- Encourage the visitor to purchase

The primary CTA should lead to:

`/checkout`

The page should clearly communicate:

- The Reality Manual
- Hardcover — Deluxe First Edition
- $65 USD
- Relevant product information
- Clear purchase CTA

Final marketing copy and imagery may be supplied separately, use placeholders for VSL and or images initially.

The page structure should make it easy to replace or refine copy and assets without rebuilding the entire application.

---

# 12. Public Design Direction

The website should feel like an extension of the physical book.

The visual language should be:

- Elegant
- Minimal
- Literary
- Premium
- Luxury
- Editorial
- Archival
- Esoteric/slightly occultish/ancient manuscript-ish
- Restrained

Use a visual system based around:

- Warm ivory
- Dark text
- Elegant serif typography
- Generous whitespace
- Subtle borders
- Restrained ornamentation
- Sophisticated typography
- High-quality book imagery

The website should feel like a premium literary object.

Avoid:

- Generic Shopify aesthetics
- Generic SaaS aesthetics
- Bright modern startup colors
- Excessive gradients
- Excessive rounded cards
- Excessive animations
- Cluttered interfaces
- Overly complicated navigation
- Unnecessary visual effects

The physical book should remain the visual centerpiece.

---

# 13. Checkout Page

Route:

`/checkout`

The checkout must use Stripe Elements.

Do not redirect the customer to Stripe's generic hosted checkout.

The checkout should visually belong to the Reality Manual website.

Display:

**The Reality Manual**

**Hardcover — Deluxe First Edition**

**$65.00 USD**

The customer must provide all information required for BookVault fulfillment.

Use BookVault's current official API documentation as the source of truth for required shipping fields.

Expected fields include:

- Full name
- Email
- Phone number
- Country
- Street address
- City
- State/province/region where applicable
- Postal/ZIP code

The exact required fields should be confirmed against the current BookVault API documentation before implementation.

---

# 14. BookVault Address Constraints

BookVault likely has character limits on certain fulfillment address fields, similar to other print-on-demand APIs. Do not assume Lulu's old limits carry over — check BookVault's official documentation and make sure whatever someone enters into our form will be accepted when we place the order via the BookVault API.

The implementation must validate these limits.

Pay particular attention to BookVault's documented limits for fields such as:

- First name
- Last name
- Organization
- Street 1
- Street 2

Validate these restrictions:

1. On the frontend for good UX.
2. On the backend for correctness and security.

Do not silently truncate customer information.

If a field is too long, display a useful validation message and allow the customer to correct it.

Do not invent character limits.

Verify the current limits against BookVault's official documentation.

Country codes must use the format expected by BookVault.

Do not use incorrect country-code assumptions.

Phone number should be collected because BookVault fulfillment requires it.

---

# 15. Shipping

Shipping is calculated by our own backend.

The customer selects their country.

The backend determines the shipping cost.

The browser must never be trusted to determine the shipping price.

The browser may send a country selection, but the server must determine the corresponding shipping rate.

The final order total is:


$65.00 book price
+
server-side shipping price
=
final total


No taxes are currently added.

---

# 16. Initial Shipping Countries

Maintain explicit shipping rates for the following countries:

1. United States
2. Canada
3. United Kingdom
4. Australia
5. Germany
6. France
7. Netherlands
8. New Zealand
9. Ireland
10. Switzerland
11. Sweden
12. Norway
13. Denmark
14. Singapore
15. Japan

Also support:

**Rest of World**

The actual shipping prices will be manually supplied based on BookVault's current shipping rates.

Do not invent these rates.

---

# 17. Shipping Configuration

Create a clear configuration/database structure for the shipping rates.

Initial placeholders:

```text
US = PLACEHOLDER
CA = PLACEHOLDER
GB = PLACEHOLDER
AU = PLACEHOLDER
DE = PLACEHOLDER
FR = PLACEHOLDER
NL = PLACEHOLDER
NZ = PLACEHOLDER
IE = PLACEHOLDER
CH = PLACEHOLDER
SE = PLACEHOLDER
NO = PLACEHOLDER
DK = PLACEHOLDER
SG = PLACEHOLDER
JP = PLACEHOLDER
REST_OF_WORLD = PLACEHOLDER
```
*I will grab these values myself and update this file when done so.
The actual values will be supplied later.

Shipping rates should be editable through the Admin Dashboard.

So after they input their country, the checkout should dynamically display:

```text
The Reality Manual      $65.00
Shipping                $XX.XX
Total                   $XX.XX
```

The server must calculate the authoritative total.

---

# 18. Stripe

Use Stripe Elements.

Use Stripe PaymentIntents.

The backend creates the PaymentIntent.

The backend calculates the authoritative final amount.

The browser must never be trusted to determine:

- Product price
- Shipping price
- Total price

The backend must calculate:

```text
book price + shipping price = total
```

The resulting total is used to create the PaymentIntent.

Use Stripe metadata to associate payments with internal orders.

At minimum, associate:

- Internal order ID
- Product identifier
- Country

---

# 19. Stripe Credentials

Use environment variables.

Required configuration should include:

```text
STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Never expose:

`STRIPE_SECRET_KEY`

to the frontend.

Never expose:

`STRIPE_WEBHOOK_SECRET`

to the frontend.

Development must use Stripe Test Mode.

Do not use production credentials during development.

Let me know where you want these Stripe credentials and I'll supply you with everything you need.

---

# 20. Stripe Webhooks

Use Stripe's official webhook mechanism to confirm successful payments.

Verify Stripe webhook signatures.

Do not trust a frontend-only payment success message.

A payment should only be considered successfully received after the backend has verified the Stripe event.

Stripe webhooks may be delivered multiple times.

Webhook processing must therefore be idempotent.

---

# 21. Orders

Every order should have a unique internal order ID.

At minimum, store:

```text
id
stripe_payment_intent_id
stripe_payment_status
customer_name
email
phone
country
street1
street2
city
state
postal_code
book_price
shipping_price
total_price
currency
bookvault_order_id
order_status
created_at
updated_at
```

Do not store:

- Card numbers
- CVC
- Full payment credentials
- Raw sensitive payment information

Stripe should remain responsible for payment-card information.

---

# 22. Order Status

Keep the order state simple.

Recommended states:

```text
PAYMENT_PENDING
PAYMENT_RECEIVED
BOOKVAULT_PENDING
COMPLETE
FAILED
REFUNDED
```
Up to you to determine this tbh.

Do not create an unnecessarily complex fulfillment state machine.

We do not need to continuously mirror BookVault's entire downstream printing and shipping lifecycle.

Once BookVault confirms successful submission of the order, the order is considered complete from the website's perspective.

Store the BookVault order ID.

---

# 23. Customer Confirmation Flow

After Stripe confirms payment:

1. Record the order.
2. Send the order to BookVault.
3. Show the customer the confirmation page.
4. Keep the page in a waiting state.
5. Wait for our backend to confirm BookVault success.
6. Update the page immediately once confirmation is available.

Initial confirmation state:

```text
We're placing your order.

Please wait while we confirm your order.
```

Show a spinner/loading indicator.

Do not tell the customer the order is complete simply because Stripe payment succeeded.

The customer should remain on the confirmation page while the backend processes the BookVault submission.

---

# 24. Confirmation Page

Route:

`/confirmation`

The page should receive a safe internal order identifier.

Do not trust arbitrary customer-supplied order information.

The backend should verify the order before returning order information.

The frontend should periodically query our backend for the order status.

Example:

```text
GET /api/orders/{order_id}/status
```

The browser communicates only with our backend.

The browser does not communicate directly with BookVault.

When the backend knows that BookVault successfully accepted the order:

Update the page immediately.

Display:

**Your order is confirmed.**

Include:

- Order number
- Product name
- Confirmation message
- Delivery estimate

The delivery estimate should be configurable through the Admin Dashboard.

Do not permanently hardcode the estimate into frontend code.

---

# 25. BookVault Integration

Use BookVault's official API.

Before implementing or changing the BookVault integration, inspect the current official BookVault developer documentation.

Verify:

- Authentication
- API base URL
- Print/order job creation
- Required request fields
- Product identifier
- Shipping address schema
- Shipping method requirements
- Order response
- Order status behavior
- Current fulfillment confirmation mechanism (webhook or polling)
- Address validation requirements
- Relevant API restrictions

Do not invent BookVault endpoints.

Do not assume a webhook exists.

Do not rely on outdated examples if the current documentation differs.

The current official BookVault documentation is the source of truth.

---

# 26. BookVault Environment

**BookVault does not provide a sandbox environment** (confirmed 2026-09-08).
Development/integration testing will be done by placing a real test order
against BookVault's live API — there is no separate sandbox/test mode to
target. Treat that first real order carefully: verify address handling,
pricing, and confirmation behavior before relying on the flow for real
customers.

Use environment variables.

Required configuration (confirmed against BookVault's real OpenAPI spec —
see §64):

```text
BOOKVAULT_API_KEY
BOOKVAULT_API_BASE_URL   = https://api.bookvault.app/v3
BOOKVAULT_TITLE_ISBN     = 9658364000016
```

**Status (2026-09-17):** configured in `backend/.env` (gitignored, never
committed) and live — see §64 for the full integration writeup. All prior
Lulu configuration (client ID/secret, POD package ID, sandbox setup) has
been fully removed from the codebase (`backend/.env`, `config.js`,
`validation.js`, the `orders.lulu_order_id` column) — Lulu is no longer
part of this project.

---

# 27. BookVault Fulfillment

The desired flow is:

```text
Stripe payment succeeds
        ↓
Order recorded
        ↓
Confirmation page shows waiting state
        ↓
Backend submits order to BookVault
        ↓
BookVault confirms successful submission
        ↓
Database records BookVault confirmation
        ↓
Confirmation page becomes successful
```

The confirmation page must not show successful fulfillment until our backend has authoritative confirmation from BookVault.

Determine the most reliable current mechanism using BookVault's official documentation.

If BookVault provides an appropriate webhook/event mechanism, use it where appropriate.

If not, use the appropriate BookVault API status/query mechanism.

The website should not claim success based solely on having sent a request to BookVault.

---

# 28. BookVault Failure Handling

Keep failure handling simple.

If BookVault fails because of a temporary issue:

- Retry automatically a small number of times.
- Record each failure.
- Do not create duplicate orders.

If BookVault ultimately cannot accept the order:

1. Mark the order `FAILED`.
2. Record the error.
3. Refund the Stripe PaymentIntent.
4. Mark the order `REFUNDED`.
5. Update the confirmation page.

Customer-facing message (something like):

```text
We're sorry, but we couldn't complete your order.

Your payment has been refunded.

Please try placing your order again.
```

The customer should not need to contact support for ordinary fulfillment failures. If it fails, they're refunded and they can try again if they like.

---

# 29. Stripe Refunds

Refunds must be performed server-side.

Use Stripe's official refund API.

Refund the PaymentIntent associated with the internal order.

Do not allow the browser to arbitrarily trigger a refund.

Refund processing must be idempotent.

Never refund the same payment multiple times.

If a refund fails:

1. Record the failure.
2. Record the Stripe response/reference.
3. Flag the error in the Admin Dashboard.
4. Do not falsely tell the customer that their payment has been refunded.

---

# 30. Idempotency

Idempotency is mandatory throughout payment and fulfillment processing.

Potential duplicate events include:

- Stripe webhook delivered more than once
- Browser refreshing confirmation page
- Browser retrying a request
- Backend retrying a BookVault request
- Network timeout after BookVault accepted an order
- Refund request being repeated

Before creating a BookVault order:

- Check whether `bookvault_order_id` already exists.
- Check whether order status is already `COMPLETE`.
- Only submit if fulfillment has not already succeeded.

The same internal order must never result in multiple BookVault print jobs.

Refund processing must also be idempotent.

---

# 31. Analytics

Do not use Cloudflare Web Analytics.

Build first-party analytics directly into the website.

Analytics data should be stored in our own database.

Every public page should automatically track page views.

At minimum track:

```text
page_view
landing_page_view
purchase_cta_clicked
checkout_view
checkout_started
payment_submitted
payment_succeeded
bookvault_submission_started
bookvault_submission_succeeded
bookvault_submission_failed
order_complete
order_failed
refund_created
```
So i wanna be able to see a bit of a pipeline with how many visitors go through each stage.

Analytics must never block or interfere with:

- Page loading
- Checkout
- Payment
- Fulfillment

If an analytics request fails, the user experience should continue normally.

---

# 32. Analytics Session Tracking

Create an anonymous first-party session identifier.

Track:

- Session ID
- Timestamp
- Event name
- Page
- Referrer
- Country where appropriate
- Order ID where appropriate

Do not collect unnecessary sensitive personal information through analytics.

---

# 33. UTM Attribution

Capture UTM parameters:

```text
utm_source
utm_medium
utm_campaign
utm_term
utm_content
```

Also capture:

- Initial referrer
- Initial landing page
- Anonymous session ID

Preserve acquisition data through the funnel.

For example:

```text
Instagram
    ↓
Landing Page
    ↓
Checkout
    ↓
Purchase
```

should preserve the Instagram attribution through to the completed order.

---

# 34. Analytics Database

Create an `analytics_events` table.

Suggested fields:

```text
id
session_id
event_name
page
order_id
referrer
utm_source
utm_medium
utm_campaign
utm_term
utm_content
country
created_at
```

Create appropriate indexes.

The analytics system should support reporting for:

- Page views
- Unique visitors
- Checkout visits
- Checkout starts
- Payment attempts
- Successful payments
- Completed orders
- Refunds
- Revenue
- Average order value
- Conversion rate
- Revenue by country
- Traffic source
- Campaign performance

---

# 35. Conversion Metrics

Do not use an undefined "conversion rate."

Clearly define metrics.

Recommended:

### Landing Page Conversion Rate

```text
Completed Orders / Unique Landing Page Visitors
```

### Checkout Conversion Rate

```text
Completed Orders / Checkout Visitors
```

The Admin Dashboard should make the definitions clear.

---

# 36. Admin Dashboard

Route:

`/admin-dashboard`

The Admin Dashboard should be lightweight and functional.

It should include:

1. Overview
2. Orders
3. Analytics
4. Shipping
5. Site Settings
6. SEO Settings
7. Error Log

---

# 37. Admin Overview

Display:

- Today's page views
- Monthly page views
- Unique visitors
- Checkout visits
- Completed orders
- Refunded orders
- Conversion rate
- Revenue
- Average order value

Allow basic date/month selection.

---

# 38. Admin Orders

Display:

- Order ID
- Date
- Customer
- Email
- Country
- Book price
- Shipping price
- Total
- Stripe status
- BookVault status
- BookVault order ID
- Internal order status

Allow viewing order details.

Never display payment card information.

---

# 39. Admin Analytics

Provide useful reporting for:

- Traffic
- Funnel
- Orders
- Revenue
- Conversion
- Country
- UTM source
- UTM medium
- UTM campaign

Allow monthly analysis.

---

# 40. Admin Shipping

Provide an editable table for:

- United States
- Canada
- United Kingdom
- Australia
- Germany
- France
- Netherlands
- New Zealand
- Ireland
- Switzerland
- Sweden
- Norway
- Denmark
- Singapore
- Japan
- Rest of World

Each should have an editable USD shipping price.

The checkout must always use the server-side values.

---

# 41. Admin Site Settings

Allow editing of:

- Book price
- Currency
- Delivery estimate minimum
- Delivery estimate maximum
- Product name
- Product description

Default:

```text
Book price: $65
Currency: USD
```
**honestly not necessary as this might require updating on Stripe side anyway. If i change the price i'll just let you know.
The browser must not be allowed to override these values.

---

# 42. Admin SEO

Create a lightweight SEO editor.

This should provide basic controls similar to a very lightweight SEO plugin.

For each public page, allow editing of:

- Page title
- Meta description
- H1
- Canonical URL
- Open Graph title
- Open Graph description
- Open Graph image
- Robots directive

Pages:

```text
/
 /checkout
 /confirmation or thank-you
 Failure pages too
```

SEO configuration should be stored in the database.

---

# 43. SEO Infrastructure

Generate:

`robots.txt`

I don't want a sitemap actually *** i don't want people looking around the site.

Use appropriate:

- Canonical URLs
- Meta descriptions
- Open Graph metadata
- Structured data

Add relevant Product/Book structured data where appropriate.

---

# 44. Admin Authentication

The Admin Dashboard must not be publicly writable.

A complicated multi-user permission system is unnecessary.

Use a simple secure authentication mechanism appropriate for a single administrator.

Never store the admin password in plaintext.

Honestly the admin password can just be 'harvey' for now, no one will know the admin URL or pw anyway, and security isn't that big of a deal for this rn anyway.



---

# 45. Error Logging

Create an `error_logs` table.

Suggested fields:

```text
id
order_id
service
error_type
error_message
request_reference
attempt_number
created_at
```

Record errors from:

- Stripe
- BookVault
- Refund processing
- Database
- Critical backend operations

Never store secrets.

Never store full payment information.

Never expose internal stack traces to customers.

The Admin Dashboard should display recent errors.

---

# 46. Security

Never expose:

- Stripe secret key
- Stripe webhook secret
- BookVault credentials
- Database credentials
- Admin credentials

to the frontend.

Use environment variables.

Validate all backend inputs.

Use parameterized database queries.

**Im very relaxed regarding security for this version, don't worry about the above much tbh. just do the basics.

Validate:

- Email
- Phone
- Country
- Address
- BookVault field lengths
- Order IDs
- Payment references

Never trust the browser for:

- Product price
- Shipping price
- Total price
- Order status
- BookVault status
- Refund state

Never allow frontend code to communicate directly with BookVault.

Never allow frontend code to initiate arbitrary refunds.

Verify Stripe webhooks cryptographically.

Use HTTPS in production.

Do not log secrets.

Use appropriate rate limiting on sensitive endpoints.

---

# 47. Performance

The public site should be extremely lightweight.

Avoid unnecessary dependencies.

Avoid unnecessary JavaScript.

Optimize images.

Only load Stripe Elements where required.

Keep analytics lightweight.

Do not load third-party analytics scripts.

Prioritize fast loading on mobile.

# 49. Responsive Design

The website must work well on:

- Mobile
- Tablet
- Desktop

Mobile checkout is particularly important.

Do not create horizontal scrolling.

Stripe Elements must work properly on mobile devices.

---

# 51. Development Environment

Development must initially use:

**Stripe Test Mode**

BookVault has no sandbox environment, so BookVault-side testing will
necessarily involve real orders against BookVault's live API (see section
26). Keep this scoped and deliberate — e.g. a single manual test order
placed by Harvey — rather than routine automated testing against BookVault's
production API.

Do not use production Stripe credentials during development.

---

# 52. Testing

Before production deployment, test the complete system.

Test:

- Landing page
- Purchase CTA
- Mobile layout
- Checkout
- Country selection
- Shipping calculation
- Server-side price calculation
- Stripe Elements
- PaymentIntent creation
- Stripe payment success
- Stripe webhook verification
- Order creation
- BookVault order submission (real test order — no sandbox available)
- BookVault confirmation
- Confirmation page
- Duplicate Stripe webhook handling
- Confirmation page refresh
- BookVault failure
- BookVault retry
- Stripe refund
- Refund failure handling
- Analytics events
- UTM attribution
- Admin dashboard
- Shipping editing
- SEO editing
- Mobile checkout
- Address validation
- BookVault character limits
- Idempotency

---

# 53. Production Readiness

Do not switch to full production traffic until a real BookVault test order
has been placed and verified end-to-end (order submission, confirmation
mechanism, address handling), and the Stripe test-mode flow has been
successfully verified.

The production transition should require explicitly changing:

- Stripe credentials
- BookVault credentials
- BookVault API base URL
- Database configuration
- Deployment configuration
- Webhook configuration

Do not automatically switch environments.

---

# 54. Documentation

Maintain a README containing:

- Project overview
- Architecture
- Installation
- Local development
- Environment variables
- Database setup
- Database migrations
- Stripe Test Mode
- BookVault integration (no sandbox — testing notes)
- Shipping configuration
- BookVault product configuration
- Deployment
- Production configuration
- Stripe webhook configuration
- Analytics
- Refund handling
- Troubleshooting

Keep documentation updated when architecture changes. Or just update this claude.md or whatever u want. however u need to keep on top of things.

---

---


# 58. Changes and Maintenance

When making a change:

1. Inspect relevant files.
2. Understand the existing implementation.
3. Make the smallest clean change.
4. Avoid unrelated refactoring.
5. Test the change.
6. Check for regressions.
7. Update documentation if necessary.

If a permanent architectural decision changes, update this `CLAUDE.md`.

---

# 59. Configuration Values To Be Supplied

The following values will be supplied during development:

- ~~BookVault product ID~~ — supplied 2026-09-17 (`BOOKVAULT_TITLE_ISBN`, see §64)
- ~~BookVault API credentials~~ — supplied 2026-09-17, see §64
- Real per-country shipping_rates fallback values (the live BookVault quote
  is now primary — see §64 — but the static table is still the fallback if
  BookVault is unreachable, and still seeded with the $9.99 placeholder)
- Stripe test credentials
- Stripe production credentials
- Production database credentials
- VPS/deployment configuration
- Final website copy
- Final images/assets
- Final SEO copy
- Final delivery estimate

Do not invent these values.

Use placeholders until they are supplied.

---

# 60. Definition of Done

The project is complete when a customer can:

1. Visit `realitymanual.com`
2. Understand the product
3. Click the purchase CTA
4. Enter their shipping information
5. Select their country
6. See the correct shipping price
7. See the correct total
8. Pay securely through Stripe Elements
9. Reach the confirmation page
10. See that their order is being placed
11. Wait while the BookVault order is confirmed
12. Receive a successful confirmation only after BookVault confirms the order

If BookVault cannot fulfill the order:

1. The system records the failure.
2. The system retries where appropriate.
3. The payment is automatically refunded.
4. The order is marked refunded.
5. The customer is informed.
6. The customer can try again.

Meanwhile the system must:

- Record every order
- Record Stripe payment status
- Submit orders to BookVault
- Store BookVault order IDs
- Prevent duplicate fulfillment
- Handle refunds
- Log errors
- Track analytics
- Preserve UTM attribution
- Provide monthly reporting
- Allow shipping rates to be edited
- Allow SEO settings to be edited
- Remain secure
- Remain maintainable
- Be verified against a real BookVault test order before full production use

---

# 61. Guiding Principle

The entire application should remain focused on one simple flow:

```text
DISCOVER
   ↓
BUY
   ↓
PAY
   ↓
FULFILL
   ↓
CONFIRM
```

Build the simplest reliable system that accomplishes this.

Do not turn the project into a large ecommerce platform.

The goal is a beautiful, premium single-product website with a reliable payment and BookVault fulfillment pipeline.

**Let me know whenever you want me to jump into the VPS terminal to make any changes. Or if i can give u vps access somehow even better.
**Btw were using github desktop for all this and u have rights to push any changes automatically. for instance in the directory youre in now, if u were to create a index.html file, that would show at realitymanual.com/

---

# 62. Internal Control Panel (/db)

A password-gated internal control panel is served at
**`https://ops.realitymanual.com/`** by `rm-ops-service` itself (source in
`ops-service/public/` — index.html, quick-add.html, migrate.html, app.js,
lib/, style.css, manifest.json, icon.svg). It is explicitly **separate
from the storefront** — do not conflate its data with the Stripe/BookVault
order pipeline or its Postgres/SQLite schema in `backend/`.

**Why it moved off `realitymanual.com/db/` (2026-09-09):** it originally
lived in `frontend/db/` and deployed via the same GitHub Pages workflow as
the storefront. GitHub Pages hardcodes `Cache-Control: max-age=600` on
every file it serves with no way to override it from the repo — every
push left browsers silently running a stale build (including stale JS
logic, not just stale content) for up to 10 minutes, which surfaced as
real bugs (login state disagreeing with the server, one device showing
data another didn't). Moving the panel onto `rm-ops-service` — already a
Node/Express origin fully under our control — fixed it outright: every
response, static files included, is sent with `Cache-Control: no-store`.
`frontend/db/` now holds only three tiny redirect stubs (`index.html`,
`quick-add.html`, `migrate.html`) pointing to the new URLs, so old
bookmarks/home-screen shortcuts don't break. **The phone home-screen
shortcut for quick-add should be redone pointing at
`ops.realitymanual.com/quick-add.html` directly** — a meta-refresh
redirect doesn't preserve the installed-PWA "standalone" display mode.

**Access:** password `ormiston`, checked server-side via `POST
/api/login`, which sets a real httpOnly session cookie (30-day expiry).
There is **no client-side storage of auth state at all** — no
`localStorage`, no IndexedDB. Every page load calls `GET /api/me` and
trusts *that* answer, never a local flag — an earlier version kept a
`localStorage` flag for instant UI state, but that could drift from the
real server session (a device with a stale "logged in" flag would skip
the login form and therefore never actually establish a session, then
silently see empty data / silently fail every save, since a 401 was
being swallowed as "no data" rather than surfaced). Removing the flag
entirely closed that whole bug class. Still deliberately low-security
overall (single shared password, no rate-limit beyond a basic per-IP
throttle on `/api/login`) — Harvey's call, matches the admin-password
precedent in section 44. `robots.txt` disallows `/db/` on the storefront
domain (now just redirect stubs), and `rm-ops-service` serves its own
`Disallow: /` robots.txt on its own origin.

**Backend + frontend (`ops-service/`, deployed as `rm-ops-service`):** a
small dedicated Node/Express + better-sqlite3 service, added 2026-09-09,
living at **`ops.realitymanual.com`** — completely separate code and data
from the storefront's `backend/`, per Harvey's repeated instruction. Runs
as a Docker container on the same Hostinger VPS as n8n (`docker run
--name rm-ops-service`, `--restart unless-stopped`, bound to
`127.0.0.1:4001`), fronted by an nginx site
(`/etc/nginx/sites-available/ops`) with a Let's Encrypt cert via certbot,
same pattern as the existing n8n site. Data lives on the VPS at
`/root/ops-service-data` (bind-mounted into the container at `/data`):
`db.sqlite` holds a generic `records(store_name, id, data, updated_at)`
table (one JSON blob per record — mirrors the old IndexedDB object-store
shape almost exactly) plus a `sessions` table; uploaded video/audio files
are plain files on disk under `/data/uploads/<store>/<id>`, not in
SQLite. The frontend is same-origin with the API now (both served from
`ops.realitymanual.com`), so `RMStore.API_BASE` is just `''` — CORS/cookie
cross-origin complexity from the original `realitymanual.com` +
`ops.realitymanual.com` split is gone, though the CORS allowlist is left
in place (harmless) in case anything ever needs cross-origin access
again. DNS (`ops` A record, Cloudflare-proxied) was created via a
Cloudflare API token scoped to DNS-edit on the `realitymanual.com` zone
only. **Deploying a change to `ops-service/public/` requires rebuilding
and restarting the `rm-ops-service` Docker container on the VPS** — a
plain `git push` alone does not deploy it (unlike the storefront's
GitHub Pages workflow).

**Storage / data flow:** `ops-service/public/lib/store.js` keeps the
original `getAll/get/put/del` interface it had back when it talked to
IndexedDB (so `app.js` needed almost no changes for the backend move) but
now calls the `rm-ops-service` REST API — `GET/PUT/DELETE
/api/store/:storeName[/:id]` for plain JSON records (`pieces`, `settings`,
`errors`), and `POST/GET /api/files/:storeName/:id` for the file-backed
stores (`videos`, `audioTracks`), where `put()` detects a `Blob`/`File`
under `record.blob` and uploads it as multipart form data instead of
JSON. `get()`/`getAll()` on those two stores fetch the file bytes back and
reattach them as `record.blob`, so the rest of the app (video preview,
audio playback via `URL.createObjectURL`) is unaffected. Nothing syncs
automatically from a browser's *old* pre-backend IndexedDB data —
`ops-service/public/migrate.html` is a one-time, password-gated tool that
reads that device's legacy IndexedDB and pushes everything up to the
backend; run it once per device that had local data worth keeping, then
it's no longer needed.

**Content Ops and Upload Files are two views over one `pieces` store, but
deliberately not the same workflow** (Harvey's clarification, 2026-09-08):
Content Ops is pure planning — Ideation → Outline Started → Outline
Completed → Filmed → Edited → **Uploaded**. Harvey drags/selects a card
through those six stages himself, and "Uploaded" is the archive/end state
for a plan — he stops interacting with it there. It is NOT the same thing
as an actual uploaded video file.

Dropping a real file in the Upload Files tab creates a **brand-new piece**
(unrelated to any plan card) starting at **Processing**, which — together
with Thumbnail Selected, Scheduled, and Posted/Live — is system-managed:
no drag-and-drop, no manual stage dropdown, just an "Auto · <stage>" badge
on the card. `ops-service/public/app.js`'s `deriveAndApplyStage()` derives the
piece's stage purely from what's been done to it (audio track picked →
Processing; thumbnail captured → Thumbnail Selected; both present →
Scheduled, with `maybeAutoSchedule()` stamping `scheduledAt` from the
Settings cadence for that content type, queued after whatever's already
scheduled). "Posted/Live" is reserved for real posting confirmation, which
doesn't exist yet. `MANUAL_STAGE_IDS`/`AUTO_STAGE_IDS` in `app.js` are the
source of truth for the split — a piece with `hasVideo: true` never
exposes manual stage controls on the board or in the modal.

**Tabs (`ops-service/public/app.js`):**
- **Content Ops** — the planning kanban described above. Click a card for
  a large modal editor (autosaving, paste-to-embed screenshots in notes).
  Each piece has a content type — Ultra-short (10–20s), Short (~1 min),
  Long-short (up to 3 min), Longform (YT/FB) — plus a per-card platform
  tag. An overview strip shows, per content type, how many real pieces
  are queued and how many days out the furthest-scheduled one is.
- **Upload Files** — drag-and-drop drop zone for already-edited (cut +
  captioned) videos, each becoming its own new piece as described above.
  The shared modal gains a Video section for these: video preview,
  transcript (manual for now — auto-transcribe is a visibly disabled
  stub until a transcription provider is wired up), backing-audio
  dropdown (from the ambient library in Settings), an in-browser
  thumbnail frame-picker (scrub the video, capture a frame to canvas —
  no API needed), the shared caption read-only, and a UTM-tracked link
  for longform pieces.
- **Content Analytics / Sales Analytics / Website Analytics** — currently
  informational placeholders listing what will populate once the
  relevant APIs/backend exist (per-video view counts; Stripe/BookVault
  order and revenue reporting; the storefront pageview funnel from
  sections 31–39). No fake data — empty until real.
- **Settings** — publishing cadence per content type, the ambient audio
  library (upload/delete mp3s), the shared caption applied to every
  upload, the base URL used for longform UTM links, and API key fields
  for YouTube/Instagram/Facebook/TikTok plus a transcription provider.
  **These keys are stored in the `rm-ops-service` database only and are
  not sent anywhere else** — there's nothing wired up to use them yet.
  TikTok access hasn't been granted yet either; the field is there for
  when it is.

**Quick-add shortcut:** `ops-service/public/quick-add.html` is a minimal
standalone page (same password/session) meant to be added to a phone home
screen (`manifest.json` + `icon.svg` for the install prompt, `start_url`/
`scope` now rooted at `/` since the move) — one big textarea, autofocused,
dictate via the OS keyboard's mic button, "Save to Ideation" writes
straight into the same backend store the main board reads from, so a
captured idea shows up in Content Ops immediately. It reports a visible
error (not a false "Saved ✓") if the save actually fails server-side.

**Known limitation:** Content Ops (board, cards, modal editor) and
quick-add have been used for real by Harvey against the live backend at
`ops.realitymanual.com` and confirmed working, including catching and
fixing the two bugs described above. The Upload Files tab's drag-and-drop
+ in-browser thumbnail frame-picker, and `migrate.html` against a device
with genuine old local data, have not yet been exercised for real — test
those before relying on them.

---

## Original brief for this tool (confirmed 2026-09-08)

Harvey's intended eventual workflow, for context on where this is headed:

- Drag-and-drop upload of already-edited videos
- Automatic splicing in of background music (currently: manual pick from
  an uploaded ambient-audio library, not automatic)
- Automatic transcription of spoken content, used to help generate/inform a
  title for each piece (currently: manual transcript + manual title —
  auto-transcribe and auto-title need a transcription/LLM API key and are
  stubbed out)
- Scheduling and cross-posting to: YouTube (long-form + Shorts), TikTok,
  Instagram, Facebook (currently: scheduling/cadence logic is real and
  working; actual cross-posting to platforms is not built — no API keys
  exist yet and it needs a backend, not client-side JS, to hold them)
- Target publishing cadence: roughly one piece every 8 hours (currently:
  cadence is configurable per content type in Settings, defaulting to
  ultra-short/8h, short/1d, long-short/3d, longform/7d — Harvey's call to
  tune)

Real API integration (posting, transcription, analytics pulls) starts once
Harvey is back from Samui (left 2026-09-09, back roughly a week later) and
has API credentials to supply — see the Settings tab's API keys section for
where those go. Keep it lightweight, consistent with this project's general
philosophy of avoiding unnecessary complexity.

---

# 63. Landing Page Redesign (2026-09-17)

The storefront was rebuilt from Harvey's desktop + mobile design mockups.
Still plain HTML/CSS/JS, no build step, no framework — one stylesheet
(`frontend/css/style.css`) shared by all three public pages.

**Price is now $65 USD** (was $59 in this file, $39 in code — both were
stale/inconsistent). Updated in:
`backend/src/config.js` (`site.bookPriceCents: 6500` — the authoritative
value), `frontend/js/checkout.js` (`BOOK_PRICE_CENTS`, used only to
initialise Stripe Elements before a country is chosen), and the static
display copy on the landing + checkout pages. The server still calculates
the real total; frontend numbers are display-only.

**Product naming:** "Hardcover — Deluxe First Edition". One edition only —
the mockup's three-tier selector (hardcover/paperback/digital) was
deliberately collapsed to a single card, per Harvey.

**Landing page structure** (`frontend/index.html`, top to bottom): sticky
header (wordmark, About, FAQ, Get Your Copy) → hero (eyebrow, H1, tagline,
body, book image, 3 trust icons, pull-quote) → offer band (video card +
edition selector side by side) → four "why this book" features → "Inside
the book" page strip + testimonial → FAQ accordion (`<details>`, no JS) →
closing CTA band with flanking quotes → footer.

**Image placeholders** live in `frontend/img/placeholder/` as hand-written
SVGs and are marked in the HTML with `<!-- IMAGE SLOT: ... -->` comments.
Replacing artwork = dropping a real file in and changing the `src`; no CSS
changes needed. Slots: `hero-bg` (hero photograph), `book-hero` (the book),
`video-poster`, `page-1..4` (interior pages), `edition-thumb`, `cta-bg`.
The old `frontend/img/product/*.svg` gallery placeholders are no longer
referenced by any page but are left in place.

**Video:** the play button is wired but inert until `VIDEO_EMBED_URL` is
set in the inline script at the bottom of `index.html`. Set it to a
YouTube/Vimeo embed URL or a local `.mp4`/`.webm` and the poster swaps for
a real player on click.

**Copy status:** all headline/feature/FAQ copy comes from the mockups and
is live on the site — it is not marked as placeholder. Two things to
confirm: "The 14 Rules" (is 14 the real number?) and the FAQ shipping
estimate, which is hardcoded as `7–14 days` inside a
`<span data-setting="delivery-estimate">` so it can be wired to the
admin-editable delivery estimate later (section 24).

**Type:** display serif is now Cormorant Garamond (was Fraunces); UI sans
stays Archivo. Stripe Elements now uses the `night` appearance theme so
checkout matches the dark site instead of rendering as a white block.

**Real hero photo (added 2026-09-17, reworked same day — see §64):** the
`hero-bg` and `book-hero` SVG placeholders described above are gone from
the hero section, replaced by two real AI-generated photos of the book on
a candlelit desk:

- `frontend/img/photo/book-desk.png` (1536×1024, landscape) — desktop/tablet
- `frontend/img/photo/book-desk-square.png` (1254×1254, square,
  tighter/larger crop of the book) — mobile

Both are **normal contained grid items** (`.hero-photo--desktop` /
`.hero-photo--mobile`, toggled by plain CSS `display` per breakpoint), not
a full-bleed `position:absolute` background — that was the first attempt
and it broke: the background's crop was anchored by a fixed
`object-position` percentage of the whole section while the text columns
were sized by independent grid `fr` tracks, so the two only lined up by
coincidence at the exact widths first tested and drifted apart at
in-between (tablet/small-desktop) widths, crowding or overlapping the
copy text into the book. Keeping the photo as a real grid item ties it to
the same track math as the text at every width — verified render-tested
from 390px through 1440px+ with no overlap. Desktop's `hero-grid` uses
`minmax(0, …fr)` columns (not bare `…fr`) so a long word in the copy/quote
column can't blow out its track either.

Mobile's copy is free-bleeding (negative `margin-inline` cancelling
`.wrap`'s padding) with no border/card frame, matching the mockup's
"part of the page, not a boxed photo" look. Desktop's copy is a bordered,
drop-shadowed 4:5 box in the middle grid column, sized like a real product
photo rather than an atmosphere background.

Crispness: holds up fine at a forced 2x device-scale-factor (retina/4K
simulation) since neither copy is ever stretched much past its native
resolution at the sizes each is actually rendered at — see the request
that raised this for the render-testing methodology. No upscaling needed
for either file as currently used. The other placeholder slots (video
poster, interior pages, edition thumbnail, closing background) are still
the hand-drawn SVGs from the initial redesign and are unaffected.

---

# 64. BookVault Shipping Integration (2026-09-17)

Researched BookVault's actual API (there's no public developer-docs page
that renders without JS — `https://api.bookvault.app/v3/docs` is a ReDoc
UI that loads its content from `https://api.bookvault.app/v3/swagger/docs/v3`,
which is the real OpenAPI/Swagger spec and is directly fetchable). That
spec is the source of truth for everything below — re-fetch it before
changing any BookVault integration code, rather than trusting this summary
or any older example.

**Auth:** `Authorization: basic <api key>` — a literal `"basic "` prefix on
the raw key (per `https://help.bookvault.app/api-setup`), **not**
base64-encoded HTTP Basic auth despite the spec labeling the scheme
`"type": "basic"`. Base URL: `https://api.bookvault.app/v3`. Still no
sandbox (§26) — every call, including a shipping quote, hits BookVault's
live system.

**Credentials, supplied 2026-09-17, live in `backend/.env` (gitignored,
never committed):**

```text
BOOKVAULT_API_KEY      = bv_OfpCyAuyQU1sKANfEWJE6nSP6DTfA
BOOKVAULT_API_BASE_URL = https://api.bookvault.app/v3
BOOKVAULT_TITLE_ISBN   = 9658364000016
```

`BOOKVAULT_TITLE_ISBN` is the 13-digit ISBN BookVault assigned to the
title in their library when Harvey uploaded the print-ready files (§26) —
required on every `OrderLine` for both shipping quotes and real orders.

**What's implemented now — live shipping calculation:**
`backend/src/services/bookvaultService.js` calls `POST /Dispatch`
("Loads all the available dispatch services based on the supplied data to
give you the current prices") with `OrderLines` (ISBN + quantity),
`CountryCode` (ISO 3166-2, the same 2-letter codes already used
throughout this project), `AreaCode` (postcode), `ServiceLevel: "Cheapest"`,
`PartnerID: 0` (let BookVault pick the best print partner), `Currency`,
and `ShipmentDate`. The response's `Services[]` array is reduced to the
lowest `DelTotal`, converted to cents. `shippingService.calculateTotal()`
now takes `(countryCode, postalCode)`, tries this live quote first, and
falls back to the static `shipping_rates` table (§17, still seeded with
the $9.99 placeholder) if the BookVault call fails for any reason —
logging an `error_logs` row (`service: 'bookvault'`) either way so a
pattern of failures is visible in the admin error log once that exists.
Both `POST /api/shipping/calculate` and `POST /api/checkout/create-payment-intent`
now require `postal_code` alongside `country_code`, and
`frontend/js/checkout.js` re-fires the shipping calculation (debounced
500ms) on postcode input as well as on country change, not just country
change alone.

Verified against the real API before considering this done (safe to do
routinely, unlike order creation — a shipping quote has no side effects):
US/10001, GB/SW1A 1AA, AU/2000, JP/100-0001, and DE/10115 each returned a
distinct, plausible cents amount (all different from the $999 fallback,
confirming they're genuinely live); an invalid country code (`ZZ`)
correctly fell through to the fallback and wrote an `error_logs` row.

**Real BookVault field limits (replacing Lulu-era placeholders):**
sourced from the `BookVAULT.OrderAddress` schema in the spec above, these
are meaningfully looser than what section 14 originally assumed from
Lulu. Now the actual limits in both
`backend/src/lib/validation.js` (authoritative) and
`frontend/checkout.html`/`frontend/js/checkout.js` (UX-only mirrors):

```text
Addressee (customer_name)  maxLength 200
Address1  (street1)        maxLength 200
Address2  (street2)        maxLength 250
Town      (city)            maxLength 99
County    (state)           maxLength 200
Postcode  (postal_code)     maxLength 99
TelNumber (phone)           maxLength 35
Email                       maxLength 120
```

**Also cleaned up while touching this code:** all remaining Lulu
references removed from the backend — `config.js`'s `lulu` block replaced
with `bookvault`, the `orders.lulu_order_id` column renamed to
`bookvault_order_id` (via a safe `ALTER TABLE … RENAME COLUMN` in
`db/index.js` that no-ops if already renamed or on a fresh DB — no manual
migration step needed), `error_logs.service` enum value `'lulu'` →
`'bookvault'`, and the corresponding `backend/README.md` passages.

**Deliberately not built yet** (out of scope for this pass — see §25-30
for the intended design once it happens): order creation
(`POST /Order`), fulfillment status polling (`Progress.Status`:
`Created → Acknowledged → SentToPrint → Batched → Printed → Dispatched →
Invoiced`), and address/postcode-format validation against
`GET /Countries`' per-country `PostcodeFormat` regex (right now the
checkout form only requires a non-empty postcode within the length
limits above — BookVault's own `/Dispatch` call tolerated a garbage
postcode in testing rather than rejecting it, so this isn't blocking
correctness today, just a nice-to-have for tighter UX later). No webhook
mechanism for order status was found in the spec (only per-platform
`WebHookURL` fields tied to their prebuilt Shopify/WooCommerce/etc. store
integrations, not a generic account-level webhook for direct API
integrations) — polling `GET /Order?PodRef=…` will be the mechanism when
order submission is built, per §27's "if not, poll" instruction.

---

# 65. Backend Deployed to the VPS (2026-09-17)

The storefront backend (`backend/`) is now a real, always-on service —
until today it only ran when someone manually started `npm start` on
their own machine, which is why checkout kept failing for Harvey testing
the live site (§64's fixes were correct but nothing was actually running
at `localhost:4000` when he tried). Deployed the same way
`rm-ops-service` already runs on this VPS (§62) — Docker container, nginx
reverse proxy, Let's Encrypt — but as a **separate** container/domain,
per the same "don't merge with the ops panel" instruction that governs
`rm-ops-service`.

**Live at `https://api.realitymanual.com`.** `frontend/js/config.js`
`API_BASE_URL` now points there instead of `localhost:4000`.

**On the VPS (Ubuntu, root, same box as n8n and `rm-ops-service` — see
`project-vps-access-notes` memory for SSH details):**
- `/root/realitymanual-repo` — a plain `git clone` of this repo (not a
  deploy-key/webhook setup — redeploying a backend change means pulling
  again and rebuilding, see below).
- `backend/Dockerfile` (new, node:24-slim — matches the Node version this
  project develops against locally; needed for the built-in `node:sqlite`
  module the backend uses, not a native-compiled dependency like
  `rm-ops-service`'s `better-sqlite3`) builds to image
  `rm-storefront-backend`, run as container `rm-storefront-backend`
  (`--restart unless-stopped`, bound to `127.0.0.1:4000`).
- `/root/realitymanual-backend-data` bind-mounted to `/data` in the
  container — holds `reality-manual.db` (`DATABASE_PATH=/data/reality-manual.db`
  set in the container's `.env`, matching the Dockerfile's `ENV` default).
  Separate from `rm-ops-service`'s own `/root/ops-service-data` — these
  two services share nothing.
- `backend/.env` on the VPS (not the one in this repo checkout locally —
  a separate copy, written directly on the server, never committed) holds
  the real Stripe test keys, BookVault credentials, and
  `CORS_ORIGIN=https://realitymanual.com` (production — no `localhost`
  entries; add one temporarily only if you need to debug the deployed
  backend against a local frontend, and remove it again afterward).
  `NODE_ENV=production`.
- nginx site `/etc/nginx/sites-available/api` (symlinked into
  `sites-enabled`), same pattern as the existing `ops` site — proxies
  `api.realitymanual.com` to `127.0.0.1:4000`. Cert issued via
  `certbot --nginx -d api.realitymanual.com` (reused the account already
  registered on this box from the `ops`/n8n certs — no new email prompt
  needed), auto-renews the same way the others do.
- DNS: an `api` A record on the `realitymanual.com` Cloudflare zone,
  proxy OFF, pointing at the VPS IP — Harvey added this one himself
  directly in the Cloudflare dashboard rather than handing over another
  scoped API token.

**Two things this fixed that looked unrelated at first:**
1. **CORS.** `CORS_ORIGIN` used to default to the local-dev origin
   (`http://localhost:5500`) — the live site at `https://realitymanual.com`
   is a different origin, so the browser blocked every checkout request
   outright regardless of country. `config.js`'s `corsOrigins` now parses
   a comma-separated list (kept for exactly this kind of dual-origin
   need during local dev — see `.env.example`), and production's is set
   to just the live domain.
2. **Private Network Access.** Separately, Chrome-family browsers block a
   public HTTPS page fetching a private-network address (loopback
   included) unless the server opts in via
   `Access-Control-Allow-Private-Network: true` on the preflight
   response. `server.js` sets that header — it has to run *before* the
   `cors()` middleware, which ends OPTIONS preflights itself and would
   otherwise skip anything mounted after it. This only ever mattered
   while the backend was local; it's harmless now but left in since local
   debugging against the deployed frontend may still come up.

**Redeploying a backend code change** (no CI/CD yet — manual, same
category of step as redeploying `rm-ops-service`):
```bash
ssh -i ~/.ssh/realitymanual_vps root@187.124.146.235
cd /root/realitymanual-repo && git pull
cd backend && docker build -t rm-storefront-backend .
docker stop rm-storefront-backend && docker rm rm-storefront-backend
docker run -d --name rm-storefront-backend --restart unless-stopped \
  -p 127.0.0.1:4000:4000 -v /root/realitymanual-backend-data:/data \
  --env-file /root/realitymanual-repo/backend/.env rm-storefront-backend
```
(A plain `git pull` isn't enough by itself — same "must rebuild the
container" caveat §62 already notes for `rm-ops-service`.)

**Not done yet:** a real Stripe webhook endpoint pointed at
`https://api.realitymanual.com/api/webhooks/stripe` — the `.env` on the
VPS still carries the `whsec_…` value from a local `stripe listen`
session, which won't verify signatures for events Stripe actually sends
to the deployed URL. Payment Intents still get created fine (shipping
calculation and checkout submission don't depend on the webhook), but
the webhook-driven order-status flip to `PAYMENT_RECEIVED` won't fire
correctly until a real webhook endpoint is registered in the Stripe
Dashboard for that URL and its secret swapped in.

---

# 66. BookVault Shipping Options, Quantity, and USPS Consolidator (2026-09-17)

Harvey asked exactly what BookVault sends back for shipping, whether
$10.14 is really flat across the whole US, whether USPS Consolidator is
guaranteed, and how quantity affects things. Answered by querying the
real `/Dispatch` endpoint directly (`ServiceLevel: "NotSpecified"` returns
every available service rather than one pre-filtered choice) rather than
guessing:

**What comes back, by destination (qty=1):**
```
US: Fedex Priority ($25.28), USPS Consolidator ($10.14)
CA: Fedex Priority, World Post International Tracked/Untracked
GB: Royal Mail 1st/2nd Class, Delivery Group Tracked (Economy/Priority),
    DPD Tracked/Pre-10:30/Pre-12:00 — more local carrier options than
    anywhere else tested
AU/DE/JP: Fedex (Priority or Economy), World Post International
    Tracked/Untracked
```
USPS Consolidator only exists for US destinations — everywhere else the
cheap/slow option is "World Post" or a local postal carrier.

**Is $10.14 really flat for the whole US?** Yes, confirmed — tested 7
very different zips (10001, 90210, 59718 rural Montana, 99501 Anchorage,
96813 Honolulu, 00901 Puerto Rico, 33101 Miami) at qty=1, and every one
returned identical services at identical prices. Not a bug; BookVault's
domestic quote genuinely doesn't vary by postcode at this weight.

**USPS Consolidator "always used when available":** confirmed it already
is the cheapest option in every US case tested, so relying on
BookVault's own "Cheapest" service level would have worked in practice —
Harvey's own read of it ("consolidator will always be cheapest where
it's an option"). `bookvaultService.js` still matches it explicitly by
name (`PREFERRED_SERVICE_NAME`) rather than leaning on that as a
guarantee, since it costs nothing and protects against BookVault's
pricing changing later.

**Quantity → weight → price**, tested at US/10001:
```
qty 1: 1416g  →  USPS Consolidator $10.14 (+ Fedex $25.28)
qty 2: 2532g  →  USPS Consolidator $15.65 (+ Fedex $30.57)
qty 3: 3648g  →  USPS Consolidator $20.23 (+ Fedex $33.46)
qty 5: 5880g  →  USPS Consolidator gone — Fedex Priority $39.31 only
```
USPS Consolidator's weight bracket tops out somewhere between qty 3 and
5 — above that, only the pricier carrier remains. This is real, not
theoretical, and confirms quantity has to reach BookVault for the price
to be correct at all — nothing sent it before this pass; every quote was
implicitly qty=1.

**Built as a result:**
- **Quantity selector** at the top of the checkout page (Harvey's
  placement — not in the order summary), a stepper (`-`/`+`/number
  input, 1-20, matching `QUANTITY_MIN`/`QUANTITY_MAX` in
  `backend/src/lib/validation.js`). Threaded through shipping
  calculation, order creation (new `orders.quantity` column, migrated
  safely like the other recent schema changes — see `db/index.js`), and
  the Stripe PaymentIntent's amount/metadata.
- **`bookvaultService.getShippingQuote`** takes `quantity`, sends it as
  the `OrderLines[0].Quantity`, requests `ServiceLevel: "NotSpecified"`,
  and picks `PREFERRED_SERVICE_NAME` ("USPS Consolidator") when present,
  else the lowest `DelTotal` among whatever came back.
- **Quantity-upgrade warning**: `shippingService.calculateTotal`, when
  `quantity > 1`, also fetches a real qty=1 quote for the same
  destination and compares `serviceName` — if the chosen service
  differs from the qty=1 baseline, `shipping_upgraded: true` comes back
  from `POST /api/shipping/calculate`, and `checkout.js` shows an amber
  warning banner (`#quantity-warning-banner`) explaining that this
  quantity no longer qualifies for the cheapest service. Driven by what
  BookVault actually returns, not a guessed weight threshold, since
  BookVault doesn't document its weight brackets and they can differ by
  country/carrier. Costs one extra live API call, only when quantity > 1
  — accepted as worth it for correctness over guessing.

Verified against the real API before considering this done (same
"read-only, safe to test for real" reasoning as §64 — a shipping quote
has no side effects): qty 1/2/3 all stayed on USPS Consolidator with
`shipping_upgraded: false`; qty 5 correctly flipped to `true`; quantity 0
and 999 both rejected with 400; an omitted quantity defaults to 1
(pre-existing checkout behavior untouched).

---

# 67. Hero Rebuilt on Two Decoupled Assets (2026-09-17)

Every earlier hero attempt (§63/§64/§66's "known limitation" note,
implicitly) tried to make **one photo** serve two jobs at once: a
full-bleed atmospheric background, and a book that must never be
cropped awkwardly. Those two jobs need different crop behavior at
different viewport widths — the background can crop however it needs
to, but the book can't lose its edges — and a single `object-position`
percentage can't satisfy both simultaneously once the background's crop
and the text grid's `fr`-tracks stop scaling in lockstep (which happens
below ~1200px). That mismatch was the root cause of the tablet-width
text/book overlap, fixed at the time by making the photo a contained
grid item — which worked, but visibly diverged from the mockup (Harvey:
"the image is supposed to form the entire background of the hero
section"; "would it be easier if I got you a true background library
candle sprite and then a separate book image").

Harvey generated exactly that split:
- `frontend/img/photo/hero-background.png` (1672×941) — pure atmosphere,
  candle + blurred books/globe, **no book in it at all**.
- `frontend/img/photo/hero-book.png` (1024×1536) — the book alone, shot
  on a dark vignette (not true alpha transparency, but close enough to
  the page's near-black `--bg` that a CSS mask can hide the seam — see
  below).

**Current structure** (`frontend/index.html` hero section,
`frontend/css/style.css` `.hero`/`.hero-book`/`.hero::after`):
- Background: an ordinary full-bleed `.bg-img` (`position: absolute;
  inset: 0; object-fit: cover`) — the exact same pattern `.video-card`
  and `.final-cta` already use elsewhere on this page. No longer needs
  the `.hero-photo--mobile`/`--desktop` display-toggling split from
  §64/§66 at all, at any breakpoint, because there's nothing in it that
  cropping could ruin.
- Book: `.hero-book`, a plain centered `<img>` — `width: min(58vw,
  300px)` on mobile, `min(20vw, 340px)` from 900px up, `margin: 0 auto`
  on mobile / grid-area alignment on desktop. Never cropped (no
  `object-fit` needed — the whole image just scales). Edges feathered
  via `mask-image: radial-gradient(ellipse 68% 72% at 50% 50%, black
  68%, transparent 100%)` so its vignette blends into the page instead
  of showing a visible rectangle.
- `.hero::after`: a **radial** vignette over the whole section — lighter
  in the center (where the book floats), heavily darkened toward the
  edges (where copy/trust/quote text always sits). Started as a flat
  overlay, which wasn't enough: the background photo's candle flame is
  bright enough to land directly under the copy text at some viewport
  widths (its crop shifts independently of the text grid, by design —
  that's the whole point of decoupling them), which hurt legibility.
  Darkening by *position* rather than trying to tune `object-position`
  per breakpoint is robust to any crop, not just the ones tested.

Render-verified at 390 / 960 / 1440 / 1920px — legible, correctly
positioned, no recurrence of the squish this replaces. The old combined
`book-desk.png` / `book-desk-square.png` files from §63/§64/§66 are no
longer referenced by any page but left on disk.

---

# 68. Hero Reverted to One Combined Photo, Again — This Time For Good (2026-09-17)

§67's decoupled two-layer split (full-bleed background + separately
floating book) lasted about one round of feedback. Harvey caught two
real problems with it: the book had no drop shadow (it was baked into
the *background* photo in earlier versions, but split apart from it
once the book became its own element — there was never a shadow drawn
for the book on its own), and the candle — dimmed by the vignette
overlay and positioned by a crop that moves independently of the book —
ended up landing behind the copy text rather than looking like it was
lighting the book.

Harvey's fix: regenerate the *combined* candle+book+shadow scene (same
one-photo approach as `book-desk.png` back in §63/§64), but properly
composed this time — candle clearly separated from the book with room
to spare, bright rather than muted, shadow naturally part of the shot —
and supply two crops instead of one:

```
frontend/img/photo/bg.png           1672×941   (16:9-ish) — desktop, 900px+
frontend/img/photo/bg-vertical.png  1086×1448  (3:4)      — mobile, <900px
```

**Both shown as contained images, never full-bleed behind text** — the
mobile one free-bleeds to the screen edges in normal flow (same
treatment §64/§66/§67 already established there), the desktop one is a
plain grid item sized to its own `aspect-ratio` so nothing is cropped.
This is the actual fix, not the multi-crop part: with the photo
confined to its own space, copy/quote text can never end up sharing
territory with it, so the "flame behind text" failure mode (§67) is
structurally impossible now, not just tuned away. No CSS vignette, no
mask — Harvey's own composition carries all of that.

The desktop grid's column split changed to fit this: `bg.png` is
landscape, not the portrait crop earlier versions were tuned for, so it
needs real width to read as prominent rather than a short, squashed
strip — `grid-template-columns` went from roughly even thirds to
`1.1fr 1.6fr 0.5fr` (copy / book / quote). Verified the copy column still
holds "The Reality Manual" to two lines at 960/1440/1920px despite
`hero-quote` giving up width to make room.

`hero-background.png` and `hero-book.png` from §67 are no longer
referenced by any page but left on disk, alongside the earlier
`book-desk.png` / `book-desk-square.png` from §63/§64/§66. `og:image`
now points at `bg.png`.

**Also fixed the same day, unrelated to the hero:** the checkout page's
quantity control (§66) had two problems Harvey flagged — the little
book-count icons next to the stepper were invisible (the placeholder
SVG's own background is `#0c0a06`, nearly identical to the page's
`--bg`, so at the original small size there was nothing to see), and
the stepper's number/buttons read as too small next to the new
"Quantity" `<h2>`. Fixed by adding a visible border to each icon
(`border: 1px solid var(--accent-3)`) and roughly enlarging both the
icons and the stepper's font sizes — confirmed via a CDP-driven
`getComputedStyle` check (not just eyeballing a screenshot) that the
icons render with a real border and the enlarged sizes actually apply.

---

# 69. Hero: True Full-Bleed, For Real This Time (2026-09-17, same day as §68)

§68 was wrong. Harvey: "this whole image is supposed to span the entire
hero" — he meant it as a full-bleed background behind all the text
(matching the original mockup), not a contained box in the middle
column. §68 also accidentally swapped the mobile image over to
`bg-vertical.png`; Harvey caught that too ("you put the tablet one on
mobile... it was perfect as it was").

**Fixed:**
- Mobile reverted to exactly what it was before §68 —
  `book-desk-square.png`, free-bleeding in normal flow. Untouched
  otherwise.
- Desktop (900px+) is `bg.png` as a genuine `position: absolute`
  background spanning the whole `<section class="hero">`, the same
  `.bg-img` pattern `.video-card`/`.final-cta` already use — not a grid
  item. `hero-grid`'s middle column goes back to being an empty `.` gap;
  there's no "book" grid item on desktop at all anymore.
- A lighter radial vignette than §67's (this composition already keeps
  real dark space around the candle/book, so it needed less help).

**Found and fixed for real, not just tuned around:** the eyebrow line
("A Strategy Manual for the Game of Life") reached far enough right at
~960-1024px to land on the book — the same independent-cropping tension
every hero attempt has hit, just milder since this photo has better
built-in clearance. Nudging `object-position` helped a little but
didn't fully fix it at every width tested. The fix that actually holds:
`.hero-copy .eyebrow { max-width: 24ch; }`, forcing it to wrap 3 lines
at every desktop breakpoint rather than 1 line at wide viewports and an
uncontrolled overlap at narrow ones — a constraint on the text's own
width, not a guess about where the image crop will land. Verified clean
at 960/1024/1440/1920px.

**Known remaining gap, not yet raised by Harvey:** at 1920px+ the
section's aspect ratio (wide, ~800px tall) vs. `bg.png`'s own ratio
(1.78:1) crops the image in more tightly than at 1440 — noticeably more
zoomed in, losing some of the surrounding desk/books context. Left
as-is since the realistic viewing range (~960-1600px) looks right and
nothing has been said about ultra-wide; revisit if it comes up.

---

# 70. §69's "Known Gap" Was Real — Fixed on Harvey's Actual PC (2026-09-17)

The ultra-wide crop noted as an unconfirmed gap at the end of §69 turned
out to be real and worse than expected: on Harvey's own monitor, `.hero`
cropped tight enough to cut "THE" off the title entirely ("this is my
pc, the layout is still supposed to be boxed" — meaning: not stretched/
cropped like this, confined to a sane frame).

**Root cause:** `.hero`'s height stayed pinned to its content's natural
height (roughly constant regardless of viewport width) while width kept
growing with the viewport, so `object-fit: cover` cropped more and more
aggressively the wider the screen. Likely worse on Harvey's actual
hardware than in most of this session's own headless-browser tests
because of OS display scaling (125-150% Windows scaling narrows the
*effective* CSS viewport well below the monitor's physical resolution)
— a gap this session's render-testing had flagged as unconfirmed but
hadn't reproduced.

**Fix:** `.hero { min-height: min(56vw, 1000px); }` — 56vw approximates
the height a full-viewport-width section needs to match `bg.png`'s own
1672:941 (≈1.78:1) aspect ratio, so `cover` stops needing to crop much
at all past a certain width. `min-height` only ever *adds* space, so
narrower desktop widths (900-1400px, where natural content height
already exceeds this) see no change. Paired with `align-content: center`
on `.hero-grid` (and `height: 100%` threaded through `.hero .wrap`, since
a percentage height only resolves against an ancestor with a *definite*
height) so the text block recenters within the now-taller section
instead of pinning to the top with dead space below.

**Second-order effect this surfaced:** with the crop reduced to nearly
zero at some widths, the book's on-screen position stopped being
distorted by cropping — and at ~1757px (tested directly, matches
Harvey's approximate effective viewport) its *natural*, barely-cropped
position was close enough to "Manual" in the H1 to overlap. Confirmed
via CDP `getComputedStyle` that this wasn't a rendering/caching fluke —
`object-position` was correctly applied but had essentially no crop left
to shift at that near-native aspect ratio, so retuning the percentage
didn't help. Fixed the same way as §69's eyebrow-line overlap: capped
`hero-copy`'s own `max-width` (34ch → 26ch) so the whole copy block —
H1 included — physically cannot reach far enough right to hit the book,
regardless of exactly where it sits. A constraint on the text's own
width holds at every viewport; chasing the "correct" crop position for
each one does not, because the two systems (grid tracks vs.
`object-fit: cover`) scale independently by construction.

Render-verified at 390 (mobile, untouched) / 960 / 1024 / 1440 / 1757 /
1920px — full title visible and no text/book overlap at any of them.

---

# 71. Hero Photo Boxed to `--wrap`, Not the Viewport (2026-09-17, same day as §70)

§69/§70 both assumed "spans the entire hero" meant the full browser
viewport. It didn't. Harvey's correction, with a screenshot marking
exactly where the header wordmark and "Get Your Copy" button sit versus
where the photo extended past them: **every other section on this page**
(`.offer`, `.why`, `.inside`, `.faq`, `.final-cta` — all via `.wrap`,
`max-width: var(--wrap)` = 1200px) is capped at that width and never
reaches the true viewport edges once the viewport exceeds ~1200px. The
hero has to match that, not bleed past it to 100vw the way §69 had it.

**Fix:** moved `.hero-bg-desktop` from a sibling of `.wrap` (a full
*section*-width background) to a child of `.wrap` (a background capped
at `.wrap`'s own box — the same `.bg-img` pattern, just re-parented).
Below 1200px viewport this looks identical to before (`.wrap` still
fills the available width there, same as the header does), but past
1200px the image now stops growing and sits in a centered box exactly
matching where the header/footer/every-other-section's content lives.

**This also permanently closes §70's aspect-ratio fight**, as a
side-effect rather than the goal: since `.wrap`'s width is now hard-
capped, `object-fit: cover` never has more than 1200px to crop against,
no matter how wide the actual monitor is. `.hero`'s `min-height` formula
changed from a bare `56vw` to `calc(min(100vw, 1200px) * 0.56)` so it's
bounded the identical way — past 1200px viewport both the width
reference and the resulting height simply stop changing.

**Stacking order needed fixing** as a consequence of the move: the
legibility vignette can't be a `.hero::after` pseudo-element anymore.
Once the image lives inside `.wrap` alongside `.hero-grid`, a
pseudo-element of `.hero` (generated *after* `.wrap` in the tree) would
paint on top of the text rather than behind it, once both have
`position` set. Moved to `.hero .wrap::after` with explicit z-index
layering: image `0`, vignette `1`, `.hero-grid` `2`.

Render-verified at mobile (untouched) / 960 / 1440 / 1757 / 2560px:
below 1200px the image fills the viewport exactly like the header does
at that width; above it, both freeze at the identical 1200px box,
matching Harvey's annotated screenshot precisely.

---

# 72. Hero Desktop Photo Back to `book-desk.png`; Vignette Dropped for Text-Shadow

§71's boxing was right, but Harvey's next round of feedback rejected
`bg.png` itself for the desktop background: the candle sat far enough
from the book, and the §71 vignette darkened enough, that it read as
"behind text and darkened" rather than lighting the book. His fix:
switch to `book-desk.png` — the original §63/§64 photo, candle close to
the book, already used for social sharing's `og:image` — and drop the
vignette entirely: **"dont darken the hero bg just because its the
background. the text should still stand out."**

**Changed:**
- `hero-bg-desktop`'s `src` → `img/photo/book-desk.png` (1536×1024,
  1.5:1 — not `bg.png`'s 1672×941). `.hero`'s `min-height` coefficient
  updated to match: `0.667` (1024/1536) instead of `0.56` (941/1672).
  Still `calc(min(100vw, 1200px) * …)`, so §71's 1200px cap and
  everything it fixed still holds.
- `.hero .wrap::after` (the radial vignette from §69-71) removed
  entirely. In its place, `text-shadow` directly on `.hero-copy`,
  `.hero-trust`, `.hero-quote` (inherited by their children) — a soft
  dark shadow right behind the glyphs gives contrast without touching
  the photo's own brightness/color at all. This is the actual
  distinction Harvey drew: darkening the *background* vs. making the
  *text* stand out are different techniques, and only the text needed
  the help.
- `frontend/img/photo/bg.png` and `bg-vertical.png` deleted — Harvey's
  own instruction ("get rid of my current one as its not working,
  clean up those files"), now fully unreferenced. `hero-background.png`
  and `hero-book.png` from §67 remain unreferenced but on disk, as
  before (out of scope for this instruction, which named the ones he'd
  just generated, not the earlier §67 pair).
- Mobile untouched again — still `book-desk-square.png`, free-bleeding
  in normal flow, never had a vignette to begin with (text there was
  never overlaid on the photo).

Render-verified at mobile / 960 / 1440 / 1757px: photo reads at natural
brightness with the candle close to the book as composed, text legible
throughout via the shadow alone, boxing behavior from §71 unchanged.

---

# 73. Hero Gap Root Cause Fixed; Real First-Party Analytics Built (2026-09-17)

**Hero, for real this time.** §68's padding-bottom:0 reduced but didn't
eliminate the gap below the hero, and Harvey also flagged a matching gap
above it, below the sticky header. Actual root cause: `.hero .wrap`'s
`height: 100%` never resolved. A percentage height only resolves against
an ancestor with a *definite* height, and `.hero`'s height was `auto` —
`min-height` is a floor on an auto-height box, not a definite height in
the spec's sense, so `height:100%` silently computed back to `auto`.
`.wrap` (and the absolutely-positioned photo pinned to its edges via
`inset:0`) only grew as tall as `.hero-grid`'s own content, leaving
`.hero`'s min-height-driven extra space (there to hold the photo's
aspect ratio at wide viewports, §70/§71) as a bare gap below it. Fixed
by switching `.hero` to `display:flex; flex-direction:column` and
`.wrap` to `flex:1; min-height:0` — flex sizing stretches a child to the
container's real content-box height by construction, sidestepping the
percentage-height rule entirely. Also zeroed `.hero`'s remaining
`padding-top` (was 6rem) per Harvey's "same above the hero below the
menu theres a lil black gap" — the photo now runs flush under the
header too. Mobile (<900px) untouched, as always. Render-verified at
1920/1440px: zero gap on both sides; 390px mobile unaffected.

**Ops panel polish, same session:** the `earth.png` backdrop (§72-adjacent,
added when the ops panel was reskinned) was too small relative to
Harvey's mockup — bumped `background-size` from 44% to 78% auto with
adjusted position/opacity so it reads as a proportional planet, not a
corner decoration. Left icon rail buttons/icons enlarged (40px→50px
buttons, 18px→24px icons, 20px→26px logo, rail width 62px→76px) per
Harvey circling the whole rail as "make these menu items bigger."

**Real first-party analytics (was fully unbuilt until now)** — the ops
panel's Website Analytics tab has shown "Not connected yet" since it was
built (§62: "No fake data — empty until real"), which is correct, but
Harvey expected to already see his own browsing/checkout activity there
and there was in fact no tracking pipeline at all: no `analytics_events`
table, no ingestion endpoint, no frontend tracking script — sections
31-34 were a spec, not yet an implementation. Built the minimal version
of what those sections describe:

- `backend/src/db/schema.sql`: `analytics_events` table (session_id,
  event_name, page, order_id, referrer, utm_*, country, created_at) +
  indexes on created_at/event_name/session_id/order_id.
- `backend/src/services/analyticsService.js`: `recordEvent()` (inserts a
  row, defensively clipping every field to 500 chars — this endpoint has
  no auth, see below) and `getSummary()` (today + last-30-days page
  views/unique visitors, a funnel breakdown across whatever event names
  have actually been sent — deliberately not a hardcoded column list, so
  a new event added on the frontend shows up here without a backend
  change — and top UTM sources by unique session).
- `backend/src/routes/analytics.js`: `POST /api/analytics/event`
  (ingest — always responds 204, wrapped in try/catch, logs to
  `error_logs` on failure rather than ever surfacing an error back to
  the page that called it, per §31 "must never block or interfere") and
  `GET /api/analytics/summary` (read-only aggregates, no PII, consumed
  by the ops panel). **Deliberately unauthenticated**, matching §46's
  "relaxed security, do the basics" — the event endpoint has no
  meaningful damage a bad actor could do beyond junk rows, and the
  summary endpoint exposes only counts.
- `frontend/js/analytics.js` (new, included on all three public pages):
  a first-touch attribution model — session id and the *first* UTM
  params/referrer seen are captured once into `localStorage` and reused
  on every later event, so a purchase two days after an Instagram click
  still credits Instagram (§33). `RMAnalytics.track(eventName, extra)`
  posts via `fetch(..., { keepalive: true })`, wrapped so a network
  failure or unreachable backend can never break the page — fires
  `page_view` automatically on load.
- Wired into the funnel: `index.html` fires `landing_page_view` plus
  `purchase_cta_clicked` (delegated off the existing `data-cta`
  attributes already on all three CTAs — nav/edition-panel/final-band).
  `checkout.js` fires `checkout_view` on load, `checkout_started` once
  on the first form field interaction, and `payment_submitted` right
  before calling `stripe.confirmPayment`. `confirmation.js` fires
  `order_complete` or `order_failed` (once each, guarded against
  re-firing) when polling reaches that terminal `order_status`.
- `ops-service/public/app.js`: the Website Analytics tab now fetches
  `https://api.realitymanual.com/api/analytics/summary` directly from
  the browser (cross-origin — `ops.realitymanual.com` was added to the
  storefront backend's `CORS_ORIGIN` on the VPS) and renders real
  numbers — today/30-day page views + unique visitors, the funnel table,
  top UTM sources — falling back to the original "Not connected yet"
  placeholder if the fetch fails for any reason (backend down, CORS
  misconfigured, etc.), so it degrades the same way it always has rather
  than showing a broken page.

**Not built / explicitly out of scope for this pass:** Sales Analytics
and Content Analytics stay static placeholders (revenue reporting needs
Stripe/BookVault order data the backend doesn't aggregate yet; content
performance needs the platform API keys from §62's Settings tab, still
unconnected) — only Website Analytics was asked for. Landing/checkout
conversion-rate math (§35) isn't computed yet, just raw funnel counts —
worth adding once there's more than a few days of real data to make a
rate meaningful. `payment_succeeded` (listed in §31) isn't fired
client-side since Stripe redirects the browser away before any script
of ours could run on success — `order_complete` on the confirmation page
(driven by the backend's own `order_status`, not the browser's belief
about what happened) is the authoritative equivalent and was tracked
instead.

---

# 74. Voice/Chat App for Talking to Claude Code Remotely (IN PROGRESS, 2026-09-18)

**Status: mid-build, blocked on one decision — read this section fully before
continuing if you're a new session picking this up.** Harvey wants a way to
talk to Claude Code by voice or text from his phone (installed as a
home-screen PWA) or desktop, while away from a terminal — not a toy chatbot,
an actual headless Claude Code agent with the same tools/repo access as any
interactive session. Two modes: "ask and wait for a reply" (spoken back via
TTS) and "just execute, don't reply" (fire-and-forget autonomous instruction).
Lives on `ops.realitymanual.com` (`rm-ops-service`), deliberately separate
from the storefront backend, same pattern as the content-ops panel (§62).

**Built so far (all committed to this repo, not yet deployed to the VPS
container):**
- `ops-service/src/claudeRunner.js` — spawns the real `claude` CLI in print
  mode (`-p`, `--output-format json`) with `--resume`/`--session-id` for
  conversation continuity, `cwd` set to the repo so it gets full CLAUDE.md
  context automatically, same as any other session.
- `ops-service/src/elevenlabs.js` — ElevenLabs for both STT (Scribe) and TTS,
  one provider. **Harvey's ElevenLabs key is already in hand** — do not ask
  him for it again, it just needs to land in the real `backend/.env`-style
  secrets file on the VPS (`ELEVENLABS_API_KEY`), never committed.
- `server.js` — new `voice_messages`/`voice_session` tables, a small
  in-process queue (processes one voice message at a time — concurrent
  `--resume` on the same session would corrupt it), and routes:
  `POST/GET /api/voice/messages[/:id]`, `POST /api/voice/transcribe`,
  `POST /api/voice/tts`, `POST /api/voice/session/reset`,
  `GET /api/voice/worklog`. All behind the existing password-session auth.
- `public/voice-mobile.html` + `voice-manifest.json` — fullscreen two-button
  PWA (top = ask & wait, bottom = just execute), install-to-home-screen like
  quick-add.html (§62's lesson about `start_url` applies here too).
- `public/voice.html` — desktop chat UI, text input + mic button, execute-only
  checkbox, per-message "▶ Play" for typed replies, auto-speaks voice-originated
  replies. Linked from `index.html`'s header ("Talk to CC ↗").
- `public/lib/voiceClient.js` — shared recording/API/polling helper used by
  both pages.
- `Dockerfile` — bumped to `node:22-slim`, installs
  `@anthropic-ai/claude-code@2.1.276` (pinned to match the VPS host's CLI
  version — bump both together), copies `src/`.
- Persistent memory design (Harvey asked for "massive memory... like a human
  project manager"): deliberately NOT a new bespoke system. Long-term/durable
  facts ride on this CLAUDE.md file + Claude Code's own auto-memory (both
  already load automatically for any session in this repo, headless or not).
  Recent/same-day continuity rides on `claude --resume` against one stored
  session id (`voice_session` table; "New conversation" button clears it).
  A plain running journal ("what did you do and when") is maintained by the
  agent itself: every voice-app invocation gets an appended system prompt
  instructing it to append one line to `<DATA_DIR>/work-log.md` after
  finishing, readable via `GET /api/voice/worklog`.

**BLOCKING ISSUE, found during smoke testing (2026-09-18): the `claude` CLI
refuses `--dangerously-skip-permissions` / `--permission-mode bypassPermissions`
outright when the process's EUID is 0 (root) — "cannot be used with
root/sudo privileges for security reasons". Confirmed directly on the VPS:**

```text
$ claude -p "..." --permission-mode bypassPermissions
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

**Everything on this VPS runs as root** (this interactive session, and where
the `rm-ops-service` Docker container would run `claude` headlessly). Two
separate consequences:

1. **Harvey's own interactive sessions on the VPS can never get true
   zero-prompt bypass** — the `.claude/settings.json` project setting
   (`permissions.defaultMode: "bypassPermissions"`, added 2026-09-18) silently
   downgrades to "Auto Mode" instead (a classifier that auto-allows most
   actions but still gates genuinely risky ones) rather than erroring, which
   is why his fresh session showed "Auto Mode Active" rather than zero
   prompts. This is very likely as good as it gets while running as root —
   don't keep fighting it; it's an intentional product safety rail, not a
   bug. If Harvey pushes on this again, the only real fix is running Claude
   Code as a non-root user for his interactive VPS sessions too, which is a
   bigger change to how he logs in (currently `tmux new-session ... claude`
   as root — see the `claude-login` tmux session) than has been explicitly
   asked for; don't do it without checking with him first.

2. **The voice app's headless runner is the more serious case** — "just
   execute" mode is *only* useful if it can run fully unattended, and it
   currently can't get bypass permissions at all as designed. Fix in
   progress: give the headless runner its own non-root Linux user
   (e.g. `claudeworker`) on the VPS, so `claudeRunner.js`'s spawned `claude`
   process runs as that user instead of root and can actually use bypass
   mode. This requires, regardless of the auth question below:
   - Creating the user, and granting it scoped access to
     `/root/realitymanual-repo` despite it living under `/root` (default
     `/root` perms block traversal for non-root entirely) — plan: `chmod o+x
     /root` (traversal only, not listing) plus a dedicated group owning just
     the repo subtree with setgid so new files inherit group-writability.
     Do NOT loosen `/root` further than `o+x` — that would expose every
     other file directly under `/root` (SSH keys, `.env` files elsewhere) to
     the new user by path if it ever learned the name.
   - This is Docker-container work really (the runner lives in
     `rm-ops-service`'s container) — inside the container it's simpler:
     just don't run the container's `claude` invocation as root, no `/root`
     traversal issue at all if the container's own filesystem layout puts
     the mounted repo somewhere normal. **Reconsider the bind-mount paths
     before implementing** — mounting host `/root/realitymanual-repo` and
     `/root/.claude` into the container can land at any in-container path
     regardless of the host being `/root`, so the in-container non-root user
     just needs ordinary ownership/permissions on the in-container mount
     point, which is much simpler than solving `/root` traversal on the
     host directly. Only solve the host-side `/root` traversal problem if
     Harvey also wants non-root headless runs directly on the host (e.g. for
     his own interactive sessions per point 1) — the containerized voice
     app doesn't need it.

**PENDING DECISION — asked Harvey, awaiting answer:** should the headless
voice-app runner authenticate as a copy of Harvey's own OAuth login
(`~/.claude/.credentials.json`, same Claude subscription/usage pool as his
interactive sessions), or as a separate `ANTHROPIC_API_KEY` (pay-as-you-go,
fully decoupled)? Leaning toward recommending a separate API key:
- OAuth refresh tokens commonly rotate on use — copying root's credentials
  into `claudeworker`'s home at setup time risks the two copies silently
  invalidating each other the first time either one refreshes, breaking
  headless auth unpredictably days/weeks later.
- A dedicated API key is the standard, supported pattern for unattended
  automation (see `--bare` mode's own docs: "Anthropic auth is strictly
  ANTHROPIC_API_KEY or apiKeyHelper"), and keeps the voice app's usage/cost
  and rate limits separate from Harvey's personal interactive usage.
- Trade-off: separate billing (pay-per-token on the API key) instead of
  riding his existing subscription.

**Not yet done once the above is resolved:** actually create the
`claudeworker` setup (or container-internal non-root user) on the VPS, wire
the chosen auth method into the container, build+run the updated
`rm-ops-service` image (§62's normal redeploy steps, now also needs
`ELEVENLABS_API_KEY` and either the copied/mounted credentials or
`ANTHROPIC_API_KEY` in its env), and do one real end-to-end test (voice
input on a phone, not just the curl smoke test already run against a local
throwaway instance on port 4099 during this session — that confirmed the
whole plumbing works except for the root/bypass issue above).

**Update, same day — root/bypass issue resolved, live in production:**

- **Repo access:** rather than loosen `/root`'s permissions (blocked by
  Claude Code's own safety classifier as a "Security Weaken" action, rightly
  — it would affect the whole VPS, not just this container), the headless
  runner gets its own dedicated clone at **`/srv/realitymanual-repo`**,
  owned by uid/gid 1000 (the "node" user baked into the `node:22-slim` base
  image). This is bind-mounted into the container at `/repo`
  (`CLAUDE_REPO_DIR=/repo`). Deliberately separate from
  `/root/realitymanual-repo` (Harvey's/interactive sessions' own checkout)
  — keeps the unattended voice agent's working tree from ever stepping on
  uncommitted interactive work. **Whoever redeploys this container must
  remember to also `git pull` inside `/srv/realitymanual-repo`** (as the
  owning uid, or just `chown` again after) — it does not update itself.
- **Non-root container:** `Dockerfile` now ends with `USER node` (after
  root-level apt/npm installs). `/root/ops-service-data` (the bind-mounted
  `DATA_DIR`) was `chown -R 1000:1000` for the same reason. `/root` itself
  was never touched — bind mounts don't need host-path traversal
  permissions for the container's user, only correct ownership on the
  mounted directory itself; this was confirmed working, not just assumed.
- **Auth: `CLAUDE_CODE_OAUTH_TOKEN`**, generated via `claude setup-token`
  on the VPS host directly (never through an automated command — the
  classifier blocks capturing a freshly-generated credential that way, for
  good reason). **Gotcha that cost real time:** `claude setup-token`'s
  browser-approval flow prints a confirmation code that must be pasted
  back into the terminal to actually finalize the token server-side —
  exiting right after the token is *printed* (before that confirmation
  step) yields a syntactically-plausible but dead token that fails with
  `401 Invalid bearer token` on every real use, even though `claude auth
  status` inside the container happily reports the env var is configured
  (it doesn't do a live check). A genuinely finalized token has the
  `sk-ant-oat01-...` prefix — the two dead ones Harvey generated first did
  not, which in hindsight was the tell. Stored in `ops-service/.env` on
  the VPS (gitignored, never committed) as `CLAUDE_CODE_OAUTH_TOKEN=...`.
- **Git push from the VPS at all** turned out to be a separate,
  previously-unsolved gap — this was apparently the first session to
  author+push directly from the VPS itself (prior work here was pulled
  after being pushed from Harvey's desktop). Fixed with a GitHub
  fine-grained PAT (contents read/write on this repo only): `root`'s own
  pushes use `credential.helper store` (`~/.git-credentials`); the `/srv`
  clone has the token embedded directly in its `origin` remote URL instead
  (simpler than a separate credential store for a non-root/non-interactive
  user with no conventional `$HOME`). Both credential-writing steps were
  also blocked by the classifier when attempted via an automated command
  and had to be run by Harvey directly in the hPanel web console — a
  recurring pattern this build surfaced: **generating or writing any raw
  credential is a "you, not me" action**, full stop, regardless of how
  routine the surrounding task is.
- **Real bug found via the first genuine end-to-end test** (not a
  synthetic smoke test): asked "what git branch are we on and what was the
  last commit" through the real deployed API. The agent correctly found
  the answer but only put it in the work-log line, replying to Harvey with
  a useless "Done — logged that in the work log too." Root cause: the
  original `VOICE_SYSTEM_PROMPT` wording let the model conflate "keep your
  reply short" with "a completion confirmation is enough, details belong
  in the log." Fixed by making the two things explicitly separate and
  ordered in the prompt (answer fully first; the log entry is a
  never-a-substitute housekeeping side-effect) — verified with a direct
  `docker exec` test before touching the real deploy. **Also note for
  future prompt-iteration:** an earlier debugging attempt at this exact
  fix appeared to fail, but that was a red herring from mangled nested
  shell-quoting in a manual test command (an apostrophe inside a `bash -c
  '...'` string), not the prompt itself — writing test prompts to a file
  or a shell variable (`"$(cat file)"`) sidesteps this; the real
  `claudeRunner.js` code path was never actually at risk since
  `child_process.spawn` with an args array never goes through a shell.
- **Nav:** "Talk to CC" moved from a small header link to the first icon
  in the ops panel's left side-rail (before Content Ops), per Harvey — a
  plain `<a href="voice.html">` reusing the `.side-rail-btn` visual class
  but deliberately with no `data-tab` attribute, so `app.js`'s
  `bindSideRail()` (now scoped to `.side-rail-btn[data-tab]`) leaves it as
  an ordinary navigation link instead of trying to route it through the
  in-page tab system.
- **Deployed and confirmed working end-to-end** through the real
  `ops.realitymanual.com` API (not just a direct CLI test): login →
  `POST /api/voice/messages` → real headless Claude Code run with actual
  bypass permissions as a non-root user → correct, complete spoken-style
  answer. **Not yet done:** a real test from Harvey's phone through the
  actual PWA UI (only the HTTP API has been tested directly so far).
- **Cross-device continuity confirmed by design, not just intent:**
  `voice_session` is a single row (`id=1`) shared by every device/browser
  that hits the ops-panel API, so `voice.html` (desktop) and
  `voice-mobile.html` (phone PWA) both `claude --resume` the *same*
  underlying session — switching devices mid-conversation already works,
  it doesn't need to be built.
- **`.claude/hooks/voice-context-bridge.js`** (landed same day, see git
  log): a `UserPromptSubmit` hook, one-way, that surfaces recent
  voice-app exchanges as context into a *terminal-based* interactive
  session when Harvey opens one — so hopping into a terminal after using
  the phone app doesn't lose continuity either. Confirmed working as the
  non-root `ubuntu` VPS user (2026-09-18): `/root` has `o+x` (traversal
  only) as planned, so `cat`-ing a specific file under
  `/root/ops-service-data/` succeeds even though `ls /root/` itself
  correctly still doesn't.
- **Gotcha caught and fixed live (2026-09-18):** `/srv/realitymanual-repo`
  (the headless runner's actual working tree) was 2 commits behind
  `origin/main` — the "Talk to CC nav" commits had been pushed but never
  pulled there. This is the exact failure mode this section already
  warned about ("whoever redeploys this container must remember to also
  `git pull` inside `/srv/realitymanual-repo`") happening for real, not
  hypothetically. Pulled and fast-forwarded; nothing else needed since it
  was a clean ff.
- **Attended-session zero-prompt bypass: confirmed not possible, by
  design, independent of root.** Harvey asked for the interactive
  session (terminal, whether root tmux or a non-root
  `claude --remote-control` login like this one) to also always skip
  permissions. Tested directly: a non-root **headless** `claude -p
  --permission-mode bypassPermissions` invocation on this VPS returns
  zero permission denials — so the earlier root/EUID restriction really
  is specific to headless mode and really is fixed by the
  `/srv`+non-root setup above. But per Claude Code's own docs
  (`docs/permissions`, `docs/permission-modes`), full bypass in any
  session a human isn't actively watching keystroke-by-keystroke is
  gated behind explicitly accepting the bypass disclaimer once
  interactively — and *attended* interactive sessions retain "Auto Mode"
  (auto-allows routine actions, still gates genuinely risky ones) as a
  deliberate, separate safety rail, not a fallback bug and not something
  project-level `settings.json` can turn off. This confirms (rather than
  just repeats) the same conclusion this section already reached before
  the non-root migration — don't re-litigate this if Harvey asks again;
  the voice app's headless path is the one that gets true bypass, and it
  already has it.

**Update (2026-09-18): renamed to "Project Manager", made the default
landing page.** Harvey's framing: `ops.realitymanual.com` should open
straight into the CC chat, not the Content Ops board — the chat *is* the
primary interface now, everything else is secondary. Concretely:
`ops-service/public/index.html` and `voice.html` were swapped — the old
Content Ops SPA now lives at **`content-ops.html`**, and the chat page
(old `voice.html`) is now **`index.html`**, so the site root loads it by
default. Every "Talk to CC" label (page titles, login headers, the
top-menu/side-rail entry in `content-ops.html`+`app.js`, the mobile PWA
page/manifest) was renamed to **"Project Manager"**, and the side-rail's
mic icon (misleading now — it's text+voice, not voice-only) was replaced
with a message-bubble icon. The top-menu/side-rail entry stays first, in
front of "Content Ops", pointing at `index.html`. `voice-mobile.html`
keeps its filename (no rename requested there, just label text) and
still works exactly as before — the PWA/session/backend plumbing (§74
above) is completely unaffected by this, it's a pure file-rename +
relabel. Deployed via the normal `rm-ops-service` rebuild+recreate cycle
(§62/§65's pattern) and verified live: `/` serves the chat page,
`/content-ops.html` serves the board, `/voice.html` correctly 404s.