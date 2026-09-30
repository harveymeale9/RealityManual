
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
`/frontend` directory when storefront files change on `main`), with Cloudflare sitting in
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

**Historical note, superseded by §239:** at the time of this pass, the
following was deliberately not built (see §25-30
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
order submission is built, per §27's "if not, poll" instruction. Those paid
order and polling pieces are now implemented as described in §239.

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

**Correction, same day: the two-page split above was wrong, reverted.**
Splitting Project Manager into its own page (`index.html`) with Content
Ops moved to `content-ops.html` broke real things Harvey caught within
minutes of testing: `#content-ops` hash links/bookmarks landed on the
chat page (which ignores hashes entirely) with no obvious way back, and
the chat page's only nav was one small text link — no side-rail, no top
tabs. **Project Manager is now `TABS[0]`** in the single SPA shell
(`ops-service/public/index.html`, `app.js`) — a real hash-routed tab
(`#project-manager`, default when the hash is empty) rendered into
`panelMain` exactly like Content Ops/Settings/etc., so it automatically
gets the same side-rail + top-tabs nav, and `#content-ops` (or any other
tab hash) works correctly again. `content-ops.html` is gone;
`voice-mobile.html` (the phone PWA entry point) is untouched — still a
deliberately separate, minimal standalone page, not part of this SPA.

**Same pass, an actual bug (not a design call): Claude Code session
transcripts live in `/home/node/.claude` inside the `rm-ops-service`
container — not on any bind-mounted volume.** The two container
rebuilds done for the (bad) two-page split above silently wiped that
directory both times, orphaning the `claude_session_id` stored in
`voice_session` and breaking every subsequent message with "No
conversation found with session ID: ...". Fixed two ways: `/home/node/.claude`
and `/home/node/.claude.json` are now bind-mounted to
**`/root/ops-service-claude-home`** on the VPS (same pattern as
`/root/ops-service-data`), so a rebuild no longer wipes conversation
history — **whoever runs the container's `docker run` must include both
`-v` flags** (see the full command near the top of §75-adjacent redeploy
notes, or just `docker inspect rm-ops-service` on a working instance and
copy its mounts) or this regresses again. Defense in depth on top of
that: `processVoiceMessage()` in `server.js` now detects this specific
failure (`/no conversation found/i` in the error) and retries once with
a fresh session instead of leaving the conversation permanently stuck —
so even if the mount is ever missing again, one message is wasted
instead of the whole voice app going dark until someone manually clears
`voice_session`.

**New feature, same pass: the Project Manager tab is now two columns.**
Left = the existing clean thread (user messages + final replies,
unchanged). Right = a live "Activity" pane showing tool calls and
thinking as they happen — deliberately *never* the final reply text
(that stays exclusive to the left, no duplication) — per Harvey: "I want
on the right side the code-like outputs... on the left the clean
output/result... so I can basically ignore the stuff on the right."
Required switching `claudeRunner.js` from `--output-format json`
(blocks until the whole run completes, one lump result) to
`--output-format stream-json --verbose`, parsing each JSONL event as it
arrives and turning `tool_use`/`thinking` content blocks into short
lines via an `onActivity` callback — plain `text` blocks are skipped on
purpose, since that's the reply content the left column already owns.
Persisted incrementally to a new `voice_messages.activity_log` column
(JSON array, safe `ALTER TABLE` that no-ops if already migrated) rather
than kept only in memory, so `GET /api/voice/messages/:id` — the same
endpoint the frontend already polled for the reply — now also carries
the growing activity trail; `voiceClient.js`'s `pollMessage()` gained an
`onTick` callback so the UI can render it live without a second
endpoint or a websocket. Verified event shapes against the real CLI
before wiring the parser (`assistant` messages with `tool_use`/`thinking`
blocks, `user` messages with `tool_result`, a final `result` event) —
this is why plain-text stripping and the `tool_result` content-can-be-
string-or-array handling are both there, not guessed.

Both fixes and the new pane were verified against the real deployed API
end-to-end, not just locally: stale session cleared → next message
created a fresh one and got a correct reply; `activity_log` present and
correctly parsed on the wire; `/`, `#content-ops`, `#settings` etc. all
route correctly with the side-rail/top-tabs visible throughout.

---

# 75. Project Manager: Cross-Device Thread Sync (2026-09-18)

Harvey's ask: desktop and mobile should mirror each other as "one very long
chat thread" — sending an instruction from his phone at a coffee shop should
show up on the desktop panel too, and opening Project Manager on either
device should resume the last conversation instead of a blank slate, not
just replay whatever that one device itself sent.

**What was actually missing:** the backend already stored every message in
one shared `voice_messages` table and `claude --resume`d one shared
`voice_session` row (§74 — cross-device *conversation continuity* already
worked), and `GET /api/voice/messages` already returned full history. The
gap was purely client-side: the desktop Project Manager tab never called it
at all (always opened blank), and `voice-mobile.html` called it exactly
once on load and only rendered already-finished rows, then never checked
again — so neither UI reflected anything the *other* device did afterward.

**Fix — no websocket needed, polling is enough for a single-admin panel:**
`ops-service/public/lib/voiceClient.js` gained `RMVoice.syncThread(callbacks,
opts)`, a small shared engine both pages now use. It calls
`GET /api/voice/messages` on an interval (2.5s default, 60-row window) and
diffs each row against what it's seen before by id: a never-seen id fires
`onNewMessage`; a status transition into pending/running (bucketed together
as `"inflight"`) fires `onPending` once; a transition to `done`/`error`
fires `onDone`/`onError`; growth in `activity_log` fires `onActivity`. Its
first tick against an already-populated table *is* the history load — there
is no separate one-shot fetch to keep in sync with the recurring one, which
is what guarantees the two can never drift apart.

Both `app.js`'s `bootProjectManager()` and `voice-mobile.html` wire up a
`syncThread` instance to their own existing render functions
(`addMessage`/`addAssistantMessage`/`addTyping`), so opening either page now
replays the full recent thread on load and keeps receiving anything sent
from the other device while it sits open. A message this device sends
itself is still rendered optimistically and instantly (unchanged
responsiveness) — right after `POST /api/voice/messages` returns, the code
calls `sync.markKnown(created)` so the engine's next tick treats that row as
already-rendered rather than duplicating it, and later calls
`sync.markKnown(row)` again with the terminal status once known locally
(mobile's blocking voice-overlay flow does this explicitly; desktop's
always-visible thread just lets the shared engine's own `onDone`/`onError`
render the completion). `autoSpeakIds` (per-page, not persisted) tracks
which in-flight ids this device itself started by voice, so only those get
spoken aloud when they complete — a reply that appears because the *other*
device triggered it is shown as text only, never auto-played.

Desktop's poller is started/stopped alongside the tab itself
(`renderActiveTab` stops it when leaving `#project-manager`,
`bootProjectManager` stops any prior instance before starting a new one) so
switching tabs repeatedly can't leak multiple concurrent pollers. Mobile's
starts once, from `showApp()`, only after login is confirmed — never
eagerly at script-load time, which would otherwise hit the authenticated
messages endpoint before a session cookie exists.

**Deliberately not built:** a real WebSocket/SSE push channel. Two devices
polling every 2.5s each is negligible load for a single-admin internal
tool, and it sidesteps an entire class of reconnect/backoff complexity a
socket would need — consistent with §6's "avoid unnecessary complexity"
philosophy. Worth revisiting only if the polling interval itself ever
becomes the complaint (it hasn't been).

---

# 76. Fixed: Persistent-Session Deadlock (2026-09-18)

The persistent Agent SDK session work from §75's neighboring commit
("Project Manager: persistent Agent SDK session instead of per-message CLI
spawn") shipped with a deadlock that made **every single Project
Manager/voice message hang forever** — found and fixed by a different
session than the one that wrote it, right after Harvey got disconnected
mid-task and a peer session asked this one to check in. Worth reading in
full if touching `claudeRunner.js` again.

**The bug:** `ensureSession()` awaited `sess.ready` — resolved only once a
`system`/`init` event came back from the SDK's `query()` iterator — before
returning the session to its caller. But in streaming-input mode, the
underlying CLI process doesn't emit that event until it has received the
*first* pushed message, and that first message is only ever pushed from
inside `runTurn()`, which callers only reach *after* `ensureSession()`
returns. Nothing could ever become ready. Confirmed empirically, not just
reasoned about: a fresh brand-new session hung identically to a resumed
one (ruling out "bad resume id" as the cause), with an empty `activity_log`
in both cases (confirming nothing was ever even sent to the CLI).

**The fix:** `ensureSession()` no longer awaits `sess.ready` — it returns
the session immediately after creating it. The background `pump()` loop is
already running independently by that point and processes events as soon
as the first real message (pushed by the caller's subsequent `runTurn()`
call) unblocks the underlying process. A stale/dead resume id still
self-heals, just one turn later than the original fail-fast attempt
intended: the pump's `catch` rejects the pending turn via
`failAllPending()` once the process actually errors out, and its `finally`
clears `currentSession`, so the *next* message after a bad resume
automatically gets a fresh session.

**How this was found:** a peer Claude Code session messaged this one
asking for a status check on Harvey's behalf after he got disconnected
mid-task. This session had no memory of that work at all (confirming via
git log it was a *different* session that built it), but rather than just
saying "not me," it ran a real test against the live deployed service —
sent an actual message through `POST /api/voice/messages` and watched it
sit on `status: "running"` for minutes with zero output. That's what
turned "let me check" into "this is actually broken right now," which
mattered: because the SDK session is a single module-level
`currentSession`, one hung turn doesn't just fail its own request — it
wedges the shared in-process queue (`server.js`'s `voiceQueue` processes
one message at a time) so *every subsequent* Project Manager message would
have queued behind it forever too. `docker restart rm-ops-service` cleared
the immediate wedge while the real fix was found and deployed.

**Verified after the fix**, against the real deployed service: sequential
messages complete in ~5-6s each (not hung), `activity_log` populates
correctly with real tool-call summaries, and a message sent right after
clearing the stored session (`POST /api/voice/session/reset`) also
completes normally — both the resume and fresh-session paths work.

**Process note for future sessions:** this repo is now being actively
worked on by multiple concurrent Claude Code sessions (this interactive
one, a non-root `ubuntu` Remote Control session doing most day-to-day
work, and CI's own automated deploy). Don't assume a `git log` entry you
don't recognize is wrong or stale — `git fetch`/`pull` and re-read this
file before assuming you have the full picture, the same way this session
had to when it found work here it had no memory of doing.

---

# 77. Voice-App Agent: Summarize Todo Items Instead of Pasting Verbatim (2026-09-18)

Harvey noticed that when the headless Project Manager agent (the one
`claudeRunner.js`/`server.js` spawns for voice/chat messages, §74) uses
its own internal TodoWrite task list while working on a multi-step
instruction, the todo item text was his entire raw message rather than a
short description of the step. Fixed by adding a paragraph to
`VOICE_SYSTEM_PROMPT` in `ops-service/server.js`: when this agent tracks
a turn with a todo list, each item should be a short plain-language
summary of that step (how you'd title a task for a colleague), never a
verbatim paste of what Harvey said. Applies only to the voice-app agent
(this is injected via `appendSystemPrompt`, §74) — normal interactive
sessions are unaffected.

Takes effect the next time `rm-ops-service` is rebuilt/redeployed (§62's
normal redeploy cycle, or the `deploy-ops-service.yml` CI workflow if
it's picked this commit up automatically — check
`ops-service/.ci/last-run.log` for the most recently deployed commit
hash before assuming this is already live).

---

# 78. Content Ops: Visually Mark Pieces Created By an Agent (2026-09-18)

Harvey wants to be able to tell, at a glance on the Kanban board, which
pieces he came up with himself versus which ones a Claude Code session
(voice/chat agent or an interactive session, acting on its own initiative
rather than typing up something Harvey dictated) created from scratch —
whether it's currently sitting in Ideation or has already moved to
Outline Started.

**Convention (any Claude Code session creating a `pieces` record via the
API, from now on):** set `createdBy: 'agent'` on the record. Nothing
sets this automatically server-side — `ops-service/server.js`'s
`PUT /api/store/:storeName/:id` just stores whatever body it's given
(see §62), and the normal UI creation paths (`createDraft()` in
`app.js`, `quick-add.html`'s save handler) deliberately don't set it,
since those are always Harvey's own ideas even when quick-add was
dictated by voice. Only set it when *you* are the one originating the
idea/content, not just typing on Harvey's behalf.

**Rendering:** `ops-service/public/app.js`'s `cardHtml()` adds a
`card-ai` class when `piece.createdBy === 'agent'` (plus a
`title="Created by Claude Code"` tooltip). `style.css` gives `.card-ai` a
subtle indigo background tint and border (`#8b7cf6`-ish, distinct from
the board's green accent) rather than a loud badge — Harvey specifically
asked for a background difference, not new UI chrome. Applies at every
stage the card passes through, not just Ideation/Outline Started (no
reason to strip the marker once it progresses further).

This is a data-driven flag, not a stage/column-based inference — a piece
keeps its `card-ai` styling for its entire lifetime on the board unless
someone removes the field.

---

# 79. Voice-Mobile PWA: Quick Link to Content Ops (2026-09-18)

`ops-service/public/voice-mobile.html` (the phone home-screen PWA
shortcut, §74) had zero navigation to anything else on the panel — it's
a deliberately standalone page, so there was no way to jump from it to
the Content Ops board to check on ideas without leaving the PWA for the
browser and typing in `ops.realitymanual.com` manually. Harvey asked for
a quick way to move between the two.

Added a small fixed pull-tab-style button (`.v-nav-btn`, reusing the
exact Content Ops kanban icon from `index.html`'s side-rail) on the left
edge at mid-screen, mirroring the existing queue pull-tab already on the
right edge — deliberately not a top-corner button, which was tried first
and overlapped the "Ask & Wait for Reply" button's own icon/label. It
links straight to `index.html#content-ops`; the SPA's hash router
(`app.js`, `renderActiveTab`) already lands directly on that tab without
needing to pass through Project Manager first. The reverse direction
(Content Ops → Project Manager) needed no new code — `index.html`'s
mobile view already keeps its horizontal-scrolling top tab row visible
with Project Manager as `TABS[0]` (§74's SPA merge), so that's already
one tap away; `voice-mobile.html` itself is also always reachable again
directly from its own home-screen icon.

---

# 80. Project Manager: Queue Shows Recent Completions Too (2026-09-18)

The queue panel (desktop `app.js` and `voice-mobile.html`, both with their
own `renderQueue(rows)` — this widget predates any shared-helper
abstraction between the two pages and the fix kept that existing
duplication pattern rather than introducing a new one) only ever showed
`pending`/`running` rows, so it went completely empty the instant nothing
was actively running — no trail of what had just finished. Harvey wanted
the last handful of completed items to stay visible, visually distinct
from what's currently in progress, capped rather than growing forever.

`renderQueue` now also derives `recentDone` — rows with `status: 'done'`
or `'error'`, sorted by `completed_at` (falling back to `created_at`),
capped to `RECENT_DONE_LIMIT = 5` — and renders them below a "Recently
completed" divider under the existing in-progress list. Older completions
just fall out of the top-5 window each tick; nothing is deleted from the
`voice_messages` table itself, this is a display-only cap on the queue
widget (full history still lives in the chat thread and
`GET /api/voice/messages`). Styling (`style.css`): `.pm-queue-done` is a
muted/receded grey (`opacity: 0.72`, plain `--surface-2` background) and
`.pm-queue-failed` uses the existing `--error`/`--error-soft` tokens —
both clearly different from `.pm-queue-active`'s green accent fill, so
"still working" vs. "already finished" reads at a glance.

---

# 81. Project Manager Chat: Bold/Italic Weren't Rendering (2026-09-18)

Harvey flagged that `**bold**` text in a reply showed up in the Project
Manager chat bubble as literal asterisks instead of actually bold.
Root cause: `renderMarkdownLite()` in `ops-service/public/lib/voiceClient.js`
(shared by `app.js` and `voice-mobile.html`) only ever recognized fenced
code blocks and inline `` `code` `` — its own comment said as much
("NOT a general markdown library... the two things Harvey actually asked
for"), but the model's replies routinely use `**bold**`/`*italic*` in
normal prose, so those were landing as raw asterisks in every reply, not
just the one Harvey happened to notice.

Fixed by extending the same text-splitting approach already used for
inline code — `appendTextWithInlineCode`'s split regex now also matches
`\*\*[^*]+\*\*` (bold, tried first) and `\*[^*]+\*` (italic, tried
second so a `**` pair isn't misread as two stray single asterisks) —
rendering `<strong>`/`<em>` elements via `textContent` alongside the
existing `<code>` handling. Still fully safe against HTML injection: only
`textContent` is ever set, never `innerHTML`, same as the pre-existing
code-block path. `stripMarkdownForSpeech()` already stripped both bold
and italic markers before TTS, so spoken replies were never affected —
this was a text-rendering-only bug.

---

# 82. Deploy Pipeline Was Silently Wedged All Session (2026-09-18)

Harvey said the new Content Ops nav button (§79) wasn't visible on
mobile. Investigating turned up something bigger: **every single change
pushed this session — §77 through §81 — had actually failed to deploy**,
despite each one being reported as "pushed, will go live on the next
auto-deploy." CI ran and reported (honestly, per §76's earlier fix)
every time; the failure was one layer deeper, in `ops-service/deploy.sh`
itself running on the VPS.

**Root cause:** `deploy.sh`'s `REPO_DIR` (`/root/realitymanual-repo`) is
deliberately dual-purpose — it's both the CI deploy script's build source
*and* an interactive root session's own working copy (§74 explains why
`/srv/realitymanual-repo` exists as a separate clone: specifically to
keep the unattended voice-app runner's tree from colliding with this
one). Some root session had uncommitted local edits to `CLAUDE.md` and
`ops-service/server.js` sitting in `REPO_DIR`, and `deploy.sh`'s plain
`git pull` has aborted on that exact conflict on every run since
`e678b49` (confirmed via `ops-service/.ci/last-run.log` across five
consecutive CI runs, all `ssh exit code: 1`) — meaning the live
container had been stuck on `e678b49` this entire session, unnoticed
until Harvey caught the missing button.

**Fixed:** `deploy.sh` now checks `git status --porcelain` in `REPO_DIR`
before pulling and auto-stashes (`git stash push -u`) if dirty, rather
than aborting — nothing is discarded, just parked in the stash list.
**This fix can't self-apply**, though: the deploy workflow SSHes in and
runs whatever copy of `deploy.sh` is *already checked out* on the VPS,
before that script's own `git pull` has run — so the fix is stuck behind
the exact problem it solves until someone with root manually clears
`REPO_DIR`'s local changes once. Full handoff — what to check, why it's
not safe to blindly discard, how to confirm the unstick worked — written
to `ops-service/.ci/handoff-notes.md` (gitignored/untracked by design,
same as the earlier VPS_SSH_KEY handoff note this session found and
resolved).

**Also queued behind this same blocker:** the §78 (agent-created card
styling), §79 (mobile nav button), §80 (queue recent-completions), and
§81 (bold/italic rendering) changes, plus this section's own `deploy.sh`
fix — none are live yet. Once someone unblocks `REPO_DIR` and a deploy
completes, re-verify all of the above against the real deployed service,
not just against this repo's `git log`.

**Process lesson:** "pushed to `main`" and "CI reported success" are not
the same claim as "the change is live" — this pipeline has two
independent layers that can each fail silently in a way the other
doesn't catch (§76 already found and honestly-failed one; this is a
different one, one layer further in). When a change is reported as
deployed but the user can't see it, check `ops-service/.ci/last-run.log`
for the actual outcome before assuming it's a code or caching problem.

---

# 83. Voice-Mobile Queue Drawer: Tap Outside to Dismiss

The §80 queue drawer in `voice-mobile.html` only ever closed by tapping
the same pull-tab that opened it. Harvey wanted tapping back into the
rest of the app (the ask/execute buttons, the chat thread — anything
outside the drawer) to dismiss it too, not just the one specific tab.
Added a `document` click listener that closes `#queueDrawer` when it's
open and the click landed outside both the drawer and the pull-tab
itself. Desktop's queue panel (`app.js`) isn't a toggleable drawer — it's
a static always-visible column — so this only applies to the mobile PWA.

---

# 84. Sent Images Weren't Shown in the Chat Bubble

Harvey attached an image to a message and couldn't see it in the chat
after sending — confirmed: `addMessage('user', text || '(image)')` (both
`app.js` and `voice-mobile.html`) only ever rendered a text placeholder,
never the actual picture. The uploaded file itself is genuinely
transient server-side too — `POST /api/voice/messages` reads it into a
base64 block for that one Claude Code turn and never persists it (no
`image_path` column, no file kept under `DATA_DIR`, nothing served back
by any route) — so there was truly no image data anywhere to display
after the fact, on any device, ever.

**Fixed, scoped narrowly:** `addMessage()` in both files now takes an
optional `imageFile` argument; when present it renders an actual `<img>`
thumbnail (via `FileReader.readAsDataURL`, same technique already used
by the existing pre-send preview) inside the sender's own chat bubble,
with any typed caption underneath. `sendTyped()` (mobile) / `sendText()`
(desktop) now pass the pending `File` object through instead of falling
back to the literal string `'(image)'`.

**Deliberately not fixed in this pass:** this only helps the sending
device see its own image at send time, using the in-memory `File`
object the browser already has — it does not persist the image
anywhere. A page reload, `GET /api/voice/messages`, or the other device
via `syncThread` (§75) still has no image data to show, only whatever
transcript text was stored (`'(image attached, no caption)'` if there
was no caption — see `server.js`'s `finalText` fallback). Making an
attached image durably visible everywhere would need actual server-side
storage (a file under `DATA_DIR`, a serving route, a `voice_messages`
column) — a real feature, not this bug fix; worth doing if Harvey asks
for cross-device/reload image history specifically.

---

# 85. Replies Now Show Which Message They're Answering

A reply can land well after Harvey's sent it — sometimes minutes, per
§74's whole ack/delay design — and he may well have sent other messages
in the meantime (from either device, since the thread is shared, §75).
With nothing marking which question a given reply answers, a late reply
was ambiguous once more than one exchange was in flight or scrollback.

Both `app.js` and `voice-mobile.html`: `addAssistantMessage()` and
`addMessage()` now take an optional `replyToText` argument. When
present, a small muted "Re: <snippet of the original message>" line
(`.pm-msg-replyto`, truncated to 80 chars) renders above the reply body.
`onDone`/`onError` in both files' `syncThread` wiring pass `row.transcript`
— the shared `voice_messages` row already stores the question and answer
together (`transcript`/`reply_text` on the same row), so no schema change
or new data was needed, this is pure rendering. Applies to error replies
too, not just successful ones, for the same reason. A small
`replyToSnippet()` helper is duplicated between the two files rather than
factored into `voiceClient.js`, matching this codebase's existing
precedent of small page-specific render helpers not being shared (§80).

---

# 86. Recording: No More "Call Connected" Bluetooth Tone, Screen Stays Awake

Two mic-recording complaints, both fixed in `startRecording()` in the
shared `ops-service/public/lib/voiceClient.js` (used by both `app.js` and
`voice-mobile.html`, so both pages get both fixes):

**"Call started"/"call ended" tone on Bluetooth.** Chrome's default
`getUserMedia({ audio: true })` applies voice-processing (echo
cancellation, noise suppression, AGC) to the captured audio — the same
processing path used for an actual phone call. On Android, when a
Bluetooth headset is connected, requesting that path forces the headset
to switch from its music profile (A2DP) to the call profile (HFP), which
is what plays the connect/disconnect tone Harvey was hearing (ChatGPT's
native app doesn't hit this because it isn't a web page going through
Chrome's `getUserMedia` voice-processing path). Fixed by requesting
`{ audio: { echoCancellation: false, noiseSuppression: false,
autoGainControl: false } }` instead — this is genuinely the only lever
available from web content; there's no API to block the Bluetooth
profile switch directly, and the fix trades slightly lower mic quality
(no echo cancellation) for avoiding it, which is an acceptable trade for
short dictation.

**Screen going to sleep mid-recording.** Added a Screen Wake Lock
(`navigator.wakeLock.request('screen')`), acquired right after the mic
stream is granted and released when the recorder actually stops (covers
both a normal finish and a cancel, since both paths call `.stop()`).
Feature-detected (`'wakeLock' in navigator`) so it's a silent no-op on
unsupported browsers (Safari <16.4, non-secure contexts) rather than an
error — same defensive pattern as everything else in this file. This is
what was causing Harvey to lose the stop-recording button entirely if he
talked past his phone's auto-lock timeout.

---

# 87. Voice Questions Weren't Actually Being Answered Out Loud

Harvey noticed he kept hearing the same generic "Got it — I'll get right
on that" line for everything, including real questions, and never
actually heard a spoken answer. Root cause, in both `app.js` and
`voice-mobile.html`'s `onDone` handler:

```js
if (!ack.fired) Voice.speak(row.reply_text || '').catch(function () {});
```

The 10s "still working on it" ack (`VOICE_ACK_DELAY_MS`) was designed
(§74) so a genuinely slow multi-minute task doesn't get its result
spoken late out of nowhere — reasonable for a background task. But
respond-mode ("Ask & Wait for Reply") is specifically the button whose
whole promise is "hear CC's answer back," and the VOICE_SYSTEM_PROMPT
(§74/this section's neighbor) explicitly tells CC to investigate
thoroughly before answering rather than shortcut — which routinely takes
well over 10 seconds. Combined, that meant most real questions sent by
voice never got a spoken answer at all: just the generic ack, then
silence (text-only).

**Fixed:** `onDone` now always calls `Voice.speak(row.reply_text)` once
an ack exists for that message (i.e. it was sent by voice expecting a
spoken reply), regardless of whether the ack already fired — the ack is
just a "still thinking" placeholder now, never a substitute for the real
answer. `onError` got the same treatment (speaks `row.error_message`),
since a question that hit an error still deserves to be told something,
not silence. Also reworded `RESPOND_ACK_TEXT` from "Got it — I'll get
right on that. I'll let you know here once it's done." (task-presuming
phrasing, wrong for a plain question) to a neutral "Still working on
that — I'll have an answer for you in just a moment." — chosen because
the client can't know in advance whether a given message will turn out
to be a task or a question, so the ack text itself has to work for
either. `EXECUTE_ACK_TEXT` ("Got it — I'll take care of that now.") is
untouched — execute-mode is unambiguously always a task by construction
(that's the whole distinction the two buttons encode), and it still
correctly never speaks a final result.

---

# 88. PM Host Access, Self-Healing Queue, and Session-Loss Context (2026-09-18)

Harvey's ask: he wants the Project Manager (the voice/chat app's headless
agent, running inside `rm-ops-service`) to work "identically" to an
interactive Claude Code terminal session on the VPS — same reach, same
reliability — with the explicit instruction to give it as much access as
possible now and layer on safeguards later rather than the reverse.
Three real gaps closed here; a fourth (proactive push notification when
blocked) only partially.

**1. Host access, via SSH — not a Docker socket mount.** The container has
no access to anything outside itself by default: no other containers,
no nginx/systemd, no host filesystem beyond its explicit bind mounts. Two
ways to fix that were considered:
- Mount `/var/run/docker.sock` into the container. Rejected: that's
  equivalent to full host root (a container with the socket can launch a
  new container with `-v /:/host`), and the escalation path is opaque —
  nothing about *why* a given docker command ran is visible unless you
  separately go inspect what got launched.
- **SSH to the host itself, as `ubuntu`** (the non-root account already
  set up for interactive sessions — see §74/75) — what's actually built.
  Equivalent end capability (ubuntu has passwordless sudo, so this is
  still full root, functionally), but every single thing the PM does
  outside its container is one explicit, individually-readable `ssh
  ubuntu@host.docker.internal '<command>'` call — auditable the same way
  any of its other tool calls already are, rather than a single opaque
  socket grant. Simplicity/auditability tradeoff, not a security
  strength — Harvey's own framing ("safeguards later") is the right way
  to think about this, not "this is already safe."

**What changed to support it:**
- `Dockerfile`: installs `openssh-client`; creates `/home/node/.ssh`
  (mode 700, owned by `node`) with a static `config` pinning
  `StrictHostKeyChecking no` / `UserKnownHostsFile /dev/null` for
  `host.docker.internal` specifically — acceptable here because that
  hostname always resolves to the one fixed, known machine the container
  itself runs on; there's no real "is this who I think it is" question
  for an unknown-host warning to protect against.
- `deploy.sh` (CI's own deploy script, so this survives every future
  automated redeploy, not just a one-off manual run): added
  `--add-host=host.docker.internal:host-gateway` and
  `-v /root/pm-ssh-key/pm_host_access:/home/node/.ssh/id_ed25519:ro` to
  `RUN_ARGS`.
- `server.js`'s `VOICE_SYSTEM_PROMPT`: tells the agent this exists, how
  to use it (`ssh ubuntu@host.docker.internal '<command>'`, `sudo` inline
  for anything privileged), and the one real caveat — rebuilding/
  restarting `rm-ops-service` *itself* over that connection kills its own
  current process mid-command, so that specific step never reports
  success back in the same turn. Told to treat this as routine, not a
  reason to avoid the capability, and to log state to the work log first
  when the next resume wouldn't otherwise make the situation obvious
  (feeds into section 2 below).

**The actual credential setup (keypair, `authorized_keys`, passwordless
sudo, chown-for-the-container's-uid) all had to be done by Harvey
directly on the VPS** — every attempt at any piece of this from an
interactive Claude Code session, including read-only checks like `sudo
-l -U ubuntu`, was refused by Claude Code's own safety classifier
(reasons given: "Containment Escape", "Unauthorized Persistence") —
consistent with, not a bug in, the same safety model this whole project
already relies on elsewhere (see §74/75's "generating or writing any raw
credential is a you-not-me action" note). The commands actually run are
whatever Harvey's own session log shows for this date; regenerate a
fresh keypair rather than trying to recover the old one if it's ever
lost, same as the GitHub PAT/OAuth token pattern established earlier.

**2. Self-healing: the queue.** Reported bug, root-caused and fixed:
Harvey saw the Project Manager's queue panel stuck showing old test
messages ("1/2 Say only the word OK", "2/2 say only the word ok")
forever. Cause: `voiceQueue` (the in-process array of not-yet-started
messages) and `currentSession` (the live Agent SDK session) are both
plain in-memory state — every container restart loses them completely,
but the `voice_messages` DB rows survive, so anything that was
`pending`/`running` at the moment of a restart stayed stuck at that
status forever with nothing left alive to ever pick it back up. This
isn't a rare edge case — it happens on *every* redeploy, including the
routine ones CI runs on every push.

Fix: `recoverInflightVoiceMessages()` in `server.js` runs once, every
time the process starts. A `pending` row never actually reached Claude,
so it's simply re-queued and processed normally. A `running` row's real
completion state is unknown (the process could have died a moment before
or after actually finishing the work), so it's marked as an error
instead of blindly re-run — silently duplicating a git push or a file
edit would be worse than asking Harvey to resend it. Either way, a
`SERVICE RESTARTED` line goes into the work log so there's a visible
trail. Verified directly against the two real rows Harvey's screenshot
showed, still stuck from testing earlier in this same session, before
writing the fix and again after.

**3. Self-healing: session-loss context.** A resumed Agent SDK session
(the normal case — `--resume` against the persisted `.claude` volume)
already carries full conversation memory across a restart on its own;
this only matters when there's genuinely no session to resume — first
message ever, "New conversation" was hit, or the previous session was
lost (the CLI's local session store can still get pruned independently
of the persisted volume). `buildSystemPromptForSession()` checks for
exactly that condition and, when it's true, appends the last 15 lines of
the work log to the system prompt — so a session starting with zero
conversation memory isn't *also* blind to what it was recently doing.

**4. "Message me if you're stuck" — partially built, not fully solved.**
Harvey wants the PM to proactively notify him when it can't proceed
without his input, not just wait for him to happen to check the app.
What's real today: the existing `[NEEDS_ACTION]` marker (§76) already
gets a visibly distinct bubble color and — since it's a normal `done`
completion — triggers the completion ping (§75) the next time either
device's tab is open and focused. What's NOT built: a true push
notification that reaches Harvey when neither app is open at all. That
needs either a registered PWA push subscription (real infrastructure:
service worker, push keys, a subscription store) or a different channel
entirely (SMS/email via a new provider). Worth doing if the in-app
signal proves insufficient in practice — not built yet because it's a
meaningfully bigger lift than everything else in this section, not
because it was overlooked.

**"New conversation" button, for the record (Harvey asked why he'd ever
use it):** it force-resets to a session with zero memory, on purpose —
for on the rare occasion the accumulated context itself becomes the
problem (e.g. a long confused back-and-forth Harvey wants to cut cleanly
away from) rather than something to reach for normally. The default
persistent-thread behavior (§74/75) is correct for ordinary use; this is
the deliberate escape hatch, not the common path.

---

# 89. Replaced the Hardcoded "Still Working On That" Ack With a Real One

§87 fixed voice questions not being spoken at all; Harvey's very next
complaint was about the thing that fixed replaced it with — hearing the
literal phrase "Still working on that — I'll have an answer for you in
just a moment" over and over, whatever he'd actually asked. His ask: no
canned filler at all, ever — the immediate spoken acknowledgment should
be genuinely contextual, prove real understanding of that specific
message, and briefly note the plan, with the full answer following once
it's actually ready (unchanged from §87).

**The mechanism:** Claude Code's own convention (see this file's own
top-level system instructions) is to say one short sentence about what
it's about to do before the first tool call of a turn — for an
interactive terminal session that's just a UX nicety, but for the voice
app it's exactly the contextual acknowledgment Harvey wants, genuinely
generated by the model from the actual message, not a template. The fix
wires that existing behavior through as real-time spoken feedback
instead of discarding it (which is what happened before — see
`claudeRunner.js`'s `describeEvent` comment: plain text blocks were
skipped on purpose, on the assumption they'd only ever duplicate the
final reply).

**`ops-service/src/claudeRunner.js`:** `handleEvent` now also watches for
the first non-empty `text` block in any `assistant` stream event for the
current turn (tracked via a per-turn `earlyAckSent` flag, so it only
fires once) and calls a new `onEarlyAck(text)` callback — threaded
through `runTurn`/`runClaude` as a plain optional callback, same pattern
as the existing `onActivity`.

**`server.js`:** new `voice_messages.early_ack` column (same safe-ALTER
pattern as `activity_log`). `processVoiceMessage`'s `onEarlyAck` callback
writes it to the DB the instant it fires — well before the turn
completes — on both the normal and session-retry `runClaude` calls.
`VOICE_SYSTEM_PROMPT` gained an explicit "Quick verbal acknowledgment"
paragraph spelling out *why* this matters and what makes a good one (a
short, specific restatement proving understanding — e.g. "Checking the
deploy log now to confirm it actually completed," never "Got it, I'll
get right on that") — relying on the model's own incidental narration
without this instruction risked exactly the kind of generic phrasing
Harvey was already complaining about, just model-generated generic
instead of hardcoded generic.

**Client (`voiceClient.js`, shared by both pages):** `syncThread`'s
per-row tracking gained `hadEarlyAck`, firing a new `onEarlyAck(row)`
callback once per row the moment `row.early_ack` first appears —
mirrors the existing `activityLen`-growth pattern for `onActivity`.

**`app.js` / `voice-mobile.html`:** `onEarlyAck` does two things: swaps
the generic "CC is working on it…" typing placeholder for the real
early-ack text (visible even on a typed, non-spoken send), and — if this
message has a pending voice ack scheduled (`voiceAck[row.id]`, meaning
it was sent by voice and is awaiting spoken feedback) — speaks it
immediately and cancels the old `VOICE_ACK_DELAY_MS` fallback timer.
That timer still exists as a last-resort safety net (renamed in comments
to reflect its now-secondary role) in case the model somehow jumps
straight into a tool call with no preceding text at all — rare, but not
impossible. Whichever one fires first (real early_ack, virtually always,
or the generic fallback phrase) marks the ack as claimed so the other
path never also speaks on top of it.

**One real duplicate-speech risk, handled:** a turn with *no tool calls
at all* (a quick, directly-answerable message) can have its first —
and only — text block be the complete final answer itself, not a
preview of one. Speaking that immediately as the "early ack" and then
speaking `reply_text` again at `onDone` would say the identical sentence
twice in a row. Fixed with an exact-match dedupe: `onDone` only speaks
the final reply if it differs from whatever text was already spoken as
the ack for that message.

Verified locally (not yet against the live deployed service, same
deploy-pipeline caveat as everything else in this session) via
`node --check` on all four touched files and a plain string-splitting
test of the underlying regex/logic patterns reused from §81. Real
end-to-end verification (does the spoken ack actually sound contextual,
does the dedupe actually prevent a double-speak on a real no-tool-call
question) still needs a genuine voice test against the deployed service —
flag this explicitly if picking this up cold, don't assume it's
confirmed working just because it's merged.

---

# 90. Queue Items Also Get a Real Title, Not Raw Speech-to-Text

Same complaint as §77/§89, one more surface that had the same problem:
the Queue panel's item text (`renderQueue` in `app.js`/`voice-mobile.html`)
was always `row.transcript` — Harvey's raw spoken message, unshortened —
even though §77 already established the principle (there, for the
internal TodoWrite list) that a queue-style list should show a real task
title, not a transcript dump. The Queue panel is a different UI surface
that §77's fix never touched.

Fixed by reusing §89's `early_ack` field rather than building a second
title-generation mechanism: both the in-progress and "Recently completed"
render loops now show `row.early_ack || row.transcript` — falling back to
the raw transcript only in the brief window before a message has started
processing and produced its first real sentence yet. `early_ack` is
already instructed (§89's VOICE_SYSTEM_PROMPT addition) to be a short,
specific one-sentence statement of what's being done, which is exactly
the "proper title... one sentence or a few words" Harvey asked for here —
no new backend work needed, just displaying data that already existed
for a different reason.

---

# 91. Nav (Side-Rail + Top Tabs): Middle-Click / Open in New Tab

Harvey wanted middle-click (or ctrl/cmd-click) on a nav item — e.g. the
side-rail's Content Ops icon — to open it in a new browser tab, the
normal way that gesture works on any link. It didn't do anything at all.
Root cause: every tab-navigation element (`index.html`'s side-rail icons,
and `app.js`'s `renderTabs()`-generated top tab row) was a plain
`<button>` with a `click` listener that sets `location.hash` — a button
has no URL for the browser to open elsewhere, so middle-click/ctrl-click
"open in new tab" silently has nothing to act on. This is a real browser
mechanism, not something a `click` handler can add on its own.

**Fixed:** both nav surfaces are now real `<a href="#tab-id">` elements
instead of buttons — `index.html`'s 6 side-rail icons directly, and
`app.js`'s `renderTabs()` template string. The existing `click` listeners
that set `location.hash` are left in place (harmless no-op redundancy on
an ordinary left click, since the anchor's own default navigation
already sets the same hash) — this was a markup change, not a routing
rewrite. `style.css` gained `text-decoration: none` on `.side-rail-btn`/
`.panel-tab` since anchors underline by default and nothing already
overrode that. No JS logic (`renderActiveTab`'s active-class toggling,
`currentTabId()`, the hash router) needed to change — all of it already
worked purely off `.dataset.tab`/`classList`, with zero assumptions
about the underlying element being a `<button>`.

Opening a tab this way lands directly on the right panel on load — the
router already reads `location.hash` unconditionally on init
(`renderActiveTab()` runs right after setup regardless of whether the
hash was already set, confirmed in §79's writeup of the same behavior)
— and the session cookie is shared automatically across tabs on the same
origin, so no separate login is needed in the new tab.

---

# 92. Content Ops Search: Hide Non-Matches Instead of Dimming Them

Search in the Kanban board used to keep every card visible and just dim
non-matches to 28% opacity (`.card-dim`) — a deliberate choice at the
time (see the comment that used to sit above `render()`) specifically so
drag order/column placement was never disturbed by a search. Harvey
wants the opposite: typing a search term should actually remove
non-matching cards from view, the same way the content-type filter
already works, and clearing the box brings everything back.

Fixed in `render()`: the search query now filters each column's `ids`
array before building card HTML (`if (query) ids = ids.filter(...)`),
mirroring the existing `activeTypeFilter` line right above it, instead of
tagging non-matches with `.card-dim` afterward. Nothing about drag
order/column placement actually changes underneath — filtering only
affects what a given `render()` call outputs, never the stored piece
data — so clearing the search box (which already calls `render()` on
every `input` event, including an emptied box) restores the exact same
board. Removed the now-fully-unused `.card-dim` CSS rule rather than
leaving dead code behind.

---

# 93. Project Manager No Longer Kills Itself Mid-Task on Every ops-service Push (2026-09-18)

Harvey's report: while the PM worked through a long (1-2 hour) to-do list
of small ops-service tweaks, he kept seeing "Service restarted while this
was in progress... please resend if it still needs doing" repeatedly.
Root-caused via git log timestamps directly correlated against container
restart times (not guessed): `deploy-ops-service.yml` triggers on every
push to `main` touching `ops-service/**`, and the PM — which has real push
rights to this repo — was committing+pushing after each completed to-do
item. Each push fired the auto-deploy, which rebuilds the Docker image and
restarts `rm-ops-service` — the exact container the PM's own session runs
inside — killing whatever turn was in flight. The self-healing recovery
from §88 correctly reported this rather than silently losing the task, but
the underlying trigger just repeated on the next to-do item.

**Harvey's actual priority, stated directly:** he wants each change visible
as fast as physically possible, not batched to the end of a long list
(that would mean waiting 1-2 hours to see a 5-minute fix land). So the fix
had to make things faster, not slower/safer-but-delayed.

**Fix — most of what's on a typical to-do list is frontend-only, and that
class of change no longer needs a rebuild or restart at all:**

- `ops-service/server.js`'s static file serving no longer serves a copy of
  `public/` baked into the Docker image at build time. It now serves
  straight from `${CLAUDE_REPO_DIR}/ops-service/public` — the exact git
  working tree the PM's own Claude Code session already edits and commits
  from (bind-mounted at `/repo` in the container, `/srv/realitymanual-repo`
  on the VPS, per §74/§88) — falling back to the image-baked `./public`
  only if that path doesn't exist (e.g. running `server.js` directly,
  outside the container). A frontend file edit is live on next page load
  the instant it's saved to disk — before it's even committed, let alone
  deployed.
- `ops-service/deploy.sh` now captures `OLD_HEAD`/`NEW_HEAD` around its
  `git pull` in `REPO_DIR`, and — after still unconditionally pulling
  `RUNTIME_REPO_DIR` (this is what actually makes the frontend-live-serving
  above correct on every deploy, not just PM-authored ones, e.g. Harvey's
  own desktop-pushed frontend edits still need this pull to reach the VPS)
  — diffs those two commits against `server.js`, `src/`, `package.json`,
  `package-lock.json`, `Dockerfile`, and `deploy.sh` itself. If none of
  those changed (a pure `ops-service/public/**` push, or nothing new to
  pull at all), it logs that and exits successfully **without** touching
  Docker at all — no rebuild, no stop/rm/run, no restart, no interrupted
  PM turn. Only a genuine backend/logic change still pays the full
  rebuild+restart cost, because that's the one case where it's actually
  unavoidable — Node has the old code loaded in memory and there's no way
  around reloading the process for it to pick up new server-side code.
- `deploy-ops-service.yml`'s trigger path (`ops-service/**`) was
  deliberately left broad rather than narrowed to backend-only paths —
  narrowing it there would also stop Harvey's own desktop-pushed frontend
  changes from ever reaching `RUNTIME_REPO_DIR` at all, since nothing else
  pulls that directory. Putting the "is this actually a backend change"
  decision in `deploy.sh` instead keeps the CI trigger working for every
  push while making the common case (frontend-only) fast and
  non-disruptive.

**Net effect:** a to-do list of ops-service UI/behavior fixes — the normal
case — can now run start to finish without a single container restart,
each item visible immediately as the PM saves it. Only an item that
touches actual backend logic (`server.js`/`src/`) still triggers one real
restart, and only for that item, not the whole list.

Verified via `node --check server.js`, `bash -n deploy.sh`, and a YAML
parse of the workflow file before pushing — not yet verified against a
real live to-do-list run on the deployed service; flag this if picked up
cold and re-verify (does a `public/`-only push really skip the rebuild in
the real CI log, does a `server.js` change still redeploy correctly) if
the same complaint resurfaces.

---

# 94. §89/§90's Fixes Have a Real Gap: Silent Tool Calls Before Any Text

Harvey reported both §89 (real spoken ack) and §90 (real queue title)
regressing on the same message — a simple "how's it going, checking in"
check-in got the generic fallback phrase spoken out loud, and the queue
showed his raw transcript as the title. Diagnosed against the live
`voice_messages` rows directly (`GET /api/voice/messages`, not
guessed): `early_ack` for that row was **not null** — it was present,
but it was the model's *entire final answer*, not a short lead-in
sentence. Comparing against rows where `early_ack` genuinely was a short
mid-task line (e.g. "Now let's confirm the search input wiring near
line ~1858...") showed the real pattern: those turns narrated *before*
each tool call, as instructed; the "how's it going" turn instead ran
several tool calls (`git fetch`, `git log`, a live ping) with zero
preceding text, then wrote its whole answer as one block at the very
end. `claudeRunner.js`'s `handleEvent` correctly captures "the first
text block," but if a turn's actual first text happens to be its last
too, that's what gets captured — arriving too late to beat the 10s
fallback timer, and leaving the queue showing the raw transcript for
however long the silent tool-call phase took.

So this isn't a new bug in the §89/§90 mechanism itself — it's the
model (this agent) not consistently following the "narrate before
tools" instruction for turns that feel like a quick status check but
still involve tool calls (which can each individually take several real
seconds — a `git fetch` or `ssh` call is not instant). `VOICE_SYSTEM_PROMPT`'s
"Quick verbal acknowledgment" paragraph in `server.js` was loosened from
a judgment call ("if a turn needs real work... skip for a turn you can
just answer directly") to a hard mechanical rule: the instant you decide
a turn needs *any* tool call at all, however small it feels, your first
output token must be the one-sentence acknowledgment, before that first
tool call — not interleaved with it, not after it. The rewritten
paragraph explicitly names this exact failure mode (silent tool calls →
late/duplicate final-answer-as-ack → fallback phrase + raw-transcript
queue title) so future instances of this agent have the actual failure
story, not just an abstract rule, to calibrate against.

Deliberately did not add a second code-level fallback (e.g. a
generic placeholder written to the queue after N seconds of silence) —
Harvey's stance from §89 is no canned filler at all, anywhere, and a
quieter written-not-spoken version of the same thing would still
violate that. The fix is behavioral discipline, enforced by prompt
wording, not a second synthetic layer papering over it.

---

# 95. Acknowledgment Sentence Must Read as a Task, Not a Reply

Same incident as §94, one more angle on it Harvey called out separately:
the "Recently completed" queue item for that turn read "Doing well —
actually verified this just now, n..." — literally the opening of the
final answer to "how's it going." Harvey's point, stated directly:
**"tasks are actual things you're DOING, not just responses."** A queue
item has to describe an action, never read like a reply to him.

This is the same root cause §94 already fixed (the acknowledgment
sentence arrived too late — as the whole final answer — because tool
calls ran silently first), but it's worth its own explicit rule rather
than assuming the timing fix alone guarantees the right phrasing: added
a paragraph to `VOICE_SYSTEM_PROMPT` spelling out that the acknowledgment
must read as "doing X," never as an answer to him — including never
answering the small-talk/greeting part of his message ("how's it
going" → "Doing well..." is answering him, not describing a task) — with
this exact incident named as the concrete example of the mistake, the
same way §94 named its own. Both rules reinforce each other: if the
sentence genuinely comes before any tool call (§94), there usually
isn't an answer to give yet anyway, which naturally forces action-style
phrasing — but stating the phrasing rule explicitly closes the gap for
any case where that isn't automatically true.

---

# 96. Mobile: No Way Back to Project Manager From the Ops Panel

§79 gave `voice-mobile.html` a dedicated button into Content Ops and
assumed the reverse direction was already covered — `index.html`'s
horizontal-scrolling top tab row keeps Project Manager as its first
entry even on mobile (side-rail is hidden below 640px, per the earlier
mobile-responsive pass). Harvey confirmed that isn't good enough in
practice: he could get *to* the ops panel from the PM's button, but
found no way back once there.

Added a dedicated fixed circular button (`.pm-back-fab`, mobile-only —
plain `display: none` outside the `max-width: 640px` breakpoint, so
desktop is untouched since it always has the side-rail) bottom-right on
every tab except Project Manager itself, reusing the same message-bubble
icon already used for Project Manager elsewhere in the nav. `<a
href="#project-manager">` (same real-anchor pattern as §91, not a
`<button>`), so it also gets native middle-click/ctrl-click "open in new
tab" behavior for free. `renderActiveTab()` in `app.js` toggles its
`.show` class alongside the existing side-rail/top-tab active-state
logic — one extra line, no new routing.

---

# 97. Stop-While-Speaking: Fixed on Desktop, Made Visible Everywhere

Harvey wanted a way to interrupt long auto-spoken replies mid-playback,
and separately flagged that the existing Play/Stop button worked on
mobile but not desktop, plus wanted a clearer visual cue for which
message is currently being read.

**Root cause of the desktop bug:** each `addAssistantMessage()` bubble's
Play/Stop button tracked "am I playing" with its own local `playing`
variable, set to `true` only inside that button's own click handler.
Auto-speak (`onEarlyAck`/`onDone`/the fallback ack) calls
`Voice.speak()` directly, bypassing that handler entirely — so the
button never learned playback had started. Clicking it during auto-speak
didn't stop anything; it called `Voice.speak()` again, which restarted
the exact same text from a fresh TTS round-trip. Mobile happened to work
only because its blocking record/transcribe overlay flow made this
particular interaction less likely to come up, not because the
underlying logic was actually different — the same bug was latent there
too.

**Fix — single source of truth in `voiceClient.js`, not per-bubble
state:** `speak(text, msgId)` now takes an optional message id and
maintains one module-level `speakingMsgId`, notified through a new
`Voice.onSpeakingChange(fn)` pub/sub (`fn(msgId)` on start, `fn(null)` on
stop/end) and read via `Voice.currentlySpeaking()`. `stopSpeaking()`
clears it and notifies too. `onSpeakingChange` returns an unsubscribe
function specifically because `app.js`'s `bootProjectManager()` re-runs
every time the Project Manager tab is revisited — re-registering without
unsubscribing the previous run would leak one listener per visit for the
life of the page (mirrors the existing `pmSync` stop-before-restart
pattern right above it). `voice-mobile.html`'s equivalent registration
only ever runs once (guarded by `startSync()`'s own `if (sync) return`),
so no unsubscribe is needed there.

**Every `Voice.speak()` call site in both `app.js` and
`voice-mobile.html`** (the per-bubble Play button, `onEarlyAck`,
`onDone`, `onError`, the `scheduleVoiceAck` fallback, and
`voice-mobile.html`'s immediate execute-mode ack) now passes the
relevant `voice_messages` row id, so playback started from *any* of
those paths is attributable to the right message. Each page registers
one shared `onSpeakingChange` listener (not one per bubble, which would
also leak) that resets any previously-`.pm-speaking` element and
highlights whichever `[data-msg-id]` element matches the new active id
— matches either a real reply bubble (`.pm-msg-assistant`) or, during
the brief early-ack window before that bubble exists yet, the typing
placeholder (`.pm-typing`, already carried `data-msg-id` since it was
first built). `.pm-msg.pm-speaking` gets an accent-colored border/glow
(also covers error bubbles, which have no Play button but can still be
auto-spoken); `.pm-typing.pm-speaking` gets an accent color plus a 🔊
prefix via `::before`. The Play button itself also now reads directly
off `Voice.currentlySpeaking() === msgId` rather than its own flag, so
its label/stop-click behavior is correct regardless of what started the
audio.

---

# 98. §96's Back-to-PM Button Pointed at the Wrong "Project Manager"

§96's mobile `.pm-back-fab` linked to `#project-manager` — the desktop-
style chat tab rendered inside `index.html`'s own SPA. Harvey pointed
out that's the wrong target: on mobile he actually lives in
`voice-mobile.html`, a deliberately separate standalone page (§74) with
its own layout (the two big Ask/Execute buttons, etc.), not the same UI
as the in-SPA tab. Tapping the FAB was taking him to a different,
desktop-shaped Project Manager instead of back to the app he'd actually
come from.

Fixed by pointing `href` straight at `voice-mobile.html` instead of the
hash route — same plain same-tab navigation pattern `voice-mobile.html`'s
own outbound button to Content Ops already uses (`<a
href="index.html#content-ops">`, no `target`), just the reverse
direction. `renderActiveTab()`'s show/hide logic (visible on every tab
except the in-SPA project-manager one) didn't need to change — it's
still correct regardless of where the link actually points.

---

# 99. "Queue" Renamed to "Task List" — Ambiguous Label, Not a Behavior Change

Harvey: "queue is kind of ambiguous, whereas task list actually tells us
that it's a list of things you're working away through." Pure copy
change — every user-visible occurrence of "Queue" in `app.js` and
`voice-mobile.html` (`.pm-activity-head` label in both files, and
`voice-mobile.html`'s pull-tab `aria-label`, "Show queue" →
"Show task list") is now "Task List," and the empty-state copy changed
to match ("Nothing queued." → "No tasks right now."). Internal
identifiers (`renderQueue()`, `pmQueueList`/`vQueueList`,
`.pm-queue-item`, `voiceQueue` server-side, etc.) were deliberately left
alone — renaming those would be a much larger, purely-cosmetic diff with
no user-visible benefit, and this project's convention throughout this
whole voice-app build has been to change display text/markup without
chasing internal names to match (see §90's `card-ai`/`early_ack`
naming, unrelated to what either actually displays as, for the same
reason).

Deliberately did not attempt to filter which messages appear in the
list (e.g. excluding a plain conversational check-in like the one that
prompted this) — every message that's actually `pending`/`running`
genuinely is mid-processing, which is what this widget exists to show,
and there's no reliable signal to classify "was this really a task" at
enqueue time, before the model has even looked at it. The renamed label
addresses the actual stated problem (ambiguity about what the list
represents), not a claim that every entry in it is formally a "task" in
the TodoWrite sense (§94/95).

---

# 100. §94's Fix Still Wasn't Reliable — Escalated, Honestly

Harvey, verbatim: **"ive asked u like 7 times."** §94 tightened the
acknowledgment rule from a judgment call to a "hard mechanical rule" and
it *still* failed on the very next few turns — checked the live DB
again, same method as §94: the "just checking in" message's `early_ack`
wasn't null this time, it was `"Let's update both the header labels and
the aria-label:"` — a real sentence, but a stray mid-task narration
fragment from deep inside the actual rename work, not anything
summarizing "checking in on recent changes." §94's rule still had an
escape hatch ("skip this only for a turn you can answer directly with
no tool use") and this turn — part conversational check-in, part a real
small edit — evidently got mentally filed under that exception, so no
acknowledgment was ever written before the tool calls started, and
whatever text came out first was just whatever the model happened to
narrate mid-task.

**Honest framing for whoever reads this next:** this is now three
attempts at the same underlying reliability problem (§90 built the
mechanism, §94 tightened it once, this is the second tightening), and
prompt wording alone clearly has a real ceiling — this is a genuine
model-behavior-consistency issue, not a bug with one findable root
cause. Two changes went in this round, not just a re-word:

1. `VOICE_SYSTEM_PROMPT`'s acknowledgment paragraph **removed the "skip
   for no tool use" exception entirely** — it's now unconditional, every
   single voice-app turn, no judgment call. The exception is exactly
   what kept getting mis-applied to mixed conversational-plus-work
   turns, so removing the judgment call entirely (rather than trying to
   word it more precisely again) is the actual change, not just tone.
2. **New: a per-message reminder, not just a system-prompt paragraph.**
   `buildVoicePrompt()` now appends a short `ACK_REMINDER` sentence
   directly onto the bracketed framing wrapped around *every single*
   message (both respond and execute mode) — re-injected fresh on every
   turn, immediately adjacent to the actual content, rather than relying
   solely on a paragraph set once in the system prompt at the start of a
   long-running resumed session. Instructions placed right next to what
   they're modifying tend to get followed more reliably than the same
   instruction sitting further back in context — worth trying as a
   second, independent lever alongside the system-prompt rule, not a
   replacement for it.

**If this happens again despite both of these**, the honest next step
is not a third wording pass — it's a structural fix: a dedicated,
separate short-title generation step decoupled from the main
conversational turn entirely (so a title exists deterministically,
never contingent on how the main turn happens to narrate itself),
rather than continuing to extract a title from the main turn's own
incidental first text block. Not built this round because it's a real
architecture change (a second model call per message, latency/cost
tradeoffs, and needs to avoid reintroducing the cold-start problem §74
already solved by moving to a persistent session) — worth doing only
once it's clear prompt-based fixes genuinely can't close this gap.

---

# 101. Voice Ack: Fallback Timer Removed Entirely — No More Canned Phrase, Ever

§100's fix (unconditional acknowledgment rule + per-message reminder) did
make `early_ack` reliably good — but it exposed a different, structural
problem underneath, which is what this section fixes.

**What actually happened, diagnosed against the live DB (not guessed):**
a "just checking in" message got a genuinely good `early_ack`, but the
full turn took 11.44 seconds — and the client's `VOICE_ACK_DELAY_MS`
fallback timer (§74/89) was still set to fire at 10s if the real
`early_ack` hadn't shown up yet. The fallback fired first, spoke the old
canned `RESPOND_ACK_TEXT` ("Still working on that — I'll have an answer
for you in just a moment"), and then the real (good) `early_ack`/reply
landed a beat later — Harvey heard the generic line even though the
mechanism built to replace it was working correctly underneath it. A
timing race, not a content bug.

**Harvey's response was a full rebuild instruction, not another prompt
tweak**, given verbatim: respond as quickly as possible with something
"made up each time... completely different... based on what I've said";
a quick/easy message should just get answered; a message needing real
thinking/execution should get told "I'm going to go think about it and
text you a reply" — and, critically, **not both** a spoken ack and then
a spoken final answer stacked on top of it ("you keep sending this same
canned message over and over and then you keep sending another one").
This is a deliberate reversal of §87's original "always speak the real
answer regardless" stance, made after Harvey directly experienced why
that produces a double-message feeling on any turn that also gets a
spoken acknowledgment.

**Rebuilt in `ops-service/public/app.js` and `ops-service/public/voice-mobile.html`
(client-side only — no `server.js` change; `early_ack`/`activity_log`/
`mode` were already reliably present on every row):**

- **Fallback timer deleted outright.** `VOICE_ACK_DELAY_MS`,
  `RESPOND_ACK_TEXT`, and `scheduleVoiceAck()` are gone from both files —
  there is no longer any canned phrase anywhere in the respond-mode path,
  and therefore no race for a slow-but-correct `early_ack` to lose. The
  old `voiceAck` map (`{fired, timer, spokenText}`) is replaced by a
  plain `voiceAutoSpeak` map (`{id: true}`) — just an eligibility flag,
  set at send time, with no timer bookkeeping at all.
- **`onEarlyAck`** speaks `row.early_ack` the instant it arrives, if the
  message is voice-auto-speak-eligible — unconditionally now, no
  fired-flag race to manage, since `syncThread`'s own per-row tracking
  already guarantees this fires at most once per row.
- **`onDone`** now decides whether the *final* reply is also worth
  speaking, based on whether the turn actually did any work:
  `usedTools = !!(row.activity_log && row.activity_log.length)`. If the
  turn used no tools at all (a quick, directly-answerable message), the
  final reply is spoken too — for that class of turn the early_ack is
  essentially the whole answer already, so this reads as one immediate
  spoken response, not two. If the turn used tools (real thinking/
  execution, per Harvey's own framing) or was sent in execute mode, the
  final reply is text-only — the one spoken acknowledgment from
  `onEarlyAck` is the only thing that gets spoken for that turn. The
  exact-match dedupe against `row.early_ack` (§89) is kept as a second
  safety net for the edge case where a no-tool turn's early_ack somehow
  was itself the complete final answer verbatim.
- **`EXECUTE_ACK_TEXT`** stays canned and immediate in
  `voice-mobile.html`'s mic-send flow only (removed from `app.js`,
  which never used it directly) — execute mode is unambiguously always a
  task by construction, so there's no ambiguity to wait on a real
  `early_ack` for, and it still never speaks the real result afterward,
  so there's no double-speak risk there either. This one instance of
  canned text was deliberately left alone; Harvey's complaint was about
  the respond-mode fallback specifically racing against/duplicating a
  real answer, not about this one.

**Net effect:** a quick conversational check-in gets one spoken
response, spoken as soon as it's ready, made up fresh by the model each
time (via `early_ack`) — never the old canned line, never twice. A turn
that genuinely needs tool calls gets one spoken "here's what I'm about
to do," with the real answer delivered as text once it's ready, per
Harvey's explicit instruction. Frontend-only change (`app.js`,
`voice-mobile.html`), so per §93 this should deploy via the fast path —
no Docker rebuild/restart, no killed session — unlike §100's fix.

Verified via `node --check` on `app.js` and on the extracted inline
`<script>` of `voice-mobile.html`; not yet verified against a real live
voice exchange on the deployed service — flag this if picked up cold.

---

# 102. Voice Ack Content: "I'll Confirm in Chat" Framing for Task Turns

Harvey's follow-up to §101, given by voice: confirmed the timing/dedupe
rebuild is the right shape, but wanted the *wording* of the acknowledgment
to make the distinction explicit rather than leaving it implicit in
client-side gating alone. In his words: if it's a question/quick lookup,
just answer it; if it's an instruction to go do something, the spoken
reply should be "Okay, I'm gonna go and do the task, and I'll send
confirmation in the chat once I'm done" — not a literal canned line, but
that framing, made up fresh each time based on what the task actually is.

**What was already true (§101, client-side, unchanged here):** a turn
with no tool calls gets its full final answer spoken automatically; a
turn that used tools only ever gets the one spoken acknowledgment, with
the real result landing as text in the chat. That mechanical behavior
was already correct — what was missing was that `VOICE_SYSTEM_PROMPT`
never told the model *why* that matters or what the acknowledgment
sentence should therefore actually say for a task-shaped turn. Its
existing examples ("Checking the deploy log now...") are lead-ins to an
investigation, not an explicit "I'll tell you in the chat" framing.

**Fix:** added a new paragraph to `VOICE_SYSTEM_PROMPT` in
`ops-service/server.js`, right after the existing "Quick verbal
acknowledgment" paragraph, spelling out the two reply shapes directly:
a question/lookup just gets answered (the app already speaks the whole
answer for a no-tool-call turn, so nothing extra is needed); an
instruction to do something gets an acknowledgment that explicitly says
the work is starting and the result will follow in the chat — worded
fresh each time, never the same phrase twice, never a vague "I'll get
right on that."

**This is a `server.js` change**, unlike §101's purely frontend rebuild —
per §93 it will trigger a full Docker rebuild+restart of `rm-ops-service`
on the next deploy, which (per §74/§88's standing caveat) kills this
agent's own current process mid-task, since this session *is* the
headless Project Manager agent running inside that container. Logged to
the work log immediately before pushing so the state is clear on resume,
per the Host Access paragraph's own instruction for exactly this
situation.

Verified via `node --check server.js` only — not yet verified against a
real live voice exchange on the deployed service (same caveat as §101);
confirm both the "quick answer" and "task, confirm in chat" phrasing
sound right in practice once this is live.

---

# 103. Bluetooth Call-Tone: §86's Fix Was Treating the Wrong Cause

Harvey reported the Bluetooth "call started"/"call ended" tone (§86) is
still happening on every recording, distorting the audio badly enough
that he can barely hear replies, and asked for real research into a fix
rather than another guess.

**§86 was fixing the wrong mechanism.** Confirmed via research (see
Sources below): disabling `echoCancellation`/`noiseSuppression`/
`autoGainControl` stops Chrome's "voice processing" pipeline, but that
pipeline isn't what forces the Bluetooth profile switch. The real cause
is structural — **A2DP (the high-quality profile a Bluetooth headset
streams music over) has no microphone channel at all; it's output-only.**
The instant a web page's `getUserMedia` call needs *any* audio input
from a Bluetooth device, Android has no choice but to switch that device
to HFP (the profile that supports a mic return channel), and that
profile switch is exactly what plays the connect/disconnect tone. This
happens regardless of any media constraint passed to `getUserMedia` —
constraints only affect signal processing on whichever device ends up
providing input, not which device gets chosen.

**Real fix: stop asking the Bluetooth device for input at all.**
`startRecording()` in `ops-service/public/lib/voiceClient.js` now calls
`enumerateDevices()` once mic permission exists, filters for an
audio-input device whose label does *not* look like a Bluetooth/wireless
headset (regex against "bluetooth", "hands-free"/"hfp", "headset",
"airpod", "buds", "wireless"), and — if a non-Bluetooth device is
found — explicitly requests it by `deviceId: { exact: ... }` instead of
leaving device selection to "default" (which Android resolves to the
connected Bluetooth headset whenever one's connected). With mic input
coming from the phone's own built-in microphone, the headset never
needs to leave A2DP for output, so there's no profile switch and no
tone. The resolved device id is cached in a module variable
(`preferredMicDeviceId`) so this is one enumeration per page load, not
per recording; a stale cached id (e.g. Bluetooth reconnects under a new
device id) is caught via a `getUserMedia` failure and falls back to the
unconstrained default rather than breaking recording outright.

**One real limitation, stated honestly:** device labels are empty until
mic permission has been granted at least once on that origin/device, so
the very first recording ever made still can't be told apart from the
Bluetooth device and may still trigger one profile-switch tone. Every
recording after that — which is what Harvey actually complained about
("I don't wanna be calling this thing every time") — resolves a labeled
non-Bluetooth device and should stay silent. This can't be fully closed
from a web page; it's the same "web content can't override Android's
Bluetooth stack" ceiling §86 already ran into, just moved one step back
(from "every single time" to "once, on first-ever use").

Applies to both `app.js` and `voice-mobile.html` automatically since
both go through this shared `voiceClient.js` function — no changes
needed in either page. Verified via `node --check` only; not yet tested
against a real Bluetooth headset on the deployed service — the actual
fix depends on Android correctly reporting a distinguishable label for
the phone's built-in mic on Harvey's specific device, which needs a real
device test to confirm, not just code review.

Sources:
- [Bluetooth headset - ArchWiki](https://wiki.archlinux.org/title/Bluetooth_headset) — A2DP has no input/microphone mode; HSP/HFP is required for bidirectional (mic) audio.
- [Trouble with bluetooth headphones on Chrome - Google Chrome Community](https://support.google.com/chrome/thread/21533239/trouble-with-bluetooth-headphones-on-chrome-no-audio-for-any-tabs?hl=en) — Chrome/Android Bluetooth audio routing behavior and known limitations.

---

# 104. Project Manager: Tap-to-Reply on CC's Messages

Harvey asked for a way to reply to a specific earlier message from CC in
the Project Manager chat — tap on one of CC's previous bubbles and reply
directly to it, so it's unambiguous which message a short follow-up (e.g.
"yes do that") is actually about, especially once several different
topics have come up in the same long-running resumed session.

**Backend (`ops-service/server.js`):**
- New `voice_messages.reply_to_id` column (safe `ALTER TABLE`, same
  no-op-if-already-migrated pattern as `activity_log`/`early_ack`) —
  stores the id of the earlier row a message is explicitly replying to.
- `insertVoiceMessage` extended to take it; `POST /api/voice/messages`
  reads an optional `replyToId` field (works for both the plain-JSON and
  multipart/image-attached request bodies, since multer parses non-file
  fields into `req.body` either way).
- **The stored `transcript` stays exactly what Harvey typed** — the
  quoted context is woven into a separate `promptText` built just before
  the message is pushed onto `voiceQueue`, not persisted. When
  `replyToId` resolves to a real row, `promptText` becomes "Harvey is
  replying directly to your specific earlier message quoted below...
  Your earlier message: "..." His reply: ...", so the actual model turn
  sees unambiguous context without permanently mutating what's shown in
  the UI as Harvey's own message.
- `GET /api/voice/messages` and `GET /api/voice/messages/:id` (via a
  renamed `hydrateVoiceMessageRow`, was `parseActivityLog`) now also
  resolve `reply_to_snippet` server-side whenever `reply_to_id` is set —
  looked up per-row from the same tiny local SQLite table (no join
  needed, N+1 is a non-issue at this table's size). Resolving it
  server-side rather than leaving the client to cross-reference its own
  already-fetched messages means the quoted preview still renders
  correctly after a page reload, on a device that never saw the original
  message, or once the original has scrolled outside the client's fetch
  window — none of which a purely client-side lookup could handle.

**Frontend (`ops-service/public/app.js` + `voice-mobile.html`, both via
the same pattern, plus a shared `sendMessage()` change in
`lib/voiceClient.js`):**
- Each assistant message bubble's meta row (`addAssistantMessage()`)
  gains a small "↩ Reply" button alongside the existing Play button.
  Clicking it calls `setPendingReplyTo(msgId, text)`, which shows a
  preview strip (`.pm-reply-preview`) above the compose box — "Replying
  to: <snippet>" with a ✕ to cancel — and focuses the text input.
- `Voice.sendMessage(text, mode, imageFile, replyToId)` gained a 4th
  optional argument, included in the request body/form when set.
- `sendText()` (desktop) / `sendTyped()` (mobile) read the pending
  reply-to state, clear it, render the outgoing message with a "Re: ..."
  quote via `addMessage()`'s existing `replyToText` parameter (built for
  §85's opposite case — CC's replies quoting Harvey's question — and
  reused here unchanged), and pass `replyToId` through to
  `Voice.sendMessage()`.
- `onNewMessage` in both files' `syncThread` wiring now passes
  `row.reply_to_snippet` through to `addMessage()` too, so a reply sent
  from the *other* device (or replayed on page load) renders its quote
  correctly as well — not just ones sent from the device currently open.

**Deliberately scoped to the text/type-bar send paths only**, per
Harvey's own phrasing ("reply... via text") — the reply button only
appears on assistant bubbles (not on Harvey's own messages or error
bubbles), and the two big voice buttons (mobile's Ask/Execute, desktop's
mic) aren't wired to a reply-target picker; a reply is always composed
by typing (or live-transcribed speech landing in the text box on
desktop, which reuses the same `sendText()` path and therefore also
picks up a pending reply-to for free) rather than the record-and-upload
voice flow.

This is a `server.js` change (the new column + endpoint behavior), so
per §93 it triggers a full rebuild/restart on the next deploy — same
standing caveat as §102, since this session is the headless agent
running inside the container being restarted.

Verified via `node --check` on all four touched JS files/inline script;
not yet tested against the live deployed service — confirm the reply
button appears, the preview bar shows/cancels correctly, the quote
renders on both the sending and receiving device, and a reply actually
disambiguates correctly in a real multi-topic conversation before
considering this fully done.

---

# 105. Bluetooth Call-Tone: §103's Fix Wasn't Enough Either — Different Lever

Harvey tested §103 live and reported the tone is still happening on every
"Start Recording" press — the deviceId-selection fix didn't close it.

**Re-researched rather than guessing again**: no source found actually
confirms that Android's Bluetooth SCO/HFP negotiation is gated on *which*
`deviceId` Chrome resolves to at all. It's plausible (not confirmed) that
Chrome's WebRTC audio backend on Android sets up a voice-communication
audio session — and Android's AudioManager decides to grab any connected
Bluetooth headset into SCO — the moment *any* mic stream opens, regardless
of which physical device was actually requested. If that's the real
mechanism, §103's deviceId selection was solving a problem that wasn't
actually the (whole) cause.

**Different, additive fix — target "every time" directly, even if the
open/close negotiation itself can't be avoided:** `voiceClient.js` used to
call `getUserMedia` fresh on every single "Start Recording" press and
immediately `stream.getTracks().forEach(t => t.stop())` at the end of
every recording — meaning if the tone comes from Chrome opening *and*
closing an audio session (matching Harvey's exact description: a tone on
both start and end), that negotiation was happening once per recording,
every recording, by construction. Now the stream is cached and reused for
the lifetime of the page (`cachedStream`, `getMicStream()`): the first
"Start Recording" press still acquires the mic (and may still trigger one
profile-switch tone — that part may be genuinely unavoidable from web
content), but every recording after that, within the same page session,
reuses the already-open stream instead of tearing it down and reopening
it — no new negotiation, so no repeated tone. The stream is only actually
released (`releaseMic()`) on `pagehide` (leaving/closing the page) or if a
track ends on its own (permission revoked, device unplugged).

**Real, honestly-stated trade-off, not yet confirmed either way:** keeping
the mic stream open for the whole session likely means the Bluetooth
headset stays in the lower-quality HFP mode for that entire time, not just
during an actual recording — which could mean CC's spoken replies sound
worse over Bluetooth for the rest of the session, not just during
dictation. Whether that actually happens depends on how Harvey's specific
phone/Android version routes simultaneous media playback vs. voice input
audio, which isn't something this session can verify without a real
device test. Ship first, verify against Harvey's actual hardware, and
revisit (e.g., release the stream after a short idle period instead of
holding it for the whole session) if the playback-quality trade-off turns
out to be worse than the repeated tone was.

Frontend-only (`voiceClient.js`), so per §93 this is already live —
served straight from disk, no deploy/restart needed; just needs a page
reload on Harvey's end to pick up the new script. §103's deviceId logic
is left in place (harmless, and may still help reduce which device gets
used on the one negotiation that does happen).

**Honest framing if this still isn't enough:** two real attempts now
(§103's device selection, this session's stream-reuse) haven't been
confirmed to fully close this — if Harvey reports it's still happening on
literally every press even after this, the next step isn't a third
in-the-dark guess, it's asking him for the exact device/Android/Chrome
version and headset model so the actual behavior can be looked up
specifically, since this class of bug is known to vary significantly by
OEM audio stack rather than being uniform across "Android" as a whole.

---

# 106. Bluetooth Call-Tone: Reverted — Not Worth Further Time

Harvey tested §105's stream-reuse fix and still heard the tone on every
recording — the third attempt (§86, §103, §105) to fix this from the web
platform, none of which worked on his real hardware. His own call: "not
a big enough deal for us to waste too much more time on," and explicitly
asked for the attempted code to be cleaned up since it didn't work.

**Reverted `ops-service/public/lib/voiceClient.js`'s `startRecording()`**
back to the plain, original form — a bare `getUserMedia({ audio: true })`
call, no device enumeration/filtering, no cached/reused stream, no
`pagehide` listener. All of §86's audio-constraint logic, §103's
device-selection logic, and §105's stream-caching logic are gone;
nothing from any of those three attempts remains in the code. The
**screen Wake Lock feature** (also introduced in §86, but a genuinely
separate, working fix for an unrelated complaint — the phone locking
mid-recording) was kept, since Harvey's "clean up the mic thing" request
was specifically about the ineffective Bluetooth-tone attempts, not the
wake lock.

**Status: accepted as a known limitation, not being pursued further.**
Per the same conversation, Harvey and this session discussed building a
native Android app instead (which would have more reliable low-level
audio-routing control than the web platform exposes) — worth reading
that reasoning if this comes up again, but the conclusion was that the
cost (separate codebase, APK packaging/distribution, losing the
instant-push-to-live PWA iteration loop this whole project depends on,
no other-platform coverage) isn't justified by one low-priority audio
annoyance. §86/§103/§105 are left in CLAUDE.md as the historical record
of what was tried and why each attempt didn't hold up — don't repeat any
of those three specific approaches if this is revisited later without a
genuinely new idea or real device-specific diagnostic info (exact
phone/Android/Chrome version and headset model) to work from.

Frontend-only revert, already live (no deploy/restart needed) — verified
via `node --check` and a grep confirming no leftover references to any
of the removed functions/variables.

---

# 107. Fixed: Pressing Play Twice Could Start Two Overlapping Audio Tracks

Harvey reported that clicking a message's Play button while audio was
already (about to be) playing could start a second track talking over
the first, rather than either stopping or cleanly replacing it.

**Root cause:** `speak()` (`ops-service/public/lib/voiceClient.js`) called
`stopSpeaking()` up front, but that function could only stop an `Audio`
element that had *already been created* — it had nothing to invalidate a
TTS request still in flight. ElevenLabs synthesis takes a beat, and
Harvey's own description matched exactly: he pressed Play, didn't hear
anything yet (still fetching), and pressed Play again — during that
window `speakingMsgId` hadn't been set yet either, so the Play button's
own "am I already speaking this one" check didn't catch it. Both
`speak()` calls' fetches eventually resolved, both created their own
`Audio` element, and both called `.play()` — the second call's
`stopSpeaking()` had nothing yet to stop when it ran, since the first
request's `Audio` object didn't exist until its fetch resolved *after*
that point.

**Fix:** a module-level `playToken` counter, bumped on every
`stopSpeaking()` call (including the one `speak()` itself makes before
firing its fetch). Each `speak()` call captures the token's value at the
moment it starts (`myToken`); when its fetch resolves, it only actually
creates the `Audio` element and plays if `myToken` still matches the
current `playToken` — if a newer `speak()`/`stopSpeaking()` happened in
the meantime, the token has moved on and the stale response is dropped
before ever touching the DOM/audio pipeline, so it can never start
playing on top of whatever's current. Net effect: pressing Play any
number of times in a row, at any timing, still only ever results in at
most one audio track playing.

Frontend-only (`voiceClient.js`), so per §93 this is already live —
served straight from disk, no deploy/restart needed. Verified via
`node --check`; not yet tested against the live deployed service with a
real fast double-tap — worth a real test to confirm the race is actually
closed, not just reasoned about.

---

# 108. Don't Speak a Reply While Harvey Is Recording a New Message

Harvey's scenario: he sends a voice message, then starts recording a
second one before hearing the first reply — the auto-spoken reply to
message 1 would then play right on top of him dictating message 2.
Asked for the reply to simply not play while he has the mic open.

**Fix — one new piece of shared state in `voiceClient.js`:**
`setRecordingActive(active)` sets a module-level `recordingActive` flag
and, when turned on, immediately calls `stopSpeaking()` — so opening the
mic cuts off anything already playing, not just blocks new playback.
`speak()` now refuses to start at all while `recordingActive` is true —
checked both up front (before even firing the TTS fetch) and again once
the fetch resolves (covers the case where recording starts *during* an
in-flight synthesis request, reusing the same `playToken` mechanism from
§107 so a stale response never sneaks through).

**Wiring — one choke point per page, no new call sites needed:**
- `app.js`: both recording paths (live speech recognition and the
  record-and-upload fallback) already funnel every start/stop through
  the single `setRecordingUI(isRecording)` function — added
  `Voice.setRecordingActive(isRecording)` there once, covering both
  paths for free.
- `voice-mobile.html`: `startFlow(mode)` (recording start, called by
  both the Ask and Execute buttons) and `cleanup()` (recording end,
  called from both the cancel and finish buttons) are the two existing
  choke points — `setRecordingActive(true)` added at the top of
  `startFlow`, `setRecordingActive(false)` added inside `cleanup`, plus
  the mic-permission-denied error path also clears it so a failed
  recording attempt can't leave replies muted indefinitely.

**Deliberately not auto-resumed:** once recording stops, the reply that
got skipped is *not* automatically spoken afterward — it's still fully
present as text in the thread (rendering was never gated, only the
audio), and Harvey can tap Play on it manually anytime. Auto-resuming
felt like the wrong call: the natural next thing after he finishes
dictating a second message is sending it, not being interrupted by an
old reply starting to talk right as he's reviewing what he just said.

Frontend-only (`voiceClient.js`, `app.js`, `voice-mobile.html`), so per
§93 this is already live — no deploy/restart needed. Verified via
`node --check` on all three files (the third via the usual extract-inline-
script technique for `voice-mobile.html`); not yet tested against the
live deployed service with a real overlapping-recording scenario.

---

# 109. Fixed: Overlapping In-Flight Replies Could Render Out of Order

Harvey sent a screenshot showing a reply bubble ("Re: Well, there's a
small bug though when I click on the play button...") appearing *below*
a newer message he'd sent afterward, instead of above it — confusing,
looked like the wrong reply was surfacing late.

**Root cause, confirmed against the live `voice_messages` rows (not
guessed):** the "play button" bug's reply (queued/created 00:29:04,
completed 00:30:12) was still processing when Harvey sent the next
message (created 00:30:07, "Another bug... while I'm recording...") —
exactly the overlapping-recording scenario §108 was built for. Both
`addAssistantMessage()` and `addMessage()` (`app.js`,
`voice-mobile.html`) always called `thread.appendChild(...)`
unconditionally, regardless of where that row's typing placeholder had
been sitting. So when the older, slower reply finally finished, its
placeholder (positioned *above* the newer message, since it was created
first) got removed from its original spot, but the real reply bubble
that replaced it was appended at the thread's *current* end — landing
below the newer message's own placeholder instead of back where it
belonged.

**Fix:** both message-rendering functions gained an optional trailing
`insertBeforeEl` parameter, and a shared `insertMessageEl(el,
insertBeforeEl)` helper that does `thread.insertBefore(el,
insertBeforeEl)` when that anchor still exists in the DOM, falling back
to a plain `appendChild` otherwise (covers the normal, common case where
nothing else was in flight). `syncThread`'s `onDone`/`onError` callbacks
now look up the row's typing placeholder *before* building the
replacement bubble, pass it through as the insertion anchor, and only
remove it after the new bubble has taken its place — so a reply always
renders in its own chronological slot, never at whatever position the
thread happens to be at by the time it completes. The now-fully-unused
`removeTyping()` helper was deleted from both files rather than left as
dead code.

Frontend-only (`app.js`, `voice-mobile.html`), so per §93 this is
already live — no deploy/restart needed. Verified via `node --check` on
both files; not yet re-tested against a real overlapping-message
scenario on the deployed service — the original repro (send a message,
start another before the first's reply lands) is the way to confirm
this actually holds.

---

# 110. Ambient Audio Upload: Real Progress Bars, No More Silent/Stale List

Harvey reported dragging/selecting files to upload into the Settings
tab's ambient audio library gave zero feedback, and the list only
reflected what actually uploaded after a manual page refresh.

**Root cause:** the `change` handler (`ops-service/public/app.js`,
Settings tab) fired every `Store.put('audioTracks', ...)` without ever
waiting on the returned promise, then called `renderAudioList()` (a full
`Store.getAll('audioTracks')` re-fetch from the server) via a blind
`setTimeout(..., 200)` — a guess that the upload(s) would be done in
200ms, which doesn't hold for a real network upload of any real size.
No visual feedback existed at all while an upload was actually in
flight, and the eventual re-fetch could easily run before the upload had
actually landed server-side, so the list looked stale until Harvey
manually reloaded the page.

**Fix — a real per-file progress bar, not just a spinner:**
`fetch()` (what `store.js`'s shared `put()` uses) has no upload-progress
event at all; only `XMLHttpRequest`'s `upload.onprogress` exposes real
byte-level progress in a browser. Added
`uploadAudioTrackWithProgress(file, onProgress)` — talks to the exact
same `POST /api/files/audioTracks/:id` endpoint and request shape
(`file` field + JSON `meta` field) `store.js`'s `put()` already uses for
file-backed stores, just over XHR instead of fetch, so nothing on the
server changed. Deliberately scoped to just this one upload path rather
than rebuilding the shared `store.js` `put()` for every store — the
video-upload flow (Upload Files tab) doesn't have the same problem,
since it renders each new piece's card immediately from local state
rather than waiting on a server round-trip, so it was left alone.

The `change` handler now creates one row per selected file (filename +
a real `<progress>` element, updated live from `upload.onprogress`),
appended to a new `#audioUploadProgress` container above the track
list. A row disappears on success; on failure it keeps the filename and
shows "Failed: <reason>" instead of silently vanishing (the old
`Store.put()` path swallowed all upload errors via a bare `.catch(() =>
{})`, so a failed upload previously looked identical to nothing having
happened at all). `renderAudioList()` — the real list refresh — now only
runs once every file's `Promise` has genuinely resolved, via
`Promise.all(...).then(renderAudioList)`, replacing the old fixed-delay
guess entirely.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check`; not yet tested
against the live deployed service with a real audio file upload — worth
confirming the progress bar actually animates and the list updates
without a manual refresh.

---

# 111. Uploader Tool Built End-to-End: Auto-Transcribe, Outline Matching, Inline Row UI, Final Check Gate

Harvey's full spec for the real uploader workflow (replacing the old
"drop a video, click it to open a modal" flow with everything visible
inline, plus a real review gate before scheduling). Confirmed with him
first on two load-bearing decisions before building (see the preceding
conversation): (1) OK to add ffmpeg as a real backend dependency and
reuse the existing Claude Code mechanism (no new API key) for the
transcript→title/outline-matching step; (2) picking thumbnail/audio/
titles no longer auto-schedules anything — scheduling only happens when
Harvey explicitly approves out of a new Final Check stage.

**Stage model (`ops-service/public/lib/store.js`):** "Thumbnail Selected"
removed as a stage; **"Final Check"** added between Processing and
Scheduled. New `Store.TAGS` — `thumbnail_selected` / `titles_selected` /
`music_added` — replacing what that stage used to communicate, now shown
as small chips instead of a whole kanban column. A one-time migration
(`app.js`'s `migrateThumbnailStage`, runs inside `ensurePiecesLoaded`,
same pattern as the existing `backfillMissingSeqs`) moves any piece still
sitting on the old `thumbnail` stage id back to `processed` and tags it,
so nothing is silently stranded on a stage id that no longer exists.

**Tags are fully derived, never manually set** — `app.js`'s `syncTags(p)`
recomputes all three from scratch (thumbnail present → tagged, `ytTitles`
non-empty → tagged, `audioTrackId` set → tagged) every time a piece is
saved, rather than being tracked incrementally, so un-picking something
correctly drops its tag again too. Rendered both on kanban cards
(`cardHtml`) and in the new upload rows (below).

**Scheduling is now fully explicit, not automatic.** The old
`maybeAutoSchedule()` fired the instant a piece had both `audioTrackId`
and `thumbnailDataUrl` set — no review step existed at all. Renamed to
`approveAndSchedule()` and re-gated on `stage === 'final_check'`; it's
now called from exactly one place, the modal's new "Approve → Scheduled"
button (shown only when `p.stage === 'final_check'`, next to the
existing schedule-status readout). `scheduleShorts()`'s "ready" filter
changed the same way (`hasVideo && audioTrackId && thumbnailDataUrl` →
`hasVideo && stage === 'final_check'`), preserving its existing
multi-slot-fill-in-rotation-order behavior — approving several pieces in
a row (or several becoming ready at once) still fills consecutive
cadence slots correctly, it just only runs when Harvey approves
something now, never automatically. The old `deriveAndApplyStage()`
(auto-advanced a video piece's stage from field presence) is gone
entirely — a video piece's stage is now moved only by three explicit
actions: upload (→ Processing), "Send to final check" (→ Final Check),
Approve (→ Scheduled).

**New Upload Files tab UI** (`app.js`'s `buildUploadRow`, replacing the
old click-a-card-to-open-a-modal flow with everything inline, per
Harvey's spec): each in-production video is a row — thumbnail/title/#id/
tags/analysis-status on the left, then a real scrubbable frame picker
(same canvas-capture technique the shared modal's pick-frame flow
already used, just inline instead of behind a click), then the backing-
audio dropdown, then up to 3 title fields, then "Send to final check" (a
"Full editor…" button still opens the existing shared modal too, for
anything the row doesn't cover — notes, platforms, content type).
Already-posted videos keep the old simple card+modal treatment
(`postedGrid`/`videoCardHtml`, unchanged) since they don't need active
editing tools anymore.

**Audio dropdown gained an explicit "No ambient music" option**
(`__none__` sentinel, distinct from empty-string "not yet chosen") — the
`music_added` tag only fires for a real track pick, not this deliberate
opt-out, matching what the tag's name actually claims.

**The "3 title fields" storage/UI already existed** (`ytTitles`,
`fieldYtTitle1/2/3` in the shared modal) but was previously shown only
for `contentType === 'longform'` — removed that restriction (both in
`index.html`'s markup and the two JS toggle sites) since Harvey wants
title rotation for every uploaded video, not just longform.

**Auto-transcribe + outline-matching pipeline — the genuinely new
backend work:**
- `Dockerfile`: added `ffmpeg` to the existing apt-get install line.
- `ops-service/src/videoAnalysis.js` (new): `transcribeVideo(videoPath,
  tmpDir)` extracts the audio track via `ffmpeg -vn -acodec libmp3lame`
  into a scratch mp3, feeds it to the existing `elevenlabs.transcribeAudio`
  (already used for voice messages — no new transcription integration
  needed), then deletes the scratch file either way.
  `matchAndGenerateTitles(transcript, candidates)` builds a prompt
  containing the transcript and every "Uploaded"-stage piece's title +
  first ~400 chars of its outline (stripped to plain text — that's
  where Harvey's own alternate titles typically sit, per his example:
  piece #035's outline opening with three headline variants), asks for
  a single strict-JSON response (`matchedPieceId`, up to 3
  `titleOptions`, one `workingTitle`), and parses it (with a defensive
  markdown-fence strip in case the model wraps it despite being told
  not to).
- `ops-service/src/claudeRunner.js` gained `runOneShot(prompt,
  timeoutMs)` — a **completely separate, single-turn Claude Code call**,
  deliberately not reusing the voice app's persistent `currentSession`
  singleton (that's a real conversation with Harvey; mixing unrelated
  per-video analysis turns into it would pollute his actual Project
  Manager chat history). Same `query()` SDK call, same `cwd`/
  `pathToClaudeCodeExecutable` as the proven voice-app session, just
  without the resume/streaming-queue machinery — safe to run
  concurrently with the voice app or with other one-shot calls, since
  nothing is shared between them.
- `server.js`: `POST /api/videos/:id/analyze` validates the video file
  and piece both exist, responds immediately (`{ok:true, status:
  'running'}` — same "kick off real work, let the client poll" pattern
  as the voice app), then runs `runVideoAnalysis(id)` in the background:
  transcribe (logged, not fatal, if it fails — matching still attempts
  with an empty transcript rather than aborting the whole piece),
  candidate-fetch (`stmts.getAll.all('pieces')` filtered to
  `stage === 'uploaded'` — the whole table, not a SQL filter, since
  `pieces` are opaque JSON blobs in the generic `records` table with no
  queryable columns; fine at this table's tiny scale), match+generate,
  then **re-fetches the piece fresh** before writing results back
  (`transcript`, `analysisStatus`, `analysisMatchedPieceId`, `ytTitles`,
  `title`) so a concurrent edit Harvey made while analysis was running
  (e.g. to notes/platforms) isn't clobbered — only the analysis-owned
  fields are overwritten.
- Client side: `handleFiles()` now chains strictly — piece record saved
  first, *then* the video blob, *then* the analyze call — all awaited in
  order rather than fired in parallel, specifically so the server's
  by-id piece lookup inside `/analyze` can never race ahead of the piece
  actually existing yet. `maybeStartAnalysisPolling()` polls (3s) only
  the specific pieces still `pending`/`running`, stopping itself once
  nothing's waiting, so a row's "Transcribing & matching…" status
  updates to the real transcript/title/match without a page reload —
  same spirit as the voice app's `syncThread`, much smaller since it's
  scoped to at most a handful of concurrently-uploading rows rather than
  a whole conversation.

**Known limitation, stated honestly:** if Harvey edits a video's title
by hand in the *very* narrow window while its analysis is still running
(realistically a handful of seconds to under a minute), the analysis
completing afterward will overwrite that edit — the background job
doesn't currently check whether the title was touched in the meantime.
Not fixed this pass since the window is small and the fields are all
freely re-editable afterward anyway; worth a "don't overwrite if
Harvey's already changed it" guard if this turns out to bite in
practice.

**What's verified vs. not, honestly:** `node --check` passes on every
touched JS file. The one-shot Claude matching call
(`videoAnalysis.matchAndGenerateTitles` → `claudeRunner.runOneShot`) was
dry-run tested directly against real synthetic candidate data in an
isolated scratch environment (confirmed the SDK call, prompt, and
`query()`/`pathToClaudeCodeExecutable` wiring all execute correctly end
to end) — but that test ran under *this interactive session's* own
auth context, which doesn't carry `CLAUDE_CODE_OAUTH_TOKEN` (this
session authenticates differently), so the call correctly reached
Claude but got an unauthenticated "Not logged in" response rather than
a real one. This is not a bug in the new code — the actual deployed
`server.js` process has `CLAUDE_CODE_OAUTH_TOKEN` in its own environment
(the same one the already-proven-working voice app uses), so
`runOneShot` should authenticate correctly once this is actually
running as the container's own server process. **Genuinely not yet
verified**: a real end-to-end run (drop a real video, watch ffmpeg
extract + ElevenLabs transcribe + Claude match + the row update itself
live) against the deployed service, and matching against a *real*
"Uploaded"-stage candidate (none currently exist in the live data —
Harvey hasn't moved any outlines to that stage yet, so the matcher has
never had a real candidate to find). This is a `server.js`/`Dockerfile`
change, so per §93 it needs a full rebuild+restart, which (per §74/§88's
standing caveat) will kill this session's own process mid-task — test
this for real once it's back up, ideally with at least one real piece
sitting in "Uploaded" so there's something genuine to match against.

---

# 112. Uploader Tool: Fixed the Whole-Panel Flash on Every Click

Harvey tested §111 live and reported the panel flashing/disappearing
briefly on nearly every interaction — after upload, picking an audio
track, using "Use this frame," and "Send to final check" (which also
visibly needed two clicks and gave no real feedback that it had worked,
even though the piece *did* move correctly on the kanban board
underneath).

**Root cause, both parts:**
1. Every single per-row action (`captureBtn`, `audioSelect`,
   originally also `sendBtn`) saved the piece and then called the
   *entire panel's* `renderUploadLists()` — which tore down every row
   in the list (not just the one that changed) and rebuilt all of them
   from scratch, re-fetching every other row's video blob over again in
   the process. One click on one row's audio dropdown was silently
   re-loading every video preview in the whole list.
2. `renderUploadLists()` itself made this worse independent of the
   above: it cleared `uploadRows.innerHTML` *synchronously*, then only
   refilled it once `Store.getAll('audioTracks')` resolved — a real
   blank gap between clearing and refilling, which is what actually
   read as the panel "flashing/disappearing," not just a slow update.

**Fix, `ops-service/public/app.js`:**
- `renderUploadLists()` now builds the new rows in a detached
  `DocumentFragment` first (waiting on `Store.getAll('audioTracks')`
  before touching the DOM at all) and swaps it in with one
  `uploadRows.appendChild(frag)` — no more clear-then-wait-then-fill
  gap. Still used for the cases that genuinely need every row rebuilt:
  initial load, a new upload landing, analysis finishing, or the full
  editor modal closing.
- `buildUploadRow()`'s head section (thumbnail/title/#id/tags/analysis
  status) was factored out into `buildUploadRowHead(p)`, with a
  `refreshHead()` closure that swaps just that one row's head for a
  freshly-built one. `captureBtn` and `audioSelect`'s change handlers
  now call `Store.put('pieces', p).then(refreshHead)` instead of the
  full `renderUploadLists()` — only that row's own thumbnail/tags
  actually change, nothing else in the list is touched or re-fetched.
  The title inputs now also call `refreshHead()` synchronously on every
  keystroke (cheap — it only rebuilds the head, never the input the
  user is actively typing in, so focus/cursor position is never
  disturbed) so the "titles selected" tag appears/disappears live too.
- **"Send to final check"** no longer touches `renderUploadLists()` at
  all: the button immediately disables and shows "✓ Sent" (Harvey's
  requested instant tick), then once the save resolves the row itself
  gets a `.upload-row-removing` class and is removed from the DOM
  ~400ms later (`style.css`: opacity/scale/max-height/margin/padding
  all transition to zero, a clean collapse regardless of the row's
  actual height, which varies with content). This also fixes the
  "had to click it twice" complaint — that was never actually a second
  submission going through, it was the first click's full-panel
  re-render flash making it look like nothing had happened, so Harvey
  clicked again.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a Python
brace-balance check on the CSS; not yet re-tested against the live
deployed service with a real upload — worth confirming the flash is
actually gone and the tick/collapse animation reads the way Harvey
wants before considering this fully settled.

---

# 113. Final Check: Full Review Right on the Kanban Card, No Click-Through

Harvey's ask, with an annotated screenshot: pieces in Final Check
shouldn't need a click into the editor at all — he wants the actual
video playable right there on the card, title underneath, the real
caption/description underneath that, the 3 title options, and a button
to push straight to Scheduled. The column itself should be roughly
twice as wide on desktop so there's actually room for all of that.

**`ops-service/public/app.js`:** `render()` now special-cases the
`final_check` column — instead of the normal compact `cardHtml()`, its
cards go through a new `finalCheckCardHtml(id, piece)`: a real `<video
controls>` (served directly from `/api/files/videos/:id`, no blob-fetch
needed — same-origin, so the session cookie rides along automatically
on a plain `src`), the title, the actual rendered caption (reusing the
same `renderCaptionText(p, settings)` the shared modal already uses —
Settings' caption templates are fetched once in `bootContentOps()` into
a new `boardSettingsCache`, since the board needed access to Settings
data it never previously required), the title options as a numbered
list, and "Approve → Scheduled" / "Full editor…" buttons. Deliberately
its own `.final-check-card` class, not `.card` — completely excluded
from the generic click-to-open-modal and drag-start bindings in
`bindBoardEvents()`, since Harvey explicitly doesn't want a click on
this card doing anything but what its own buttons/video do.

**"Click the video preview and it just starts playing":** native
`<video controls>` only toggles play/pause when its own control bar is
clicked, not the video frame — so a delegated click handler on
`.fc-video` calls `play()`/`pause()` directly, restricted to clicks
landing above roughly the bottom 40px of the video (where the native
control bar actually sits), so it doesn't fight with — and
double-toggle against — the control bar's own native click handling.

**"Approve → Scheduled"** calls the same `approveAndSchedule()` built
for the modal's own Approve button in §111, then a plain `Store.put` +
`render()` — the kanban board's `render()` is a single synchronous
`board.innerHTML = ...` rebuild (unlike the Upload Files list's old
bug, §112), so there's no blank-gap flash risk in reusing it here.

**Column width:** `.column[data-stage="final_check"] { width: 800px; }`
(double the normal 400px), scoped inside a `@media (min-width: 641px)`
block — deliberately a *separate* desktop-only media query rather than
folding it into the existing rule, because an attribute-selector rule
has higher CSS specificity than the existing mobile breakpoint's plain
`.column { width: 86vw; }` override regardless of source order; without
scoping it explicitly to desktop, the wider column would have stayed
800px on mobile too, overriding the intentional mobile-responsive
behavior. Per Harvey's own phrasing ("twice as thick on desktop"),
mobile keeps the normal `86vw` column width — the rich card content
(video/caption/titles) still shows there too, just without the extra
desktop-only column width, since he didn't ask for it to be
mobile-specific, only the width doubling.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a Python
brace-balance check on the CSS; not yet tested against the live
deployed service with a real Final Check video — worth confirming the
video actually streams/plays from the direct `/api/files/videos/:id`
URL, the click-to-play boundary feels right, and the caption renders
correctly once a real piece sits in this stage.

---

# 114. Uploader: Auto-Detect Content Type from Video Duration + Orientation

Harvey wants the content type (ultra-short / short / long-short /
longform) picked automatically on upload instead of always defaulting to
"Short" — his rule: check orientation first (does landscape/vertical
help distinguish it), then use length.

**`ops-service/public/app.js`, `handleFiles()`:** added
`probeVideoMeta(file)` — reads `duration`/`videoWidth`/`videoHeight`
straight off the local file via a throwaway `<video>` + object URL, no
upload or ffmpeg round trip needed (this is just the browser parsing the
file's own metadata locally, fast, and resolves `null` rather than
rejecting if it ever fails, so a weird/corrupt file still uploads —
it just falls back to the same "Short" default that was hardcoded
everywhere before this feature existed).

**The actual rule** (`detectContentType(meta)`), matching Harvey's own
framing — orientation is specifically what separates "this is basically
Longform" from everything else, since Longform is inherently a
landscape format (YT/FB), not a vertical one:
```text
landscape (width >= height) AND duration > 180s  →  longform
duration <= 20s                                   →  ultra_short
duration <= 75s                                    →  short
otherwise                                           →  long_short
```
A short landscape clip still gets bucketed by length like everything
else (only *long* landscape content reads as Longform); a very long
vertical video still caps out at `long_short` rather than ever being
called Longform, since that type doesn't really exist as a vertical
format in practice.

`handleFiles()` now awaits the metadata probe (typically sub-second for
a local blob) before creating the piece record at all, so
`contentType` is set correctly from the very first save — no
after-the-fact correction pass needed. Each file's row still appears
independently as soon as *its own* probe resolves, not gated on other
files uploaded in the same batch.

Frontend-only, so per §93 this is already live — no deploy/restart
needed. Verified via `node --check`; not yet tested against a real
mixed batch of vertical/horizontal, short/long clips on the deployed
service — worth confirming the thresholds actually feel right in
practice (they're reasonable first-pass numbers based on how each type
is already described in `Store.CONTENT_TYPES`, not something Harvey
specified precisely) and adjusting if a real upload gets miscategorized.

---

# 115. Final Check Now Actually Shows the Final (Audio-Spliced) Video

Harvey's report matched exactly what §113's card was missing: the Final
Check preview was still the raw uploaded video, no ambient audio
spliced in at all. His rule: build the *real* final video before a
piece is ever allowed into Final Check — it stays in Processing until
that's genuinely done.

**`ops-service/src/videoAnalysis.js`: `buildFinalVideo(videoPath,
audioPath, outPath)`** — the same 20%-under-original mix Harvey already
manually reviewed and approved back when this was first tested by hand
("that's actually perfect. well done!"), now wired into the real
pipeline. One addition beyond that original manual test: `-stream_loop
-1` on the audio input, so a shorter ambient track loops for the video's
full length instead of playing once and going silent — matches Harvey's
own uploader spec ("all music is simply to loop/repeat until the video
ends"). `amix`'s `duration=first` still cuts the whole output off once
the video's own original audio ends, so the loop doesn't run past the
video. Verified for real against the live test video before wiring it
in (same "safe to test, no side effects" reasoning as the shipping-quote
checks elsewhere) — confirmed the command runs cleanly and produces an
output whose duration exactly matches the source video's; not
separately re-verified with a track *shorter* than the video (the one
available for testing happens to already be longer), so the actual
looping behavior itself is unconfirmed on real output, just standard,
well-documented ffmpeg mechanics. When no audio track is chosen (or
`"__none__"`, Harvey's explicit "No ambient music" pick), this just
remuxes the original video untouched via `-c copy` rather than skipping
the step — so Final Check always plays from the same `<id>-final` file
regardless of whether music was actually added, one code path instead
of two.

**`server.js`: `POST /api/videos/:id/build-final`** — same
immediate-response-then-background-job pattern as the existing
`/analyze` route. Builds into a **separate** `<id>-final` id in the same
`videos` store (never overwriting the raw upload) specifically so
picking a different audio track later and sending it again always
splices from the untouched original, not from a previous splice.
Registers a normal `videos` DB record for the new file (so it serves
through the existing, unchanged `/api/files/videos/:id` route — no new
serving code needed) and, **only once the build genuinely succeeds**,
sets `piece.stage = 'final_check'` itself, server-side — the client
never flips the stage directly anymore. On failure the piece stays in
Processing with `finalBuildStatus: 'error'` so Harvey can just try
again (e.g. after picking a different track) instead of getting stuck.

**Frontend (`app.js`):** "Send to final check" no longer moves the
piece itself — it sets `finalBuildStatus: 'pending'`, calls the new
route, and the row shows "Building final video (splicing in audio)…"
live. The row's own instant-tick-and-remove animation from §112 still
happens, just triggered by the *real* completion landing via the
polling loop (generalized — same poller now also watches
`finalBuildStatus`, and a piece whose stage actually changed gets the
animated removal, while one still in Processing with just a changed
status gets its own row refreshed in place) rather than faked the
moment the button is clicked. Also narrowed the Upload Files "in
production" list to `stage === 'processed'` only (was `stage !==
'live'`, which included final_check) — once a piece has its own review
card on the kanban board (§113) it shouldn't also still show as an
editable row here, which used to be a harmless-looking but real
inconsistency (a full page reload would have brought a final_check
piece right back into this list, undoing §112's removal animation).

**One-time migration** (`migrateUnbuiltFinalChecks`, same pattern as
the existing `migrateThumbnailStage`): any piece already sitting in
`final_check` without `finalBuildStatus: 'done'` — which, before this
fix, was *every* piece that ever reached that stage, since the build
step didn't exist yet — gets sent back to Processing so it goes through
the real build the next time Harvey sends it. Confirmed directly
against the live data before writing this: piece #094 (from Harvey's
own screenshot) is exactly this case, `finalBuildStatus: undefined`,
and will correctly migrate back to Processing on next load.

This is a `server.js`/`videoAnalysis.js` change (real backend logic,
not just frontend), so per §93 it triggers a full rebuild+restart on
the next deploy — same standing caveat as §102/§104/§111, since this
session is the headless agent running inside the container being
restarted.

Verified via `node --check` on all touched files and a direct ffmpeg
test of the actual splice+loop command against the real uploaded test
video on the VPS; **not yet verified end-to-end through the deployed
app itself** — confirm after the restart that clicking "Send to final
check" genuinely builds the file, the piece stays in Processing with a
live status line while it does, and the Final Check card's video
actually has the spliced audio audible when played.

---

# 116. Final Check Card: No Editor Escape Hatch, Added Post Locations + Type

Harvey's follow-up on §113/§115: drop the "Full editor…" button entirely
— Final Check should be a closed review surface with no way to open the
shared editor modal at all — and add the platform (post locations:
FB/IG/etc) and content-type chips directly onto the card, alongside
what's already there.

**`ops-service/public/app.js`:** `finalCheckCardHtml()`'s "Full
editor…" button is gone, and its `bindBoardEvents()` click handler
(`.fc-edit-btn`) removed along with it — since `.final-check-card` was
already deliberately its own class rather than `.card` (§113, to keep
it out of the generic click-to-open-modal binding), removing this one
button closes the only remaining way to reach the editor from this
card. Added `'<div class="chip-row">' + chipHtml(piece) + '</div>'`
right under the title — `chipHtml()` is the exact same helper the
normal kanban cards already use for platform + content-type chips, so
no new rendering logic was needed, just reusing what already existed.

Final Check cards now show exactly Harvey's list: title(s), video
preview, post-location/type chips, caption, and one Approve button —
nothing else clickable.

Frontend-only, so per §93 this is already live — no deploy/restart
needed. Verified via `node --check` and a CSS brace-balance check.

---

# 117. "Upload Files" Renamed to "Content Production"; Instant Send-to-Final-Check; Glassy Panels

Three small Harvey asks in one pass, all `ops-service/public/` only.

**Rename.** The `upload-files` tab's display label changed from "Upload
Files" to "Content Production" in `app.js`'s `TABS` array and the
side-rail icon's `title`/`aria-label` in `index.html`. Per this
codebase's established convention (see §90/§99), the internal tab id
(`upload-files`), hash route (`#upload-files`), and every JS identifier
(`renderUploadLists`, `buildUploadRow`, `UPLOAD_MARKUP`, etc.) were
deliberately left alone — only the user-visible text changed.

**"Send to final check" now shoots off instantly.** §115 made this
button kick off a real ffmpeg audio-splice build server-side and wait
(showing "Building…"/a live "Building final video…" status line) for
that job to actually finish before the row disappeared — correct
architecturally, but Harvey found the wait itself annoying ("I don't
want it to hang, I want it to shoot off immediately"). Fixed in
`buildUploadRow`'s `sendBtn` click handler: it still saves
`finalBuildStatus: 'pending'` and still fires
`POST /api/videos/:id/build-final`, but the fetch is no longer awaited
before the row's tick-and-collapse animation runs — `removeUploadRowAnimated`
now fires immediately after the (fast, local) `Store.put` resolves,
not after the (slow, real ffmpeg) build completes. The actual build,
and the server-side stage flip to Final Check on success (§115,
unchanged), still happen in the background exactly as before — this is
a UI-perception fix, not an architecture change.

**Failure visibility, preserved despite the row being gone already:**
`maybeStartAnalysisPolling`'s poll loop still tracks
`finalBuildStatus` for every such piece regardless of whether its row
is still on screen. If a build later fails (`finalBuildStatus ===
'error'`) and the row was already removed by the instant-tick
animation, the poller now calls a full `renderUploadLists()` instead of
silently no-op'ing (the old `refreshUploadRowHeadById`/
`removeUploadRowAnimated` pair both just early-return if the row isn't
in the DOM) — so a real failure still resurfaces the row with its error
status and a "try again" path, it just takes one extra rebuild rather
than updating in place. A successful build still never triggers a
visible change here at all, since the row is already gone by the time
it completes — exactly what Harvey asked for.

**Glassy/translucent panels instead of flat green-black.** Harvey: "the
green is super boring." The ops panel already renders a fixed
Earth-from-space backdrop behind everything (`body::before`, `img/earth.png`)
but every panel surface used an opaque `var(--surface)` background, so
it never actually showed through. `.dropzone`, `.video-card` (the
Posted grid), and `.upload-row` (the main per-video Content Production
panels) now use a translucent aurora-tinted gradient (green → violet →
cyan, all low-opacity) plus `backdrop-filter: blur(…) saturate(150%)`
instead — a frosted-glass look that lets the Earth backdrop bleed
through with a soft blur, with a subtle green glow on hover instead of
a flat border-color swap. Deliberately scoped to just this tab's three
panel types, not the kanban's `.card`/`.final-check-card` or anything
outside Content Production — Harvey's complaint was specifically about
this section.

Frontend-only (`app.js`, `index.html`, `style.css`), so per §93 this is
already live — no deploy/restart needed. Verified via `node --check`
and a CSS brace-balance check; not yet tested against the live deployed
service with a real upload — worth confirming the instant-collapse
feels right in practice and a deliberately-forced build failure (e.g.
picking a corrupt file) actually resurfaces the row via the poller
rather than silently vanishing.

---

# 118. Manuscript Landed; Ops Panel Nav Restructured Into Groups

**Manuscript:** Harvey committed `THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt`
(2529 lines, page-delimited with `==PAGE N==`/`==END PAGE N==` markers) to
the repo root locally but hadn't pushed it — committing and pushing are
separate steps in GitHub Desktop, and only the latter reaches GitHub. Once
he pushed, `git fetch`/`merge` pulled it into this session's checkout
cleanly (pure addition, no conflicts) and it's readable. Nothing else
required — this isn't wired into any feature yet (see the deferred
manuscript-driven-idea-generation discussion from earlier the same day);
it's just sitting in the repo for now.

**Nav restructure (`ops-service/public/`, Harvey's spec):** the ops panel
had 7 flat top-level destinations (Project Manager, Content Ops, Content
Production, Content Analytics, Sales Analytics, Website Analytics,
Settings). Reorganized into 3 top-level entries, two of which are groups:

```text
Project Manager
Content Ops
  Content Pipeline   (was the "Content Ops" kanban board — same leaf id)
  Content Production (was "Upload Files"/§117 — same leaf id)
  Content Settings   (was "Settings" — same leaf id)
Analytics
  Content Analytics
  Sales Analytics
  Website Analytics
```

**Implementation, `app.js`:** `TABS` (a flat array) is now derived from a
new `GROUPS` array (`TABS = GROUPS.reduce(...)`) — every leaf tab id is
completely unchanged from before (`content-ops`, `upload-files`,
`settings`, `content-analytics`, `sales-analytics`, `website-analytics`),
only labels and grouping changed, so `renderActiveTab()`'s routing
(`if (active === 'content-ops') { ... }` etc.), `bootContentOps`/
`bootUploadFiles`/`bootSettings`, and everything else that keys off a
leaf id needed zero changes. `groupForTab(id)` looks up which group a
leaf belongs to.

- `renderTabs()` (top strip) now renders one link per **group** (3
  links), each pointing at its group's first leaf as the default
  destination, marked active if the current leaf is *any* member of
  that group.
- New `renderSubtabs(active)` renders a second-tier pill-style strip
  (`#panelSubtabs`, new nav element in `index.html` between
  `.panel-header` and `.panel-main`) listing the active group's own
  leaves — this is the only way to reach a group's non-default leaf
  (e.g. Content Production, Sales Analytics) from the top nav now that
  the top strip itself collapses each group to one link. Empty (and
  CSS-collapsed via `:empty`) for the single-leaf Project Manager
  "group". Called from `renderActiveTab()` on every hash change.
- Side-rail (`index.html`): Content Ops and Analytics are now each a
  `.side-rail-group` — a full-size parent icon (a new distinct icon per
  group: layered-diamonds for Content Ops, trending-line for Analytics,
  chosen deliberately different from any child's icon to avoid visual
  duplication) linking to the group's default leaf, with its 3 real
  leaf icons nested beneath under a thin divider, smaller (34px vs the
  parent's 50px) — Harvey's "nested sub-icons" request. Not indented
  sideways (the rail is only 76px wide); the nesting reads through
  size + the divider + grouping instead. `bindSideRail()`/
  `renderActiveTab()`'s existing generic `.side-rail-btn[data-tab]`
  handling needed no changes — every new nested icon just carries a
  real leaf `data-tab`, same as before.
- New icon for the Content Analytics leaf (a play-circle, previously had
  no side-rail icon at all — the old rail's comment noted "Content
  Analytics stays reachable from the top tab row only," which is no
  longer true now that it's nested under the Analytics parent).

Frontend-only (`app.js`, `index.html`, `style.css`), so per §93 this is
already live — no deploy/restart needed. Verified via `node --check`, a
CSS brace-balance check, and an HTML open/close tag-count check on the
restructured side-rail markup; not yet visually verified against the
live deployed service — worth confirming the nested rail icons and the
pill-style sub-tab strip actually render/align the way Harvey pictured
before considering this fully settled.

---

# 119. Final Check Card: Real Click-to-Play, Description Under Title, Titles Reformatted

Harvey tested §116's Final Check card for real and sent a screenshot with
three fixes: the video still wasn't click-to-toggle despite §113's fix,
the caption ("the description of the YT vid") should show directly under
the main title rather than after the chip row, and the title-options list
should be plain "Title 1: x" / "Title 2: y" lines placed once, directly
under the video — not a numbered list, and not repeated again near the
description.

**Video click-to-play, root-caused rather than re-patched.** §113's fix
compared the click's Y coordinate against a guessed 40px control-bar
height on the `<video>` element itself, to tell a frame click from a
native-control-bar click. That's fragile — Chrome's native controls live
in a UA shadow root, and a click anywhere inside it still retargets to
the host `<video>` for a plain `click` listener, so there's no reliable
way to distinguish "clicked the frame" from "clicked the control bar"
purely from where the event says it landed once you're relying on
coordinate math on the same element both regions share. Replaced with a
structural fix instead: `<video>` is now wrapped in `.fc-video-wrap`,
with a transparent `.fc-video-overlay` (`position:absolute; inset:0;
bottom:44px`) covering only the frame — clicks in that region can only
ever hit the overlay (toggles play/pause directly), and the uncovered
44px strip at the bottom is never touched by anything but the native
control bar, so there's no shared element and no coordinate ambiguity
left to get wrong.

**Reordered the card.** New order: video → title options ("Title 1: x"
/ "Title 2: y", one `<div>` line each via a new `.fc-title-line`,
replacing the old `<ol><li>` numbered list) → main title (`.fc-title`,
unchanged content: `#094 — <piece.title>`) → caption/description
(`.fc-caption`, unchanged rendering via `renderCaptionText` — captions
*are* this codebase's "YT description" field, per §62's Settings spec;
no new field was needed, Harvey had just saved one) → platform/type
chips → Approve button. Nothing about `renderCaptionText`/the Settings
caption templates changed — this was purely a layout/positioning fix.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a CSS
brace-balance check; not yet re-tested against the live deployed service
with a real Final Check card — worth confirming the overlay actually
makes the whole frame clickable without interfering with the native
scrub bar/volume/fullscreen controls, and that the reordered layout
reads correctly with a real saved caption now that Harvey has one set.

---

# 120. Final Check: Click-to-Play Fixed for Real (Dropped Native Controls); Removed Redundant Title; Green Play Icon

Harvey tested §119 on his real device and reported the frame still
wasn't clickable — he had to hit the tiny native play icon in the
control bar specifically. He also sent a screenshot showing 3 separate
"titles" on the card (Title 1, Title 2, and a large `#094 — <title>`
heading below them, which duplicates Title 1) and asked to drop the
redundant heading, enlarge Title 1/Title 2 to that heading's size, and
add a green accent placeholder play-button over the video.

**Root cause, honestly reasoned rather than re-guessed a third time:**
§119's partial overlay (covering the frame, leaving a bottom strip
uncovered for the native `<video controls>` bar) is a sound pattern in
an ordinary desktop browser, but native video controls on some
platforms — iOS Safari in particular — render through the OS's own
media-player chrome rather than plain shadow-DOM content the page can
reliably out-layer with a positioned `<div>`, especially before first
play. There's no further CSS/JS tuning that reliably fixes this from
inside the constraint of "keep native `controls`" — the two real device
tests (§113's coordinate hack, §119's partial overlay) both failing in
the same direction (frame doesn't respond, only the literal native
button does) supports this rather than pointing at a fixable typo.

**Fix: drop `controls` entirely.** `finalCheckCardHtml()`'s `<video>`
no longer has the `controls` attribute at all. With no native chrome
left to protect or conflict with, `.fc-video-overlay` now covers the
*whole* frame (not just the region above a guessed control-bar height)
and is guaranteed to receive every click on every platform — there's
nothing else in the video's box that could intercept it. This also
naturally supplies Harvey's second ask: the overlay hosts a centered
`.fc-play-icon` (a green-accent circle + triangle, `var(--accent)`
border/color) that's the click-anywhere-to-play affordance *and* the
placeholder he asked for, in one element. `bindBoardEvents()`'s
`.fc-video-wrap` loop wires `play`/`pause` events on the real `<video>`
to toggle a `.is-playing` class on the wrap, which CSS uses to hide the
icon while actually playing (and it correctly reappears if the video
pauses for any reason, including reaching its natural end, since
`pause` fires there too — not just on an icon click).

**Real trade-off, stated honestly:** losing native `controls` also
means losing the scrub bar, volume, and fullscreen button — Final Check
is now play/pause-anywhere only, no seeking. Acceptable for a quick
review of a short clip; worth adding a minimal custom scrub bar later
if that turns out to be missed in practice, but not built now since
Harvey's ask was specifically about reliable click-to-play, not seeking.

**Titles:** the large `#094 — <piece.title>` heading (`.fc-title`) is
gone entirely — it was always just a duplicate of Title 1 in practice.
`.fc-title-line` (the "Title 1: x" / "Title 2: y" lines from §119) is
now sized to match what that heading used to be (`font-size: 1.02rem;
font-weight: 600`, was `0.85rem`). The `.fc-title` CSS rule was deleted
outright (confirmed nothing else referenced it) rather than left as
dead code.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a CSS
brace-balance check; **genuinely not yet confirmed against Harvey's real
device** — this is the third attempt at reliable click-to-play on this
card (§113, §119, this one), and the first two both looked correct on
inspection and failed in practice, so don't assume this one is settled
just because the reasoning holds up — ask Harvey to actually test it
before treating this as closed.

---

# 121. Final Check Click-to-Play: Third Attempt — Bind Directly to `<video>`, Drop the Overlay Indirection

§120 made things worse, not better — Harvey reported clicking anywhere,
including the green play icon, did nothing at all. Confirmed via a
direct fetch of the live `ops.realitymanual.com/app.js` that what's
deployed is byte-identical to this repo (ruling out a stale-deploy
explanation), so the bug is real, not a caching artifact.

**Reasoning through it once more, in full:** §120 kept a separate
`.fc-video-overlay` `<div>` as the actual click target, sized to cover
the whole video. That made sense in §119, where the overlay's whole job
was covering the frame *without* covering the native control bar. But
§120 already removed `controls` — at which point there is no native
chrome left to route around, and the overlay had no remaining reason to
exist as a click target. Keeping it anyway introduced exactly the kind
of indirection (a sibling element sitting on top of the real interactive
element) that's a known source of mobile/cross-browser hit-testing
quirks — and with no way to reproduce the failure directly in this
environment (no headless browser available here), removing that
indirection entirely is the most defensible fix available: it doesn't
just patch around a guessed cause, it eliminates the one remaining
structural difference between this and "the simplest possible thing
that could work."

**Fix:** the click/`play()`/`pause()` listener now binds directly to the
bare `<video>` element (`bindBoardEvents()`'s `.fc-video-wrap` loop).
`.fc-video-overlay` is still in the markup and still renders the green
`.fc-play-icon`, but is now `pointer-events: none` in CSS — purely
decorative, structurally incapable of intercepting a click meant for the
video. This is about as direct as a click-to-toggle binding can get:
one element, one listener, no controls attribute, nothing layered on
top of it that could ever eat the event.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed; confirmed via a direct fetch that the live
`app.js` matches this commit. Verified via `node --check` and a CSS
brace-balance check. **Third attempt at the same underlying problem
(§113, §119, §120, now this) — flag this prominently if Harvey reports
it's still broken.** If so, the honest next step is not a fourth blind
code change: it's asking him for the exact device/browser (e.g. "iPhone
15, Safari" vs. "Pixel 8, Chrome") and, ideally, to open the page's
console (Safari: Settings → Advanced → Web Inspector, then inspect from
a Mac; Chrome Android: `chrome://inspect` from a desktop Chrome on the
same network) so a real error, if any, can be read directly instead of
guessed at from static code review.

---

# 122. Storefront Privacy Policy / Terms, and a TikTok App-Review Package for Content Studio

Two related deliverables, both from the same request: (1) `realitymanual.com`
needed a Privacy Policy and Terms of Service, styled to match; (2) Harvey
wants TikTok Content Posting API access for Content Studio (the ops-panel
uploader tool, §111+) and asked for everything needed to get approved on
the first submission — researched TikTok's actual current requirements
first (see Sources below) rather than guessing.

## What TikTok actually requires (researched, not assumed)

- **App registration** in TikTok's developer portal needs: a custom app
  name matching the real product, an app icon, a description, a **valid,
  fully-developed official website** (not a bare landing/login page), and
  **Privacy Policy + Terms of Service links that are prominently visible
  on that website's homepage**, not hidden behind menus.
- **Demo material**: at least one demo video (up to 5, 50MB each)
  showing the complete end-to-end integration, all requested scopes
  actually demonstrated, and — for a first-time (unaudited) submission —
  a sandbox environment. Screenshots reinforce this but video is the
  primary artifact TikTok's own guidelines describe.
- **Scopes**: Login Kit (OAuth account connection) + `video.publish`
  (Content Posting API, direct post) are the two we actually need; only
  request scopes actually used.
- **Unaudited restriction**: until TikTok audits the app for compliance,
  every post made through the Content Posting API is forced to
  `SELF_ONLY` visibility regardless of what the API request asks for,
  capped at 5 posting users per 24h. Public posting requires passing a
  separate compliance audit afterward.
- **Required UX** (from TikTok's Content Sharing Guidelines): show a
  content preview and the confirmed creator account before posting,
  collect a Music Usage confirmation and a Branded Content disclosure
  toggle, and provide posting-status feedback (poll `Get Post Status`
  after publishing) rather than claiming success just because a request
  was sent.

## What was built

**Storefront (`frontend/`)** — `privacy.html` and `terms.html`, styled
with the existing dark/gold design system (`.legal-page` class added to
`css/style.css`, reusing `--serif`/`--accent`/`--wrap` etc., no new
fonts or frameworks). Both linked from the footer of `index.html`,
`checkout.html`, and `confirmation.html` via a new `.footer-links` row.
Content is grounded in how this site actually operates (per this file's
own §13-34, §64-66) — real data flows (Stripe for payment, BookVault for
fulfillment, first-party analytics with a localStorage session id, no
third-party ad/analytics scripts, no data sold) rather than generic
boilerplate. **Placeholders that need Harvey's confirmation, flagged
explicitly rather than silently invented:**
- Contact email `support@realitymanual.com` — used throughout; needs to
  actually exist (a real inbox), or swap in whatever address should be
  used instead.
- The returns/refunds clause in `terms.html` describes only what the
  system actually does today (automatic refund if fulfillment fails) —
  there's no defined "change of mind" return window anywhere in this
  project, so none was invented; confirm this matches what Harvey
  actually wants to offer.
- No specific governing-law jurisdiction was named (none was known) —
  add one if that matters, or leave general.
- **This is a solid working draft, not a substitute for actual legal
  review** — reasonable for getting the site/TikTok submission
  unblocked, but flag to Harvey that a lawyer pass is worth it before
  this is truly final, especially the liability/returns sections.

**Ops-service (`ops-service/public/`, all pure static additions — no
`server.js` change, so per §93 this is served instantly, no
rebuild/restart)**:
- `privacy.html` / `terms.html` — a matching pair for Content Studio
  itself (the internal tool), written to accurately describe what it
  actually is: a password-gated internal team tool with no public
  signup, what it stores (content/video/audio/scheduling data, platform
  OAuth tokens once connected), and that platform integrations only ever
  post content the team itself authored to accounts the team itself
  controls — never third-party data. This is the privacy policy TikTok's
  registration form itself needs a URL for.
- `tiktok-app-review.html` — the demo/showcase page for reviewers. Walks
  through the real integration end-to-end (connect account via Login
  Kit → produce/review video in the existing Final Check gate → the two
  new TikTok-specific consent checkboxes (Music Usage, Branded Content)
  → scheduled-post confirmation with a dummy future date and "this is
  when it goes live" note, exactly as Harvey described) using inline
  mockups built from **this app's real CSS classes** (`.chip`,
  `.final-check-card`-style layout, `.btn-primary`, etc.) populated with
  clearly-labeled demo data — a genuine rendering of the actual design
  system, not a photograph, and explicitly captioned as such so nothing
  here misrepresents what is/isn't live yet. Explicitly states which
  parts already exist in the shipped product (upload, transcribe,
  splice, human-approval gate) versus what's net-new for TikTok
  specifically (the two consent checkboxes, the actual `video.publish`
  API call, status polling) — honesty here matters for a compliance
  review.
- All three pages cross-link to each other and are reachable from the
  Content Studio login screen's own footer (`.login-legal-links`, new),
  so the privacy/terms links are genuinely discoverable, not just
  privately known URLs — the same "must be visible, not hidden" bar
  TikTok holds the storefront to.
- `noindex, nofollow` on all three (matches this whole origin's existing
  `Disallow: /` `robots.txt`, §62) — irrelevant to TikTok review, which
  reaches these via a direct URL, not search discovery.

## What is NOT built, and what Harvey has to do himself

- **The actual TikTok app registration and submission** — requires
  Harvey's own TikTok developer/business login; nothing here can do that
  step. Register the app, set the official website to
  `https://realitymanual.com`, fill in the Privacy Policy / Terms of
  Service fields with the two new storefront pages built above, request
  Login Kit + `video.publish`, and point reviewers at
  `https://ops.realitymanual.com/tiktok-app-review.html` for the
  integration walkthrough.
- **A real demo video.** TikTok's own guidance treats video as the
  primary review artifact, not just screenshots — this session can't
  record narrated video. Worth deciding: either Harvey screen-records a
  short walkthrough of `tiktok-app-review.html` himself (the page is
  built specifically to make that easy — it's a single scrollable
  narrative), or this gets revisited once there's a way to capture one.
- **The actual `video.publish` integration code** (OAuth callback
  handling, token storage, the real `POST` to Content Posting API, the
  `Get Post Status` poll) is not built — TikTok credentials don't exist
  yet, and per this project's own established pattern (§62's TikTok
  Settings field, still empty, "the field is there for when it is"),
  building the real integration is properly sequenced *after* getting
  approved, not before. The demo page describes the intended design
  faithfully but isn't a claim that it's live.
- A working `support@realitymanual.com` inbox, if that placeholder
  address is kept.

Verified: `node --check` on all touched JS, brace-balance checks on
touched CSS, and an HTML tag-balance check on all five new HTML files.
Not yet reviewed by Harvey for tone/accuracy, and not yet submitted to
TikTok by him — flag both if this comes up again.

Sources (TikTok for Developers, fetched 2026-09-19):
- [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines)
- [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [Get Started - Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [App Review FAQ](https://developers.tiktok.com/docs/en/getting-started-faq)

---

# 123. Final Check Video Click-to-Play: Actually Found and Fixed (Real Root Cause, Verified End-to-End)

§113/§119/§120/§121 were all guessing at this from static code review — three theories (Y-coordinate math, native iOS media chrome, overlay-div indirection), none confirmed against a real browser, and Harvey correctly kept reporting it as still broken. This time, before touching any code, a real headless-browser test rig was built specifically to reproduce the bug against the live deployed service.

**How the test rig was built (worth knowing if this is needed again):**
`playwright-core` installs fine via npm, and `npx playwright install chromium` downloads a working browser binary — but this container is missing several shared libraries Chromium needs (`libnspr4`, `libnss3`, `libatk*`, `libcups2`, `libgtk-3-0`, `libxcomposite1`, `libxdamage1`) and has no root/sudo, so `apt`/`playwright install-deps` can't install them normally. Worked around by downloading the individual `.deb` files directly from `deb.debian.org` (reachable over plain HTTPS even with no configured apt sources) and extracting them with `dpkg-deb -x <file> <dir>` — which, unlike `dpkg -i`, doesn't require root — into a scratch directory, then pointing `LD_LIBRARY_PATH` at it. One real gotcha: the newest `libnspr4` build available required a newer glibc than this container has (`GLIBC_2.38` vs. the container's `2.36`); an older `libnspr4` package version resolved it. Logged into the real `ops.realitymanual.com` with the real password and drove real mouse clicks against the live Content Ops board.

**Root cause, finally confirmed rather than guessed:** `bindPanning()` — the board's click-and-drag-to-pan handler for the horizontally-scrollable kanban, bound to `boardWrap`'s `pointerdown` — excludes real cards from triggering a pan via `e.target.closest('.card, .card-move, button, select, input, textarea, [contenteditable]')`. `.final-check-card` was never in that list (it's deliberately *not* `.card`, per §113, specifically to keep it out of the generic click-to-open-modal/drag bindings — which inadvertently also kept it out of *this* exclusion list, an unrelated handler nobody was thinking about while chasing the video specifically). So every `pointerdown` anywhere inside a Final Check card — including on the video, regardless of which of the three previous click-handling schemes was in place — was captured by `boardWrap.setPointerCapture(e.pointerId)`, which redirects all subsequent pointer events for that gesture to `boardWrap` instead of whatever was actually clicked. The browser never sees a matching mousedown+mouseup pair on the video, so it never synthesizes a `click` event there at all. Confirmed directly: instrumenting `mousedown`/`mouseup`/`pointerdown`/`pointerup`/`click` on the video showed `mousedown`/`pointerdown` firing normally and `mouseup`/`pointerup`/`click` **never firing** — while a purely synthetic `dispatchEvent(new MouseEvent('click'))` (which bypasses real pointer-capture routing) worked fine, and a direct `video.play()` call worked fine. That combination only makes sense if something between mousedown and mouseup was stealing the pointer — which is exactly what `setPointerCapture` does.

This also explains why every earlier attempt failed in the same way regardless of approach: the Y-coordinate hack, the overlay div, and the direct-video-listener version were all fighting the wrong layer — the click was being intercepted one level up, by the *board*, before any of those schemes ever got a chance to matter.

**Fix — one line:** `bindPanning()`'s exclusion selector now includes `.final-check-card`:
```js
if (e.target.closest('.card, .card-move, .final-check-card, button, select, input, textarea, [contenteditable]')) return;
```
Nothing else from §121 needed to change — the direct-video-element click listener was already correct; it just never had a chance to receive real clicks.

**Verified end-to-end against the live deployed service** (not reasoned about): a real mouse click via the test rig now produces the full `pointerdown → mousedown → pointerup → mouseup → click` sequence on the video, toggles play/pause correctly in both directions, and — confirmed separately — dragging on empty board space (not on a card) still pans the board normally, so the fix doesn't regress the feature it's touching. This is a `ops-service/public/app.js`-only change (frontend-only), so per §93 it was already live on save, no rebuild/restart, and the live `app.js` was directly re-fetched mid-session to confirm the edit had actually propagated before re-testing.

**Process lesson for this file:** three prior attempts (§113, §119, §120/§121) shipped "verified via `node --check`" — true, but `node --check` only proves the JS parses, it says nothing about runtime behavior. This is the first attempt in this whole thread of fixes actually confirmed against real click events in a real browser against the real deployed service, and it's the one that turned out to have found the actual bug. Building the test rig cost real setup effort, but far less than a fifth guess-and-ship round would have — worth doing again for any future "I clicked it and nothing happened" report before touching code.

---

# 124. Legal Page Punctuation/Content Fixes, Checkout Legibility, Content Settings: Per-Platform Captions

Four smaller Harvey requests in one pass.

**Legal pages (`frontend/privacy.html`, `frontend/terms.html`,
`ops-service/public/privacy.html`, `ops-service/public/terms.html`):**
all em/en dashes removed (rewritten as commas, semicolons, colons, or
separate sentences depending on what actually read best in each spot —
not a blind find-replace to a hyphen). Both storefront pages now name
BookVault as based in the United Kingdom (§64/§65 already established
this is our real fulfillment partner; this is the first place the site
itself says where they're located). `terms.html`'s Returns & Refunds
section now states the support email directly inline
(`support@realitymanual.com`), not just in the page's closing Contact
section — Harvey's ask was specifically to have it right there in the
refund paragraph itself, not just findable elsewhere on the page.

**Checkout page legibility (`frontend/css/style.css`):**
- `.qty-gift-note` ("Know someone who'd appreciate a copy...") was
  serif italic at 0.92rem — Harvey found it hard to read. Switched to
  upright sans-serif at 0.95rem with slightly taller line-height;
  same muted color, just no longer italic/serif at a small size, which
  was the actual legibility problem, not the color.
- `.qty-book-icon` (the small per-copy book icons next to the quantity
  stepper): the accent-colored border from §68 is gone, and the icons
  now overlap into a fanned stack (`margin-left: -1.1rem` on all but
  the first) instead of sitting in an evenly-gapped row, per Harvey's
  "imagined the books overlapping slightly." A subtle drop shadow
  replaces the border for separation between overlapping icons — the
  placeholder SVG's own near-black background needed *some* visual
  edge (§68's original reasoning still holds), just not a colored
  outline now that they overlap and read as a stack rather than
  individual tiles.

**Content Settings: TikTok and Instagram/Facebook caption panels**
(`ops-service/public/app.js`, `lib/store.js`) — two new fields
alongside the existing Shorts/Longform caption templates (§62's
original "shared caption" design). `defaultSettings().captions` gained
`tiktok`/`igfb` keys (empty by default; `getSettings()`'s existing
`Object.assign(d.captions, s.captions)` merge backfills them for any
settings record saved before this change, no migration code needed).
`captionTemplateFor(settings, p)` (signature changed from taking just
`contentType` to taking the whole piece, its one call site updated)
now checks the piece's tagged platforms first: a piece tagged `tiktok`
uses the TikTok caption if one's set; a piece tagged `instagram` or
`facebook` uses the Instagram/Facebook caption if set; otherwise it
falls back to the existing Shorts/Longform split exactly as before.
This means a piece with no TikTok/IG/FB platform tag, or one where the
new fields are left blank, behaves completely unchanged — the new
fields are additive, not a replacement for the existing two. Rendering
(`renderCaptionText`, used by both the shared modal's caption readout
and the Final Check card) needed no changes beyond the one call-site
update, since both already just call `renderCaptionText(p, settings)`.

Frontend-only across both repos (no `server.js`/backend change), so per
§93 this is already live — no deploy/restart needed. Verified via
`node --check` on both touched JS files, a CSS brace-balance check, and
an HTML tag-balance check on the four legal pages; not yet visually
confirmed against the live deployed service for any of these four —
worth a look before considering this fully settled, particularly the
book-icon overlap (never rendered outside of reasoning about the CSS)
and whether the new caption fields save/reload correctly in Settings.

---

# 125. Voice Replies No Longer Read Raw URLs Out Loud

Harvey: links in a spoken reply were being read character-by-character
("h-t-t-p-s colon slash slash...") — same class of problem §89's fenced
code block handling already solved for shell commands ("sounds
ridiculous," his words this time, about links specifically).

**Fix, `ops-service/public/lib/voiceClient.js`'s `stripMarkdownForSpeech()`**
(shared by both `app.js` and `voice-mobile.html`, so this applies
everywhere TTS is used): two new regex passes, right after the existing
fenced-code-block handling and before inline-code/bold/italic stripping —
- Markdown-style `[label](https://...)` links keep the human-readable
  label and drop the url, becoming `label (link below)`.
- Any remaining bare `https://...`/`http://...` url (not part of
  markdown link syntax) becomes the plain phrase `link below`.

Both run before the fenced-code-block regex's own output could
interfere, and markdown links are handled before the bare-url pass
specifically so a link's own url text isn't caught twice. The chat
bubble's own rendering (`renderMarkdownLite`) is untouched — this only
changes what gets spoken, the visible text (and the real clickable link)
is exactly as the model wrote it.

Frontend-only (`voiceClient.js`), so per §93 this is already live — no
deploy/restart needed. Verified via `node --check` and a direct regex
test against a string containing both a markdown link and a bare url;
not yet heard on a real device — confirm a reply containing a link
actually says "link below" instead of the raw url next time one comes up.

---

# 126. Found the Real Source of the Repeated "Task-Style Sentence" Leak

Not a per-turn discipline problem, in the end — a genuine bug in this
codebase's own prompt text. Harvey caught this agent literally writing
"One task-style sentence: ..." (or a softened paraphrase of the same
thing) as a visible prefix, repeatedly, across separate turns, despite
being told to stop each time and a memory being written after the
second occurrence. On the fourth occurrence he asked, verbatim, to "go
in and gut whatever programming" was causing it — which turned out to
be exactly the right instinct: `ops-service/server.js`'s
`VOICE_SYSTEM_PROMPT` and the per-message `ACK_REMINDER` (§100 — added
specifically because "instructions placed right next to what they're
modifying tend to get followed more reliably," re-injected fresh
immediately before every single reply) both used the literal phrase
"task-style sentence" as an imperative instruction ("write one short,
task-style sentence..."). That phrasing is exactly the kind of thing
this agent is prone to echo back verbatim as a meta-label rather than
translating into natural output — and because `ACK_REMINDER` re-injects
it fresh right before every single reply is generated, it was
functioning as a standing, repeated trigger for the exact mistake it
was trying to prevent.

**Fix:** both `VOICE_SYSTEM_PROMPT`'s "Quick verbal acknowledgment"
paragraph and `ACK_REMINDER` reworded to describe the desired sentence
by example ("say, in your own words, what you're about to check or
do... the way you'd say it out loud to a colleague") instead of using
"task-style sentence" as an instructional label, and both now explicitly
say not to echo the instruction itself as a prefix, naming the exact
failure mode by description (though not by the literal trigger phrase,
deliberately — quoting the bad phrase as "don't write this" risks being
exactly as echo-prone as using it as a positive instruction was).

This is a `server.js` change, so per §93 it triggers a full
rebuild+restart on the next deploy — which, per the standing §74/§88
caveat, kills this session's own process mid-task, since this session
*is* the headless Project Manager agent running inside the container
being restarted. Logged to the work log immediately before pushing.

Verified via `node --check` and a grep confirming the only remaining
occurrences of the literal phrase are inside quoted "don't write this"
examples, not imperative instruction text. **Not yet confirmed this
actually stops the leak** — three prior attempts at the *symptom*
(re-wording, then a memory file, then a stronger memory file) didn't
hold, and this is a different kind of fix (addressing what's actually
different is the *prompt content itself*, not just adding more
instructions on top of it) — genuinely possible this still isn't
enough. If it recurs after this specific fix, the honest next step
isn't a fifth wording pass on either of these two strings — it's
questioning whether an per-message imperative reminder written in
second person ("write X") is inherently more echo-prone than a
declarative description, regardless of exact wording, and restructuring
the mechanism itself (e.g., style guidance folded into surrounding
prose rather than a standalone directive sentence) rather than
continuing to edit word choice within the same structure.

---

# 127. Kanban: Right-Click to Delete, Including Final Check Cards

Harvey asked for right-click delete on any kanban card, Final Check
cards included, with a confirm step so it can't fire by accident.

**`ops-service/public/app.js`:** a single reusable floating menu
(`.kanban-ctx-menu`, appended to `document.body`, repositioned per
invocation rather than one instance per card) opened via a delegated
`contextmenu` listener on `board` (`bindKanbanContextMenu()`, called
once from `bootContentOps()` — safe to bind directly on `board` rather
than `document`, since `board` is a fresh DOM node every time the tab
is (re-)booted, so there's no listener leak across visits, same
reasoning as the existing `bindPanning()` right above it). Matches on
`e.target.closest('.card, .final-check-card')` — both listed explicitly
since `.final-check-card` is deliberately not `.card` (§113, to keep it
out of the generic click-to-open-modal/drag bindings) — the exact same
"forgot to also list `.final-check-card` in an unrelated selector"
gotcha §123's pan-capture fix already hit once, avoided here by
remembering it up front.

**Two-step confirm**, same spirit as the shared modal's own existing
delete button (arm, then confirm) but as an explicit second menu state
rather than a timed re-arm: clicking "Delete" swaps the menu's content
to a "Delete this piece?" label with "Confirm delete" (styled in
`--error`) and "Cancel" buttons, rather than deleting immediately.
Confirming calls `Store.del('pieces', id)` and, for a piece with
`hasVideo`, also `Store.del('videos', id)` **and** `Store.del('videos',
id + '-final')` — the latter is new (the shared modal's own delete
button, `btnDelete`, only ever cleaned up the raw upload, never the
`-final` audio-spliced copy §115 introduced, so deleting a piece that
had reached Final Check would have left its final video file orphaned
on disk; worth fixing there too, not just in this new code, but out of
scope for this specific ask so left as a known gap). `stmts.del`/the
`DELETE /api/store/:storeName/:id` route already handles a
non-existent id gracefully (`fs.rm(..., { force: true })`), so calling
it for a `-final` file that was never built (piece never reached Final
Check) is a safe no-op, not an error.

Menu closes on an outside click, Escape, or right-clicking a different
card (opens a fresh menu for the new target instead of leaving the old
one stuck open) — the outside-click/contextmenu listeners are added via
a deferred `setTimeout(..., 0)` specifically so the very click that
opened the menu doesn't immediately close it again in the same tick.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a CSS
brace-balance check; not yet tested against the live deployed service —
worth confirming right-click actually opens the menu (not the native
browser context menu) on both a normal card and a Final Check card, the
confirm step genuinely requires the second click, and a deleted Final
Check piece's `-final` video file is actually gone from disk afterward.

---

# 128. "Use This Frame" Did Nothing for Vertical: Real Root Cause Was the Video Codec, Not Orientation — Plus Auto-Thumbnail, Platform/Type Display

Harvey's report ("clicked 'use this frame' on the vertical vid, nothing
happened") looked orientation-specific from his two test uploads, but
wasn't — confirmed with the same real-browser test rig from §123/§127
rather than guessed.

**Root cause, found by direct testing against the real broken upload:**
`videoEl.videoWidth`/`videoHeight` were stuck at `0` even though
`readyState` reported `HAVE_ENOUGH_DATA` and `duration` was correctly
known — and no amount of seeking or waiting fixed it. `ffprobe` on the
actual file showed why: it's HEVC (`codec_name=hevc`), the format modern
iPhones default to for recordings. Chrome/Chromium doesn't support HEVC
decoding on most desktop/Linux builds (a licensing restriction, not a
bug) — the browser genuinely cannot decode the video at all, so
`drawImage(videoEl, ...)` silently no-ops (doesn't throw, just draws
nothing — confirmed directly: sampled canvas pixel was `[0,0,0,0]`,
transparent black, both before and after clicking the button) rather
than erroring in any way JS could catch and report. The working
"horizontal" test upload was h264, not the exact orientation Harvey's
theory implied — the two videos just happened to differ in codec, not
only in orientation.

**Fix — normalize on the server, once, right after upload, not a
client-side workaround (there isn't one — no JS trick makes a browser
decode a codec it lacks):** `ops-service/src/videoAnalysis.js` gained
`ensureBrowserCompatibleVideo(videoPath)` — probes the video stream's
codec via `ffprobe`, and if it's not one of `h264`/`vp8`/`vp9`/`av1`
(the ones browsers universally decode), re-encodes it to H.264/AAC via
`ffmpeg` **in place** (same file path), so every downstream consumer —
the inline frame picker, Final Check's own preview, the eventual final
spliced video — gets a decodable file automatically, with zero
awareness needed anywhere else in the codebase. A no-op (`transcoded:
false`) for anything already compatible, so safe to call unconditionally
on every upload. Wired into `server.js`'s existing `runVideoAnalysis(id)`
— the same background job that already runs transcription/title-matching
right after upload — as its very first step, before transcription.
**This would have silently broken Final Check's own video preview too**
for any HEVC upload, not just this button — a meaningfully bigger deal
than the original report suggested, since it undermines the actual
review gate this whole tool exists for.

**Verified for real, not just reasoned about:** manually ran the exact
same `ffprobe`/`ffmpeg` commands against the real broken upload on the
VPS, confirmed the output was correctly re-encoded to `h264, 1080x1920`
(the display-matrix rotation baked correctly into real pixels too, not
just a metadata flag), swapped it into place, and re-ran the browser
test — `videoWidth`/`videoHeight` correctly reported `1080x1920`,
`drawImage` produced a real non-blank pixel, and clicking the real "Use
this frame" button produced a genuine ~230KB captured JPEG (was a
~2.8KB blank one). Also verified end-to-end with a **fresh** synthetic
upload through the real file input (not a pre-existing piece) to
confirm the whole new-upload path, described next, together.

**Also in this pass, all in `ops-service/public/app.js` (frontend) plus
the same `videoAnalysis.js`/`server.js` (backend) change above:**

- **Auto-picked starting thumbnail.** `buildUploadRow`'s frame-capture
  logic was factored into a shared `captureCurrentFrame()` (used by both
  the button and this), and a one-time `loadeddata` listener now
  auto-captures frame zero for any piece that doesn't already have a
  thumbnail — so a row is never stuck at "No thumbnail" waiting for a
  manual click. Only fires once per row's own listener registration
  (`removeEventListener` right after), and only when `p.thumbnailDataUrl`
  is genuinely empty, so it can never clobber a thumbnail Harvey already
  deliberately picked on a page reload. Still freely overridable via the
  scrub bar + "Use this frame," same as before.
- **Content-type thresholds tightened** (`detectContentType`, §114's
  original version): Harvey's restated rule is simpler than what was
  built — landscape is *always* Longform now, full stop, no duration
  gate at all (was: landscape AND >180s). Vertical thresholds also
  changed: ultra-short ≤25s (was ≤20s), short ≤60s (was ≤75s), otherwise
  long-short, uncapped (unchanged) — verified against 8 duration/
  orientation combinations directly in Node before shipping.
- **Type + platforms shown directly in the upload row.** A read-only
  content-type chip (`.upload-row-type-row`, reusing `contentTypeOf()`
  and the same chip styling normal kanban cards use) — deliberately not
  editable here, since it's purely derived from orientation/duration,
  not a judgment call; the full editor modal still allows overriding it
  if that's ever genuinely needed. Below that, a row of small platform
  checkboxes (`Store.PLATFORMS`, one per platform) pre-checked from
  `PLATFORM_PRESET_BY_TYPE` — the exact same default the shared modal's
  content-type dropdown already applies — individually uncheckable.
  New video pieces now get `platforms` populated with that preset at
  creation time too (was always `[]` before this, meaning "Send to final
  check" could go out with zero platforms tagged unless Harvey opened
  the full editor first). Verified live: a fresh ultra-short vertical
  test upload correctly pre-checked YT Shorts/TikTok/Instagram/Facebook
  and left YT Long unchecked, matching the preset exactly; unchecking
  one and reloading confirmed the change actually persists server-side.

This is a `server.js`/`videoAnalysis.js` change (real backend logic), so
per §93 it triggers a full rebuild+restart on the next deploy — same
standing caveat as §102/§104/§111/§115, since this session is the
headless agent running inside the container being restarted. The
frontend-only parts (auto-thumbnail, content-type/platform display,
threshold tightening) are already live independently of that deploy, per
§93's fast path.

---

# 129. Captions Restructured: Per-Platform, Organized by Short-form/Longform; Final Check Shows All of Them With a Toggle (2026-09-20)

Harvey's ask, in two parts that turned out to be the same underlying
change: (1) reorganize the Captions section in Content Settings into a
"Short-form" tab (FB, IG, TT, Shorts — one field each) and a "Longform"
tab (YT, FB — one field each), each independently editable; (2) when a
horizontal (longform) video is tagged for both YouTube and Facebook, the
Final Check card should show *both* descriptions with a toggle between
them, not just one merged/single caption, and should only offer a
platform's caption as a toggle option if that platform is actually still
selected in Content Production.

**Settings (`ops-service/public/lib/store.js`, `app.js`):**
`defaultSettings().captions` changed from a flat `{ shorts, longform,
tiktok, instagram, facebook }` shape to a nested one keyed by content
shape and then platform id, matching `PLATFORM_PRESET_BY_TYPE`/
`Store.PLATFORMS` exactly:
```js
captions: {
  shortform: { ytshort: '', tiktok: '', instagram: '', facebook: '' },
  longform: { ytlong: '', facebook: '' }
}
```
Facebook deliberately gets its own field in *both* groups — a piece can
be shortform-Facebook or longform-Facebook, and those read very
differently, so they're not the same text. `getSettings()` gained a
migration (detected by `captions.shortform` not already being an
object) that maps the old flat shape onto the new one without losing any
real saved text — verified directly against the live settings row before
writing it (`longform` → `longform.ytlong`, `tiktok` → `shortform.tiktok`,
confirmed both survive the migration with a standalone test of the exact
migration logic against the real live data).

**Settings UI:** the Captions section now has a small "Short-form" /
"Longform" pill-tab pair (`.caption-group-tabs`/`.caption-group-tab`,
same visual language as the existing `.panel-subtab`), each revealing a
panel with one textarea per platform in that group. The wiring in
`bootSettings()` is driven off a new `CAPTION_GROUPS` constant (platform
ids/labels/order, reused below) rather than four/six hand-wired inputs,
so Settings and the Final Check toggle can never drift out of sync on
which platforms exist in which group.

**`app.js`: `captionsForPiece(settings, p)`** is the new core function —
given a piece, it looks at its content shape (`shortform` for
ultra_short/short/long_short, `longform` for `longform`) and returns one
entry per platform the piece is *actually tagged with* (`p.platforms`,
Content Production's own checkboxes, §128) that also belongs to that
caption group, each with its own template/rendered text. Unchecking a
platform in Content Production removes it from `p.platforms`, which is
exactly what makes its caption stop showing here too — no separate
filtering logic needed, this falls out of reusing the same field.
`captionTemplateFor(settings, p)` (used by the shared editor modal's
one-line caption readout, which has no room for a toggle) is now a
thin single-winner wrapper over `captionsForPiece` — first tagged,
non-empty entry in `CAPTION_GROUPS`' own order.

**Final Check card:** `finalCheckCardHtml()`'s single `.fc-caption` div
is replaced by `fcCaptionSectionHtml()`, which shows a plain caption (no
tabs) when the piece has only one relevant platform caption, or a small
pill-tab strip (`.fc-caption-tabs`/`.fc-caption-tab`) plus the active
one's text when there's more than one — e.g. a longform piece tagged for
both `ytlong` and `facebook` shows a "YouTube"/"Facebook" toggle. Which
tab is selected is tracked ephemerally per piece id
(`fcCaptionTab`, resets on page reload, not persisted — there was no ask
to remember it). Clicking a tab calls a new scoped `bindCaptionTabs()`
that replaces just that card's `.fc-caption-section` innerHTML and
re-binds only within it, deliberately *not* a full `render()` — a full
re-render would reset the `<video>`'s playback position/state, which
would be a jarring side effect of just switching which description is
showing.

Frontend-only (`app.js`, `lib/store.js`, `style.css`), so per §93 this
should deploy via the fast path — no Docker rebuild/restart, no
interrupted session. Verified via `node --check` on both JS files, a
CSS brace-balance check, and a standalone replay of the exact migration
logic against the real live settings data (confirmed real longform/
TikTok caption text survives the shape change). **Not yet verified
against the live deployed service** — confirm the Short-form/Longform
tabs actually save/reload each platform's field independently, and that
a real Final Check card for a piece tagged with two platforms in the
same group shows a working toggle that correctly narrows to one option
if a platform is unchecked in Content Production.

---

# 130. Content Production: Vertical-Video Boxes Auto-Orient; Shortform Platform Defaults Revised (Then Corrected Back to Include Facebook)

Two Harvey asks from a screenshot of piece #097 ("verticalvideodemo"):
the frame-picker's scrub preview (and the row's own thumbnail box) were
both hardcoded 16:9 boxes, so a vertical upload showed either heavily
letterboxed (frame-picker) or cropped down to a sliver via
`object-fit: cover` (thumbnail) — asked for both to auto-detect and
switch to a vertical box. Separately, shortform platform defaults were
first changed to drop Facebook, then corrected back within the same
session ("fb also for shorts") — see the Platform defaults paragraph
below for the final, actually-correct state.

**Orientation auto-detect (`ops-service/public/app.js`,
`style.css`):** a new `piece.videoIsVertical` boolean, set two ways —
at upload time in `handleFiles()` from the real probed
`width`/`height` (`probeVideoMeta`, already computed there for
`detectContentType`, just wasn't being kept), and, for any pre-existing
piece uploaded before this field existed, lazily backfilled the first
time its row renders: the frame-picker `<video>`'s `loadedmetadata`
handler compares `videoWidth`/`videoHeight`, and if it disagrees with
whatever's currently stored (including "never set"), saves the
corrected value and calls `refreshHead()`. Deliberately computed from
the actual decoded video, not inferred from `contentType` — a vertical
video's orientation shouldn't silently flip if Harvey later overrides
the content type by hand in the full editor.

`buildUploadRowHead()`'s `.upload-row-thumb` and `buildUploadRow()`'s
`.upload-row-video` both get an `is-vertical` class when the flag is
set. CSS: `.upload-row-thumb.is-vertical` / `.upload-row-video.is-vertical`
switch to `aspect-ratio: 9/16` with `max-width: 220px` (so a vertical
box doesn't stretch to the full grid-column width the way the 16:9
default does) — the video box also gained `object-fit: contain` on the
base rule as a defensive no-op for the landscape case, guaranteeing no
stretching either way regardless of any rounding mismatch between the
box's aspect-ratio and the actual video's.

**Platform defaults (`PLATFORM_PRESET_BY_TYPE`):** briefly changed
shortform entries (`ultra_short`/`short`/`long_short`) from `['ytshort',
'tiktok', 'instagram', 'facebook']` to `['ytshort', 'tiktok',
'instagram']`, then reverted that same change minutes later per
Harvey's immediate follow-up ("fb also for shorts") — the **final,
correct state is all four platforms pre-checked for every shortform
type**, unchanged from before this whole section started. `longform`'s
`['ytlong', 'facebook']` was never in question and is unchanged
throughout. This preset is read at two points that both needed no
further changes: `handleFiles()` applies it to `platforms` at creation
time, and the shared editor modal's content-type dropdown re-applies it
on an explicit type change during editing.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a CSS
brace-balance check; not yet visually confirmed against the live
deployed service — worth loading the real #097 piece (the one in
Harvey's screenshot) to confirm its thumbnail/frame-picker both switch
to a vertical box on next view (via the lazy-backfill path, since it
predates this change), and that a fresh vertical upload gets the
correct box immediately with no letterboxing.

---

# 131. Content Production: Shortform Titles — Just 1 Field, Not 3

Harvey: "when its a shortform video/vertical, remove the '3 title
options' and put just 1 as theres no way to test/rotate titles" — a
short gets posted once and is done, unlike a longform upload where
different titles genuinely can be tried at different times, so
offering 3 slots for a short was implying a capability (title
rotation/testing) that doesn't actually exist for that format.

**`ops-service/public/app.js`, `buildUploadRow()`'s title-picker
section:** now renders 1 plain "Title" input for a shortform piece
(`p.contentType !== 'longform'`, which — per §128's `detectContentType`
— is exactly the vertical case in practice) and the existing 3
"Title option N" inputs for longform, instead of always 3. Backed by
the same `p.ytTitles` array either way (just fewer input slots writing
into it), so no data-shape change — a shortform piece's array is simply
length ≤ 1 now going forward. `finalCheckCardHtml()`'s title-lines
display needed no change at all: it already renders however many
entries are actually in `ytTitles`, not a hardcoded 3, so a shortform
piece already just shows "Title 1: …" there once its array has one
entry.

**Deliberately scoped to the Content Production upload row only** —
the shared full-editor modal's `fieldYtTitle1/2/3` (reachable via
Content Ops, not from Final Check, which has no editor escape hatch per
§116) still always shows all 3 regardless of content type. Harvey's ask
was specifically about "the '3 title options'" surface he's been
iterating on in Content Production screenshots; the modal is a
secondary/power-user surface this request didn't touch, and per this
project's "smallest clean change" convention it wasn't extended there
without being asked. If auto-analysis (`videoAnalysis.js`) had already
populated a shortform piece's `ytTitles` with more than one entry
before this change, those extra entries are preserved but not shown or
editable in the single input — only visible again if the piece's
content type is later changed to longform, or overwritten the moment
Harvey types in the one visible field (which then saves just that one
value, dropping the hidden extras).

Frontend-only, so per §93 this is already live — no deploy/restart
needed. Verified via `node --check`; not yet visually confirmed against
the live deployed service — worth checking that a real shortform
upload row shows exactly one "Title" input (not three) and that a
longform upload's row is unaffected.

---

# 132. Content Production: "Full editor…" Button Removed

Harvey: "remove the 'full editor' button in general for all vids in the
content production panel, ill nevver use this." Everything he actually
touches for an in-production video already lives inline in the row
itself (thumbnail/frame-picker, backing audio, title(s), platform
checkboxes, send-to-final-check) — the modal it opened was a leftover
escape hatch from before that inline UI existed (§111), same category
of thing already removed from Final Check cards for the same reason in
§116.

**`ops-service/public/app.js`, `buildUploadRow()`:** the `openBtn`
button ("Full editor…", called `openPiece(p.id, renderUploadLists)`)
and both places that referenced it (`appendChild`, and the
disable/re-enable pairing inside `sendBtn`'s click handler) are gone.
`openPiece()`/the shared modal itself are untouched — Content Ops (the
planning kanban) still opens it the normal way on a card click, and the
Posted grid (already-posted videos) still opens it too, per its own
existing, separate treatment (§111) — this only removes the one entry
point into it from the in-production upload row.

Frontend-only, so per §93 this is already live — no deploy/restart
needed. Verified via `node --check` and a grep confirming no leftover
`openBtn` references; not yet visually confirmed against the live
deployed service.

---

# 133. Real YouTube OAuth Connect Flow Built; TikTok Researched Again — No Live Login Area Needed There

Harvey asked to start building the "login area" developers/reviewers
will need to pass YouTube's and TikTok's platform API review, ahead of
supplying real OAuth credentials ("in about an hour"), and to figure
out whether TikTok even needs one. Researched both platforms' actual
current requirements (WebSearch/WebFetch, not assumed) before building
anything.

**What Google's YouTube Data API OAuth verification actually
requires** (per `developers.google.com/identity/protocols/oauth2/
production-readiness/sensitive-scope-verification` and related pages):
a **real, live OAuth consent flow** — a genuine "Connect"/"Sign in"
button that redirects through Google's actual consent screen — plus a
demo video of that real flow (app name + client ID visible in the
address bar, the exact functionality each sensitive scope unlocks), a
detailed written justification per scope, and a publicly-reachable
homepage (not gated behind our own login) describing the app and
linking the privacy policy. This is a genuinely different bar than
TikTok's (§122): Google's video has to show a *real* flow, not an
illustrative mockup, so the "Connect YouTube" button had to actually
be built and wired end-to-end now, not just described.

**What TikTok actually requires, re-checked directly against
`developers.tiktok.com`'s App Review Guidelines and FAQ pages:**
neither page mentions supplying reviewers with demo accounts or a live
login area — TikTok's review is a demo-video + sandbox-mode
submission, exactly as §122 already found and built for
(`tiktok-app-review.html`). **No new TikTok work was done here** — the
existing page and app-review package from §122 already covers what
TikTok's documented process actually asks for; building a live TikTok
login area now would be speculative work against a requirement that
doesn't appear to exist, not something to do "just in case" without
Harvey re-confirming it's actually needed.

**Built for YouTube (all in `ops-service/`):**
- `src/youtubeAuth.js` (new) — plain REST calls to Google's OAuth
  endpoints via Node 22's built-in `fetch` (same pattern
  `elevenlabs.js` already uses server-side; deliberately no
  `googleapis` SDK dependency, per §6's "avoid unnecessary
  dependencies"). Requests only `youtube.upload` (publish) and
  `youtube.readonly` (look up the connected channel's own name for the
  Settings UI) — the strict minimum per Google's "least privilege"
  guidance, not the broader `youtube`/`youtube.force-ssl` scopes.
- `server.js`: a new single-row `youtube_oauth` SQLite table (tokens
  live here only — the generic `settings` record, which the browser
  can read in full via `GET /api/store/settings/settings`, never sees
  them) and four routes, all behind the existing `requireAuth` session
  gate: `GET /api/youtube/status` (connected?/channel name, no
  tokens), `GET /api/youtube/oauth/start` (redirects to Google, with a
  short-lived httpOnly `state`-nonce cookie for CSRF protection),
  `GET /api/youtube/oauth/callback` (exchanges the code, fetches
  channel identity, stores tokens, redirects back to `/#settings`),
  `POST /api/youtube/disconnect`. `/oauth/start` returns a clear 500
  message rather than crashing while `YOUTUBE_OAUTH_CLIENT_ID/SECRET/
  REDIRECT_URI` are still unset — the button can exist and be clicked
  today, it just won't do anything real until Harvey's credentials
  land in the VPS's `ops-service/.env` (documented in
  `.env.example`; **still needs manually adding to the real `.env` on
  the VPS and a container restart once Harvey supplies them** — an
  env var change needs a restart regardless of any code change).
- `public/app.js` + `style.css`: Content Settings gained a real
  "Platform connections" section with a YouTube connect/disconnect
  card (`renderYoutubeConnectCard()`, polls `/api/youtube/status`,
  shows "Not configured yet" / "Not connected" / "Connected as
  <channel>"). The old plain-text "YouTube" entry in the API-keys
  `KEY_FIELDS` list — never wired to anything — was removed in favor
  of this real mechanism rather than kept alongside it.
- `public/youtube-app-review.html` (new, public — not behind the panel
  password, per Google's homepage-must-be-public requirement) — the
  written walkthrough + scope justification + compliance commitments
  Google's review actually asks for, honestly distinguishing what's
  real today (the connect card, the production/review pipeline) from
  what publishing itself will do once credentials exist. Cross-linked
  from `privacy.html`/`terms.html`/`tiktok-app-review.html`'s footers.
- `public/privacy.html` gained a dedicated "Google user data (YouTube
  integration)" section spelling out exactly what's accessed/stored/
  shared, per Google's explicit requirement that the privacy policy
  disclose this specifically (a generic "we use OAuth" paragraph,
  which is all it said before, wasn't enough).

**Not done, waiting on Harvey:** the actual Google Cloud Console OAuth
client setup (client ID/secret, consent screen fields, scope
verification submission, demo video recording — literally recording
him clicking "Connect" and going through the real Google screen) is a
"you, not me" action, same category as every other raw-credential step
this project has hit (§74/§88). Once he supplies
`YOUTUBE_OAUTH_CLIENT_ID`/`YOUTUBE_OAUTH_CLIENT_SECRET`, they need to
land in the VPS's `ops-service/.env` and the container needs a
restart — nothing here does that automatically. The actual
`videos.insert` publish call (using the stored token) also isn't built
yet — this pass only built the connect/auth plumbing, matching this
project's established "connect first, wire up real posting once
there's something to post through" sequencing (§62, §122).

This is a `server.js`/new-`src`-file change, so per §93 it triggers a
full rebuild+restart on the next deploy — same standing caveat as
every prior backend change in this file, since this session is the
headless agent running inside the container being restarted. Logged to
the work log immediately before pushing.

Verified via `node --check` on all three touched/new JS files, a CSS
brace-balance check, and a div-tag-balance check on all four touched/
new HTML files. **Not yet verified end-to-end** — there's nothing to
test against without real Google credentials yet; once Harvey supplies
them, confirm `/api/youtube/oauth/start` actually reaches Google's
consent screen, the callback correctly stores tokens and shows
"Connected as &lt;channel&gt;" in Settings, and Disconnect actually
clears the stored tokens.

---

# 134. Content Production: "Use This Frame" Was Silently Dead on a Still-Loading Row

Harvey: "the 2nd row isn't interactable when theres multiple rows...
nothing happens... i need to be able to make changes to any video i
upload here." Confirmed and root-caused with a real headless-browser
test rig against the live service (same technique as §123/§127/§128)
rather than guessing from code review — reproducing it required real
network throttling, since the container's own link to the VPS is fast
enough that a small test video loads near-instantly and never actually
exercises the failure window.

**Root cause:** each upload row's video element fetches its own blob
independently (`Store.get('videos', p.id)`, §128's already-documented
comment on `captureCurrentFrame()`: "videoWidth/videoHeight being 0
here should only mean 'hasn't loaded far enough yet.'"). Real uploaded
videos run 10MB+; on an ordinary (non-container-fast) connection, a
second or third row's blob can still be mid-fetch for a genuinely long
time after the row itself is visible and its button looks clickable.
Clicking "Use this frame" during that window hit
`captureCurrentFrame()`'s early-return guard and did nothing at all —
no error, no state change, the exact "dead button" Harvey described.
Verified directly: under a throttled connection, `videoWidth`/
`videoHeight` stayed `0` for **27 real seconds** after the row appeared
before the video actually finished loading.

**Fix, `ops-service/public/app.js`'s `buildUploadRow()`:** the button
now starts `disabled`, reading "Loading video…", and the scrub range is
disabled too — both flip to enabled/"Use this frame" the moment the
video's `loadeddata` event fires (`readyState >= HAVE_CURRENT_DATA`),
the same signal the existing auto-pick-first-frame listener already
waited on. A disabled button can't be clicked at all (browser-enforced,
not just a JS check), so the failure mode changes from "looks
clickable, silently does nothing" to "honestly shows it isn't ready
yet" — the actual capability was never missing, just unannounced.

**Verified end-to-end against the live deployed service**, not just
reasoned about: reproduced the original bug under throttled bandwidth
(button correctly showed disabled + "Loading video…"; a scripted click
attempt on the disabled button correctly timed out, proving the browser
itself now blocks it); confirmed the button becomes enabled once
`loadeddata` fires; confirmed a real scrub-then-click afterward
produces a genuinely new, different captured frame and a real
`PUT /api/store/pieces/:id` save (checked both via the DOM and a fresh
server-side re-fetch of the piece). All synthetic test pieces created
for this were cleaned up via the app's own delete endpoints afterward,
leaving Harvey's real data untouched.

Frontend-only (`app.js`, no new CSS needed — reused the existing
`.btn-secondary:disabled` rule), so per §93 this is already live — no
deploy/restart needed.

---

# 135. Final Check Card: Vertical Video Size Cap, Caption-Tab Styling, Title Label, Video Chip

Four related Final Check polish items from the same round of feedback
on a real vertical piece.

**Vertical video was enormous.** `.fc-video` had no size cap beyond
`width: 100%` of the ~800px desktop column — fine for the landscape
case it was designed around, but a 9:16 vertical piece rendered at
roughly 800×1420px, blowing the card out (Harvey: "the size is way too
big in the final check for vertical ones," with a screenshot showing
exactly that). Fixed by giving `.fc-video-wrap` an `is-vertical`
variant (`max-width: 360px; margin: 0 auto`), toggled from
`piece.videoIsVertical` (the same flag §130 already computes/persists
for Content Production's own vertical-box handling) — bigger than
Content Production's 220px cap since this is the actual review
surface, not an inline picker, but still bounded rather than filling
the column.

**Caption tabs looked like only one platform was selected.** The
`.fc-caption-tab` pill strip (§129) used a muted/faint default style
for every tab except the currently-active one, which read as "3 of the
4 platforms aren't selected" even though all 4 genuinely apply to the
piece (Harvey: "the video should have all four platform pills selected
by default, currently only YT shorts is" — he was looking at this tab
strip, not the separate platform-checkbox chips lower on the card,
which were already correctly showing all 4). Fixed by giving every tab
a real accent border/text color by default (`border: 1px solid
var(--accent-3); color: var(--ink-soft)`); only the active tab keeps
the solid fill. The distinction now reads as "which one you're
currently viewing," not "which ones are turned on."

**"Title 1:" implied a second option that doesn't exist for a
short.** Since §131, a shortform piece only ever collects one title
(no rotation/testing for something posted once), so
`finalCheckCardHtml()`'s hardcoded "Title 1:" numbering was misleading
there — fixed to just "Title:" when `ytTitles.length === 1`, still
numbered ("Title 1:"/"Title 2:"/"Title 3:") for a longform piece with
genuinely multiple options.

**Redundant "▶ video" chip.** `chipHtml()` — shared between the normal
kanban card and Final Check — always appended a "video" chip whenever
`piece.hasVideo`, which is meaningful on a planning-stage kanban card
(distinguishes an uploaded video from a plain idea) but pure noise on
Final Check, where every single card is necessarily a video (Harvey:
"theyre lit4erally all videos"). `chipHtml(piece, opts)` gained a
`hideVideoChip` option, passed `true` only from
`finalCheckCardHtml()`'s call site — the normal kanban card's own call
is unchanged, so it still shows the chip there.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live
— no deploy/restart needed. Verified via `node --check` and a CSS
brace-balance check; not yet visually re-confirmed against the live
deployed service for these four specifically — worth a look at a real
vertical Final Check card to confirm the video no longer overflows and
the caption tabs read correctly.

---

# 136. Real YouTube Video Publish, End to End; Demo-Video Placeholder on the Review Page (2026-09-20)

§133 built the OAuth connect plumbing but deliberately stopped there — no
actual `videos.insert` call existed yet. Harvey confirmed the Connect flow
works live and wants to submit for Google's verification review, but
verification requires a demo video showing each requested scope's real
functionality — including `youtube.upload` actually publishing something —
so the missing piece had to be built before there was anything honest to
film. Harvey's own plan: upload a real longform video, uncheck every
platform but YouTube (so no other platform's posting needs to exist yet),
publish it for real, and test it himself before filming.

**`ops-service/src/youtubeAuth.js`: `uploadVideo(accessToken, filePath,
mimeType, metadata)`** — real publish via YouTube's resumable-upload
protocol, plain REST (no `googleapis` SDK, same "avoid unnecessary
dependencies" philosophy as the rest of this file). Two requests: POST the
metadata (`snippet.title`/`description`, `status.privacyStatus`) to
`.../upload/youtube/v3/videos?uploadType=resumable` and read the one-time
`Location` header back, then PUT the actual video bytes to that URL,
streamed straight off disk via `fs.createReadStream` (not buffered into
memory — longform files are real size) using Node 22's built-in fetch with
`duplex: 'half'`, which is required for a streaming request body.

**`ops-service/server.js`:**
- `getValidYoutubeAccessToken()` — reads the stored `youtube_oauth` row,
  refreshes proactively via the existing `youtubeAuth.refreshAccessToken`
  whenever the access token is within a minute of expiring, and persists
  the new token/expiry (keeping the existing `refresh_token`, since Google
  doesn't normally rotate it on a plain refresh).
- `runYoutubePublish(id, opts)` / `POST /api/youtube/publish/:id` — same
  "validate, respond 202 immediately, do the real work in the background,
  let the client poll the piece record" pattern already established by
  `/analyze` (§111) and `/build-final` (§115). Always uploads the built
  `<id>-final` file (audio already spliced in, per §115's rule that a
  piece can't reach Final Check without it) if present, falling back to
  the raw upload only if it somehow isn't. On success: `piece.stage =
  'live'` (the long-reserved "Posted/Live" stage, §62, now has a real
  posting confirmation behind it for YouTube), plus
  `youtubePublishStatus: 'done'`, `youtubeVideoId`, `youtubeUrl`,
  `postedAt`. On failure: `youtubePublishStatus: 'error'` +
  `youtubePublishError`, stage left untouched so Harvey can just retry —
  matching the exact same failure convention `finalBuildStatus`/
  `finalBuildError` already established.

**`ops-service/public/app.js` — Final Check card:** a piece only shows a
"Publish to YouTube" control at all if it's actually tagged for the
`ytlong` platform (`fcYoutubePublishHtml()`) — exactly Harvey's own test
setup (uncheck every other platform), not a guess about which platform he
meant. A privacy `<select>` (Private/Unlisted/Public, defaulting to
Private — the safest choice for the very first real test against his
actual channel) sits next to the button. Clicking it computes the real
title (`ytTitles[0]` or the piece title) and description (the real
`ytlong` entry from `captionsForPiece`, §129 — link-substituted, exactly
what would actually ship) client-side, disables the button in place
(`btn.textContent = 'Publishing…'`) without a full `render()` (same
"don't reset the video's playback position" reasoning as the caption-tab
toggle, §129), then POSTs to the new endpoint. `maybeStartYoutubePublishPoll()`
(mirrors `maybeStartAnalysisPolling`, §111/115, kept as its own separate
poller since it watches a different field on a different view) polls
every 3s for any piece still `pending`/`running` and triggers a full
`render()` once one resolves — appropriate here, unlike the caption
toggle, since "done" moves the card out of the Final Check column
entirely. `youtubeStatusCache`, fetched once in `bootContentOps()`
alongside the existing `boardSettingsCache` fetch, disables the button
with an explanatory tooltip if YouTube isn't actually connected.

**`ops-service/public/youtube-app-review.html`:** added a clearly-marked
`<div class="rv-video-slot">` placeholder ("Verification demo video —
coming soon") near the top of the page, with an HTML comment describing
exactly what to swap it for once Harvey records the real thing (a plain
`<iframe>` YouTube embed) and what the video needs to show, in order:
login → Settings → real Google consent screen → producing/approving a
video through Final Check → the real Publish action landing on the
actual channel. This was built specifically so the page has an honest,
obviously-a-placeholder slot to point at right now, rather than either an
empty gap or a claim that a video already exists.

**Deliberately out of scope for this pass, per Harvey's own instruction**
("just YouTube... you don't need to wire up any other services"): no
change to TikTok/Instagram/Facebook, which remain exactly as unbuilt as
§62/§122 already documented. Also not built: any automatic/scheduled
posting — this is a manual, on-demand "publish now" action triggered from
Final Check, not a cron job firing at a piece's `scheduledAt` time; the
existing Approve→Scheduled flow (§111) is untouched and still available
as a separate action for pieces not going out immediately.

This is a `server.js`/`youtubeAuth.js` change (real backend logic), so
per §93 it triggers a full rebuild+restart on the next deploy — same
standing caveat as every prior backend change in this file, since this
session is the headless agent running inside the container being
restarted. Logged to the work log immediately before pushing.

Verified via `node --check` on all touched JS files and a CSS/HTML
balance check on the touched CSS and the review-page HTML. **Not yet
verified against the live deployed service** — there's nothing to test
against until this deploys and Harvey actually uploads his real test
video; once it's live, confirm: the Publish button appears only when
`ytlong` is the piece's tagged platform, the upload actually completes
and produces a real, playable YouTube video at the chosen privacy level,
the piece correctly moves to "Posted / Live" on success, and a deliberate
failure (e.g. disconnecting YouTube mid-test) surfaces
`youtubePublishError` on the card rather than failing silently.

---

# 137. Final Check Button Genericized to "Schedule Video"; TikTok Publish Still Blocked on Missing Credentials (2026-09-20)

Harvey's correction to §136, right after reading it: the Final Check
button shouldn't be framed as platform-specific ("Publish to YouTube")
at all — conceptually it's one action that publishes to *every* platform
a piece is tagged for, and today just happens to only have YouTube
actually wired underneath. He also asked, separately, whether TikTok
needs the same real wiring or whether a mockup demo is enough for its
own app review, so he can shoot two separate test videos (one per
platform) today if it's worth doing now.

**`ops-service/public/app.js`:** `fcYoutubePublishHtml()` renamed to
`fcScheduleVideoHtml()` and reworked around a new `WIRED_PUBLISH_PLATFORMS
= ['ytlong']` constant — the single source of truth for which tagged
platforms can actually be acted on right now, extend this array (and the
click handler) as more platforms get real integrations. The section is
no longer gated on `ytlong` specifically — it renders for any Final
Check card, buttons "Schedule Video" (or "Retry" after a failure), and
splits the piece's tagged platforms into `wired` vs `unwired`:
- Zero wired platforms tagged → button shown disabled, with a note
  listing which selected platforms aren't wired yet ("tiktok, instagram
  not wired up yet — won't be published there") rather than hiding the
  button entirely, so it's visible that scheduling exists but can't do
  anything real yet for this piece's current platform selection.
- At least one wired platform (i.e. `ytlong`) tagged → button enabled,
  same real immediate-publish click handler as §136 (unchanged — it was
  already YouTube-only under the hood, this only changed what surrounds
  it), plus the same "not wired yet" note for any other tagged platforms
  so nothing is silently skipped without saying so.

No scheduled-time delay was added or is planned for this action — per
Harvey's own "for this test we can publish immediately," clicking it has
always published right away (§136), which already matches what he
wants; the only thing that needed fixing was the label/framing implying
it was YouTube-specific.

**TikTok: genuinely still blocked, not a judgment call.** Checked the
actual repo state before answering rather than guessing: there is no
TikTok client key/secret anywhere in this codebase, not even a
placeholder in `.env.example`, and zero backend code (`src/tiktokAuth.js`
doesn't exist, no `tiktok_oauth` table, no routes) — §62's original
"the field is there for when it is" TikTok Settings entry is still just
an inert text field. This is the same category of blocker as YouTube's
own credentials were before Harvey supplied them (§133/§136): building
real TikTok posting needs an actual TikTok developer app registered
first (client key/secret, Login Kit scopes), which only Harvey can do —
there's nothing to wire up server-side until that exists.

Separately, on the actual question asked (real integration vs. a
demo-only mockup for TikTok's own review): re-read §122's own research
notes on this — TikTok's App Review Guidelines ask for a demo video
"showing the complete end-to-end integration, all requested scopes
actually demonstrated," which reads closer to Google's "must be a real,
live flow" bar than to something a static mockup can honestly satisfy,
though TikTok's wording is looser than Google's explicit
address-bar-visible requirement. Also relevant: TikTok's own "unaudited
app" restriction (posts forced to `SELF_ONLY` visibility, capped at 5
posting users/24h) exists specifically so a developer *can* test real
posting against their own account before formal approval — the same
shape as YouTube's Testing-mode test-user allowance — so once
credentials exist, real (if self-only) TikTok posting is achievable for
a demo video the same way YouTube's Private-visibility test was. Net
recommendation: build it for real once credentials exist, for the same
honesty reasons §122 already flagged about this page ("honesty here
matters for a compliance review") — but this is Harvey's call to make
once he's registered the app, not something blocked on more research.

**Not built this pass:** any TikTok backend code — there's nothing to
build against yet. If Harvey registers a TikTok developer app and
supplies a client key/secret, the next step would mirror §133/§136's
YouTube pattern (`src/tiktokAuth.js`, a `tiktok_oauth` table, connect/
disconnect routes, then a real `video.publish` call reachable from this
same `fcScheduleVideoHtml()` section) rather than a new mechanism.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live —
no deploy/restart needed. Verified via `node --check` and a CSS
brace-balance check; not yet visually re-confirmed against the live
deployed service — worth a look to confirm the button reads "Schedule
Video," the not-wired note appears correctly when e.g. only TikTok is
checked, and the real YouTube publish still fires correctly when
`ytlong` is checked (should be unchanged from §136's already-built
click handler).

---

# 138. Fixed: Copy Buttons on Fenced Code Blocks Copied the Wrong Block

Harvey reported the "Copy" button on code blocks in the Project Manager
chat "don't work" — and the message he was looking at (this session's own
previous reply, which happened to contain two separate fenced code
blocks) is exactly the reproduction case.

**Root cause, `renderMarkdownLite()` in
`ops-service/public/lib/voiceClient.js`:** the loop that builds each
fenced code block declared its `pre`/`codeEl`/`copyBtn` elements with
`var`, which is function-scoped, not per-iteration. A message with more
than one code block runs this loop more than once, and every click
handler created inside it — `copyBtn.addEventListener('click', function
() { ... codeEl ... copyBtn ... })` — closed over those same shared `var`
bindings rather than the specific element from its own iteration. By the
time any button was clicked, `codeEl`/`copyBtn` held whatever the *last*
loop iteration had set them to. Practical effect: clicking an earlier
block's Copy button silently copied the *last* block's text to the
clipboard instead of its own, and flipped the *last* button's label to
"Copied" instead of the one actually clicked — which, on the button
Harvey actually clicked, looked exactly like nothing happened at all. A
message with only one code block was never affected (nothing to
misattribute to), which is presumably why this hadn't been reported
before now — most replies with code only include one.

**Fix:** the three `var` declarations inside the loop changed to `let`,
which is block-scoped per iteration — each button's closure now
correctly captures its own element bindings, not whichever iteration
happened to run last. Every browser this app targets (Chrome/Safari,
desktop and mobile) supports `let` natively; no build step or
transpilation involved.

Frontend-only (`voiceClient.js`), so per §93 this is already live — no
deploy/restart needed. Verified via `node --check`; the multi-code-block
repro case (this exact conversation's earlier reply) is the way to
confirm it in practice — each button should now independently copy and
label only its own block.

---

# 139. Real TikTok Video Publish Built, Mirroring YouTube (§136); Final Check Button Now Covers Both Platforms (2026-09-20)

Harvey registered a TikTok developer app, created a Sandbox (per §137's
recommendation — unaudited/sandboxed posting is genuinely testable
end-to-end before formal review, just forced to `SELF_ONLY` visibility),
added Login Kit + Content Posting API with the `user.info.basic` and
`video.publish` scopes, verified domain ownership of
`ops.realitymanual.com` (via the URL-prefix signature file this session
hosted directly — see the immediately-preceding exchange), and supplied
the sandbox's Client Key/Secret. Asked for the real integration to be
built the same way YouTube's was, so he can test two separate pieces
(one YouTube-only, one TikTok-only) today.

**Researched TikTok's actual current API shape before writing anything**
(same discipline as §64's BookVault research) — endpoints, exact
request/response fields, and chunking rules were fetched directly from
`developers.tiktok.com`'s live docs, not assumed from general TikTok API
familiarity, which has genuinely moved between API versions over time:

- Auth: `https://www.tiktok.com/v2/auth/authorize/` (no PKCE for the web
  flow — `code_verifier` is mobile/desktop-only), token exchange/refresh
  both at `https://open.tiktokapis.com/v2/oauth/token/`,
  form-urlencoded, both returning `access_token`/`refresh_token`/
  `expires_in`/`refresh_expires_in` — TikTok may rotate the refresh token
  on a plain refresh (Google normally doesn't), so the new value must
  always be persisted, not assumed unchanged.
- User info: `GET /v2/user/info/?fields=open_id,display_name`.
- **Direct Post, FILE_UPLOAD source** — three calls: `POST
  /v2/post/publish/creator_info/query/` first (required before showing/
  using posting options per TikTok's Content Sharing Guidelines — also
  the only way to know which `privacy_level` values this specific
  account is actually allowed, since an unaudited/sandboxed app is
  forced to `SELF_ONLY` regardless of what's requested); then `POST
  /v2/post/publish/video/init/` with `post_info.title` +
  `source_info.{video_size,chunk_size,total_chunk_count}`, returning a
  `publish_id` and a one-hour-valid `upload_url`; then one or more `PUT`
  requests to that URL with `Content-Range: bytes {start}-{end}/{total}`
  per chunk (5MB-64MB each, final chunk absorbs the remainder up to
  128MB, 1-1000 chunks total — videos under 64MB go out as a single
  chunk); then `POST /v2/post/publish/status/fetch/` polled until
  `PUBLISH_COMPLETE`/`FAILED`, since TikTok processes the upload
  asynchronously after the last byte lands.

**`ops-service/src/tiktokAuth.js`** (new) — mirrors `youtubeAuth.js`'s
shape and "no SDK dependency" philosophy: `buildAuthUrl`, `exchangeCode`,
`refreshAccessToken`, `fetchUserInfo`, `queryCreatorInfo`, and a single
`publishVideo(accessToken, filePath, mimeType, {title})` that
orchestrates creator-info → init → chunked upload → status-poll end to
end, matching `youtubeAuth.uploadVideo`'s one-call shape for `server.js`
to consume the same way. `computeChunkPlan()`/`uploadVideoChunks()`
implement the chunking rules above directly against the file on disk
(`fs.promises.open` + `.read()` per chunk — never buffers the whole file
into memory, same reasoning as YouTube's streamed upload).

**`ops-service/server.js`:** a `tiktok_oauth` table (same single-row
shape as `youtube_oauth`) and a parallel route set —
`GET /api/tiktok/status`, `GET/GET /api/tiktok/oauth/{start,callback}`,
`POST /api/tiktok/disconnect`, `getValidTiktokAccessToken()` (proactive
refresh, persists whatever `refresh_token` comes back rather than
assuming it's unchanged) — plus `runTiktokPublish(id, opts)` /
`POST /api/tiktok/publish/:id`, the exact same "respond 202 immediately,
do the real work in the background, let the client poll the piece
record" pattern as `runYoutubePublish`. Uploads the built `<id>-final`
file if present, same fallback-to-raw-upload behavior. On success:
`piece.stage = 'live'`, `tiktokPublishStatus: 'done'`,
`tiktokPublishId`, `tiktokPrivacyLevel`, `postedAt`. On failure:
`tiktokPublishStatus: 'error'` + `tiktokPublishError`, stage left
untouched — identical convention to the YouTube/final-build failure
paths already established.

**Known, accepted limitation, stated honestly rather than solved:** if a
single piece were ever tagged for *both* `ytlong` and `tiktok`
simultaneously, `runYoutubePublish` and `runTiktokPublish` would both
read-modify-write the same piece record concurrently with no locking
between them — a real (if narrow) race where one job's write could
clobber the other's. Not fixed this pass because Harvey's actual stated
test plan is one platform per piece (two separate test videos), which
never exercises this path — worth a per-piece lock if simultaneous
multi-platform publishing from one piece is ever actually used.

**`ops-service/public/app.js` — generalized for two platforms:**
- `WIRED_PUBLISH_PLATFORMS` (§137) now `['ytlong', 'tiktok']`, with new
  `publishStatusFieldFor`/`publishErrorFieldFor`/`publishEndpointFor`/
  `publishPlatformConnected` helpers replacing the YouTube-only field
  references `fcScheduleVideoHtml()` and its click handler used before.
  The button aggregates state across whichever wired platforms a piece
  is tagged for — "Publishing…" while any is pending/running, one error
  line per platform that failed, a "not wired up yet" note for any
  tagged-but-unwired platform, same behavior as §137 just no longer
  hardcoded to one platform.
- The privacy `<select>` only renders when `ytlong` is among the wired
  platforms — TikTok has no real choice to offer while sandboxed
  (`SELF_ONLY` is forced either way), so no TikTok-specific control was
  added for it.
- The click handler fires one independent publish request per
  wired-and-tagged platform. TikTok's request body sends the piece's
  real `tiktok` caption entry (from `captionsForPiece`, §129) as
  `title` — Content Posting API has one text field that serves as the
  on-post caption, not separate title/description fields like YouTube,
  so the caption text is what actually belongs there, falling back to
  the piece's plain title if no TikTok caption template is set.
- `maybeStartYoutubePublishPoll()` (name kept per §90/§99's "don't chase
  internal names" convention) now watches both platforms' status fields.
- Content Settings gained a `tiktokConnectCard`/`renderTiktokConnectCard()`
  mirroring the YouTube one exactly (Connect/Disconnect, "Connected as
  @handle"), and the old plain-text "TikTok (pending access)" API-key
  field was removed from `KEY_FIELDS` now that a real mechanism exists —
  same treatment YouTube's own placeholder field already got in §133.

**Credentials:** `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`/
`TIKTOK_REDIRECT_URI` added directly to `ops-service/.env` on the VPS
(gitignored, never committed) via SSH — same mechanism already used for
YouTube's credentials (§136). Placeholder entries added to
`.env.example` for documentation. `TIKTOK_REDIRECT_URI` is
`https://ops.realitymanual.com/api/tiktok/oauth/callback`, matching what
Harvey registered in the TikTok developer portal.

This is a `server.js`/new-`src`-file change (real backend logic), so per
§93 it triggers a full rebuild+restart on the next deploy — same
standing caveat as every prior backend change in this file, since this
session is the headless agent running inside the container being
restarted. Logged to the work log immediately before pushing.

Verified via `node --check` on all touched/new JS files. **Not yet
verified end-to-end** — there's nothing to test against until this
deploys; once it's live, confirm: the TikTok Connect button in Content
Settings reaches TikTok's real consent screen and shows "Connected as
@handle" afterward, a real TikTok-only test piece's "Schedule Video"
button actually uploads and the piece moves to Posted/Live, and a
deliberate failure surfaces `tiktokPublishError` on the card rather than
failing silently. Once both platforms are confirmed working for real,
Harvey can record the TikTok demo video against this genuine sandbox
integration.

---

# 140. Real Bug: Final Check Had Two Confusingly Similar Buttons — Neither Actually Published

Harvey's first real test of §139's "Schedule Video" button failed
silently in a specific, diagnosable way: the piece (#097,
"verticalvideodemo") landed in the **Scheduled** kanban column instead
of Posted/Live, nothing reached his TikTok account, the card showed all
4 platforms despite him believing he'd narrowed it to TikTok only, and
the normal kanban card showed no thumbnail at all.

**Root cause, confirmed by pulling the piece's real stored record**
(not guessed): `finalCheckCardHtml()` still rendered **two** buttons
side by side — the old `fc-approve-btn` ("Approve → Scheduled", §111's
pre-real-publish cadence-only approval) *and* the new `fcScheduleVideoHtml()`
("Schedule Video", §137-139). Harvey clicked what he read as "the"
schedule action; it happened to be the old one, which silently just
sets `stage = 'scheduled'` via the internal cadence scheduler and
touches no publish API at all — no error, no feedback, nothing to
suggest the click did anything other than what he expected. That's
exactly the piece's confirmed state: `stage: "scheduled"`,
`scheduledAt` set, no `tiktokPublishStatus` field at all.

Two buttons that both plausibly read as "make this go out" was the
actual bug — not a wording problem to fix with a relabel. **Fix:** the
old `fc-approve-btn`/"Approve → Scheduled" button and its click handler
are removed entirely from the Final Check card. `fcScheduleVideoHtml()`'s
"Schedule Video" is now the only action there, exactly matching
Harvey's original §137 ask. `approveAndSchedule()` itself and its other
two call sites (`setPieceStage`'s manual-drag safety net, the shared
editor modal's own Approve button — unreachable for a Final Check piece
in practice since §116 already removed all navigation into the modal
from that card) were left alone; removing only what's actually
reachable and actually caused this bug.

**The 4-platforms display was not a bug** — pulled straight from the
piece's real stored `platforms` array, which genuinely still held all
4. Piece #097 predates Content Production's per-platform checkboxes
(§128) reaching this specific piece's own edit window, and once a piece
advances past the `processed` stage there is currently no UI anywhere
to edit its platform tags — Final Check only ever displays them
read-only (§116). Harvey's belief that he'd unchecked the other three
for this piece doesn't match what's stored; most likely he unchecked
them on a different, still-in-Production piece. Not fixed as a "bug"
since there wasn't one in the code — flagging the real gap instead:
there is currently no way to change a piece's tagged platforms once it
reaches Final Check, which could be worth adding if this keeps causing
confusion.

**Thumbnail:** confirmed `piece.thumbnailDataUrl` genuinely exists on
this piece (a real base64 JPEG) — `cardHtml()` (the normal, non-Final-
Check kanban card) simply never rendered it, unlike `videoCardHtml()`
(Posted grid) and the shared modal, which both already do. Added a
`.card-thumb` (16:9, cropped, matching the visual weight of
`.video-card-thumb`) shown at the top of any card that has one; a plain
idea with no video/thumbnail renders exactly as before.

**Piece #097 itself, fixed directly against the live data** (not just
in code) so Harvey has something real to re-test: moved back to
`stage: 'final_check'` (its `finalBuildStatus: 'done'` final-spliced
video was still intact and never touched, so the card will render
correctly), `scheduledAt` cleared, and `platforms` set to `['tiktok']`
only, matching what Harvey actually said he wanted for this test.

Frontend-only (`app.js`, `style.css`), so per §93 this is already live
— no deploy/restart needed. The piece #097 data fix was applied
directly via the live API (login → GET → PUT), separately from the code
push. Verified via `node --check` and a CSS brace-balance check; not
yet re-confirmed against the live deployed service that clicking the
now-sole "Schedule Video" button on #097 actually reaches TikTok for
real — that's the next thing to check once Harvey retries it.

---

# 141. Fixed: Unchecking Multiple Platform Boxes in Content Production Could Silently Resurrect One

Harvey's report immediately after §140: unchecking platform checkboxes
in Content Production was "a bit buggy" — some came back on. Real race
condition, not a UI glitch — traced end to end rather than guessed.

**Root cause:** each platform checkbox's `change` handler
(`buildUploadRowHead()` in `ops-service/public/app.js`) mutated
`p.platforms` in memory and immediately fired its own `Store.put('pieces',
p)`. `lib/store.js`'s `put()` calls `JSON.stringify(body)` synchronously
at the moment each request is *sent* — a correct snapshot at that
instant — but `PUT /api/store/:storeName/:id` on the server does a full-
record overwrite with no merge logic, so whichever request's response
happens to *arrive* last simply wins outright, regardless of which one
was sent last or which one carries the more complete change. Unchecking
two boxes within the same few hundred milliseconds fires two concurrent
PUTs; ordinary network timing variance can easily let the earlier
request (missing only the first uncheck) land on the server *after* the
later one (missing both) — silently persisting the earlier, incomplete
state and making the second uncheck look like it "came back on," even
though the in-memory `p.platforms` and the checkboxes' own visual state
were correct the whole time. This is a classic fire-a-request-per-
keystroke/click race, not anything specific to checkboxes or platforms.

**Fix:** debounce the actual save, same pattern already used for
Settings (`saveSettingsDebounced`/`settingsSaveTimer`) — a new
module-level `platformSaveTimers` map (keyed by piece id, alongside the
existing `uploadRowObjectUrls`). The checkbox handler still mutates
`p.platforms` and updates that one checkbox's own `.checked` visual
class immediately/synchronously (instant feedback, no behavior change
there), but the `Store.put()` call itself is deferred 400ms and reset on
every subsequent toggle for the same piece — so a rapid burst of clicks
results in exactly one PUT, built from whatever `p.platforms` looks like
once the user actually stops clicking, with nothing left to race against.
Also dropped the old `.then(refreshUploadRowHeadById)` full-head-rebuild
after each save — unnecessary now (nothing else on the row's head
visually depends on which platforms are checked besides the checkboxes
themselves, which are already updated directly) and it was itself a
minor source of DOM churn during rapid interaction.

Frontend-only (`app.js`), so per §93 this is already live — no deploy/
restart needed. Verified via `node --check`; not yet re-tested against
the live deployed service with a real rapid multi-uncheck — worth
confirming a fast burst of unchecks now reliably persists all of them
after a page reload, which is the only way this race actually surfaced
before (the in-memory/visual state was never wrong, only what
eventually landed on the server).

---

# 142. §141 Wasn't the Whole Bug: the Analysis Poller Was Also Clobbering Platform Edits

Harvey tested again right after §141 and hit essentially the same
symptom from a different angle: unchecked everything but TikTok on a
fresh upload, and by the time it reached Final Check all 4 platforms
were back, with the caption tab strip also wrongly showing all 4
platforms' captions instead of just TikTok's.

**That second complaint (captions) isn't a separate bug** — the Final
Check caption tabs are entirely derived from `piece.platforms`
(`captionsForPiece()`, §129); once platforms is wrong, the caption
section is automatically wrong too. Fixing the real cause fixes both
symptoms from one change.

**Real root cause, found by reading `maybeStartAnalysisPolling()`
directly:** every 3s while a piece's `analysisStatus` or
`finalBuildStatus` is `pending`/`running`, this poller does
`Store.get('pieces', id)` and then **`pieces[r.id] = r`** — a full,
unconditional replace of the entire in-memory piece object with
whatever the server happened to return. Analysis (ffmpeg extraction +
ElevenLabs transcription + a Claude Code matching call) and the final-
video build routinely take several real seconds — plenty of time for
Harvey to be actively unchecking platform boxes on that exact row while
it's still processing. If a poll tick's `GET` reflects a server
snapshot from *before* that edit's own (now-debounced, per §141) save
has landed, the wholesale replace overwrites Harvey's in-progress local
edit with the stale server value the instant `refreshUploadRowHeadById`
re-renders that row's head — silently reverting it, regardless of
whether §141's debounce had even fired yet. §141 fixed the write side
of this row's platform-save race; this was a second, independent bug on
the *read* side, in a completely different piece of code, that could
undo the same field by an entirely different mechanism.

The irony: `server.js`'s own background jobs (`runVideoAnalysis`,
`runBuildFinalVideo`) already do this correctly — both explicitly
re-fetch the piece and overwrite *only* the fields they own before
saving (§111/§115's own documented reasoning: "a concurrent edit Harvey
made while analysis was running isn't clobbered"). The client-side
poller consuming those same jobs' results never applied that same
discipline — it just replaced everything.

**Fix, `ops-service/public/app.js`'s `maybeStartAnalysisPolling()`:**
instead of `pieces[r.id] = r`, merge — start from the current local
object and copy over only the fields these two background jobs actually
own (`analysisStatus`, `analysisError`, `analysisMatchedPieceId`,
`transcript`, `ytTitles`, `title`, `finalBuildStatus`,
`finalBuildError`, `stage`, `updatedAt`). Everything else — `platforms`,
`thumbnailDataUrl`, `audioTrackId`, `videoIsVertical`, `contentType`,
`notesHtml` — now always stays whatever's currently in the browser's
own memory, since none of these background jobs ever touch those
fields server-side either. This closes the exact bug reported and, by
construction, the same latent bug for the other two fields editable
inline on this same row (audio track, thumbnail) that hadn't been
reported yet but were equally exposed.

Verified the actual "Test video" piece from Harvey's screenshot no
longer exists in the live data (`GET /api/store/pieces` — 94 pieces
total, only #097 has `hasVideo: true`) — he most likely deleted it
after screenshotting, via the right-click delete from §127, so there
was nothing left to hand-fix directly this time; he'll need to re-test
with a fresh upload once this deploys.

Frontend-only (`app.js`), so per §93 this is already live — no deploy/
restart needed. Verified via `node --check`; not yet re-tested against
the live deployed service with a real fresh upload — worth confirming
that unchecking platforms *during* active analysis/build processing
(the actual failure window) now survives through to Final Check
correctly, captions included.

---

# 143. First Real TikTok Publish Attempt: Genuine Platform Rule, Not a Bug — Account Must Be Set to Private

Harvey's first real "Schedule Video" click against TikTok reached the
live API correctly (confirms §139/§142's fixes are all working
end-to-end — auth, chunked upload, everything up to TikTok's own
business-logic check) and got back a real, documented TikTok error:

```text
{"error":{"code":"unaudited_client_can_only_post_to_private_accounts",
"message":"Please review our integration guidelines at
https://developers.tiktok.com/doc/content-sharing-guidelines/", ...}}
```

**Researched rather than guessed:** this is a second, separate
unaudited-client restriction beyond the post-level `SELF_ONLY`
`privacy_level` §139 already handles correctly. TikTok additionally
requires the **target account's own account-level visibility** to be
set to Private in the TikTok app itself (Settings and privacy → Privacy
→ Private account) — a completely different setting from the
per-content privacy level our `queryCreatorInfo`/`initPublish` calls
already request correctly. Both conditions are required together for an
unaudited client to post at all; our code was never wrong here, there's
just nothing it can do about the account's own visibility setting.

**Fix (Harvey, not code):** switch the connected TikTok account
(whichever real account he added as a Sandbox target user) to Private
in the TikTok app, then retry Schedule Video. Worth noting for later:
per the same TikTok documentation, making a previously-private-account
post publicly visible afterward isn't automatic just from switching the
account back to public — each individual piece of content's own privacy
also has to be changed to "Everyone" separately at that point.

No code change this round — nothing to fix on our end. Documented here
since it's a genuine, verified TikTok platform requirement worth
knowing before the next real test, not something to re-investigate if
the same error shows up again.

Sources:
- [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)

---

# 144. Fixed: Kanban Board Went Stale If Harvey Left Content Production Before a Background Job Finished

Harvey's report: click "Send to final check" in Content Production, then
quickly switch to the Kanban board — the card doesn't actually appear in
Final Check until a full page reload, even well after the real ffmpeg
build has genuinely finished server-side. Separately, he asked to add a
transition animation (Final Check → Scheduled, Processing → Final Check)
to the to-do list — noted below, not built this pass since he explicitly
framed that part as a backlog item, not something to fix right now.

**Root cause, in `maybeStartAnalysisPolling()`'s poll tick
(`ops-service/public/app.js`):** once a piece's `analysisStatus` or
`finalBuildStatus` actually resolves, this function's per-row DOM update
(`removeUploadRowAnimated`, `refreshUploadRowHeadById`, or
`renderUploadLists()` for the error-recovery case) only ever touches
`uploadRows` — Content Production's own DOM subtree. The moment Harvey
navigates to a different tab, that subtree is torn down by the SPA's
tab router; these calls don't error against the detached node, they just
silently do nothing. `pieces[r.id]` itself was already being correctly
updated in memory (§142's fix), but nothing told whichever *other* tab
was actually on screen — the Kanban board, in Harvey's exact scenario —
to redraw itself with that new data. Only a full page reload re-fetched
everything fresh and rendered once, which is why that "worked."

**Fix:** the poller now checks `currentTabId() !== 'upload-files'`
before running any of the Content-Production-specific DOM updates, and
calls the existing generic `notifyPiecesChanged()` hook instead when
some other tab is active — the same `window.__rmOnPiecesChanged`
mechanism already used everywhere else in this file for exactly this
"a different view needs to know data changed" case (e.g. after quick-
add saves, or the shared modal's own edits). Since `window.__rmOnPiecesChanged`
always points at whichever tab most recently booted itself (`render`
for Content Ops, `renderUploadLists` for Content Production), this
correctly redraws the Kanban board — or whatever else is actually
visible — the instant a background job's result lands, without waiting
for Harvey to switch back to Content Production first or reload the
page. Confirmed calling a torn-down tab's own render function (e.g. a
stale `render()` still referencing Content Ops's now-detached `board`
element, if Harvey's since moved on to a *third* tab like Settings) is
a harmless no-op, not an error — DOM writes against a disconnected node
just don't paint anywhere, they don't throw.

**Deferred, per Harvey's own "add to my to-do list" framing — not built
this pass:** a real move-transition animation when a card changes
column (Processing → Final Check, Final Check → Scheduled, etc.), so
the change reads as motion rather than a card just appearing/
disappearing between renders. Worth scoping properly when picked up —
`render()` currently does a single full `board.innerHTML = ...` rebuild
per call (§113/123), which has no concept of "this specific card moved
from column A to column B" to animate against; doing this properly
likely means diffing the previous and next render's card-to-column
mapping and running a FLIP-style transition on whichever cards actually
moved, not just fading the whole board.

Frontend-only (`app.js`), so per §93 this is already live — no deploy/
restart needed. Verified via `node --check`; not yet re-tested against
the live deployed service with the exact repro (send to final check,
immediately switch to the Kanban tab, wait for the real build to finish
without touching the page) — worth confirming the card now appears on
its own once the background build completes.

---

# 145. §144 Verified For Real (Not Just Reasoned About) — and the Move Animation Actually Built This Time

Harvey reported §144's fix still wasn't working ("i still dont see any
movement from processing --> final check"). Given this exact codebase's
own repeated history of shipping reasoning-only fixes that failed in
practice on this specific board (§113/§119/§120/§121's four rounds
before §123 finally built a real test rig), the right response wasn't a
fifth guess — it was building a real browser test rig again and actually
watching it happen.

**Test rig rebuilt from scratch this session** (same workaround as
§123: `playwright-core` + `npx playwright install chromium`, then
downloading missing shared libs as plain `.deb` files from
`deb.debian.org`'s `bookworm` pool — this container's actual Debian
version, confirmed via `/etc/os-release` first rather than guessing,
which avoided §123's glibc-version mismatch gotcha entirely — and
extracting them with `dpkg-deb -x` into a scratch dir for
`LD_LIBRARY_PATH`, no root needed). Logged into the real
`ops.realitymanual.com`, uploaded a real synthetic video (`ffmpeg
testsrc` + a real `sine` audio track — a first attempt without an audio
track produced a real server-side `finalBuildStatus: 'error'`, which
is correct behavior, not a bug, and was a useful reminder that a failed
build should never be confused with a stale-render bug), picked a real
ambient audio track to force the slower `amix` re-encode path, clicked
"Send to final check," immediately switched to `#content-ops`, and
polled the live DOM for up to two minutes watching for the card to
land in Final Check **without ever reloading the page**.

**§144's fix genuinely does work** — confirmed three times: a fast
build (desktop), a slower realistic build with real audio (desktop,
~4s), and the same flow under an emulated mobile viewport/Safari user
agent. All three landed correctly in Final Check with no reload. No
service worker exists on this origin either (checked and ruled out as
a possible stale-cache explanation). All five synthetic test pieces
created during this verification were deleted afterward via the app's
own delete endpoints, leaving Harvey's real data untouched.

**So what was Harvey actually seeing?** Most likely just this: §144 made
the *card appearing in the new column* work correctly, but a card that
was already correctly re-rendered still has no way to visually read as
"it moved" — it simply materializes in the new column on the next
redraw, with nothing to distinguish that from having always been there.
Harvey's *complaint* about "no movement" may have been entirely correct
about the experience even though the underlying data/render bug was
already fixed — this section's actual new work (below) is what he
explicitly escalated to ("i need that movement thing actually done"),
not a re-litigation of §144.

**Built for real this time — `animateBoardMove(id)` in
`ops-service/public/app.js`:** a plain FLIP animation. Reads the card's
current on-screen `getBoundingClientRect()`, lets the normal `render()`
happen, reads the same card's new position, and animates the visual gap
between old and new with a CSS `transform: translate(...)` transition
(480ms) plus a brief accent-glow highlight (`.card-just-moved` in
`style.css`, 900ms) so the change is genuinely noticeable, not just
spatially correct. Deliberately not hooked into every `render()` call —
search, type-filtering, and drag-and-drop reordering already work fine
today and don't need this; it's only invoked from the specific places
that know a piece's *stage* (not just some other field) actually
changed:
- `maybeStartAnalysisPolling()` (Processing → Final Check, once a video
  build completes) — via a new optional `window.__rmOnPieceMoved` hook,
  set only while Content Ops is the currently booted tab (mirrors
  `window.__rmOnPiecesChanged`'s existing pattern, §144/§75), used
  instead of the plain notify specifically when exactly one piece's
  stage changed in that poll tick.
- `maybeStartYoutubePublishPoll()` (Final Check → Posted/Live, once a
  real publish succeeds) — calls `animateBoardMove()` directly rather
  than through the hook indirection, since this poller only ever runs
  while Content Ops is already the booted tab in the first place (the
  Publish button that starts it only exists on a Final Check card).

Frontend-only (`app.js`, `style.css`), so per §93 this is already live
— no deploy/restart needed. **Confirmed working for real, not just
`node --check`-clean**: re-ran the same test rig against the live
deployed result, instrumenting the card itself as it transitioned —
`.card-just-moved` was genuinely applied and `getComputedStyle` showed
the real accent-green glow rendering (`rgb(60, 255, 137) 0px 0px 0px
2px, ...`) at the moment it landed in Final Check, confirming
`animateBoardMove()` actually ran end to end rather than just existing
in the deployed source. All synthetic test pieces created during this
verification pass were deleted afterward via the app's own endpoints.

---

# 146. Real Bug: Stuck Analysis/Build Jobs Poll Forever, Flickering the Whole Board

Harvey's report ("the thumbnail in Final Check disappears then reappears
then disappears again a few times after I clicked it once") led to a
more serious underlying bug than the symptom suggested — not anything
about clicking, and not scoped to just the one card he was looking at.

**Root cause, confirmed against the live data:** piece #97
(`horizontalvid`, already at `stage: 'live'`, successfully published to
YouTube days earlier) and piece #98 (`verticalvideodemo`, sitting in
Processing) both had `analysisStatus: 'pending'` **permanently stuck** —
never having progressed to `'running'`, `'done'`, or `'error'`. The only
place that ever updates `analysisStatus` off its initial `'pending'`
value is `runVideoAnalysis()` in `server.js`, and its very first line is
`piece.analysisStatus = 'running'; savePieceRecord(piece);` — so a piece
stuck at `'pending'` means that background job never even started, or
started and was killed before its first line landed. The most likely
cause: `rm-ops-service` gets rebuilt/restarted on every backend deploy
(§93), and this project already solved the exact "a restart abandons an
in-flight background job forever" problem once before, for voice
messages (`recoverInflightVoiceMessages()`, §88) — but never applied the
same fix to video analysis/build jobs, so a video whose analysis was
queued or running at the moment of a redeploy was left stuck with no
mechanism to ever notice or recover.

**Why that caused a repeating flicker, unrelated to anything Harvey
clicked:** `maybeStartAnalysisPolling()` (client, `app.js`) includes any
piece with `analysisStatus`/`finalBuildStatus` `pending`/`running` in its
"still waiting" list and polls every 3s until that list is empty. A piece
stuck at `'pending'` forever means that list is **never** empty — the
poller runs indefinitely, and every tick (per §144/§145's own fix)
re-renders whatever tab is actually on screen, since nothing about the
stuck piece ever changes to make the loop stop. Every 3 seconds, the
entire Kanban board — including whatever Final Check card Harvey
happened to be looking at — was being torn down and rebuilt, which reads
exactly as a video/thumbnail "disappearing and reappearing" repeatedly,
totally independent of his own click.

**Fixed three ways:**
1. **`server.js`: `recoverInflightVideoJobs()`**, mirroring
   `recoverInflightVoiceMessages()`'s exact pattern, now runs on every
   process start. Any piece found with `analysisStatus`/`finalBuildStatus`
   still `pending`/`running` gets marked `'error'` with a clear message —
   same conservative choice §88 already made for voice messages (don't
   blindly re-run/resume something whose real completion state is
   unknown), applied to the class of job this project had left
   unprotected. Logs a `SERVICE RESTARTED` line to the work log, same as
   the voice-message recovery already does.
2. **`app.js`: a 5-minute timeout** in `maybeStartAnalysisPolling()`'s own
   `waiting` filter — defense in depth independent of the server-side
   fix, since no real analysis/build job takes anywhere close to that
   long, so anything still pending/running that long later is stuck, not
   slow. Closes the same failure class even if it ever happens for some
   other reason a server restart doesn't explain.
3. **Immediate data fix**, applied directly via the live API so Harvey's
   flicker stopped right away rather than waiting for this deploy:
   manually cleared the two actually-stuck pieces (#97, #98) to
   `analysisStatus/finalBuildStatus: 'error'`.

This is a `server.js` change (real backend logic), so per §93 it
triggers a full rebuild+restart on the next deploy — same standing
caveat as every prior backend change in this file, since this session is
the headless agent running inside the container being restarted. Logged
to the work log immediately before pushing.

Verified via `node --check` on both files; the immediate data fix was
confirmed applied via a direct re-fetch of both pieces. **Not yet
verified end-to-end** that `recoverInflightVideoJobs()` actually fires
and behaves correctly on a real restart — worth confirming after this
deploy that the work log gets the expected recovery line if any piece is
genuinely mid-analysis/build when it happens next.

---

# 147. Kanban Move Animation Generalized to Every Stage-Change Path; Real Demo Videos Embedded on Both App-Review Pages (2026-09-20)

**Animation.** §145's `animateBoardMove()` FLIP animation only fired from
two places — the analysis-poller (Processing → Final Check) and the
publish-poller (Final Check → Live). Harvey asked for it to work "for all
pipeline stages when a piece moves," so it's now wired into every other
place a piece's `stage` actually changes:

- **Manual drag-and-drop** (`bindBoardEvents()`'s column `drop` handler):
  the dragged piece's `setPieceStage(p, stageId)` call no longer passes
  `render` as its callback (that would double-render, wiping the
  animation's transform mid-flight); the trailing `render()` call after
  the reorder loop is now `animateBoardMove(draggingId)` instead.
- **The `.card-move` dropdown** on each card: `setPieceStage(p, sel.value,
  render)` → `setPieceStage(p, sel.value, function () {
  animateBoardMove(p.id); })`.
- **The shared editor modal's Approve button and Stage field**: both
  used to call the plain `notifyPiecesChanged()` hook. Added a new
  `notifyPieceMoved(id)` helper right next to it — prefers
  `window.__rmOnPieceMoved` (the real animation, only set while Content
  Ops is booted) and falls back to a plain re-render otherwise (e.g. a
  save landing while Content Production is the active tab, which has
  nothing to animate against). `syncFromForm()` now captures `prevStage`
  before applying form values and calls `notifyPieceMoved` only if the
  stage actually changed; the Approve button always calls it, matching
  its own guaranteed stage change.

**Verified for real, not just reasoned about** — this exact board has a
documented history (§113/119/120/121) of reasoning-only fixes failing in
practice, so a Playwright rig was rebuilt from scratch (same
manually-extracted-Debian-.deb-packages workaround as §123/§145) and run
directly against the live deployed service: created a synthetic test
piece, drove a real `.card-move` dropdown `change` event and a real
synthetic `DragEvent` sequence (dragstart/dragover/drop) against the
actual DOM, and polled `getComputedStyle` every 100ms. Both paths
genuinely applied `.card-just-moved` with the real accent-green
`box-shadow` and (for the drag case) a real CSS `transform` mid-transition,
correctly landing in the target column and cleaning up after ~900ms in
both cases. All synthetic test pieces were deleted afterward via the
app's own DELETE endpoint.

**Demo videos.** Harvey recorded and pushed two real screen-recordings
directly to the repo root (`ContentStudioTikTokDemo.mp4`,
`YouTubeContentStudioDemo.mp4`, ~16MB each). Moved into
`ops-service/public/media/` (`tiktok-demo.mp4` / `youtube-demo.mp4`) so
they're served as ordinary static files from the same origin as the two
review pages, and embedded via a plain `<video controls>` element:

- `youtube-app-review.html`'s `rv-video-slot` placeholder (added §136,
  "coming soon") is replaced with the real embed; the now-unused
  `.rv-video-slot`/`.rv-video-icon`/`.rv-video-title`/`.rv-video-hint`
  CSS was deleted rather than left dead.
- `tiktok-app-review.html` never had a video slot at all (§122's page
  only had an illustrative static mockup, `.demo-video-box`, labeled
  "DEMO DATA") — added a new `.rv-video-embed` block in the same
  position as the YouTube page's (right after the intro paragraph,
  before section 01), left the illustrative Final Check mockup
  in section 03 as supplementary written context since it's still
  honestly labeled as demo data, not a claim that it's the real video.

Both are plain frontend/static-file changes (no `server.js`/`src/*`
touched), so per §93 this deploys via the fast path — no Docker
rebuild/restart, no interrupted session.

**Known gap flagged to Harvey, not fixed this pass:** the real
"Schedule Video" flow on Final Check does not yet show TikTok's own
required pre-post UX — a Music Usage confirmation checkbox and a
Branded Content disclosure toggle, both explicitly required by TikTok's
Content Sharing Guidelines (already noted as *planned but not built* in
§122's own mockup caption: "the two pieces of this screen we'd add
specifically"). The real demo video therefore shows a real publish
without these prompts. Worth building for real before relying on this
video alone to carry a review, though TikTok's guidelines describe this
requirement less strictly than an automatic rejection trigger — Harvey's
call whether to submit as-is or wait for these to be built first.

---

# 148. TikTok Music Usage + Branded Content Checkboxes Actually Built (2026-09-20)

Closed §147's flagged gap — Harvey asked for the least invasive
addition, to refilm the demo video afterward.

**`ops-service/public/app.js` — `fcScheduleVideoHtml()`:** when `tiktok`
is a wired-and-tagged platform for a Final Check piece, two checkboxes
now render above the "Schedule Video" button — "I confirm this content
complies with TikTok's Music Usage Confirmation" and "This is branded
content" — matching the exact copy already used in `tiktok-app-review.html`'s
illustrative mockup (§122), now real. Music Usage has no actual TikTok
API field to send; per TikTok's own docs it's a developer-side
compliance gate shown in the app's own UI, not a post parameter — so
it's enforced purely client-side: the click handler for
`.fc-yt-publish-btn` now checks the box's state before firing anything,
and if TikTok is among the platforms being published to and it's
unchecked, blocks the *entire* click (not just TikTok's half) with an
inline warning (`.fc-tiktok-consent-warn`, reusing the existing
`.fc-yt-error` styling) rather than silently skipping TikTok — so it's
obvious why nothing went out rather than a delayed "why isn't this on
TikTok" moment later.

**Branded Content is real** — TikTok's Content Posting API genuinely has
a `brand_content_toggle` field on `post_info`. Threaded end to end:
checkbox state → `brandedContent` in the request body → `server.js`'s
`POST /api/tiktok/publish/:id` route → `runTiktokPublish`'s call to
`tiktokAuth.publishVideo` → `initPublish`'s `post_info.brand_content_toggle`.
Defaults to `false`/unchecked, matching the mockup.

**Known limitation, noted in a code comment rather than solved:** per
TikTok's own documentation, a branded-content post cannot use
`SELF_ONLY` privacy — and every TikTok post from this app is currently
forced to `SELF_ONLY` while unaudited (§143). Not handled, since
Harvey's real content is never actually branded content in practice;
worth revisiting if that combination is ever genuinely hit and TikTok's
API rejects it.

This is a `server.js`/`src/tiktokAuth.js` change (real backend logic),
so per §93 it triggers a full rebuild+restart on the next deploy — same
standing caveat as every other backend change in this file, since this
session is the headless agent running inside the container being
restarted. Logged to the work log immediately before pushing.

Verified via `node --check` on all three touched JS files and a CSS
brace-balance check. **Not yet verified against the live deployed
service** — once it's back up, confirm: the two checkboxes render on a
Final Check card tagged for TikTok (and don't render for a
YouTube-only card), clicking Schedule Video with Music Usage unchecked
shows the inline warning and genuinely fires nothing, checking it and
clicking again actually publishes, and a checked Branded Content box
results in `brand_content_toggle: true` reaching TikTok's real API (a
deliberate real test would need TikTok to actually accept or reject
that combination against the still-SELF_ONLY-forced account — the
error path, if any, should surface via the existing `tiktokPublishError`
mechanism, not fail silently).

---

# 149. §142's Own Fix Had a Second Bug: Object-Identity Break Let Platforms Keep Reverting

Harvey re-tested §148 by refilming with only TikTok selected and hit the
exact same symptom §142 was supposed to have closed: all 4 platforms
came back on Final Check despite selecting only TikTok. Root-caused
against the live piece and server logs rather than guessed again.

**Confirmed via the live API and VPS docker logs, not assumed:** the
piece (`08762a6c-...`, filename "verticalvideodemo," same test filename
reused) was created at 12:57:55Z and never touched again after
12:58:24Z — `analysisStatus` stuck at `'pending'` forever (its analysis
job genuinely hung partway through, per §146's still-standing gap, since
the server log shows only the HEVC-normalization line and nothing
past it), while `finalBuildStatus` reached `'done'` and `stage` reached
`final_check` — meaning "Send to final check" fired and completed
successfully using data that still disagreed with what the analysis
poller's own view of the piece had already moved on to.

**Real root cause — a second, independent bug introduced by §142's own
fix, not a repeat of the first one:** §142 correctly stopped the poller
from blindly overwriting the whole piece object, but its actual
implementation —
```js
var merged = existing ? Object.assign({}, existing) : r;
...
pieces[r.id] = merged;
```
— builds a **brand-new object** on every single poll tick and reassigns
`pieces[id]` to point at it. That breaks object *identity*, and
`buildUploadRow()`'s "Send to final check" button closes over the exact
`p` reference it was originally built with — it never re-reads
`pieces[id]` again after that. Only `refreshUploadRowHeadById()` (the
poller's own per-tick DOM update) reads the live `pieces[id]` and
rebuilds the head's checkboxes against whatever the *current* object
is. Since analysis/build jobs routinely take several real seconds — one
poll tick every 3s for the whole duration — it only takes a single tick
firing while Harvey is mid-edit for `pieces[id]` to get silently swapped
to a new object: any platform he unchecks *after* that tick lands only
on the new object the checkboxes now point at, invisibly to the send
button, which is still holding the original, pre-edit object (the full
preset) and ships exactly that the moment it's clicked. §142's own fix
correctly stopped the *read* side from clobbering local edits with stale
server data, but introduced this new way for a *local* edit to get
silently split across two different objects instead.

**Fix, `ops-service/public/app.js`'s `maybeStartAnalysisPolling()`:**
mutate `existing` in place rather than building a copy — `pieces[id]`
now keeps the exact same object identity for a piece's entire lifetime
once created, so every closure that ever captured it (however long ago,
including a stale "Send to final check" button) always sees live
updates with zero risk of drifting apart. `refreshUploadRowHeadById()`
is now purely a visual refresh (so status text/tags redraw), not load-
bearing for correctness the way it accidentally became.

**Piece #097 fixed directly against the live data again** so Harvey has
something to retest: `platforms` reset to `['tiktok']`, `analysisStatus`
set to `'error'` with an honest message (its own analysis job is
genuinely hung, not just delayed — matches §146's still-open gap: no
job actually times out server-side yet, only the client's 5-minute
polling-timeout stops re-rendering around it; a real server-side timeout
for a hung `transcribeVideo`/`matchAndGenerateTitles` call is still
worth adding if this keeps happening).

**Also answered, Harvey's question about "This is branded content"
(§148's checkbox):** it's TikTok's own required disclosure for actual
paid partnerships / sponsored content — check it only when a video is a
paid collaboration with a brand. For his own organic book-marketing
videos this should stay unchecked essentially always. Also worth
knowing: per §143's research, TikTok won't even allow a branded-content
post while this app's postings are forced `SELF_ONLY` (unaudited/
sandboxed) — not a practical blocker right now since he won't be
checking it, but relevant if that ever changes.

Frontend-only (`app.js`), so per §93 this is already live — no deploy/
restart needed. Verified via `node --check`; the piece #097 data fix was
confirmed applied via a direct re-fetch. **Not yet re-tested against the
live deployed service with a fresh upload** — the real test is: upload a
video, uncheck platforms down to one, wait long enough for at least one
3s poll tick to fire (trivial — analysis always takes some time), then
send to Final Check and confirm the platform selection survives all the
way through this time.

---

# 150. Real Logo + Exact App Name, to Match Google's OAuth Branding Requirement

Google's OAuth branding verification (§133/§136) came back with 4
issues, all boiling down to one thing: the app name/logo on the OAuth
consent screen (App name: "Reality Manual Content Studio") didn't match
what Google's reviewer actually found on the homepage URL registered as
the app's "Application home page" — which was still showing a split
"The Reality Manual" / "Content Studio" wordmark and a plain inline SVG
diamond outline, neither literally matching the single registered name
or logo file. Google explicitly flags a generic, wordmark-less icon
like that as failing to "uniquely identify your brand," separately from
the mismatch itself.

Harvey supplied the exact PNG he'd already uploaded to Google's OAuth
Branding page (a solid green layered-diamond mark on black,
1024×1024) — committed to `ops-service/public/img/logo.png`. Same file,
used in both places asked for:

- **`ops-service/public/youtube-app-review.html`** (the actual page
  registered as Google's "Application home page" — the one that
  actually matters for verification): nav mark swapped from the inline
  SVG to `<img src="img/logo.png">`, and the name split across `.name`/
  `.sub` ("The Reality Manual" / "Content Studio — internal team tool")
  collapsed to a single `.name` reading exactly **"Reality Manual
  Content Studio"** (matching the OAuth App name field verbatim), with
  `.sub` now just "Internal team tool." `<title>` updated to match too.
- **`ops-service/public/index.html`** (the internal control panel
  itself — not what Google checks, but Harvey asked for the same
  consistency here): the post-login header's `brand-mark`/`wordmark-sm`
  got the same image + exact name treatment. The **login screen**
  (what an unauthenticated visitor, or Google, would actually see if
  they ever loaded this URL directly) previously had no logo image at
  all and split "The Reality Manual" (small kicker) / "Control Panel"
  (large heading) — added the logo image above the form and swapped the
  roles so the large, primary heading now reads "Reality Manual Content
  Studio" with "Control Panel" demoted to the small kicker above it, on
  the theory that whatever's biggest/most prominent is what a reviewer
  (or Harvey's own future self) reads as "the app name." `<title>` and
  the footer line updated to match as well.

Deliberately scoped to just these two files, per Harvey's own explicit
list — didn't touch `privacy.html`/`terms.html`/`tiktok-app-review.html`
or any of the small decorative diamond icons used elsewhere in the ops
panel's own UI iconography (side-rail logo, group icons), which are
ordinary interface icons, not "the app logo" in the sense Google's
verification cares about.

Frontend/static-only (`index.html`, `youtube-app-review.html`,
`style.css`, plus the new image), so per §93 this deploys via the fast
path — no Docker rebuild/restart, no interrupted session. Verified via
a CSS brace-balance check and a rough HTML tag-balance check on both
touched pages; not yet visually confirmed against the live deployed
service — worth a look to confirm the logo renders correctly at both
sizes (22px nav mark, 44px login logo) and the login screen's longer
heading doesn't wrap awkwardly in the 360px card before resubmitting to
Google for reverification.

---

# 151. Real Bug: A Piece Could Reach Final Check While Analysis Was Still Running Underneath It

Harvey still couldn't film his TikTok demo — the video's thumbnail kept
disappearing and reappearing while he tried to interact with it. Asked
for the piece to either not show at all, show a "still preparing"
placeholder, or just stay in Processing longer until genuinely ready —
which is exactly the right framing and matches the actual fix.

**Root cause, confirmed against the live piece:** `714d2e6b-...` was
sitting in `final_check` with `finalBuildStatus: 'done'` (fully built,
playable) but `analysisStatus: 'pending'` (its transcription/matching
job never finished). §115 only ever gated the Final Check transition on
`finalBuildStatus` — analysis (triggered separately, right after
upload) and the final-video build (triggered by "Send to final check")
are two completely independent background jobs with no coordination
between them. Since `maybeStartAnalysisPolling()` re-renders the whole
board every 3s for as long as *either* job is pending, a piece could
become fully interactive in Final Check while still being torn down and
rebuilt on a timer underneath — tearing out the `<video>` element
(losing playback state) mid-interaction, exactly what Harvey described.

**Fix, `ops-service/server.js`:** a new `maybeAdvanceToFinalCheck(id)`
only flips `stage` to `'final_check'` once **both** `finalBuildStatus
=== 'done'` **and** `analysisStatus` is no longer `'pending'`/`'running'`
(analysis failing is fine — only analysis still *in progress* blocks
the move). Called from the completion of both jobs, in both their
success and error paths — whichever job finishes second is the one
that actually advances the stage. In the common case (analysis already
resolved by the time Harvey finishes editing and clicks send, which is
most of the time) this behaves identically to before, zero added delay.
Also added `withAnalysisTimeout()` — a 90s server-side timeout wrapping
the transcription and matching calls — so a genuinely hung analysis job
(confirmed happening for real twice already this session, §146/§149)
can't block a piece from ever reaching Final Check; it just resolves to
`analysisStatus: 'error'` instead, which the gating already treats as
"settled, safe to advance."

**Client-side, `ops-service/public/app.js`:** a piece now sitting in
Content Production with `finalBuildStatus: 'done'` but analysis still
running gets a new, honest status line — "Final video ready — waiting
on transcription/matching to finish before this moves to Final Check…"
— instead of looking like nothing happened after clicking send.

**Immediate relief, applied directly against the live piece Harvey was
actively testing with** (`714d2e6b-...`) so he didn't have to wait for
the redeploy: manually cleared its stuck `analysisStatus: 'pending'` to
`'error'`, stopping the poller (and the flicker) for that piece right
away. Its `platforms` currently still shows all four
(`ytshort`/`tiktok`/`instagram`/`facebook`) — Harvey didn't flag that as
wrong this specific time (he was focused on the flicker blocking him
entirely), so this wasn't assumed to be a regression of §149's fix and
wasn't touched; worth a real check next time he uploads fresh whether
that fix is holding, since this piece's `createdAt` is after §149
deployed.

This is a `server.js`/`app.js` change (real backend logic), so per §93
it triggers a full rebuild+restart on the next deploy — same standing
caveat as every other backend change in this file, since this session
is the headless agent running inside the container being restarted.
Logged to the work log immediately before pushing.

Verified via `node --check` on both touched files. **Not yet verified
end-to-end against the live deployed service** — once it's back up,
confirm with a genuinely fresh upload: the piece stays in Content
Production (with the new "waiting on transcription/matching" status
line) until analysis actually resolves, only *then* moves to Final
Check, and the video plays/interacts cleanly with no flicker once
there — and separately, whether §149's platform fix is holding on this
same fresh upload.

---

# 152. Scoped Reviewer Login for Google's OAuth Verification Team (2026-09-20)

Google's OAuth verification asked for credentials so reviewers could
test the real connect flow themselves, not just watch the demo video.
Harvey's real panel password would have handed them Project Manager (a
live headless agent with real host SSH access, §88) and every piece of
Content Ops planning data — explicitly not acceptable, so this needed a
genuinely separate, narrowly-scoped credential, not just a UI that hides
other tabs (which a reviewer with API access could trivially bypass).

**`ops-service/server.js`:**
- New `REVIEWER_PASSWORD` env var and a completely separate
  `reviewer_sessions` table/cookie (`rm_reviewer_session`) — structurally
  isolated from the real `sessions` table/`rm_session` cookie, so a
  reviewer token can never be confused with or escalated into real admin
  access.
- `POST /api/reviewer-login`, `POST /api/reviewer-logout`,
  `GET /api/reviewer-me` — mirror the main login routes exactly, just
  against the new table/password.
- `requireAuthOrReviewer` — accepts either a real admin session or a
  reviewer session. Applied **only** to the four YouTube connect-flow
  routes a reviewer actually needs: `GET /api/youtube/status`,
  `GET /api/youtube/oauth/{start,callback}`, `POST /api/youtube/disconnect`.
  Removed the old blanket `app.use('/api/youtube', requireAuth)` that
  used to cover the whole path, replacing it with this per-route guard
  on just those four.
- **Real gap found and fixed while doing this:** `POST
  /api/youtube/publish/:id` (the route that actually uploads a video to
  the channel) had been relying on that same old blanket middleware.
  Removing the blanket without checking would have left this route with
  **zero auth at all** — anyone could have triggered a real publish.
  Caught by grepping for every `/api/youtube/*` route before removing
  the blanket rather than assuming the four connect-flow routes were the
  only ones; fixed by explicitly adding `requireAuth` (admin-only, never
  `requireAuthOrReviewer`) directly to this route, since actually
  publishing is a consequential action a reviewer must never be able to
  trigger, unlike just viewing/connecting the channel.
- OAuth callback redirect target is now explicit, not guessed from which
  cookies happen to be present (which could be ambiguous if a browser
  holds both a real admin session and a reviewer session at once, e.g.
  while testing this): `reviewer.html`'s Connect button passes
  `?from=reviewer` to `/oauth/start`, which stores that choice in a
  short-lived `yt_oauth_return` cookie the callback reads and clears,
  redirecting to `/reviewer.html` or `/#settings` accordingly.
- `/api/tiktok/*` and everything else (`/api/store`, `/api/files`,
  `/api/voice`) are completely untouched — still gated by `requireAuth`
  alone, no reviewer path exists for them at all.

**`ops-service/public/reviewer.html`** (new) — a minimal standalone page,
same pattern as `quick-add.html`: a login form posting to
`/api/reviewer-login`, and once authenticated, **only** the YouTube
connect/disconnect card (a small duplicated version of `app.js`'s
`renderYoutubeConnectCard()`, kept separate rather than shared per this
codebase's usual convention for small page-specific logic). No side-rail,
no other tabs, no link to anything else in the panel — the page's own
simplicity isn't the security boundary though, the server-side route
gating above is; this page is just what a reviewer session is actually
able to *do* something with.

**Credential handling:** `REVIEWER_PASSWORD` is a freshly-generated
app-level password (like the panel password Harvey picked for himself,
§44/§62's precedent — not an external credential captured from another
system), added directly to `ops-service/.env` on the VPS via SSH.

This is a `server.js` change (real backend logic, plus route-level auth
changes worth being especially careful about), so per §93 it triggers a
full rebuild+restart on the next deploy — same standing caveat as every
other backend change in this file, since this session is the headless
agent running inside the container being restarted. Logged to the work
log immediately before pushing.

Verified via `node --check` and a manual re-grep of every `/api/youtube/*`
route to confirm each one still has an explicit auth guard after removing
the blanket middleware, plus an HTML tag-balance check on `reviewer.html`.
**Not yet verified end-to-end against the live deployed service** — once
it's back up, confirm: `reviewer.html` actually logs in with the new
password, the Connect button reaches Google's real consent screen, the
callback correctly redirects back to `/reviewer.html` (not `/#settings`)
and shows "Connected as `<channel>`", and — just as important — that the
reviewer session genuinely gets 401s from `/api/voice/*`, `/api/store/*`,
and `/api/tiktok/*` rather than silently working.

---

# 153. §152 Replaced: Google's Real Demo-Account Requirement Needs Hands-On Access, Not Just a Connect Button (2026-09-20)

§152's narrow reviewer.html (YouTube connect/disconnect only) was built to
satisfy the OAuth *sensitive-scope verification* review — but Harvey then
hit a separate, stricter Google requirement for the **YouTube API
Compliance Audit** (needed to unlock Public/Unlisted uploads, §128's own
follow-up finding): *"Provide credentials with FULL access to all
features, including premium/enterprise. The account should have sample
data."* A connect-only page doesn't satisfy that — Google's reviewer
needs to actually produce and publish a video through the real product.
Harvey's explicit instruction: throw out the narrow page, give the
reviewer password (`youtubeaccess`, set directly on the VPS) full access
to Content Pipeline/Production/Settings on the *same* main panel, but
never Project Manager or Analytics, never able to edit/delete Harvey's
own existing pieces, and with every non-YouTube field disabled.

**Session model, rebuilt:** `reviewer.html` and its dedicated
`/api/reviewer-login`/`-logout`/`-me` endpoints are gone. The password now
logs into the exact same login form as the admin password
(`POST /api/login` tries `PANEL_PASSWORD` first, then `REVIEWER_PASSWORD`,
and sets whichever session cookie matches) — `GET /api/me` returns
`{ ok, role }`, and `lib/auth.js`'s `checkSession`/`checkPassword` now
resolve to that whole object (still truthy, so nothing else needed to
change) instead of a bare boolean. The two session tables/cookies from
§152 (`sessions`/`rm_session` for admin, `reviewer_sessions`/
`rm_reviewer_session` for the reviewer) are kept exactly as they were —
still structurally separate, so a reviewer token still can never be
confused with or escalated into a real admin one — just pointed at much
more surface area now. `requireAuthOrReviewer` attaches `req.sessionRole`
so every route below can tell which kind of session it's serving.

**Server-side enforcement (the actual security boundary — everything in
`app.js` below is UX only):**
- `/api/store` and `/api/files` are no longer `requireAuth`-only; both
  admit a reviewer session, with fine-grained checks inside each handler:
  - `errors` store: fully forbidden for a reviewer (GET/PUT/DELETE), not
    relevant to a YouTube demo and not something to hand an outside party.
  - `settings`: **GET is redacted** — `redactSettingsForReviewer()` blanks
    every `apiKeys.*` value before the response ever leaves the server
    (Instagram/Facebook/transcription keys are real secrets stored in this
    same JSON blob; client-side "disabled" alone would still have exposed
    the raw value). **PUT is allowlist-merged**, not overwritten —
    `mergeReviewerSettingsWrite()` only ever changes
    `captions.shortform.ytshort` and `captions.longform.ytlong`; every
    other field in the request body is ignored and the existing stored
    value is kept, so a raw API call (not just the UI) can never touch
    another platform's caption text or any API key.
  - `audioTracks`: read allowed (a reviewer can pick from the existing
    ambient library when producing its demo video), but PUT/POST/DELETE
    (library management — add/remove tracks) is admin-only.
  - `pieces`/`videos`: a reviewer can create freely (`createdBy` is
    force-set to `'youtube-reviewer'` server-side regardless of what the
    client sends, so it can never claim an existing record or disguise
    its own as admin-authored), and can only edit/delete a record it
    created itself — `pieceOwnedByReviewer()`/`ownerPieceIdFor()` resolve
    a `videos` id (including the `-final` suffix) back to its owning
    piece for this check. Reading any piece/video, including Harvey's
    own, is unrestricted — the whole point is "view everything, edit only
    what you made."
- `/api/videos/:id/analyze` and `/api/videos/:id/build-final` (the
  uploader pipeline) gained `requireAuthOrReviewer` + the same ownership
  check. **These had no auth guard at all before this pass** — a real
  pre-existing gap (anyone who knew a valid video id could have triggered
  ffmpeg/transcription/Claude Code work against it), closed here as a
  side effect of touching these routes for reviewer access, not a
  design choice worth keeping.
- `/api/youtube/publish/:id` changed from `requireAuth`-only (§152's
  explicit "a reviewer must never publish" stance) to
  `requireAuthOrReviewer` + ownership — Google's own requirement is that
  the demo account can genuinely publish, which is a direct reversal of
  §152's reasoning, made deliberately: a reviewer still can never publish
  anything Harvey created, only its own piece.
- `/api/tiktok/*` and `/api/voice/*` are untouched — still `requireAuth`
  only, full stop, regardless of anything else. TikTok has nothing to do
  with this account's purpose and Project Manager is the one surface that
  must never be reachable by an outside credential under any
  circumstance.
- The `?from=reviewer`/`yt_oauth_return` cookie dance from §152 (routing
  the OAuth callback back to `/reviewer.html`) is gone — both roles now
  land on the same `/#settings` after connecting, since there's only one
  page to land on anymore.

**Client-side (`app.js`, `index.html`, `style.css`) — all cosmetic/UX,
matching what the server already enforces, not a second source of
truth:**
- `IS_REVIEWER`/`CURRENT_ROLE` set once from the login/session-check
  response. `body.role-reviewer` (toggled in `initApp()`) drives CSS that
  hides Project Manager, the whole Analytics group, Quick Add, and the
  mobile "back to Project Manager" button from every nav surface
  (`renderTabs()` also drops those groups from the top strip directly).
  `renderActiveTab()` bounces any hash outside
  `content-ops`/`upload-files`/`settings` back to `content-ops` — catches
  a stale bookmark or hand-edited URL, though the real gate is server-side
  regardless.
- `canEditPiece(p)` (true for admin always; true for a reviewer only when
  `p.createdBy === 'youtube-reviewer'`) is threaded through every place a
  piece can be changed: `cardHtml()` (draggable + stage-select disabled
  for a foreign piece), `bindKanbanContextMenu()` (no right-click-delete
  menu at all for one), `fcScheduleVideoHtml()` (Schedule Video disabled,
  and even on an owned piece only ever offers YouTube — TikTok is never a
  reviewer option, via a new `effectiveWiredPlatforms()`), and a new
  `applyReviewerModalGate(p)` (called after `populateFields()` in both
  `openPiece()`/`createDraft()`) that disables every field in the shared
  editor modal — including, on the reviewer's *own* piece, every
  non-YouTube platform checkbox — for anything it doesn't own. The modal's
  DOM nodes are reused across opens, so this actively re-enables fields
  too, not just disables them, or a previously-viewed read-only piece
  would leave the next genuinely-editable one locked.
- Content Production (`buildUploadRowHead`/`buildUploadRow`): a foreign
  row is fully locked (frame picker, audio, titles, send button); an
  owned row still has TikTok/Instagram/Facebook platform checkboxes
  disabled, YouTube ones left enabled. `handleFiles()` pre-checks only
  YouTube platforms for a reviewer's own fresh upload, instead of the
  normal full 4-platform preset, since the others are disabled anyway.
- Content Settings: TikTok's connect card shows "Not available for this
  account" outright (its `/api/tiktok/status` fetch would just 401);
  cadence inputs, the base-link field, every non-YouTube caption
  textarea, the ambient-audio upload control and each track's Delete
  button, and the two remaining API-key inputs are all disabled for a
  reviewer — matching exactly what the server's allowlist/redaction
  above actually accepts.

**Credential:** `REVIEWER_PASSWORD=youtubeaccess`, set directly in
`ops-service/.env` on the VPS via SSH (Harvey's own choice of password,
matching this project's established "relaxed security, simple shared
password" precedent for internal/demo credentials, §44/§62).

This is a `server.js` change (real backend logic, route-level auth
changes), so per §93 it triggers a full rebuild+restart on the next
deploy — same standing caveat as every other backend change in this
file, since this session is the headless agent running inside the
container being restarted.

---

# 154. Real Bug: A Client's Own Stale Object Could Silently Revert Server-Computed Analysis Fields

Found while investigating a fresh report of the exact §146/§149/§151
symptom recurring — a real, unaudited-until-now video (`verticalvideodemo`,
piece #100) stuck in Processing, `analysisStatus: 'pending'` forever
despite its final (audio-spliced) video already having built
successfully. This time root-caused directly against the live VPS docker
logs rather than assumed to be the same already-fixed cause: the log
showed `runVideoAnalysis` genuinely started and got past its first real
step ("normalized video ... from hevc, to h264") — meaning
`analysisStatus` really was written to `'running'` in the database at
that point — but nothing else was ever logged for that piece again, and
the stored value had reverted all the way back to `'pending'`, a value
`runVideoAnalysis` itself never writes past its very first line.

**Real root cause — a full-record overwrite with no protection for
server-owned fields:** `PUT /api/store/pieces/:id` has always replaced
the entire stored record with whatever the client's request body
contains, no merge against what's actually in the database. The client's
own `pieces[id]` object is a single shared in-memory value, and
`maybeStartAnalysisPolling()`'s 3-second interval (§111/§142/§149) is
what's supposed to keep that local copy in sync with what the server's
background jobs have actually written — but there's a real window, from
the instant a video is uploaded until that poller's first tick, during
which the client's own copy is still whatever it set at creation
(`analysisStatus: 'pending'`). Harvey picking an audio track or toggling
a platform checkbox inside that window — completely ordinary, fast
actions while testing/filming — fires its own `Store.put('pieces', p)`
using that same stale object, and since the server just blindly replaces
the whole record, it silently reverted whatever `runVideoAnalysis` had
already written moments earlier. This is the write-side twin of the
read-side bug §142 already fixed in the client's own poller (which
stopped blindly replacing its local copy) — the server-side route had
the identical class of bug all along, just never triggered in a way
anyone had traced back this far before.

**Fix, `ops-service/server.js`'s `PUT /api/store/:storeName/:id`:** for
any update (not creation) to a `pieces` record with `hasVideo: true`, the
current database value always wins for `analysisStatus`, `analysisError`,
`analysisMatchedPieceId`, and `stage` — regardless of what the client's
request body says — since none of these are ever legitimately set by a
plain client edit once a video piece already exists (only by
`runVideoAnalysis` itself, or by the client at creation time, when
there's nothing yet to protect). Deliberately **not** applied to
`finalBuildStatus`/`finalBuildError`, even though they're also
server-written: the client legitimately sets `finalBuildStatus: 'pending'`
itself on every "Send to final check" click, including a deliberate retry
after a failure, and protecting that field would silently break the
retry path instead of fixing anything.

**Immediate relief, applied directly against the live piece** so Harvey
didn't have to wait for the deploy: piece #100 (`a9d36e9a-...`) had its
stuck `analysisStatus` set to `'error'` (with an honest explanation) and
`stage` moved straight to `final_check` by hand — its final video was
confirmed already built and untouched, so the card renders correctly.

This is a `server.js` change, so per §93 it triggers a full
rebuild+restart on the next deploy, bundled with §153's larger change
above (both were in flight in the same session).

Verified via `node --check`; the actual fix is reasoned from the log
evidence (a full local repro of the race would need controlling exact
request timing against a live upload) — worth confirming after this
deploys that a fresh upload followed immediately by an audio-track pick
or platform toggle no longer disturbs `analysisStatus`.

---

# 155. Content Production: Real Title Now Shown Everywhere, Not the Raw Filename; Video Chip Dropped From Normal Kanban Cards Too

Two smaller fixes from the same round of feedback as §154's bug report.

**Title.** Since §132 removed the "Full editor…" button from Content
Production, there was no remaining way to edit `piece.title` itself for
an in-production video — the row's own "Title" input (§131) only ever
wrote to `ytTitles`, so every card/row showing `piece.title` (the normal
kanban card, the Content Production row's own head) kept displaying the
raw uploaded filename forever, no matter what Harvey typed. Fixed in
`buildUploadRow()`'s title-input handler: once a real title's been
typed, `piece.title` is set to match it (falling back to the
filename-derived default only while the field is genuinely still
empty), and `refreshHead()` — already called on every keystroke for the
"titles selected" tag — now also updates the row's own visible title
line for free.

**Video chip.** `chipHtml()`'s "▶ video" chip is now hidden on every
normal kanban card (`cardHtml()`), not just Final Check cards (§135
already made that same call there — "theyre literally all videos").
Every card that would show it already has a thumbnail image and an
"Auto · <stage>" badge making it obviously a video; the chip was pure
redundant noise once a video piece had progressed off ideation-stage
manual cards.

Frontend-only (`app.js`), so per §93 this is already live — no
deploy/restart needed.

---

# 156. Voice/Chat App: TODO — Show Which Turns Ran on Subscription vs. API Usage

**Superseded 2026-09-21:** Harvey explicitly dropped this request after
removing the credit-based setup. Do not build the usage-source indicator
described below unless he asks for it again.

Harvey asked, separately from everything else in this session, for the
Project Manager (voice/chat) UI to make it "unmissable" which turns are
running on his Claude subscription versus metered API credits. **Not yet
built** — flagged here so it isn't lost, to be picked up as its own pass
rather than folded into the reviewer-access/stuck-piece work above.

What's known already: per §74, the headless runner authenticates via
`CLAUDE_CODE_OAUTH_TOKEN` (Harvey's own subscription, generated via
`claude setup-token`) — there is currently no `ANTHROPIC_API_KEY` path
configured at all, so as things stand *every* Project Manager turn runs
on the subscription, not a mix of the two. Worth confirming this is
still true (nothing else in the container's env has changed that) before
building any indicator — if only one auth mode is actually ever in play,
the "unmissable" UI need might really be a one-line confirmation
("Running on your Claude subscription") rather than a per-message
badge distinguishing two modes that don't currently both exist. If a
mix is ever introduced (e.g. a future fallback to a metered key), the
`stream-json` event stream `claudeRunner.js` already parses would need
to be checked for whether Claude Code's own CLI output actually
surfaces which credential path a given turn used at all — this hasn't
been researched yet.

---

# 157. Project Manager: Claude/Codex Selector, Shared Thread, and Host-Native Codex Runner

The Project Manager now supports both the existing Claude Code agent and
OpenAI Codex without replacing or weakening the Claude path. Desktop and
`voice-mobile.html` each have a compact Claude/Codex selector. The choice
is stored server-side in the single-row `voice_preferences` table, so it
survives reloads and stays synchronized across devices. New
`voice_messages` rows record their `agent` (old rows migrate to `claude`),
and both clients use that field to render labeled, differently colored
`Claude:` and `Codex:` response bubbles, agent-specific working text, and
agent names in the task list. The message history remains one shared
cross-device stream.

The agents keep separate native resumable conversations in the existing
single-row `voice_session`: `claude_session_id` is unchanged and
`codex_session_id` is new. A new conversation clears both IDs while
leaving the selected-agent preference alone. When Harvey switches agents,
`buildCrossAgentContext()` supplies the newly selected agent with completed
other-agent exchanges since its previous turn (or a bounded recent window
on its first turn). This preserves conversational continuity in the one
visible thread without pretending Claude and Codex use the same native
session format.

**Codex execution architecture.** `src/codexRunner.js` starts the Codex
CLI on the VPS host through the container's already-established audited
SSH path (`ubuntu@host.docker.internal` plus passwordless `sudo -H`). It
runs from `/srv/realitymanual-repo` with
`codex exec --json --dangerously-bypass-approvals-and-sandbox`, then uses
`codex exec resume` for later turns. This keeps Codex authentication and
thread storage in root's existing host-level Codex home; no token or other
credential is copied into the container or committed. It also means Codex
naturally has the requested host view of the repository, Docker, Nginx,
systemd, logs, and filesystem. It inherits root's persistent Codex config,
currently GPT-5.6 Sol with medium reasoning and full access. Optional
`CODEX_HOST*` environment variables in `.env.example` document the paths
without containing secrets.

The runner parses Codex's JSONL events into the existing Project Manager
contract: the first agent message becomes `early_ack`, command/reasoning/
file/MCP/web events append to `activity_log` while the turn runs, and the
last agent message becomes the final response. Image uploads remain the
same browser/API feature; for Codex their `/data/uploads/...` path is
translated to the corresponding host path under
`/root/ops-service-data/uploads/...`, passed with `-i`, and deleted after
the turn. Claude still receives its existing base64 image block and still
runs through the unchanged Agent SDK route.

**Recovery discipline followed:** the live `rm-ops-service` container was
left untouched while a separate image/container on port 4011 was built and
tested. In that staging container, Codex passed a first turn, native resume
turn, image turn/cleanup, real host-command activity streaming, and
read-only checks of Docker, `nginx -t`, systemd, the host filesystem, and
host logs. A deliberately deleted Codex thread also exercised the stale-
session fallback (`no rollout found`) and retried successfully as a fresh
thread. The unchanged Claude route also completed a real turn, and a
Claude turn correctly recovered `IMAGE_OK` from the intervening Codex
exchange through the shared-context bridge. A real headless Chromium test
at desktop size and 390×844 mobile size verified both labels/colors, both
selectors, persistence across reload, and selector propagation from mobile
back to desktop. Syntax checks, `git diff --check`, and an independent
Docker build also passed before deployment.

---

# 158. Agent-Aware Project Manager Speech: Claude/ElevenLabs and Codex/OpenAI

Project Manager speech output is now routed through a small provider adapter
instead of every response going directly to ElevenLabs. The default mapping is
configuration, not a permanent agent/provider coupling:

```
Claude -> ElevenLabs
Codex  -> OpenAI Audio API (`gpt-4o-mini-tts`, `cedar` voice)
```

Claude's existing behavior is preserved: microphone uploads still use the
unchanged ElevenLabs transcription path, and Claude early acknowledgments and
eligible final replies still use the existing ElevenLabs synthesis function.
Codex never falls back to ElevenLabs. Its TTS endpoint requires the ID of a
completed Codex `voice_messages` row and obtains the text from that database
row, rather than trusting browser-supplied text. This makes the boundary
server-enforced: only the final user-facing Codex reply can be spoken, never an
early acknowledgment, shell command, reasoning/activity event, log, or error.
The OpenAI response is piped to the browser as it arrives; browsers with MP3
MediaSource support begin playback incrementally and others safely use the
existing complete-Blob playback approach.

Codex agent authentication remains the host's ChatGPT login. OpenAI speech is
a separate API service and requires `OPENAI_API_KEY` in the uncommitted
`ops-service/.env`; no API key is passed to the Codex CLI or browser. If the key
is absent, Codex speech returns `503 openai_tts_not_configured` and does not
fall back to ElevenLabs. `VOICE_TTS_PROVIDER_CLAUDE` and
`VOICE_TTS_PROVIDER_CODEX` make the mapping changeable later, while
`OPENAI_TTS_MODEL` and `OPENAI_TTS_VOICE` hold the OpenAI speech settings.

Harvey supplied the separate OpenAI API key on 2026-09-21 and it was installed
only in the uncommitted VPS environment. The first real request proved that
Spruce is a ChatGPT voice rather than an Audio API voice: OpenAI returned HTTP
400 and its supported-value list omitted `spruce`. Codex speech therefore uses
the supported OpenAI `cedar` voice; it remains entirely on OpenAI and never
falls back to ElevenLabs.

The host `/root/.codex/config.toml` now explicitly persists
`model = "gpt-5.6-sol"`, `model_reasoning_effort = "medium"`,
`sandbox_mode = "danger-full-access"`, and `approval_policy = "never"`.
Project trust entries were preserved, ChatGPT authentication remains in use,
and an explicit `codex -m ...` override still changes the model for a manually
requested session.

Verification used an isolated `rm-ops-codex-tts-test` container and a local
streaming OpenAI-compatible mock, leaving the production container untouched
until deployment. Route tests proved the exact OpenAI request used Spruce,
Codex made zero ElevenLabs calls, Claude made zero OpenAI calls, and missing
OpenAI credentials failed closed. Real ElevenLabs synthesis and transcription
both succeeded. Headless Chromium tested desktop and 390×844 mobile layouts,
selector persistence/reload, manual playback for each provider, and microphone
turns through both agents. The OpenAI mock received only completed Codex reply
text. Finally, the staging backend was restarted: its Codex native session ID
survived, the resumed turn recalled prior context, ran host `pwd` and
`docker ps`, and its rollout recorded GPT-5.6 Sol with medium reasoning.

---

# 159. Desktop Project Manager Agent Selector Moved Above the Chat Column

The desktop Claude/Codex selector now sits in the left Project Manager column,
directly above the shared conversation, rather than in a full-width toolbar
that visually placed it over the right-side Task List. The Mobile view and New
conversation controls share that left-column toolbar. The standalone mobile
page keeps its existing compact selector placement and all selection,
persistence, routing, and message-history behavior is unchanged. This is a
frontend-only layout change, so §93's live-working-tree deploy path applies.

---

# 160. TTS Play Buttons: Persisted Message Agent Is Authoritative

A stale Project Manager tab exposed a routing hole after the Codex TTS work:
the pre-agent version of `voiceClient.js` sent only speech text, so the backend
normalized the missing agent to Claude and could send a Codex reply to
ElevenLabs. The current Play buttons already send both `messageId` and `agent`,
but server routing now also treats the stored `voice_messages.agent` as
authoritative whenever a message ID is supplied. A caller cannot relabel a
persisted Codex reply as Claude or vice versa.

Agent-less requests without a usable message row now fail with
`tts_agent_required` instead of defaulting to ElevenLabs. This means a very old
still-open browser tab fails safely until it is refreshed; it can no longer
send Codex text to the Claude voice. The desktop and mobile HTML also
cache-bust `voiceClient.js` (and desktop `app.js`) so the next reload reliably
loads the agent-aware client. The TTS response exposes its resolved provider in
`X-RM-TTS-Provider` even when synthesis cannot start, which makes the fail-
closed OpenAI-key state directly verifiable without exposing any credential.

---

# 161. Ops Panel Favicon and Header Brand Cleanup

The main Content Studio page now uses the same `img/logo.png` mark shown on
its login card as the browser favicon. The redundant 16px copy of that image
beside the desktop header text “Reality Manual Content Studio” was removed
because it was too small to read. The larger diamond mark at the top of the
vertical navigation rail is unchanged. This is a frontend-only change.

---

# 162. Codex Progress Now Feeds Both Project Manager Status Panels

Codex already populated Activity with command starts/results, file changes,
reasoning summaries, MCP calls, and web searches, and its message appeared as
one active row in Task List. One meaningful stream was missing: Codex CLI
emits intermediate user-facing progress updates as `agent_message` JSONL
items, the same item type as its final answer. `codexRunner.js` kept replacing
the buffered final text with each newer message, so those interim updates
never reached either status panel.

The runner now keeps the newest agent message buffered as the possible final
answer and, when another arrives, sends the previous one to Activity as a
confirmed intermediate progress update. The first message remains the
`early_ack`/Task List title and is not duplicated. Thread-ready, turn-started,
turn-completed, and failure lifecycle events are also recorded, so Activity
is no longer blank during Codex startup or between tool calls. Hidden chain of
thought is not exposed; these are Codex's normal user-facing progress notes
and already-public tool events.

For an in-progress row, desktop and mobile Task List now show the latest
Activity line as a smaller live status beneath the stable task title. A
Codex-only prompt reminder asks for concise progress updates at major phases
of genuine multi-step work and use of its normal task tracker, while explicitly
forbidding manufactured plans for simple questions. Claude execution and its
existing Task List/Activity behavior are unchanged.

Verified in an isolated container with a fresh Project Manager database and a
real host Codex run. A three-phase read-only audit produced 21 persisted live
events: startup/session/turn lifecycle, shell starts and results, four distinct
phase updates, and completion; its final reply remained only in the chat.
Headless Chromium at desktop and 390×844 mobile sizes confirmed the active
Task List row showed the stable title plus its latest live status subline.

---

# 163. Content Ideation: Manuscript-Grounded Proposal and Learning Workspace

Content Ops now has a real **Content Ideation** leaf immediately after Content
Pipeline. It is an admin-only, responsive authoring workspace that maintains a
server-persisted target of ten active proposals. The desktop view uses dense,
expandable development cards; the mobile view changes those grids into a
single-column, touch-sized layout rather than shrinking the desktop board.

**Persistence and queue.** `src/ideationService.js` owns dedicated normalized
SQLite tables for ideas, immutable revision snapshots/diffs, feedback history,
weighted learning signals, the inspectable preference profile, provider
settings, and restart-recoverable jobs. Pending/running jobs recover as pending
after a backend restart. Generation runs in the background, and a vacant slot
shows its provider and generation state. Provider failures stay visible and
explicitly retryable; the service never silently falls back. Accepted work is
not placed in a second pipeline: it is transactionally written into the
existing `records`/`pieces` model with the normal stage, sequence, order,
platform preset, and `notesHtml`, plus compatible `ideationMetadata`. A guarded
status transition prevents duplicate transfers.

**Grounding and generation.** `src/ideationCorpus.js` reads the canonical root
`THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt` directly and understands its
`==PAGE N==` markers. Every alleged direct quote is normalized and checked
against that file; unverified text is discarded rather than displayed as a
quotation, and verified quotes receive the canonical page. The provider prompt
includes the compact learned profile, the current duplicate catalog, historical
format distribution, and representative Outline Completed records selected
from the longest/most-developed scripts plus examples of each content type. It
instructs the agent to read the full manuscript and follows the project-specific
concept → implication → human problem → well-being/life strategy → physical
book presentation → hook/script method. Runtime is recalculated server-side at
145 spoken words per minute plus a small allowance for explicit book/stage
interactions.
The saved content type is reconciled to generous runtime bands so a provider
cannot leave, for example, a five-minute script labelled as a one-to-three-
minute long-short.

`src/ideationProviders.js` is the provider boundary. Codex uses the existing
host runner and ChatGPT authentication (therefore the persistent GPT-5.6 Sol,
medium-reasoning, full-access defaults); Claude uses the existing independent
one-shot Claude Code subscription path. Both receive the same context and no
new API credential is required. The server-side Ideation selector defaults to
Codex and is deliberately independent of Project Manager's selector. Every
proposal and AI revision records the provider/model that actually produced it.

**Editing, revision, and learning.** Manual title, big-idea, hook, and script
changes save without AI, recalculate runtime, and create a revision snapshot.
Polling will not replace a card with unsaved wording. Feedback accepts typing
or the unchanged shared ElevenLabs transcription path and is append-only.
Implement Feedback uses the currently selected provider, tells it to preserve
unrelated/manual text, updates the same idea, moves it to the top, marks it
EDITED, and shows both a provider change summary and a line-level LCS add/remove
diff. The full revision chain survives reloads.

Signals are weighted rather than treated equally: explicit feedback/manual
rewrites/implemented feedback are strong; direct-to-completed is stronger than
outline-started; explained rejection is stronger than an unexplained rejection.
The underlying rows remain inspectable while bounded unprocessed batches update
a compact JSON preference profile. Transferred ideas are also reconciled with
their real Kanban piece so later progress through filmed/edited/uploaded/
scheduled/live becomes a positive learning signal once per stage.

**Verification.** A temporary container on port 4002 used a copy of the real
production database, the real manuscript/repository mount, and the real agent
credentials; production content was untouched. A real Codex run generated ten
distinct proposals and scripts, including verified quotations/pages and a
long-form piece. Manual editing, typed and real voice-transcribed feedback,
Codex revision, exact preservation of a manual marker, add/remove diff,
revision history, rejection, both Outline Started and Outline Completed
transfers, duplicate-transfer count, learned-profile persistence, replacements
back to ten, and backend-restart persistence were exercised there. The same
replacement path was also exercised with Claude to prove selector routing and
metadata without fallback. Headless Chromium at 1440×1000 and 390×844 found no
runtime errors or horizontal overflow and verified tab order, ten cards,
provider selection, EDITED state, history, and diff rendering. The committed
Node integration test covers the queue/edit/feedback/revise/transfer/reject/
learning/provider/restart lifecycle with deterministic provider doubles.

---

# 164. Project Manager Subscription Usage Dashboard

The desktop and standalone-mobile Project Manager agent selectors now include
a Usage button. It opens a responsive dashboard showing the allowance actually
reported by the two installed coding-agent accounts: Claude's five-hour and
weekly limits (plus model-specific weekly limits when Anthropic supplies them),
and Codex's primary/secondary rate-limit windows. Percentages are presented as
remaining allowance, with local reset times; the Codex card also shows the
configured model/reasoning level and both cards show their detected plan.

`src/agentUsage.js` performs both lookups on the VPS host through the existing
auditable SSH boundary. Claude's host-side helper reads Claude Code's own OAuth
credential and calls Anthropic's OAuth usage endpoint without sending the
credential back to the container. Codex starts its native app-server protocol
and uses `account/rateLimits/read` plus `config/read`. Only a normalized result
containing plan, percentage, reset, model, reasoning, and optional extra-credit
status reaches the browser; raw credentials and provider responses are never
returned. One provider failing does not hide the other. Results are cached for
two minutes, manual Refresh bypasses the cache, and completing a Project
Manager turn invalidates it.

The route is under the existing admin-only `/api/voice` middleware. This is an
informational display only: it does not change the selected agent, billing, or
credentials. The frontend is shared by desktop and mobile through
`public/lib/usageDashboard.js` and becomes a full-height sheet on mobile.

Verification used an isolated container on port 4011 with the real host SSH
boundary and real provider accounts. A forced refresh returned Claude and
Codex data together, including current percentages and reset timestamps; the
production endpoint was then checked again after the full backend deployment.

---

# 165. Content Ideation UX Stabilization and Doctrine-Grounded Generation

Harvey's first review of the ten generated proposals exposed a severe UI flaw:
the five-second state poll replaced the entire Ideation DOM even when the
server response had not changed. That reset the document and script-textarea
scroll positions, reopened the first card, and closed any other card, making
both desktop and mobile scripts effectively unreadable. Ideation now hashes
the returned state and does nothing when a poll is identical. When real state
does change, it preserves expanded-card choices, page scroll, and textarea
scroll. Card state therefore remains under the user's control while background
generation/revision polling continues.

The cards are intentionally much simpler. Manuscript sources, sections, pages,
verified-quote audit output, paraphrase audit output, and the entire Source
Treatment block remain available internally for grounding/verification but are
no longer rendered. Alternating card backgrounds make proposal boundaries
obvious. Field labels are larger and warmer, editor text is softer than pure
white on black, and the feedback microphone is a full labelled Record/Stop
control instead of a tiny unexplained dot. Future long-form cards show three
alternative titles near the start of the brief.

Generation now uses `src/ideationDoctrine.js`, a permanent compact map derived
from the manuscript: all fourteen named Rules of Reality plus the objective of
maximizing lifetime-average EWB, the five axes, emotional scoring, love,
God/oneness, Heaven/Hell on Earth, fulfilment versus dissolution, triple
alignment, FIRR, and enlightenment. Prompts require each proposal to use a
relevant rule/definition as part of the actual logical chain—often objective
→ rule → diagnosis → strategy—instead of treating source paragraphs as
isolated material. They explicitly identify a subconscious belief as a
crystallized emotional signature and encourage exact Rule numbers/names when
they clarify the argument.

Physical directions are now constrained: TURN/READ/SHOW only when a specific
passage or visual is genuinely used, and TRACE only for diagrams, never prose
or a paragraph. Generated scripts may not contain timestamps or timecoded beat
ranges. Existing active scripts are idempotently migrated to remove their
timecode prefixes while retaining useful headings. New and revised long-form
proposals require exactly three distinct alternative titles; those titles are
stored with the proposal and travel into pipeline metadata.

Verification included the complete Node service test, including doctrine
instructions, long-form alternative-title persistence, and timecode migration.
An isolated container on port 4012 used a safe copy of the production database.
Real headless Chromium tests at 1440×1000 and 390×844 closed the first card,
opened the second, scrolled its script, waited through a polling interval, and
confirmed expansion and scroll remained unchanged. They also verified distinct
alternating backgrounds, removal of source-audit UI, readable label sizing,
the larger microphone control, and removal of timecodes from the live copied
proposals.

---

# 166. Content Ideation Loading State Is a Centered Green Spinner

The initial Content Ideation fetch no longer reuses the red `idea-fatal` error
banner for normal loading. It now shows only an accessible green animated
spinner centered in the available page area; genuine load failures retain the
red error treatment. CSS and `ideation.js` are cache-busted together. A real
Chromium test delayed the live state request, confirmed the spinner was exactly
centered and green with no loading text or red banner, then confirmed the ten
proposal cards replaced it when the request completed.

---

# 167. Ideation Card Format/Runtime Label Readability

The compact format/runtime kicker at the top of each Ideation card (for
example, `SHORT · 1:01`) now uses a larger 0.78rem font, slightly tighter
tracking, and a brighter muted-green color. The provider/origin metadata stays
small so the useful format/runtime information has clear visual priority. The
stylesheet URL is cache-busted so the change appears on refresh.

---

# 168. Ideation Script Scroll No Longer Crosses the Panel Footer

An expanded Ideation card could overflow the fixed-height `.panel-main` while
the normal control-panel footer remained laid out at the bottom of the
viewport. Its top border then appeared as a horizontal line drawn directly
through the script while scrolling. `renderActiveTab()` now marks the main
panel while Content Ideation is active; that mode owns its vertical scrolling,
contains overscroll, and hides the irrelevant control-panel footer. Switching
tabs removes the mode, so other workspaces keep their existing layout. The
Ideation rerender-preservation logic now restores this panel's own scroll offset
as well as the document/textarea offsets. The stylesheet, `app.js`, and
`ideation.js` URLs are cache-busted together.

---

# 169. Implement Feedback Advances Focus and Queues the Revising Card

Implement Feedback no longer leaves a large expanded card occupying the
workspace while its provider runs. The revision route moves that idea's
persistent `sort_order` immediately behind the next active proposal and returns
the next proposal's ID. The browser collapses every other card, expands that
next proposal, scrolls it into view, and puts keyboard focus on its summary.
The submitted card therefore appears directly beneath it as a collapsed purple
`REVISING` card while work continues.

Revision completion now preserves that queue position instead of moving the
edited idea to the very top. It remains purple through the existing EDITED
state so Harvey can return to it deliberately after reviewing the newly focused
idea. If the final card is revised and has no successor, its position is left
unchanged and the preceding available proposal receives focus. The service integration test verifies the returned focus ID and the
persistent next-idea/revised-idea ordering; browser tests cover the collapse,
reorder, purple state, expansion, and focus handoff on desktop and mobile.

---

# 170. Project Manager Play Button Exposes Missing TTS Configuration

Codex reply audio was failing with no visible explanation: the live
`/api/voice/tts` request correctly returned HTTP 503 with
`openai_tts_not_configured`, because `OPENAI_API_KEY` is not present in the
production environment, but both desktop and mobile discarded every rejected
speech promise with an empty `catch`. `voiceClient.js` now preserves the
server's stable error code and a readable message. Both interfaces show a red
`OpenAI key needed` state on the exact Play button that failed (and a generic
`Audio unavailable` state for other synthesis errors) instead of appearing to
do nothing.

This UX fix does not weaken the deliberate provider boundary from §158: Codex
remains on OpenAI and does not silently fall back to ElevenLabs. Harvey later
supplied the OpenAI key directly; it is installed only in the VPS environment,
never committed. Real Chromium tests against the live desktop and mobile
interfaces confirmed the visible error state and explanatory tooltip on each.

---

# 171. Content Ideation Is Now a Big-Idea Queue, Not a Script Generator

Harvey rejected the full proposal/script workflow as premature: until the
system has more examples of content he has developed himself, Ideation should
surface only the valuable editorial premise and manuscript support. The
generation contract now explicitly forbids titles, hooks, scripts, outlines,
formats, runtimes, timestamps, camera directions, and production instructions.
Each result contains only:

- a self-contained two-to-five-sentence **Big Idea** connecting a recognizable
  real-world situation to a specific Reality Manual rule/pillar and practical
  EWB stakes;
- three to six **concepts / angles to mention**, which are prompts for Harvey's
  own thinking rather than ordered content beats; and
- one to four **direct manuscript quotes**, all passed through the existing
  exact corpus verifier and displayed with their canonical pages.

The prompt includes Harvey's relationship-anxiety example as a model of the
desired specificity and logical shape, explicitly not as an idea to repeat. It
retains the doctrine map, the learned preference profile, and the historical
duplicate catalog, but no longer feeds representative completed scripts back
into generation.

Cards now render this entire compact payload directly, with alternating
backgrounds and a single **Send to Ideation** action. There are no generated
titles or format/runtime labels, editable hook/script fields, feedback/revision
controls, source-audit blocks, or alternate destinations. Acceptance creates a
normal piece at the main Content Pipeline's `ideation` stage, with the Big Idea,
concepts, and verified quotes in `notesHtml` and structured
`ideationMetadata`; its required internal card label is derived from the first
sentence rather than generated as a separate title. Platform selection is
left blank and the normal short content type is only a pipeline-compatible
default for Harvey to change while developing the piece.

The database adds `discussion_angles` plus a one-time migration ledger. On the
first deployment of this version, existing full-script active proposals are
marked `superseded` rather than deleted (preserving their revisions, feedback,
and learning history), stale jobs are cancelled, and ten entirely new Big Idea
cards are generated. The service integration test covers generation, quote
verification, exact payload shape, Ideation-stage transfer, automatic queue
replacement, learning signal, provider persistence, and one-time migration.
Real Chromium tests at 1440×1000 and 390×844 verified the new card contents,
single action, absence of the old title/hook/script/revision controls, transfer
refresh, no runtime errors, and no horizontal overflow. A clean Docker image
build also passed before deployment.

---

# 172. Codex Long Turns No Longer Time Out or Leave an Active Thread Writer

Two consecutive Project Manager failures had one root cause. `codexRunner.js`
used a fixed twenty-minute wall-clock timeout. A legitimate long implementation
turn reached that limit and the runner killed only its local SSH client; the
host-side Codex process survived, retained the thread store's writer lock, and
continued outside the service's control. The serialized voice queue then
started the next message against the same stored thread ID, producing
`thread-store conflict ... already has an active writer`. The noisy SSH
known-host warning was unrelated but was included in the surfaced stderr.

Codex supervision is now host-aware:

- Project Manager turns use a four-hour **inactivity** watchdog, rearmed by
  every streamed stdout/stderr event, rather than a twenty-minute total runtime
  cap. Ideation generation uses the same semantics with a one-hour inactivity
  window. Active long turns therefore have no practical wall-clock limit.
- Every host invocation runs in its own process group and records the group
  leader in a narrowly named `/tmp/rm-codex-<owner>.pid` file. Before a new
  Project Manager turn starts, it validates and terminates any surviving group
  from that same dedicated owner lane. If the inactivity watchdog ever fires,
  it terminates that exact host process group (TERM, bounded wait, then KILL),
  waits for cleanup, and only then allows the queue to advance.
- The PID is validated against the configured Codex executable before any
  signal is sent, so a stale/reused PID cannot target an unrelated process.
  The SSH client now uses `LogLevel=ERROR`, removing the harmless permanent-host
  warning from failure text.
- If Codex still reports an active-writer/session-store conflict (for example,
  one left by the pre-fix runner), the server clears that stored thread and
  retries the message once in a fresh session instead of presenting the raw
  conflict to Harvey.

Validation included shell-syntax checking of the generated nested remote
supervision command, a real host Codex smoke turn through the SSH wrapper, and
a forced one-second inactivity test around a thirty-second Codex shell command.
The forced stop returned only after the host process group was gone and its PID
file had been removed, proving the failure cannot leave the writer that caused
the second error.

---

# 173. Kanban Rough Ideas / Big Ideas Stage and Generator Learning Loop (2026-09-21)

The Content Pipeline's `ideation` stage is now labelled **Rough Ideas**, and a
new manual **Big Ideas** stage (`big_ideas`) sits immediately after it and before
Outline Started. The existing internal stage ID remains `ideation` so old cards,
quick-add records, and transferred generator proposals need no migration. Quick
Add and Content Ideation now say “Save/Send to Rough Ideas” to match the board.

Big Ideas is also a deliberate learning signal, not just a visual column. The
server compares the persisted stage on every admin piece write. Creating a card
in Big Ideas or moving one there records one strong `curated_big_idea` signal
containing the title, plain-text notes, content type, prior stage, generator
origin/metadata when present, and concepts-to-discuss. Reviewer-owned test
content is excluded. Ordinary edits while the card remains there do not create
duplicate signals.

A dedicated `ideation_big_idea_examples` table keeps the latest full snapshot
for each curated piece. This matters because a newly created card may first
autosave after only its title has been entered: later note/title edits update the
same exemplar, so the generator sees the finished framing rather than an early
partial draft. These current examples are included directly in every generation
prompt, with instructions to study transferable framing, reasoning structure,
tension, and practical stakes without copying wording or merely generating
adjacent topics. The existing persistent preference-profile job also treats
selection into Big Ideas as a strong signal and now maintains explicit framing,
structure, and selection-rationale patterns. Pipeline-progress learning includes
the new stage in its rank order.

Verification covered syntax and the complete Node integration suite, including
signal persistence, one-signal-per-entry behavior, live exemplar updates, and
profile rebuilding. An isolated local service/database plus real headless
Chromium at 1440×1000 verified the exact column order, creating directly in Big
Ideas, moving a Rough Idea via the real card dropdown, editing the created card
after its first save, zero page errors, no horizontal overflow, exactly two
selection signals for the two actions, and two current exemplar snapshots.

---

# 174. Codex Project Manager Turns Survive Backend Deploys (2026-09-21)

Backend deploys used to replace the `rm-ops-service` container while a Codex
Project Manager turn was still running. Codex itself runs on the VPS host and
usually survived, but the container owned the only copy of its event stream.
On startup, `recoverInflightVoiceMessages()` therefore had no authoritative way
to know whether the work finished and rendered a red “completion status
unknown” error even when Codex had completed successfully.

Project Manager Codex runs now tee stdout JSONL and stderr into per-message
files under the bind-mounted data directory (`/data/codex-runs` in the
container, `/root/ops-service-data/codex-runs` on the host). GNU tee is run in
`warn-nopipe` mode so losing the old container's SSH output pipe does not stop
the host process or its durable journal. The host wrapper atomically writes an
exit marker only after Codex ends.

On startup, a running Codex message with those artifacts stays in the normal
running state. The new service serially reconnects to its journal, adds a
visible Activity update explaining the reconnection, waits for the exit marker,
restores the Codex thread ID, and records the real final agent message as the
normal completed reply. Later queued messages remain behind it, preserving the
single-writer guarantee. Artifacts are removed after the database has recorded
success or failure. Old/pre-feature turns and Claude turns still use the
conservative unknown-status error because they have no surviving authoritative
event stream and must not be blindly replayed after possible side effects.

Verification includes syntax checks, the full Node test suite, and dedicated
recovery tests for an already-completed journal, a journal that completes after
the replacement watcher attaches, and a genuine failed host run. The new paths
are documented in `.env.example`; production uses their defaults and requires
no new credential or service.

---

# 175. §174's Own Deploy Broke Every Codex Turn With EACCES (2026-09-21)

§174 shipped and immediately took down Codex entirely — every real Codex
message after that deploy failed with `EACCES: permission denied, open
'/data/codex-runs/<id>.jsonl'`, including Codex's own attempt to respond to
being told about it (the exact self-inflicted chicken-and-egg this produced:
Codex couldn't fix its own bug because hitting the bug was the first thing
its own turn tried to do). Harvey asked Claude to fix it, framed simply as
"fix what codex broke."

**Root cause, confirmed against the live VPS, not guessed:** §174's
`initializeRunFiles()` runs inside the container as the non-root `node` user
(uid 1000) and does `fs.mkdirSync('/data/codex-runs')` +
`fs.writeFileSync(paths.journal, '')` — but that path is a bind mount shared
with the *host*, where the actual Codex process writes into the same
directory as **root** (via the `sudo -H sh -c ...` wrapper `codexRunner.js`
already uses for every host invocation). Whichever side happened to create
the directory first left it too restrictive for the other: on the live VPS,
`/root/ops-service-data/codex-runs` ended up `root:root`, mode 755 — which
let `node` traverse and read it, but not create new files in it, so every
subsequent Codex turn's local pre-touch threw EACCES before `ssh` was even
spawned, well before the actual Codex host process (which would have worked
fine, root can always write there) ever got a chance to run.

**Fix, both in `ops-service/src/codexRunner.js`:**
- `initializeRunFiles()`'s local pre-touch is now wrapped so a permission
  failure there can never abort the turn — it's genuinely optional. The
  *live* run is parsed straight from the `ssh` child process's own stdout,
  never from these files; the journal/stderr files only matter for
  recovering a completion after a mid-turn service restart (§174), and the
  host-side `tee` (running as root) creates them regardless of whether this
  local pre-touch succeeded. Best-effort `chmod 777` calls on the directory
  and files are still attempted first (harmless when they work, silently
  skipped when this process doesn't own whatever's already there).
- `buildRemoteCommand()`'s host script — which already runs as root via
  `sudo` — now also does `mkdir -p <dir>; chmod 0777 <dir> 2>/dev/null;`
  immediately before every Codex invocation, so the shared directory
  self-heals to permissive on every single turn regardless of which side
  created it or last narrowed it. Root can always chmod it, whoever
  currently owns it.

**Immediate relief, applied directly on the VPS** (didn't wait for a
redeploy): `sudo chmod -R 0777 /root/ops-service-data/codex-runs` — Codex
turns work again right now, independent of when this code fix actually
deploys.

This is a `src/*` change, so per §93 it triggers a full rebuild+restart on
the next deploy — same standing caveat as every other backend change in
this file. Logged to the work log immediately before pushing.

Verified: `node --check` on the touched file, the full existing Node test
suite (all 4 suites, including §174's own recovery tests) still passes
unmodified, and a `bash -n` syntax check against the actual generated
remote command string (built with a realistic runKey/paths) confirms the
new `mkdir`/`chmod` prefix nests correctly through the existing multi-layer
shell-quoting without breaking it. **Not yet re-verified with a real live
Codex turn after the code deploy** (the manual VPS chmod already unblocks
things independently of that) — worth confirming after the next deploy
that a fresh Codex turn still succeeds even if the directory somehow
reverts to a restrictive owner again.

---

# 176. Claude Project Manager Turns Also Survive Backend Deploys (2026-09-21)

§174 fixed this for Codex only; Harvey asked (before §175's EACCES bug even
existed) for Claude to get the same treatment "regardless of which model
being used" — that request itself had errored out instantly on the EACCES
bug without ever reaching this work. Claude's actual gap was structurally
different, and worse, than Codex's ever was: Codex already ran as a
host-side process (§157), so §174 only had to fix how its *event stream*
was recovered. Claude's voice turns ran the Agent SDK **in-process, inside
this container** (a deliberate choice — see the old top-of-file comment in
claudeRunner.js — keeping one long-lived streaming session alive across
many messages specifically to avoid a full CLI cold start on every single
one). That process died the instant the container did, with nothing left
on the host to reconnect to at all; every Claude turn caught mid-flight by
a redeploy was unrecoverable by construction, always bouncing to the
conservative "completion status unknown" error.

Asked which of two fixes he wanted — mirror Codex exactly (simple, but
reintroduces the per-message cold start) or build a genuinely persistent,
reattachable host-side session (keeps the current speed, but is a much
larger, more novel piece of engineering with no existing pattern in this
codebase) — Harvey chose the simple one: "you make the call... speed isnt
super important."

**What changed:** `claudeRunner.js`'s voice-turn path (`runClaude`,
`recoverClaudeRun`, `hasRecoverableRun`, `cleanupRun`) now mirrors
`codexRunner.js` structurally, including §175's permission hardening from
day one: the real `claude` CLI runs once per turn as a host-side SSH
process, teed into a durable JSONL journal on the same bind-mounted data
directory pattern (`/data/claude-runs` in the container,
`/root/ops-service-data/claude-runs` on the host). The old in-process
session singleton (`currentSession`, `createMessageQueue`, `ensureSession`,
`handleEvent`) is gone entirely; `resetSession()` is kept as a documented
no-op so its one existing caller in server.js didn't need touching.
`runOneShot()` (video-analysis's unrelated one-shot in-process call) is
untouched. `server.js` now branches on `agent` symmetrically for run-key
generation, recovery on startup (`recoverInflightVoiceMessages`), and
cleanup, generalizing the old Codex-only `recoverCodexVoiceMessage` into
`recoverAgentVoiceMessage(id, agent)`.

**Real differences from Codex's version, not oversights:**
- Codex escalates to root on the host via `sudo` (it needs root). Claude's
  `--allow-dangerously-skip-permissions` is refused outright under EUID 0
  (see the Dockerfile's own comment on this), so its host command runs
  directly as the non-root `ubuntu` user — no sudo layer at all.
- Claude's host-side `$HOME` is **not** `ubuntu`'s own real one. That's
  Harvey's personal interactive Claude Code identity/session history on
  this VPS (confirmed live during this session: authenticated, real
  `~/.claude` with active session data) — resuming into it directly would
  have mixed Project Manager voice-chat turns into Harvey's own terminal
  history and vice versa. Instead, `CLAUDE_HOST_HOME`
  (`/root/ops-service-claude-home/host-identity` by default) is a small
  directory whose `.claude`/`.claude.json` are symlinks onto the exact same
  files already bind-mounted into the container at `/home/node/.claude`
  and `/home/node/.claude.json` — the same identity the old in-process
  runs already used, kept fully isolated from `ubuntu`'s personal one.
  `deploy.sh` now creates this idempotently on every deploy so it isn't a
  silent one-off left only on disk.
- Session continuity required matching **cwd**, not just the identity
  directory: Claude Code's session store keys conversations by working
  directory, and the in-container runs always used cwd `/repo`. A
  host-side process cd'd into `/srv/realitymanual-repo` directly would
  have looked for `9366b942-...` (an already-live real session id) under
  the wrong project bucket and failed to resume it. Fixed with a `/repo`
  symlink on the host pointing at `/srv/realitymanual-repo`
  (`deploy.sh` now (re)creates this too) — confirmed directly with a real
  `--resume <id> --fork-session` call against the actual live session
  before writing any code: it correctly recalled prior conversation
  content.
- Auth: the host `claude` CLI otherwise reports "Not logged in" even with
  the right `$HOME` — it needs `CLAUDE_CODE_OAUTH_TOKEN` in the actual
  process environment (same variable already in `ops-service/.env`),
  passed through the ssh command the same way the container already
  receives it via `--env-file`, not read from any stored credentials file.
- Images: the host `claude -p` has no equivalent of Codex's native `-i
  <path>` attachment flag. Rather than block this on building one, an
  attached image is handed over as a plain host-reachable path appended to
  the prompt text ("...view it with your Read tool"), which already
  supports reading images directly — server.js's upload route now computes
  that host path for both agents instead of only Codex, and the old
  base64-inlined `imageBlock` content-block path is gone entirely.

**Verified:** `node --check` and `bash -n` on every touched file; the full
Node test suite (new `claudeRunner.test.js`, mirroring §174's Codex
recovery tests, plus all pre-existing suites) passes. Before writing any
runner code, the exact host invocation shape (flags, isolated `$HOME`,
token-via-env auth, and `--resume`/`--fork-session` continuity against a
real live session) was hand-verified directly on the VPS as root — not
assumed from `--help` text alone.

---

# 177. Big-Idea Method Reverse-Engineered From the Manuscript and Completed Outlines (2026-09-21)

Harvey asked for a detailed read of the complete manuscript and every card in
Outline Completed, followed by a real formula for the kind of “big idea” the
Content Ideation panel is supposed to produce. The review covered the full
180-page canonical manuscript and all 31 completed outlines in the live
production database—not merely their titles or a sample of long-form scripts.

The important distinction is now explicit: a subject such as procrastination
is only a topic, and a teaching such as the Rule of Subconscious Action is only
a manuscript concept. A Big Idea is the editorial claim produced when the
manuscript's machinery is used to reinterpret a recognizable human situation
in a way that changes a diagnosis, decision, or strategy. The common structure
across Harvey's completed work is:

```text
recognizable situation
  + hidden/default assumption
  + manuscript mechanism
  + non-obvious logical turn
  + strategic consequence
  + concrete emotional-well-being stakes
```

`ops-service/src/ideationBigIdeaMethod.js` now holds the complete, inspectable
method supplied to every generation run. It describes an explicit six-step
derivation process and eight reusable operators found across the completed
outlines: redefine, invert, compress, transfer, synthesize, extremize,
diagnose, and resolve an objection. It also records the deeper house patterns:
start in the audience's world rather than the book; prefer causal mechanisms
to inspiration; distinguish inputs from outputs and ends from proxies; look
for category errors; derive second-order implications; preserve boundary
conditions; expose the lifetime/EWB cost of the mistaken model; and finish at
a practical strategic lens rather than mere surprise.

The prompt also applies a silent seven-axis quality gate (human relevance,
non-obviousness, manuscript specificity, derivational rigor, strategic
usefulness, EWB stakes, and distinctiveness). Any candidate weak on the real
logical turn, rigor, or usefulness—or scoring under 27/35 overall—is to be
discarded before output. Rule restatements, chapter summaries, generic
self-help, mechanism-free provocations, and old outlines with substituted
nouns are expressly rejected.

This is deliberately a distilled reasoning method rather than the 31 scripts
being injected wholesale into each prompt. The latter would consume large
context, encourage stylistic imitation, and overweight the longest outlines.
Harvey's live Big Ideas column and learned preference profile remain the
adaptive layer (§173); this new module supplies the stable editorial machinery
beneath that learning loop.

Verification: syntax checks passed for the new module and changed service, the
full ops-service Node suite passes (8/8), and the ideation integration test now
asserts that the derivation formula, operator set, and rejection threshold are
actually present in the provider prompt.

---

# 178. Big-Idea Method Corrected: Simple Conceptual Reframes, Not Clever Micro-Applications (2026-09-21)

Harvey rejected the first §177-generated batch outright. The earlier method
mistook detailed specificity for the desired sophistication and produced narrow
micro-applications (unwanted gifts, missing a workout, unfinished task lists,
lifestyle inflation, guilt while resting, online arguments). Those were
defensible applications of the manuscript, but they were not the kind of “Big
Idea” Harvey means.

Harvey supplied the intended reductions of four of his own completed outlines,
which were then checked against the full source cards in the production DB:

- **#022, The Relevant Question:** failure to act is not fundamentally a lack
  of discipline; the useful question is which incompatible subconscious belief
  is making the action physically unavailable.
- **#035, The Most Powerful People Have Mastered This:** power is not control
  over others, but insusceptibility to external events that ordinarily disturb
  one's internal state.
- **#034, Understand This & You Can Sell Anything:** businesses do not really
  sell products or services; those are proxies for the emotional transformation
  the customer purchases.
- **#028, Why A Super-intelligent Alien Race Would Never Invade Or Harm
  Humanity:** a genuinely superintelligent extraterrestrial civilization would
  understand and practice the Rule of Oneness, so humanity need not fear it.

The common method is substantially simpler than §177's framework:

```text
familiar subject/question
  → manuscript-based reframe
  → minimum necessary reason
```

The reframe itself is the Big Idea. It should normally fit into one to three
sentences and be repeatable in one breath. It starts with a broad concept or
conversation people already care about, uses the manuscript to replace the
usual definition/question/frame, and stops as soon as the new conception
clicks. Examples, proof, qualifications, strategy, and development belong in
the eventual outline, not the Big Idea. A genuinely broader long-form premise
may take up to six sentences when the causal bridge requires it.

`src/ideationBigIdeaMethod.js` was completely replaced—not amended—with this
method and Harvey's four canonical examples. It expressly rejects contrived
domestic/lifestyle scenarios, intricate multi-move theses, advice, therapeutic
interventions, pre-written outlines, and padding. `ideationService.js`'s own
surrounding prompt was changed to agree with the new definition and length
instead of fighting it with §177's previous “specific practical situation”
framing. The integration test now asserts the new formula, examples, negative
constraints, and concise length contract. Full Node suite: 8/8 passing.

---

# 179. Integrated Desktop Manuscript Reader and AI Semantic Finder (2026-09-21)

Harvey wanted the complete Reality Manual inside Content Studio so ideation and
outline work no longer requires keeping the manuscript PDF open in another
window. The desktop icon rail now has a book icon pinned to its bottom. It is a
rail-only destination—deliberately absent from the ordinary product-area tabs
and from the mobile UI—and opens a reconstructed ivory two-page book spread.

The reader serves the canonical 180-page
`THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt`, preserving its real page numbers
while removing `*IMAGE:` descriptions and page delimiter metadata from the
reading view. A numeric Page field with Go and previous/next-spread controls can
open any requested page; odd/even alignment keeps the requested page visible on
the physically appropriate side, including a blank verso beside page 1.

The left-hand finder is deliberately not a keyword filter. Each natural-language
query becomes a persistent `manuscript_search_jobs` row and is processed in the
background by the currently selected Ideation AI provider (Codex by default).
The provider is instructed to inspect the canonical manuscript by meaning,
including related Rules, arguments, definitions, implications, and examples
whose vocabulary differs from the query. It returns 3–8 ranked passages with a
page, concise relevance explanation, and exact excerpt. The server rejects
invalid/duplicate pages, verifies excerpts against the claimed page (falling
back to real page text rather than showing fabricated copy), caches identical
completed queries, and returns in-progress jobs to `pending` after a service
restart. Clicking any result opens the corresponding spread.

Implementation lives in `src/manuscriptService.js` (authenticated page/search
API and durable worker), `public/manuscript.js` (reader/search interaction), and
the dedicated reader styles in `public/style.css`. The complete API is
admin-only because it exposes the full manuscript; the reviewer role cannot see
the rail icon and is redirected if it hand-edits the hash.

Verification: all touched JavaScript passes syntax checks; the new integration
test proves page pairing, diagram removal, background AI-job completion, result
validation, semantic-search prompting, and completed-query caching; the full
ops-service suite passes 9/9. The final check used headless Chromium against the
real deployed `ops.realitymanual.com`: the bottom book icon opened page 1,
direct entry of page 34 rendered the 34–35 spread with no diagram marker, and a
natural-language query about knowing what action to take but being unable to do
it returned seven AI-ranked passages. Its first result was page 110, and clicking
it opened the 110–111 spread. This verifies the actual DOM/navigation/search
loop rather than merely proving that the JavaScript parses, per §123.

---

# 180. Manuscript Spread Fits the Viewport and Turns from Its Page Edges (2026-09-21)

Harvey found the first integrated reader slightly too tall: longer pages pushed
the bottom edge and printed page numbers below the visible viewport. The spread
now has a smaller, fixed viewport-relative footprint instead of expanding with
its text. Because canonical pages vary in word count, `manuscript.js` measures
each rendered page and reduces only that page's type in quarter-pixel steps
until its final line fits above the page number; shorter pages retain the normal
reading size. The reader stage itself no longer scrolls, while the independent
search-results column still does.

The outer 56 pixels of each physical page are now full-height Previous/Next
buttons. Their arrows remain subtle until hover/focus, but the entire edge is a
real mouse/touch target with accessible labels. Boundary controls disappear on
the first/last spread, and the toolbar arrows remain available as before.

Verified against the live DOM in headless Chromium at 1440×900: on the dense
110–111 spread the book bottom was at y=874, its printed page number at y=853,
and the viewport/stage bottom at y=900. Clicking the right edge opened 112–113;
clicking the left edge returned to 110–111. All 9 backend tests still pass.

---

# 181. Big Ideas Can Be Edited and Dictated In Place (2026-09-21)

The Content Ideation cards no longer render the generated premise as immutable
display text. Each card now has an auto-growing Big Idea editor, an explicit
Save changes button, a Dictate button, and inline states for unsaved, listening,
transcribing, saving, saved, and microphone errors. Typed changes remain local
until Harvey deliberately saves them.

Dictation is an editing input, not an autonomous rewrite: it inserts speech at
the current caret/selection, leaves the resulting text visible for review, and
does not save automatically. Chrome/Edge use live browser speech recognition;
other capable browsers fall back to the existing MediaRecorder + ElevenLabs
transcription endpoint. The microphone button becomes Stop while recording.

`PUT /api/ideation/ideas/:id` persists the edited premise, regenerates its
internal label, marks it edited, increments its revision number, and stores a
`manual_edit` snapshot plus before/after data in `ideation_revisions`. Sending
the card to Rough Ideas therefore uses the saved revision rather than the
original generated premise.

Verification: the ideation integration test now edits a generated premise,
checks its revision record, transfers it, and confirms the edited sentence is
in the resulting piece. The full Node suite remains 9/9. A Chromium DOM test
used a synthetic idea and simulated Web Speech Recognition (so no production
idea was modified): typed copy plus dictated copy appeared together in the
textarea, and the Save request contained exactly that reviewed combined text.

---

# 182. Direct Big-Idea Feedback and Manual Rewrites Train Future Generations (2026-09-21)

Harvey correctly expected direct feedback on a Content Ideation card to teach
the generator. The database still had the original `ideation_feedback` table,
but the Big-Idea-only redesign had removed both its API/UI and its connection
to the preference-profile worker. Before this change, only moving a piece into
the Kanban's Big Ideas column (plus later pipeline progress) trained the current
generator; comments and manual edits in the Ideation panel did not.

Every active Big Idea card now includes a Direct feedback field, its own
Dictate control, a Teach generator button, and permanent feedback history.
Submitting feedback stores the exact comment with the exact idea/context it
refers to, records an `explicit_feedback` signal at full strength, and
immediately queues a preference-profile update. Typed/dictated source is
preserved. Dictation remains reviewable before submission.

Saving a manual rewrite now also records a full-strength `manual_rewrite`
learning signal containing the before/after premise and its supporting angles.
The profile prompt expressly treats direct feedback as an instruction and a
rewrite as a contrastive demonstration: it should learn transferable changes
in framing, simplicity, emphasis, structure, or reasoning rather than merely
memorizing that idea's topic or wording. These learned likes, avoids, framing
patterns, and structural patterns are included in all subsequent generation
prompts through the existing preference profile.

The profile queue also now detects feedback arriving while a profile job has
already snapshotted its inputs and schedules one follow-up pass. This closes a
subtle race that could otherwise leave a newly inserted signal unprocessed.

Verification: the integration suite proves that voiced direct feedback and
manual rewrite signals retain the idea context, reach the profile prompt, and
survive through transfer; full suite 9/9. A Chromium DOM test with intercepted
synthetic data confirmed typed + dictated feedback is submitted together as a
voice-sourced learning signal, without altering Harvey's production ideas.

---

# 183. Big Ideas Use Actual Rule Names, Never Roman-Numeral Labels (2026-09-21)

Harvey flagged “Under Rule XIV” as opaque: readers—including Harvey while
reviewing the queue—should see the actual concept name, such as “Rule of
Freedom,” not have to remember what a numeral refers to.

Rule naming is now a hard generation constraint. The doctrine map supplied to
the model no longer displays Roman numerals at all, the Big Idea prompt expressly
requires actual names and forbids numbered references, and normalization of
every generated premise/angle converts any numeral the provider emits anyway.
Verbatim manuscript quotations remain untouched because quotation accuracy
takes precedence over stylistic normalization.

A one-time migration corrects existing active cards as well: numbered Rule
references are replaced with their canonical names, each affected card receives
an auditable `rule_name_normalization` revision, and titles are refreshed from
the corrected wording. Harvey's instruction is also stored once as a global,
full-strength `explicit_feedback` signal, so the adaptive preference profile
learns the same requirement rather than relying only on a static prompt.

Verification covers the exact conversion “Under Rule XIV” → “Under Rule of
Crystallized Emotion,” “Rule VIII” → “Rule of Freedom,” and “Rule X” →
“Tripartite Rule”; confirms the doctrine section contains no numeric Rule
labels; and the complete Node suite passes 9/9.

---

# 184. Host-Side Claude OAuth Token Forwarding Regression Fixed (2026-09-22)

Claude Project Manager turns began failing immediately with “Not logged in ·
Please run /login” after the §176 migration moved the real Claude CLI process
from inside the container to the VPS host over SSH. The existing OAuth token
was still present and valid inside `rm-ops-service`; a direct host auth check
reported unauthenticated without that token and authenticated when it was
supplied. The isolated host `$HOME` and its symlinks were also intact.

The cause was an implementation/documentation mismatch in
`src/claudeRunner.js`: §176 and `.env.example` said the existing
`CLAUDE_CODE_OAUTH_TOKEN` was passed through the SSH command, but
`buildRemoteCommand()` only set `HOME`. An SSH child inherits the token in its
local container environment, but SSH does not automatically forward arbitrary
environment variables to the remote process. The host CLI therefore received
no usable authentication at all.

`buildRemoteCommand()` now requires the existing container token and explicitly
sets `CLAUDE_CODE_OAUTH_TOKEN` in the host-side Claude command alongside its
isolated `HOME`. No new credential, `/login`, `.env` edit, or use of Harvey's
personal host Claude identity is involved. A regression test replaces `ssh`
with a local stub and refuses to return a successful Claude event unless both
the variable name and a synthetic token reached the generated remote command;
this covers the exact boundary the original recovery tests missed.

---

# 185. Video Type Defaults to “Not selected” (2026-09-22)

New planned pieces no longer silently claim to be Shorts before Harvey has
chosen a video type. The shared piece editor now begins with a real “Not
selected” option and renders untyped cards with the same label instead of
falling back visually to Short. Changing a piece back to “Not selected” also
clears the platform preset that came from its prior type.

All non-video creation paths use the unset value consistently: New Piece,
Quick Add, and transfer from the Content Ideation panel. Existing deliberate
type selections are preserved. Actual uploaded video files are unchanged:
their type is still detected automatically from orientation and duration,
because that classification is based on the real video rather than a planning
default.

**Follow-up correction:** the first pass changed creation code but left the
old stored `contentType: "short"` value on existing Kanban cards, so Harvey
quite reasonably still saw Short throughout the board. An idempotent data
migration now clears that retired default on non-video cards in Archived,
Rough Ideas, and Big Ideas while preserving every later-stage type and every
actual video classification. New records carry
`contentTypeSelectionExplicit`: choosing a type in the editor sets it true,
whereas Quick Add and Content Ideation transfers leave it false. The generic
piece API also rejects an implicit Short sent by an older still-open browser
tab when creating or overwriting an otherwise-unselected early-stage card, so
the stale frontend cannot silently undo the correction. A deliberate Short
selection from the current UI remains Short.

---

# 186. Kanban Editor Dictation (2026-09-22)

The shared Kanban piece editor now has a microphone button in its header. It
targets whichever editable text area Harvey used most recently—Title or
Notes—and labels itself accordingly, so one compact control covers both rather
than permanently consuming space beside every field. Dictation inserts at the
current caret or replaces the current selection; Notes retain their rich HTML
and pasted images instead of being flattened to plain text.

Chrome/Edge use live Speech Recognition with interim text visible while Harvey
speaks. Browsers without that facility use the existing MediaRecorder →
`/api/voice/transcribe` fallback already proven in Content Ideation. The button
pulses and changes to Stop while listening, shows listening/transcribing/error
status, and feeds the resulting edit through the editor's normal autosave.
Read-only reviewer cards disable the mic alongside their other editor fields.

---

# 187. Laptop-Safe Manuscript Layout, Selectable Results, and Passage Highlighting (2026-09-22)

The manuscript reader could place its printed page number over the final lines
of text on laptop-sized screens. Two layout assumptions combined to cause it:
the spread height was calculated from the browser viewport rather than the
space actually remaining inside the reader panel, and the overflow fitter
measured the whole page even though its absolutely positioned page number did
not participate in that measurement.

The reader now derives a 4:3 spread from the stage's measured width and height
after its toolbar, reserves a real footer for each page number, and fits each
page's manuscript body inside the space above that footer. Dense pages may
reduce their type independently, while shorter pages retain their normal size.
Chromium checks on the dense page 48 at 1440x900, 1536x864, 1366x768, and
1280x800 all measured zero text/footer overlap, zero body overflow, and zero
book overflow outside the reader stage.

AI-search result cards are now selectable text rather than native buttons. A
mouse selection suppresses the card's navigation click, allowing excerpts to
be copied normally; Enter, Space, or an ordinary click still opens the result.
Opening a result carries its server-verified excerpt into the spread, finds the
corresponding text despite curly-quote or whitespace differences, and visibly
highlights that exact passage on the destination page. A browser test selected
and copied an excerpt without leaving page 48, then clicked the same result and
confirmed navigation to page 81 with its complete excerpt highlighted.

---

# 188. “Not Interested” Teaches the Big-Idea Generator (2026-09-22)

Every active card in Content Ideation now has a **Not interested** button next
to **Send to Rough Ideas**. Choosing it removes the card from the active queue,
marks the durable idea record `rejected` with the `not_interested` exit reason,
and immediately generates a replacement so the panel returns to ten ideas.

The dismissal is also a deliberate strong negative learning signal, not merely
a UI deletion. It stores the rejected Big Idea, its concepts/angles, verified
quotes, and provider metadata, then queues a preference-profile update. The
profile worker studies transferable problems in the rejected framing, scope,
structure, reasoning, or treatment and adds warranted traits to its avoids. It
is expressly told not to infer a blanket topic ban from one rejection; repeated
rejections increase confidence. Future generation prompts already consume this
profile and the rejected catalog, so both taste learning and duplicate
avoidance apply automatically.

Verification: the integration test proves the status/exit reason, complete
negative signal, profile-prompt inclusion, replacement generation, and absence
of the rejected card from active state. The complete Node suite passes 10/10.
A Chromium test with synthetic API data confirmed the visible button makes one
reject request, shows the learning status, animates the old card out, and
renders its replacement without modifying Harvey's production ideas.

---

# 189. Cross-Device Kanban Writes Cannot Overwrite Newer Work (2026-09-22)

Harvey raised the exact lost-update scenario the shared backend did not yet
protect: leave an old Kanban tab open at home, edit the same cards later from a
laptop, then interact with the old desktop tab. Because the browser kept a
complete in-memory copy of every piece and `PUT /api/store/pieces/:id` replaced
the complete record, that old tab could previously send its entire stale copy
and silently erase the laptop's newer title, notes, stage, platforms, ordering,
or other edits.

Piece records now use server-issued optimistic-concurrency tokens. Every piece
returned by the list or single-record API includes `_recordVersion`; every
update must present the exact current version. A successful write receives a
new version. If any other browser or a server-side video job wrote the piece in
between, the old version receives HTTP 409 `stale_write` and the current record
instead of being applied. Tabs opened before this deployment have no token and
are therefore safely rejected too. Conditional deletion uses the same token,
so an old tab cannot delete a card—or its associated video files—after another
device improved it.

The shared browser store serializes writes per piece, preventing one tab's own
rapid autosaves from racing each other. On a cross-device conflict, the current
app displays a prominent notice, fetches the complete fresh piece collection,
and reloads an open editor with the server's newer title/notes rather than
claiming the stale change was saved. Background analysis polling carries the
latest version token forward alongside its server-owned fields.

Verification includes 12/12 Node tests. The concurrency regression test models
two clients reading the same original card, accepts the laptop's improvement,
rejects the desktop's stale full-record write and stale deletion token, rejects
an old pre-feature client with no token, and accepts a deliberate edit after a
fresh read. A Chromium two-device simulation edited a stale home modal and
confirmed its `home-v1` write was rejected, its visible warning appeared, and
the editor reloaded the exact `cafe-v2` title and notes.

---

# 190. Manuscript Finder Uses a Persistent Instant Semantic Index (2026-09-22)

Harvey found the integrated book search impractical while writing because a new
query routinely took 15+ seconds. The manuscript text itself was already
memory-cached; the latency came from launching a fresh Codex or Claude process
for every previously unseen wording and asking it to inspect the complete book.
Only an identical-query result was cached, so even a small paraphrase paid the
full agent startup and reasoning cost again.

The finder now builds a persistent SQLite FTS5 index from the canonical 180
pages once, fingerprinted against both the manuscript and index algorithm.
Each real paragraph is indexed with Porter stemming, its section heading, and
domain-specific semantic concepts covering the Manual's Rules and recurring
pillars. Queries combine ordinary full-text relevance, exact phrase matching,
semantic expansion, and concept/page-range weighting, then deduplicate and
rank the strongest passages locally. Excerpts still come directly from the
canonical page, so result clicks retain exact passage highlighting. If the
manuscript or indexing algorithm changes, the fingerprint rebuilds the index;
otherwise service restarts reuse it without reprocessing.

New searches complete synchronously in the initial POST response instead of
creating a 15-second agent job and an extra 1.8-second browser polling wait.
Historical completed-query rows remain valid instant cache hits, while legacy
pending jobs are completed from the same local index after a restart. The UI
now describes the finder accurately as a pre-indexed meaning-based search.

Representative local benchmarks ranked results in 2.7–4.8 ms: inability to do
what one knows one should returned the Subconscious Action pages 109–112;
power as immunity to external upset returned Freedom pages 89–93; fear of
advanced aliens/UFOs returned Oneness pages 57–59; purpose/function returned
page 81 first; and a remembered quotation fragment returned its exact page 48.
The complete Node suite passes 12/12 and asserts that no AI provider is invoked,
semantic paraphrases resolve correctly, exact queries remain cached, and an
unchanged persistent index is reused across service setup/restart.

---

# 191. Customer Mailbox Interface, Ready for Provider Connection (2026-09-22)

Content Studio now has a first-class **Mailbox** destination for
`info@realitymanual.com`: an envelope in the desktop side rail with a live
unread-count badge and a matching top-level tab (so it remains reachable on
mobile when the rail is hidden). It is admin-only in both navigation and API;
the YouTube reviewer role cannot see it and `/api/mailbox/*` uses `requireAuth`,
not `requireAuthOrReviewer`.

The three-pane desktop interface (`public/mailbox.js`) provides Inbox,
Starred, Drafts, Sent, and Archive views; search; conversation reading;
read/unread, star, and archive actions; reply/reply-all; and a full composer.
The composer supports rich text, ordinary file attachments, and images pasted
or selected into the message body. Mobile collapses this into a folder/list
view and a separate reading view, while the composer becomes a full-screen
sheet. On sub-640px screens the header wordmark and Quick Add link are hidden
to preserve a genuinely tappable horizontally scrolling product-navigation
row; the same links remain present elsewhere where applicable.

`src/mailboxService.js` owns a normalized, persistent SQLite store for threads,
messages, and attachment metadata; attachment bytes live under
`/data/mailbox-attachments`. It includes provider-message-ID deduplication,
incoming attachment ingestion, durable drafts, unread aggregation, thread
management, authenticated downloads, and an injected transport boundary for
sending. A failed Send while no provider exists deliberately preserves the
message as a draft and tells the UI “Saved to Drafts — connect the mailbox to
send”; it never pretends the email went out. `MAILBOX_ADDRESS` is documented in
`.env.example`, while provider credentials will remain server-side in the VPS
`.env` once supplied.

The provider itself is intentionally not guessed or partially configured.
Harvey is supplying the real mailbox details next: either its provider/API and
OAuth details, or standard incoming IMAP host/port/security/username plus
outgoing SMTP host/port/security/username and the app-specific password. Once
known, the receiver/sync loop and sender can be injected into the already-built
service without changing the data model or UI.

Verification: the full Node suite passes 14/14. Dedicated integration tests
cover idempotent incoming sync, incoming and outgoing attachments, unread/read,
starred mail, draft persistence, safe not-connected sends, and a configured
fake transport reaching Sent. Headless Chromium verified the real SPA at
1440×900 and 390×844 with intercepted provider state: navigation, unread badge,
connection notice, no viewport overflow, full composer, and durable Save Draft
all worked at both sizes.

---

# 192. Manuscript Finder: Enter Searches, Shift+Enter Adds a Line (2026-09-23)

The integrated manuscript reader's Intelligent Finder now treats ordinary
Enter as a submit action instead of inserting a newline into its textarea.
Shift+Enter remains available for an intentional multiline query, and IME
composition confirmation is left untouched. The behavior calls the form's
normal `requestSubmit()` path, so button clicks and keyboard searches share
the same validation, loading state, API request, and result rendering.

---

# 193. Namecheap Private Email Connector for the Customer Mailbox (2026-09-23)

The Mailbox shell from §191 now has its real provider implementation. DNS
identifies `info@realitymanual.com` as Namecheap Private Email, so the service
uses the provider's standard encrypted endpoints: IMAP at
`mail.privateemail.com:993` and SMTP at `mail.privateemail.com:465`, both TLS.
`src/namecheapMailbox.js` is the isolated adapter, using ImapFlow for receipt,
MailParser for MIME bodies/attachments, and Nodemailer for delivery. The From
identity is **Reality Manual Support <info@realitymanual.com>**.

Incoming mail is pulled once at service startup, once per minute thereafter,
and immediately when the Mailbox Refresh control is used. The first connection
imports at most the newest 250 Inbox messages (configurable), then stores the
mailbox UID validity and highest UID so later passes fetch only new mail.
Provider UID plus RFC Message-ID deduplication makes retries/restarts safe.
In-Reply-To/References headers map replies into the existing conversation, and
incoming files/inline images are persisted through §191's attachment store.
Outgoing replies preserve those same threading headers; rich HTML, plain text,
ordinary attachments, and CID-embedded images pass through SMTP.

Connection state is explicit: configured-but-not-yet-synced reads “Connecting,”
a failed IMAP connection produces a useful non-secret error in the UI, and a
successful sync marks Namecheap connected with a timestamp. `POST
/api/mailbox/sync` is authenticated/admin-only like the rest of the mailbox.
The adapter remains completely disabled when `MAILBOX_APP_PASSWORD` is absent;
it does not partially attempt anonymous connections.

All settings are documented in `.env.example`. The app password is deliberately
not committed, printed, or copied by an agent: Harvey must enter it directly in
the VPS's gitignored `/root/realitymanual-repo/ops-service/.env`, after which
the container must be recreated so `--env-file` loads it. Defaults already
cover address, display name, hosts, ports, and TLS, so the password is the only
required secret.

Verification before the real credential: 17/17 Node tests pass. The provider
test uses a wholly synthetic password and fake IMAP/SMTP boundaries to prove
UID incremental fetch, MIME/address/inline-attachment mapping, reply headers,
SMTP delivery, and the exact From identity. Mailbox integration coverage proves
sync ingestion and connected status. A real provider login/send test remains
deliberately pending until Harvey performs the raw-credential environment step.

---

# 194. Intelligent Finder Resolves Exact Rule References (2026-09-23)

The manuscript finder now treats references to any of the fourteen named Rules
as exact navigational intent. Previously, tokenization discarded the one-character
number in `rule1` / `rule 1`, leaving only the generic word `rule`; normal FTS
ranking then compared every Rule passage and could put Rule VII first. The finder
now resolves Arabic numbers (`rule1`, `Rule 1`), Roman numerals (`Rule I`), number
words (`rule one`), and canonical names (`Rule of Internal Value`) against the
single doctrine catalogue in `ideationDoctrine.js`.

An exact Rule request injects that Rule's actual manuscript page into the candidate
set, gives it an explicit navigation-priority boost, and presents its canonical
title (for example, **Rule I: The Rule of Internal Value**) first. This applies
consistently to Rules I–XIV rather than special-casing Rule I. Generic conceptual
searches still use semantic/topic ranking; a passing mention of a broad word such
as “freedom” inside a longer query does not accidentally become an exact Rule
lookup. The search-index fingerprint was bumped so cached pre-fix jobs cannot
continue serving the old ranking.

Verification: the manuscript integration suite exercises all 14 Rules in compact
Arabic, spaced Arabic, and Roman forms, plus a canonical-name lookup. The full
Node test suite passes 17/17, and direct index checks confirm `rule1` opens page 9
with Rule I first while Rule X and Rule XIV resolve to pages 104 and 128.

---

# 195. Intelligent Finder: Verbatim Phrases and Long-Query Intent (2026-09-23)

The manuscript finder now distinguishes literal quotation lookup from semantic
discovery instead of reducing both to the same bag of stemmed keywords. For a
multi-word query, it scans the canonical page text for the entire token sequence,
ignoring only typographic/punctuation differences such as smart quotes,
apostrophes, and hyphens. Every literal match is injected into the reranker even
if ordinary FTS omitted it, receives decisive exact-match priority, and returns
an excerpt containing the actual phrase so result-click highlighting still works.
This is an independent retrieval path, so even a phrase made entirely of FTS stop
words (for example, `what is to be`) resolves to its literal page.

Long natural-language paraphrases also no longer lose their strongest semantic
candidate merely because FTS's broad 80-row candidate cap filled up with pages
containing common words. Known intent-anchor pages are now injected before
reranking. The finder specifically recognizes the relationship between finite
time/actions, movement toward desires, and actions compelled by avoidance as the
Manual's concept of freedom. Harvey's real failed query beginning “we all get 24
hours in a day” now ranks page 91 first, where the Manual contrasts directing life
toward what one wants with spending it avoiding worse outcomes; it previously
ranked the unrelated subconscious-action discussion on page 107.

The index/search fingerprint was advanced to
`semantic-fts-v5-highlight-safe-phrases`, so cached results generated by either
the old ranker or the first cross-paragraph excerpt implementation are not
reused. Exact-match excerpts are constrained to one rendered paragraph, matching
the reader's highlight boundary. Integration coverage
now proves punctuation-tolerant exact quotation lookup, all-stop-word literal
lookup, and the real long freedom paraphrase, in addition to every numbered Rule
lookup from §194. The full test suite passes 17/17.

---

# 196. Customer Mailbox Connected and Live (2026-09-23)

Harvey completed the root-only interactive credential step introduced in §193 by
running `sudo /root/realitymanual-repo/ops-service/configure-mailbox.sh`. The app
password is present only in the host's gitignored `.env` and the recreated
container; it was not printed, read back, or committed.

The production mailbox is now fully connected to Namecheap Private Email. A
manual live sync authenticated to IMAP, completed without error, and imported the
real inbox; the Content Studio reports the provider as connected with five unread
messages and twelve visible threads at verification time. A direct provider
verification from the production container authenticated successfully to both
encrypted IMAP and encrypted SMTP. The live provider identity is
**Reality Manual Support <info@realitymanual.com>**.

Headless Chromium then logged into the real production site, opened Mailbox, and
confirmed the Namecheap connected state, address, five-count unread badge, Inbox
count, imported thread list, visible Compose control, and absence of UI errors.
The complete Node suite passes 17/17, including outgoing identity, IMAP mapping,
incremental sync/deduplication, SMTP send behavior, attachments, and threading.

---

# 197. Automated Weekly Performance Email (2026-09-23)

Content Studio now sends Harvey (`harveymeale9@gmail.com`) a weekly performance
report every Monday at 09:00 **Europe/London** time. The reporting window is the
previous completed local Monday-to-Monday week, so an email never compares a
partial current week with a complete prior one. The service checks for a due
report on startup and every fifteen minutes, which provides cron-like scheduling
without adding a second host process; a persisted `weekly_report_runs` record
prevents an ordinary restart or redeploy from resending the same period and also
records errors/retries. Authenticated status and manual due-check endpoints live
at `/api/reports/weekly/status` and `/api/reports/weekly/run`.

The email is delivered through the already-connected Namecheap mailbox as
**Reality Manual Support <info@realitymanual.com>**, and the exact outbound
message is saved in the Content Studio Mailbox's Sent folder. It includes:

- first-party page views, unique visitors, funnel conversion, and tagged traffic
  sources, with the headline visitor comparison against the previous week;
- paid order count, units, gross USD revenue, average order value, and refunds;
- new/actively worked-on content, every meaningful Kanban milestone reached,
  pieces published, and a current pipeline breakdown;
- connected YouTube lifetime views/likes/comments plus measured view growth, and
  TikTok publication counts. TikTok engagement is identified as unavailable
  because the current TikTok connection has publish-only scope rather than an
  analytics scope.

All sales/customer data remains private. `deploy.sh` bind-mounts the storefront
SQLite directory into the ops container at `/store-data` read-only; the weekly
reporter queries only aggregate values and never returns names, addresses, email
addresses, or order rows. There is no public revenue API and no copied storefront
credential. YouTube statistics use the existing refresh-token flow and never
enter the report database or email as credentials.

`piece_stage_events` records stage transitions at the shared write boundary, so
future completion counts reflect actual movement during each week rather than
merely today's card state. Existing pieces are bootstrapped once from their best
available stage timestamp, and reviewer-created demo cards are excluded. The
complete ops test suite passes 20/20, covering London/BST week boundaries,
one-send-only behavior, stage tracking, email contents, mailbox Sent storage,
YouTube statistics normalization, and aggregate storefront reporting with an
explicit no-PII contract. A direct read-only query against the live storefront
database also returned the expected traffic/funnel/sales aggregates.

---

# 198. Automatic Mail Digestion, Archiving, and Project Manager Alerts (2026-09-23)

Every inbound message imported into the customer mailbox now enters a durable
AI-triage queue. Each email is read once and classified for Harvey-specific
importance: customer/order/support problems; platform/API/account-review news;
payment, legal, security, domain, or infrastructure issues; genuine partnership
or media enquiries; and direct business messages that likely need a response.
Routine newsletters, promotions, generic product updates, and spam are silently
filed. After successful digestion every message is marked read and its thread is
moved to Mailbox Archive, so Inbox is an arrival queue rather than a second task
list. If classification fails, the email deliberately remains visible and
unread in Inbox and is retried later; nothing is silently archived on an error.

Inbound email is hostile/untrusted input, so it is never passed to either normal
tool-capable Project Manager agent. `claudeRunner.runTextOnlyStructured()` creates
a fresh single-turn classifier with `tools: []`, `permissionMode: dontAsk`, a
one-turn cap, and a strict JSON schema. The prompt explicitly treats the message
as data, and a deterministic safeguard independently recognizes YouTube/Google/
TikTok API-review decisions and serious Stripe/BookVault/Namecheap/GitHub
operational notices. A synthetic live call through the production Claude SDK
proved schema output works with zero tools exposed.

Important messages create a living `mail_alert` row in the existing
`voice_messages` timeline. Alerts are grouped by sender address plus canonical
conversation subject (ignoring `Re:`/`Fwd:`), so a thread's later reply replaces
its earlier status in the same card and marks that card unread again rather than
stacking one notification per email. The first release's existing per-message
history is consolidated on startup: only the newest current status remains
visible and older intermediate cards are retained as hidden superseded history.
This is deliberately per conversation/topic—not one global mailbox card—so an
unrelated customer problem or security warning still gets its own alert.

Desktop and `/voice-mobile.html` render each current topic as a single warm coral
**Mailbox alert** card—not as a fake Harvey message plus a Claude reply, and not
in the Task List. The card gives sender/subject, the facts that matter, and an
explicit action or “No action needed right now,” with Play, Reply, and Open
Mailbox controls. Their shared poller recognizes in-place alert updates and
replaces the visible card on an already-open device; it also removes any card
that became superseded after a backend restart/migration. Mail notifications are
excluded from the normal Claude/Codex cross-agent context bridge so they do not
pollute future Project Manager turns.

Unread mail alerts have a separate durable read state and authenticated count/
mark-read APIs. Both Project Manager interfaces show a numbered envelope badge;
tapping it scrolls to the unread alert and clears the count, while tapping an
individual card clears only that alert. The mobile shortcut also uses the Web
Badging API where the installed browser supports it, with the always-visible
in-app number as the reliable cross-browser fallback.

Verification: the full Node suite passes 22/22. Integration coverage proves all
successfully digested mail is archived, only important mail creates an alert,
YouTube approval is force-protected even if model classification is false,
a related follow-up updates the same durable alert row, reprocessing is
idempotent, and a classifier outage leaves the original email untouched in
Inbox. Headless Chromium at 390×844 and 1440×900 proved the coral single-card
rendering, unread `1` badge, mark-read behavior, no fake user bubble, no Task List
pollution, and no viewport overflow.

---

# 199. Green Ask Button Speaks Codex's Immediate Contextual Response (2026-09-23)

The mobile green **Ask & Wait for Reply** button promised a spoken response, but
when Codex was selected its contextual first sentence was only rendered at the
bottom of the chat. The client explicitly skipped Codex in `onEarlyAck`, while
the TTS route allowed Codex to speak only a completed `reply_text`; consequently
Harvey heard nothing during a tool-using turn even though the response was
already visible.

Both Project Manager clients now request speech for that stored `early_ack` as
soon as it arrives. The server does not trust browser-supplied Codex text: a new
`speechKind` discriminator makes it resolve either `early_ack` or `reply_text`
from the identified `voice_messages` row. Arbitrary activity, commands,
reasoning, and logs remain impossible to route to Codex TTS. Final replies keep
their existing behavior, so a green-button Codex turn speaks the immediate
contextual acknowledgment and later speaks the answer when it is ready. The
desktop mic uses the same corrected path for consistency; typed messages and
the lower **Just Execute** button remain text-only as before.

---

# 200. Automated VPS Disk-Capacity Monitoring (2026-09-23)

The ops service now checks the VPS filesystem every hour and emails Harvey at
`harveymeale9@gmail.com` through the connected Reality Manual Support mailbox
when usage first reaches 80%. It sends one additional urgent email if usage
reaches 90%, but does not repeat mail while capacity remains in the same band;
returning below 80% rearms the warning. State, the last measured capacity, and
any monitor error persist in `disk_monitor_state`, so service restarts cannot
cause duplicate alerts. Authenticated status and manual-check endpoints are
`/api/system/disk/status` and `/api/system/disk/check`. The container root
overlay exposes the underlying VPS capacity, so no Docker socket or added host
privilege is required.

The baseline audit that motivated the monitor found the 96 GB filesystem at
51% use (49 GB used, 48 GB available). `/var/lib/containerd` accounted for
about 37 GB: roughly 29 GB of Docker overlay snapshots and 8.2 GB of content
blobs. Docker reported 26.34 GB of build cache (25.98 GB reclaimable) and 35.66
GB of images (27.24 GB associated with unused images). n8n accounted for
another roughly 4 GB across its 1.3 GB live Docker volume and 2.7 GB legacy
root-level data/database copies. The remaining major usage was normal system
and application data. No cleanup was performed as part of this monitoring
change.

---

# 201. Authenticated Complete-Manuscript Download (2026-09-23)

The manuscript reader now exposes `GET /api/manuscript/download`, mounted
behind the existing admin session gate. It downloads the canonical
`THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt` as
`The Reality Manual - Complete Manuscript.txt`, giving Harvey a one-tap phone
or desktop download without publishing the full manuscript at a public static
URL. Integration coverage verifies the attachment filename and manuscript
contents.

---

# 202. Manuscript Result Highlighting and No-Clipping Page Fit (2026-09-23)

At a 1663×573 laptop viewport, pages 34–35 reproduced Harvey's screenshot:
the old fitter stopped at approximately 7.4px while the page bodies still
overflowed by 140px and 207px. Because page bodies deliberately hid overflow,
the bottom paragraphs—and sometimes the otherwise-correct search highlight—
were present in the DOM but invisible.

The fitter now enters a compact typography mode when an ordinary page still
does not fit at 7.5px, tightening paragraph spacing/line height and continuing
to fit down to 4.5px. An individual page body becomes scrollable only as a
last-resort guard for an exceptionally dense future page, so text is never
silently cut off. Search highlighting now finds the longest exact excerpt run
within a paragraph when the indexed excerpt spans a paragraph boundary or was
ellipsized. A strongest-word-overlap fallback guarantees that even stale
cached results visibly mark the most relevant paragraph instead of opening an
unmarked page.

Headless Chromium at the reported 1663×573 laptop viewport opened all 180
canonical pages: none retained hidden overflow and none needed the emergency
per-page scrollbar. It also clicked all eight results for the reproduced
belief/meaning search; every card produced exactly one visible highlight,
including pages 34 and 35 from Harvey's screenshot.

---

# 203. Durable, Credit-Aware Background Waiters (2026-09-23)

Project Manager can now continue authorized work after an external condition
becomes ready without Harvey sending another message. `backgroundMonitorService`
persists watchers in SQLite and supports GitHub release assets, HTTPS status/body
conditions, stable files under `/data`, and scheduled times. Its 30-second probes
are deterministic and consume no Claude/Codex allowance. When a condition is
met, it creates a normal durable Project Manager queue row with the saved
continuation prompt, so the selected agent resumes the work through the existing
runner, cross-device thread, activity, and restart-recovery mechanisms.

Agent turns register watchers with the host-side
`ops-service/scripts/register-monitor.js`; it atomically drops a validated JSON
request into `/root/ops-service-data/monitor-requests`, the host view of the
existing `/data` bind mount. This avoids an internal bearer credential or Docker
socket. The system prompt now explicitly instructs both agents to register a
watcher instead of asking Harvey to nudge them when only an observable external
condition remains, but forbids doing so when human input, approval, or a scope
decision is still required.

Before waking an agent, the watcher reads the existing normalized subscription
usage service. If the selected provider's weekly remaining percentage is below
the monitor's reserve (15% by default), it enters `paused_credits` and keeps
polling without invoking the model; it resumes automatically after allowance
recovers. Watchers expire after seven days by default, claim themselves before
queueing to prevent duplicate turns, and survive service restarts. Authenticated
list, manual-check, and cancel routes live under `/api/voice/monitors`.
The brief claim/enqueue window uses a deterministic continuation-message ID;
startup retries an interrupted claim against that same ID, so a crash at the
worst possible instant neither strands the watcher nor duplicates the agent
turn.

---

# 204. Illustrated, Searchable Manuscript Reader from the Print Interior (2026-09-23)

The integrated reader now displays the actual designed pages from Harvey's
print-ready interior—including every diagram, illustration, parchment texture,
heading, and printed page number—instead of reconstructing the book from plain
text. The supplied `interior_printready2.pdf` is a 1,874,043,869-byte,
187-sheet PDF/X file with no embedded fonts or text layer: every page is a
flattened image. Its first three sheets are title/contents front matter, sheets
4–183 correspond exactly to the canonical numbered pages 1–180, and the last
four sheets are unnumbered end matter. The reader deliberately preserves its
existing 180-page numbering, so search results and outline citations did not
change.

`scripts/build-manuscript-artwork.js` is the reproducible ingestion pipeline.
It renders the numbered interior once at 200 DPI, compresses each page to a
1,606×2,386 lossy WebP at quality 72, runs Tesseract over the render, and emits
a compact positioned word layer plus a source-hash manifest. It requires the
host commands `pdftoppm`, `cwebp`, and `tesseract`. Generated files live only
under `/data/manuscript-pages` (the host path is
`/root/ops-service-data/manuscript-pages`), never in Git or the container
image. The 180 images total 46,959,366 bytes and the 43,974-word coordinate
layer totals 1,272,477 bytes: 48,231,843 bytes combined, a 97.43% reduction
from the 1.874 GB print source and an average image size of about 261 KB.

The authenticated manuscript API detects the completed manifest at startup,
serves immutable private page artwork, and returns the corresponding OCR word
boxes with each spread. If the generated bundle is unavailable or incomplete,
the existing canonical text reader remains the safe fallback. The browser
lays those transparent words over the artwork, which keeps page text
selectable/copyable and lets a clicked semantic-search result illuminate the
actual printed passage. Longest exact OCR runs anchor highlights; a local
vocabulary-overlap window guarantees a visible passage even when decorative
type causes an OCR error. Search itself still uses the much cleaner canonical
180-page text index, so illustration support does not weaken or slow semantic
retrieval. The physical spread now uses the print interior's true aspect ratio,
and edge-tap navigation remains above the selection layer.

Verification covered all 180 page images and all 180 coordinate files, their
page IDs and 1,606×2,386 geometry, representative text/diagram quality, the
authenticated artwork response/cache headers, and the full ops-service test
suite. A real Chromium run at Harvey's reproduced 1,663×573 laptop viewport
opened every spread and observed every numbered page with no failed image
request or cropped page; it also copied text from the OCR layer, found an exact
quotation on page 91 by pressing Enter, visibly highlighted 89 positioned
words, and turned the spread by clicking its right edge.

---

# 205. Explicit Thumbnail Choice and Unified Frame Preview (2026-09-23)

Content Production previously showed two competing image surfaces: an empty
`No thumbnail` box in the row's left metadata column and the real scrubbable
video frame picker beside it. It also silently captured frame zero as soon as
the video loaded, which meant the app claimed a thumbnail was selected before
Harvey had actually chosen one.

The redundant left thumbnail surface is gone. The real frame picker is now the
only visual source of truth: while its video blob is loading it shows a centered
spinner over that exact frame area, keeps the scrubber and **Use this frame**
button disabled, and reveals/enables them together on `loadeddata`. Missing or
undecodable video data replaces the spinner with a direct error instead of
leaving an unexplained black/empty box. No frame is selected automatically.
Only an explicit **Use this frame** click captures and persists the JPEG, adds
the existing `Thumbnail selected` tag, and changes the button itself to
**✓ Thumbnail selected**. Moving the scrubber afterward changes the button back
to **Use this frame**, making it clear that the newly displayed frame has not
yet replaced the saved thumbnail.

A real Chromium test used an isolated temporary service/database and generated
H.264 video, with the video response delayed to exercise the loading phase. It
confirmed there was no legacy thumbnail node, the spinner was visible and both
controls disabled during load, loading alone did not write a thumbnail, the
explicit click saved a JPEG data URL and tag while showing the tick, and
scrubbing reset the prompt. The full ops-service suite remains 26/26.

---

# 206. Manual Production Titles Beat Late Analysis + Live YouTube Stats Audit (2026-09-23)

Harvey typed `demo vid` into Content Production, but Final Check later showed
the analysis-generated `Are You Ready?`. The title field itself updated both
`ytTitles[0]` and `piece.title`; the real bug was concurrency. Video analysis
runs independently and, when it completed after Harvey's edit, unconditionally
replaced both fields with its generated suggestions. The three-second analysis
poller also treated those fields as always background-owned, so a stale poll
response could replace a title currently being typed before its debounced save.

Typing in any production title slot now sets durable
`ytTitlesManuallyEdited: true`. The analysis worker re-reads the latest piece
before applying its result and refuses to replace titles carrying that marker.
The browser poller likewise preserves a locally edited title against an older
generated response, while still accepting an explicit manual title saved from
another device. Generated suggestions continue to populate untouched uploads;
only the user's deliberate choice takes ownership. Regression coverage proves
both halves: analysis still fills an untouched title, and the identical late
result cannot replace `demo vid` once manually selected. The full suite is now
27/27.

The connected YouTube OAuth grant was also tested directly against the live
YouTube Data API, not inferred from configured scopes. The current
`youtube.upload` + `youtube.readonly` connection successfully resolved the
connected channel's uploads playlist and fetched `videos.list` with
`snippet,statistics` for its ten most recent videos. Returned fields include
per-video title/publish time, views, likes, and comments; for example the API
currently reports `Reality Manual Content Studio Demo` at 5 views, 0 likes,
and 0 comments, and another recent video returned a nonzero like count. The
existing `fetchVideoStatistics` implementation and weekly report already use
these fields for pieces that have a stored `youtubeVideoId`. The Content
Analytics tab remains a placeholder and does not yet display them; watch time,
retention, and shares require the separate YouTube Analytics API rather than
the Data API statistics response tested here.

---

# 207. Daily YouTube Publication Audit and Terminal Removed Stage (2026-09-23)

Content Studio now reconciles its **Posted / Live** column with YouTube once per
24 hours. The service performs an hourly due-check (and a due-check at startup),
but a durable `youtube_publication_audit_state` row prevents a successful audit
from running more than once in the 24-hour window. Only production cards in
`live` with the exact `youtubeVideoId` stored by our uploader are included;
Google-reviewer demo cards and non-YouTube cards are excluded.

The audit uses the existing `youtube.readonly` OAuth grant and an authenticated
`videos.list?part=status` lookup. A video whose privacy is still `public` and
whose upload is processed remains in Posted / Live. A private, unlisted,
deleted/missing, rejected, or otherwise unavailable video moves automatically
to a new final Kanban column: **Deleted / Removed / Private** (`removed`). The
piece retains its original YouTube id/URL and records the last checked time and
reason, so the history is not destroyed.

Safety is deliberately fail-closed with respect to Kanban mutation: all API
batches must complete successfully before the first card is saved. OAuth,
quota, network, or YouTube server failures record an audit error and move no
cards; the hourly due-check then retries because no successful completion time
was written. Admin-only status and force-run endpoints are available at
`/api/youtube/publication-audit/status` and `/api/youtube/publication-audit/run`.
`YOUTUBE_PUBLICATION_AUDIT_ENABLED=false` is the emergency off switch.

Regression coverage proves public/private/missing decisions, terminal-stage
movement, the 24-hour guard, reviewer/non-live exclusions, and the no-mutation
rule on API failure. The YouTube boundary test separately proves the requested
status fields and authenticated scope behavior. The complete suite passes
30/30.

---

# 208. Manuscript Page Turns Preload Behind a Stable Spinner (2026-09-23)

Illustrated page turns no longer replace the current spread with text/blank
page placeholders while the protected WebPs are still downloading. That old
sequence exposed three different paint states in quick succession—the cream
fallback, the artwork page's ochre background, and finally the image—which
looked like the pages changed colour twice on every turn.

`public/manuscript.js` now keeps the existing spread intact, overlays one
centered green loading spinner, fetches the page metadata, then preloads and
decodes both artwork images before replacing the DOM in one paint. The fully
ready spread enters with a short opacity/position reveal instead of the old
partial page-flip flash. The initial book opening uses the same stable loader,
rapid successive navigation is protected by a request generation number so an
older response cannot replace a newer requested spread, and image failures
still surface a readable error with page-turn controls.

A real Chromium test against the protected production artwork deliberately
delayed every image response. It proved that the initial state contained only
the visible spinner (no fallback pages), a later turn retained the old page
while loading, and the new two-page spread appeared only after both images had
finished. The full suite remains 30/30.

---

# 209. YouTube Competitor “One-of-Ten” Dashboard, No New API Signup (2026-09-24)

The former Content Analytics placeholder is now a working YouTube competitor
dashboard. Harvey can paste any current `@handle`, `youtube.com/@handle` URL,
stable `/channel/UC…` URL, or raw channel id into a saved watchlist. Each channel
shows its public subscriber/video totals, average views across the latest ten
available uploads, all ten videos with thumbnail/title/date/duration/views/
likes/comments, their raw view-count rank, and an explicit **Current winner —
#1 of 10** callout. Every video card opens the original YouTube watch page.

This uses only the OAuth connection already present in Content Studio and its
existing `youtube.readonly` scope. It requires no API key, new Google project,
new scope, or competitor authorization. Exact channel handles are resolved with
`channels.list`, then the uploads playlist is read with `playlistItems.list`
and the latest public video details are fetched in one `videos.list` batch.
Deliberately avoiding `search.list` both removes ambiguous channel matching and
avoids its separate, tighter search quota bucket. One channel refresh is three
cheap read calls.

The ranking is intentionally transparent and policy-safe: it sorts the current
public view counts within that channel's latest ten uploads. It does not pretend
to reproduce YouTube Studio's private equal-age velocity ranking, retention,
impressions, or CTR, and it does not manufacture an opaque proprietary score.
The UI states that limitation directly. Public snapshots are cached so revisits
are instant and auto-refreshed on entry once older than six hours; snapshots
older than YouTube's 30-day non-authorized-data limit are erased automatically
at service startup while the user's channel watchlist remains.

Backend state lives in `youtube_competitor_channels`; authenticated admin-only
list/add/refresh/delete endpoints are under `/api/youtube/competitors`. A failed
channel refresh retains and displays the last good snapshot plus the current
error instead of blanking the dashboard. Tests cover exact-handle parsing, the
three-call API flow, stable recency ordering plus view ranking, duration and
missing-stat normalization, durable add/refresh/remove behavior, failed-refresh
fallback, and 30-day expiry. A direct live call through the existing production
OAuth connection resolved `@YouTube`, returned ten public uploads, and ranked a
winner without exposing the token. Chromium at 1440×900 and 390×844 verified
the dashboard layout with no overflow or runtime errors. Full suite: 34/34.

---

# 210. Fifty-Video Competitor Baseline, Ten-Video Winner Set (2026-09-24)

The competitor dashboard originally calculated its average from the same latest
ten videos used for the visible **one-of-ten** contest. Harvey correctly pointed
out that ten is too small a sample for a useful channel-performance baseline.
Those are now deliberately separate populations: the current winner and video
cards still rank only the channel's latest ten public uploads, while average and
median views are calculated from up to its latest fifty public uploads.

Fifty is YouTube's maximum `playlistItems.list` page size, so the larger sample
does not add another request: each channel refresh remains the same three Data
API calls (channel, uploads playlist, batched video details). The saved snapshot
contains the full baseline plus distinct `recentViewRank` and
`baselineViewRank` values, but the interface renders only the ten recent cards
and labels the two baseline statistics with their actual sample count. Median
was added alongside average so one unusually viral upload cannot disguise the
channel's typical performance.

Snapshots now carry `sampleVersion: 2`. Opening the dashboard automatically
refreshes an older ten-video snapshot even if it is less than six hours old,
which prevents stale cache data from silently preserving the old calculation.
Compatibility fallbacks keep such a snapshot readable during that refresh.
Regression coverage proves the fifty-item request, correct mean/median fields,
and that an older high-view outlier contributes to the baseline without
entering the latest-ten winner ranking. Full suite: 35/35.

Production verification used the existing OAuth connection to resolve
`@YouTube` and returned exactly 50 baseline videos plus 10 recent ranked
videos; the eleventh item had no recent rank as intended. Real Chromium at
1440×900 and 390×844 showed exactly ten cards, **#1 of 10**, both latest-50
statistics, the new cache-busted asset, no horizontal overflow, and no runtime
errors. The temporary production watchlist entry was removed afterward.

---

# 211. Thumbnail-First Outlier Board and Metadata-Grounded AI Reads (2026-09-24)

Each watched competitor channel now has a **Creative outlier board** above its
latest-ten list: six large thumbnail cards representing the top-viewed videos
within that channel's latest-50 sample. Ranking remains the unmodified public
YouTube view count within one channel—no cross-channel league table or invented
performance score. Every card clearly displays its original thumbnail, title,
views, source link, and raw “#n of 50” position. The existing latest-ten grid
remains underneath for recency comparison.

The top-six cards also contain a concise AI creative read: **Topic**, **Big
idea**, and **Angle**. The analysis is deliberately grounded only in the
creator-supplied public title and description and says so directly in the UI.
Descriptions are retained only for the current top six, rather than bloating
each snapshot with 50 full descriptions. The AI receives them as explicitly
untrusted data in the existing one-turn structured runner with `tools: []`, so
prompt-like text in a description cannot access files, shell, network, or agent
sessions. Reads are fingerprinted by video/title/description, cached with the
30-day-refreshable public snapshot, reused when metadata is unchanged, and
regenerated by a per-channel **Refresh AI reads** button. AI failure never
discards valid YouTube statistics or thumbnails.

We did **not** scrape or claim access to competitor transcripts. YouTube's
official `captions.list` and `captions.download` methods require the broader
`youtube.force-ssl`/partner authorization and can still return 403 when the
authorizing account lacks permission for those caption tracks; our existing
`youtube.readonly` connection is not a way to download another channel's
captions. YouTube's policy also forbids downloading audiovisual content and
scraping YouTube applications. The interface therefore explicitly labels the
source and never implies that the model watched the video or read a transcript.
Snapshots are now `sampleVersion: 3`, forcing older watchlist data to refresh.

Regression coverage proves top-six selection, safe structured prompting,
metadata-fingerprint cache reuse, explicit regeneration, graceful AI failure,
description minimization, and the unchanged 50/10 split. Synthetic Chromium at
1440×900 and 390×844 rendered six outlier cards, ten recent cards, all 18 AI
fields, and no horizontal overflow. Full suite: 37/37.

Production verification resolved `@YouTube` through the real OAuth connection,
stored 50 videos, selected six top-viewed cards, and generated all six
structured creative reads in one real restricted Claude call with no error.
The outputs correctly admitted when sparse metadata did not establish a big
idea or angle. Production Chromium loaded all six original thumbnails, 18 AI
fields, the source/caption disclosure, and the current cache-busted asset with
no desktop overflow or runtime error. The temporary channel was removed and
the production watchlist returned to empty afterward.

---

# 212. Genuine One-in-Ten Outliers Replace the Fixed Top Six (2026-09-24)

Harvey clarified that the Creative outlier board must not always show an
arbitrary fixed number of winners. It now displays a variable number of videos,
including zero, under a transparent two-part rule across the latest-50 sample:

1. the video must rank in the sample's top 10%; and
2. its views must exceed the conventional high-outlier fence, `Q3 + 1.5 × IQR`.

The rank condition preserves the intended “one in ten” rarity, while the
second condition prevents a flat-performing channel from manufacturing five
supposed outliers merely because something must occupy ranks 1–5. Samples with
fewer than ten public videos produce no one-in-ten designation. This remains a
within-channel calculation over raw YouTube view counts—never a cross-channel
score or league table.

Each qualifying card now shows an immediately legible performance lift against
the channel median, e.g. **5.0× typical · +400% vs median**. Median is used as
the “typical” baseline because the breakout video itself can badly inflate a
mean. The interface explains the inclusion rule and has a deliberate no-outlier
state. Only qualifying videos retain public descriptions and receive cached AI
topic/big-idea/angle reads; ordinary top-decile videos no longer consume an AI
call or appear in the creative board. Snapshots are now `sampleVersion: 4`, so
existing watchlists refresh automatically.

Regression coverage proves a flat 50-video sample yields zero outliers, while a
single 10× breakout is retained and ordinary top-decile neighbors are rejected.
It also proves AI runs only for videos already marked as genuine outliers.
Synthetic Chromium at 1440×900 and 390×844 verifies both multi-outlier and
zero-outlier states, relative-performance labels, the unchanged latest-ten
grid, and no horizontal overflow. Full suite: 38/38. A read-only live calculation
against `@YouTube` returned five qualifiers from 50, all above the 421,203-view
outlier fence and ranging from 7.0× to 127.8× that channel's median.

Production verification at `ede4634` returned the same five qualifiers through
the authenticated API. The initial structured Claude call had one transient
failure; this deliberately left all YouTube data intact and the live **Refresh
AI reads** retry then populated all five analyses, proving the graceful-failure
path rather than hiding it. Real Chromium at 1440×900 and 390×844 showed five
cards, 15 creative fields, original thumbnails, exact median-lift labels from
7.0× through 128×, ten recent cards, the current cachebuster, and no overflow
or runtime errors. The temporary watchlist entry was removed; live count is 0.

---

# 213. Caption-Only Competitor Analysis; Metadata Analysis Removed (2026-09-24)

Harvey rejected title/description inference as too shallow. Competitor creative
analysis now uses **actual caption transcript text or nothing**. Titles remain
visible as YouTube labels on cards but are never included in the AI prompt;
video descriptions are no longer fetched, stored, or analyzed at all.

The official Data API cannot provide this competitor use case:
`captions.download` requires the authorizing user to have edit permission on
the video and uses the broader `youtube.force-ssl`/partner scope. Instead, the
backend makes a no-login request to YouTube's public player JSON endpoint and,
when that response exposes a caption-track URL, downloads the same timed-text
feed used for ordinary public closed-caption playback. It prefers manual
English, then English ASR, then another manual language, then any available
track. The caption URL is restricted to HTTPS `youtube.com` hosts, both requests
have 15-second timeouts, and there is deliberately **no watch-page HTML
scraping fallback**. This player endpoint is public but undocumented/best-effort
and can be bot-gated or changed by YouTube; any failure is treated exactly like
no public caption track and the card is omitted.

The transcript is parsed from both current `<p>/<s>` and classic `<text>` timed
text, decoded, and passed as explicitly untrusted data to the existing
single-turn structured Claude runner with `tools: []`. The transcript itself is
not persisted. Only language, manual/auto status, word count, a short content
hash, and Topic/Big Idea/Angle output are stored. Unchanged transcript hashes
reuse the cached AI read; long transcripts are represented by equal opening,
middle, and ending sections so a five-outlier batch stays inside model context.

The Creative outlier board now filters for both `isOneInTenOutlier` and a
successfully retrieved caption. If five statistical outliers exist but zero
public tracks can be read, the board shows no cards and says why; the ordinary
latest-ten statistics grid remains unaffected. Captioned cards explicitly show
caption language, manual/auto source, and word count. Snapshots are now
`sampleVersion: 5`, forcing every old metadata-derived result to be replaced.

Regression coverage proves caption-track preference, XML parsing, entity
decoding, no-track behavior, prompt isolation from titles/descriptions,
transcript-hash caching, AI-failure preservation, and zero AI calls for
uncaptioned outliers. Real network validation retrieved and parsed 487 words of
manual English captions for a known public video and returned null for an
uncaptioned/bot-gated video. Synthetic Chromium at 1440×900 and 390×844 proves
captioned, uncaptioned-outlier, and no-outlier states with no overflow. Full
suite: 41/41. A read-only live `@YouTube` sample found five statistical
outliers but zero publicly retrievable tracks, so the new board correctly shows
none rather than manufacturing analyses from metadata.

Production verification at `bf0a904` confirmed the deployed container can
retrieve a real 487-word manual-English public caption track through the new
parser. The authenticated `@YouTube` test returned sampleVersion 5, five true
statistical outliers, zero retrievable player tracks, zero AI reads, and zero
stored description fields. Real Chromium at 1440×900 and 390×844 therefore
showed zero creative cards plus the explicit “5 statistical outliers ... none
expose a retrievable public caption track” explanation, while retaining the ten
ordinary statistics cards; current cachebuster, no errors or overflow. The
temporary watchlist channel was removed and live count returned to 0.

# 214. Routine Mail Acknowledgements Are Silent (2026-09-24)

Harvey reiterated that the mailbox assistant must not create a Project Manager
notification for every inbound message. The concrete failure was BookVault's
automatic response to our production enquiry: the model correctly described it
as a content-free acknowledgement, but marked it important because the response
subject inherited the word `Urgent` from our outgoing email. The deterministic
BookVault safeguard also treated that inherited word as an operational problem,
so a routine auto-response became a coral alert.

Mail triage now has a hard acknowledgement filter ahead of both the AI result
and deterministic safeguards. Automatic/out-of-office responses, support-ticket
receipts, submission acknowledgements, and messages that only promise a reply
within a stated number of working days are archived and remain silent. Words
such as urgent, order, payment, and review inherited from an outgoing subject do
not change that. The classifier prompt now requires genuinely new substantive
information, an actual decision/request/problem, or a likely-needed human reply.
The platform safeguard was narrowed from any mention of a review/API to actual
approval, rejection, completion, failure, suspension, deadline, or requested
action; `urgent` alone was removed from the operational safeguard.

This does not suppress the eventual useful reply. Regression coverage proves
that an urgent-sounding BookVault auto-response produces no alert even if the
model calls it important, while a later human response identifying a production
fault and asking for a decision still alerts normally. The full suite passes
42/42.

---

# 215. Competitor Analytics Navigation Label (2026-09-24)

The working YouTube competitor dashboard is now labelled **Competitor
Analytics** throughout the Content Studio navigation and panel heading, replacing
the old generic `Analytics` / `Content Analytics` wording. Its top-level menu
group remains the final normal navigation item after Content Ops (the
rail-pinned manuscript reader is still a separate utility). The existing Sales
Analytics and Website Analytics subtabs remain available beneath that group.

The `app.js` cache key was advanced so already-open browsers fetch the new menu
label immediately. This is a presentation-only change; the stable
`#content-analytics` route and competitor data are unchanged.

---

# 216. Analytics Parent and Mailbox Navigation Order (2026-09-24)

Harvey clarified the intended hierarchy after §215: **Analytics** is the
top-level group name, while **Competitor Analytics** is the name of its first
subtab and dashboard. The top navigation order is now Project Manager, Content
Ops, Analytics, Mailbox, making Mailbox the far-right final item. The icon rail
mirrors the same functional order (with the manuscript reader still pinned at
the bottom as a utility). The asset cache key was advanced again so the corrected
label and ordering appear immediately on existing devices.

---

# 217. GitGuardian SMTP Alert Was a Unit-Test False Positive (2026-09-25)

GitGuardian emailed that commit `e155cba` had exposed SMTP credentials in the
public repository. The alert's exact GitHub diff anchor resolves to
`ops-service/test/namecheapMailbox.test.js`, line 73—not `.env`, deployment
configuration, or a real mailbox value. The flagged code was the deliberately
synthetic unit-test pair `MAILBOX_APP_PASSWORD: 'test-only'` alongside the
public support address and Namecheap SMTP defaults. The actual app password has
only ever lived in the gitignored VPS `ops-service/.env`; that file is mode 600,
and both backend and ops-service `.env` paths remain covered by gitignore.

The test now calls `envConfig()` without a password, which exercises the same
non-secret provider defaults and avoids presenting scanners with a
credential-shaped literal. No live credential was exposed, so password
rotation and destructive Git-history rewriting are neither necessary nor
appropriate. The old harmless `test-only` string may remain visible in the
historical commit referenced by the alert; it was never accepted by the mail
provider and grants no access.

---

# 218. Phone-Readable Complete Manuscript PDF (2026-09-26)

Harvey needed a practical copy of the full print interior to send to a friend
for offline reading on a phone. The immutable source remains
`interior_printready2.pdf` in the `manuscript-interior-source` GitHub release
(1,874,043,869 bytes, SHA-256
`138b4f88f592fe2a429037baf95b81f1bb4eb6a89fd79af1ecff698a91e2a5e3`). A
separate derivative, `The_Reality_Manual_phone.pdf`, now lives alongside it in
that release; the original was not replaced or modified.

The derivative was produced with Ghostscript as an RGB PDF 1.6, downsampling
the flattened print artwork to 180 DPI with bicubic scaling and JPEG quality
82. It preserves all 187 sheets at 1,445×2,147 pixels, including the front and
end matter and every illustration/diagram. The result is 49,759,595 bytes
(47.45 MiB), a 97.34% reduction / 37.7× smaller than the print source, with
SHA-256 `ea335691d3d8d7a38adcf004847a16c15a5f551143c6c9081bb6043b0d6f5052`.
Validation covered `pdfinfo`, an embedded-image inventory (exactly one
1,445×2,147 image on each of 187 pages), and visual checks of front matter,
dense body text, illustrated pages, and end matter. The unauthenticated release
download was also verified to return HTTP 200 with the exact expected byte
length.

---

# 219. Research Product Area, Outlier Analysis Rename, and Thinker Seed List (2026-09-26)

Harvey separated two fundamentally different activities that had been conflated
under Analytics. The existing YouTube competitor tool studies externally
observable performance—packaging, titles, thumbnails, topics, big ideas and
angles that materially outperform a channel's normal result. A new body-of-work
tool will instead ingest a thinker's public writing, newsletters, interviews,
podcasts and captioned videos, extract recurring claims, and generate sourced
ideas by relating those claims to The Reality Manual.

The desktop/mobile Content Studio navigation now has five normal top-level
areas in this order: Project Manager, Content Ops, **Research**, Analytics and
Mailbox. Research contains **Outlier Analysis** (the existing stable
`#content-analytics` route and fully working competitor dashboard, renamed and
given accurate explanatory copy) plus a new **Idea Research**
(`#idea-research`) workspace. Idea Research currently presents the intended
source-grounded workflow and is ready for the first profiles; its ingestion,
corpus and comparison UI will be built once Harvey supplies his direct list.
Analytics now contains only Sales Analytics and Website Analytics. The side
rail mirrors this hierarchy with a distinct Research group and reviewer-role
sessions remain unable to see either Research or Analytics.

The initial candidate discovery used the live YouTube connection to enumerate
all 150 uploads on the real `@PickingNuggets` channel rather than sampling its
latest 50. The archive is unusually concentrated: 114 titles mention Naval
Ravikant and 16 mention Nassim Taleb, with recurring appearances from Kapil
Gupta, Charlie Munger, Tim Ferriss, Elon Musk, Mohnish Pabrai, Jordan Peterson,
Shane Parrish, Peter Thiel, Daniel Kahneman, Steven Pinker, James Clear, Sam
Harris, William Irvine and Josh Waitzkin. Julio Froment's own published source
list and broader consciousness/metaphysics research were then used to avoid
mistaking that Naval-heavy editorial mix for the entire relevant universe.

A curated 36-person seed list was emailed successfully to
`harveymeale9@gmail.com` from Reality Manual Support at
2026-09-26T06:44:22.789Z. It is prioritized into closest conceptual overlaps,
psychology/meaning/transformation, and useful contrasts/applications; the first
recommended ingestion batch is Naval Ravikant, Kapil Gupta, Jiddu Krishnamurti,
Alan Watts, Michael A. Singer, Byron Katie, Anthony de Mello, Eckhart Tolle,
Rupert Spira, Donald Hoffman, Bernardo Kastrup and Iain McGilchrist. Research
artifacts live outside Git under `/root/ops-service-data/research`.

Verification: `node --check` passes for both edited JavaScript files, CSS braces
balance, and real Chromium sessions at 1,663×900 and 390×844 confirmed the exact
top-level order, Research subtabs, Outlier Analysis heading, Idea Research
workspace, and Analytics' two remaining subtabs. The only console 401 was the
expected pre-login session probe.

---

# 220. Canonical Manual Concept Index and Two-Pass Idea Research (2026-09-26)

Idea Research now has a compact, source-checked representation of the full
180-page manuscript instead of requiring every future source statement to be
compared blindly against the complete book. `src/manualConceptIndex.js`
compresses the Manual into 35 concepts across six useful groups: the game and
objective, all fourteen named Rules, core mechanisms, metaphysics and purpose,
practical change methods, and the final conceptions of power/Heaven on Earth.
It includes the objective of maximizing emotional well-being, life as a
solvable game, the emotional scoreboard, the five axes, the reciprocal
meaning–belief–emotion relationship, both modes of resolving desire, the
Tripartite/action model, resistance, motivation, the action cycle, triple
alignment, Panacea, FIRR, and enlightenment.

Each entry has a stable id, concise thesis, comparison aliases, page range,
and a short canonical quotation with its exact page. The service validates
every quote against the actual manuscript during startup and refuses to start
if a quote drifts or any of Rules I–XIV is absent. This prevents a compact
summary from gradually becoming an uncited substitute for Harvey's book.

The research contract is deliberately two-pass:

1. compare an external source statement against the small concept index to
   identify likely conceptual connections;
2. return to the canonical manuscript page and quotation for every useful
   candidate; and
3. only then develop the agreement, tension, contradiction, extension, or
   reframe using Harvey's exact formulation.

The protected manuscript API exposes `GET /api/manuscript/concepts` and
`POST /api/manuscript/concepts/match`. Idea Research is no longer a placeholder:
it shows the complete grouped index, provides a fast filter and statement
comparison control, and makes every result open the illustrated manuscript at
the verified source page with its passage highlighted. This is also the data
contract the later thinker-ingestion pipeline will place in its comparison
prompt (`promptText()` supplies the small AI-readable form); the full
manuscript remains the authority for the final sourced output.

Validation added to the manuscript regression suite proves there are exactly
14 Rules, every quotation is verbatim on its declared page, reciprocal
meaning/belief/emotion language ranks the Rule of Bidirectional Belief first,
and action/discipline resistance language returns the relevant action
concepts. Full suite: 42/42. Real Chromium at 1440×900 and 390×844 rendered all
35 concepts/14 Rules with no horizontal overflow or runtime errors, ranked the
Bidirectional Belief example first, then opened page 36 and highlighted 50 OCR
text-layer words from the canonical passage.

---

# 221. Configurable Ambient-Music Mix Level (2026-09-26)

The background-music gain used to be hard-coded in
`src/videoAnalysis.js` at 20%, so changing it required a code change and every
final build used the same fixed mix. Content Settings' **Ambient audio
library** now includes a **Background music volume** selector with every whole
percentage from 5% through 30%. It defaults to 10%, matching Harvey's expected
normal working level, and saves as `settings.ambientMusicVolumePercent` in the
existing shared settings record. Reviewer sessions can see the value but
cannot change this global production setting.

`runBuildFinalVideo()` reads the current value directly from the server-side
settings record each time **Send to final check** is run (including a retry),
normalizes it to an integer inside the 5–30 range, and passes it into the
ffmpeg final-video builder. Existing settings rows need no migration: a missing
or malformed value resolves to 10%. The no-music path remains a byte-preserving
remux and ignores the mix value. Already-built final files do not change
retroactively; resending a piece to Final Check rebuilds it using the current
selection.

Regression coverage proves the 10% fallback, 5%/30% bounds, exact 13% ffmpeg
filter, and unchanged no-music command. Full suite: 43/43. Real Chromium at
1440×900 and 390×844 showed all 26 choices, a 10% initial value, persisted a
17% selection through the real settings API, and had no horizontal overflow.
A real one-second ffmpeg render using a silent source plus sine-wave backing
track measured -50.11 dB RMS at 5% and -34.56 dB RMS at 30%, the expected
15.55 dB separation for a sixfold gain difference, confirming the selection
changes the produced audio rather than merely changing UI state.

---

# 222. Platform-Specific Tracked Caption Links (2026-09-26)

Caption link handling is now an explicit publish-time platform policy rather
than a blind `[LINK]` string replacement. Facebook receives a per-piece
UTM-tracked storefront link for both short-form and long-form posts. If the
Facebook template contains `[LINK]`, it is replaced in place; if it omits the
shortcode (or is blank), the URL is appended automatically, so Facebook cannot
accidentally publish without the requested trackable destination. The UTM
source is derived from the caption's actual platform, fixing the prior case in
which a Facebook caption on a joint Facebook/YouTube piece could receive
`utm_source=youtube`.

Long-form YouTube retains its existing clickable-link behavior: `[LINK]` is
expanded with `utm_source=youtube`, but unlike Facebook it is not forced into a
template which omits the shortcode. Only YouTube Shorts, Instagram and TikTok
are kept free of the store URL. Any legacy `[LINK]` shortcode in one of those
saved templates is removed while rendering the Final Check card and again in
the same rendered text passed to the publish endpoint; the stored template
remains editable and is not destructively rewritten. This protects publishing
even before Harvey tidies old caption wording. The Settings copy and
placeholders now explain the distinction accurately.

YouTube's current official documentation confirms the underlying Shorts
constraint: URLs in Shorts descriptions/comments are non-clickable, whereas
long-form description URLs can be clickable for channels with advanced-feature
access. Content Studio follows that same Shorts-versus-long-form distinction.

Regression tests exercise the platform allowlist, Facebook replacement and
automatic append behavior, long-form YouTube expansion without forced append,
and legacy-shortcode removal across every excluded platform. Full suite: 47/47.

---

# 223. Authenticated Owner Email Becomes a Project Manager Instruction (2026-09-26)

Harvey's own replies to `info@realitymanual.com` must not be summarized back to
him as incoming-email alerts. Mail arriving from the configured owner address
(`MAIL_OWNER_INSTRUCTION_SENDERS`, falling back to the weekly-report recipient
and therefore currently `harveymeale9@gmail.com`) now takes a separate route:
its newly-written text is inserted into the ordinary durable Project Manager
queue in autonomous `execute` mode, assigned to whichever agent Harvey has
currently selected, and processed through the same runner, progress,
restart-recovery and completion path as a task submitted from the app. It does
not create a `mail_alert`, does not increment the mobile unread badge, and is
archived only after the durable task row exists. The resulting task and real
completion remain visible in the normal shared conversation, rather than as a
yellow email-summary card.

This is not based on the display address alone. During IMAP ingestion the
Namecheap adapter records whether the receiving server reported an aligned
DMARC or DKIM pass for the message's From domain. Both the exact configured
address and that authentication result are required before an email can reach
the executable queue; a spoofed From address stays in the existing tool-free,
untrusted classifier. Gmail/desktop quoted-thread markers and `>` quote lines
are removed before queuing, so instructions reflected from an earlier support
email or third party cannot become commands. A source-ref partial unique index
and deterministic task ID make the handoff idempotent across a crash between
queueing and triage completion.

On startup, historical mail-alert cards whose source was Harvey's exact owner
address are marked superseded and removed from the unread count, fixing the
already-generated self-notification that prompted this change. Existing mail
ingested before authentication metadata was stored is deliberately not
retroactively executed.

Regression coverage proves aligned authentication parsing, rejection of a
display-address spoof, silent owner routing, quote removal, archival after
queueing, and cleanup of the previous self-alert. Full suite: 50/50.

---

# 224. Ten-at-a-Time Thinker Research and 1/10 Synthesis (2026-09-26)

The Research surface is now an actual inspiration queue rather than only the
Manual's compact concept index. It maintains ten durable Big Ideas at a time
and exposes Harvey's requested workflow on every card: approve/unapprove, add
autosaved notes, mark **Not interested**, or **Send to Ideation**. Rejecting or
transferring a card queues a replacement, while **Generate a fresh 10**
supersedes the visible batch. Each generation uses a fresh exploration nonce,
shuffles the complete source pool and receives the last 40 ideas as an
anti-duplication catalogue, so browsing does not simply replay a fixed prompt.
Sending an idea creates a normal Kanban piece in
the Ideation stage with the Big Idea, Harvey's notes, source lenses, verified
Manual quotations/pages, and any 1/10 corroboration in its notes.

The source pool contains all 36 thinkers from the initial seed email plus Teal
Swan, Mark Manson, Alex O'Connor, The Mindset Mentor Podcast and Chase Hughes.
Peter Crone was already in the original 36, so the deduplicated pool is 41,
not 42. The complete named pool and its focus descriptors are sent to every
generation pass and are visible in a collapsible UI roster. Source names are
explicitly presented as intellectual lenses rather than verified attributions:
this phase has not silently invented a quotation corpus or claimed that a
specific thinker said generated wording.

Before a proposed idea is stored, generation receives all currently available
Outlier Analysis entries which are both statistically genuine 1-in-10 videos
and have a creative read derived from an actual public caption transcript.
The model may attach corroboration only when the video's premise, mechanism or
angle materially supports the new idea; no match is required. Server-side
allowlists then discard every source name, Manual concept ID and video ID not
present in the real stores. The UI labels surviving links **1/10
corroboration**, includes channel/title and relative median-view lift, and does
not use title/description text as the basis of its creative interpretation.
Manual connections likewise expand only from the canonical 35-concept index,
so every transferred quote and page is already verified against the manuscript.

Generation runs in a restart-safe SQLite job queue and reports running/error
state in the UI. An errored job occupies its intended queue slots until an
explicit retry, preventing a model outage from causing an automatic retry
storm. Regression coverage proves the 41-person pool, ten-card invariant,
approval/notes, reject and transfer replenishment, Ideation record shape,
verified-reference allowlisting, caption-only outlier eligibility and bounded
error behavior. Full suite: 52/52.

---

# 225. Measured LUFS Dialogue/Music Mixing With Legacy A/B Mode (2026-09-26)

Final Check audio no longer has to rely on a raw music percentage, which made
tracks with different masters sound unpredictably loud or quiet at the same
setting. Content Settings now defaults to **Loudness matched** and exposes four
controls: finished dialogue loudness from -18 through -14 LUFS (default -16),
music level from 15 through 25 dB below dialogue in 1 dB steps (default -20
dB), true-peak ceiling from -3 through -1 dBTP in 0.5 dB steps (default -1.5),
and optional gentle speech-triggered music ducking. **Legacy percentage** is
still selectable and reveals the old 5–30% control for direct listening
comparisons; its ffmpeg behavior remains unchanged.

The new renderer is deliberately measured rather than a renamed volume knob.
For every Final Check build it runs ffmpeg loudness analysis independently on
the uploaded video's dialogue and the selected music. It applies calculated
gains so dialogue reaches its configured LUFS target and music reaches the
configured dB relationship, optionally runs a mild sidechain compressor during
speech, and writes a temporary lossless FLAC mix. It then measures that
completed mix and uses those measured values in a true two-pass `loudnorm`
finalization, followed by a no-makeup limiter at the configured ceiling. Short
music still loops to the duration of the original audio. With no music chosen,
the dialogue is still normalized and peak-protected in Loudness mode. Temporary
audio is removed in success and failure paths.

Each built piece records the mix mode and effective settings in
`finalAudioMix`, making it possible to tell later which version Harvey heard.
Changing a global setting affects the next send/resend to Final Check; it does
not silently rewrite an already-reviewed file. Old settings records migrate in
the client to the new measured defaults, while explicit Legacy mode is
normalized server-side and retains the old percentage fallback.

Regression coverage now includes bounds/defaults for every setting, independent
dialogue and music gain calculation, loudness JSON parsing, ducking graph
selection, measured two-pass finalization and the true-peak limiter, while
retaining the prior percentage tests. Full suite: 54/54. A real five-second
ffmpeg integration render used a -43.96 LUFS dialogue source and -24.85 LUFS
music source; the intermediate mix measured -15.96 LUFS and the completed AAC
output measured -16.00 LUFS, confirming the passes affect produced media rather
than only the settings UI.

---

# 226. Buffer-Backed TikTok Scheduling Foundation (2026-09-26)

TikTok rejected Reality Manual's direct internal-use developer application, so
the supported publishing path is now Buffer rather than trying to disguise the
same prohibited use case. Buffer's current official GraphQL API was checked
before implementation: account API keys can enumerate connected channels,
`createPost` can add a TikTok video to its automatic queue, video assets require
a publicly reachable URL, and the video asset accepts a millisecond thumbnail
offset. Buffer also exposes scheduled/sent posts and per-post/aggregate metrics
for the later reporting reconciliation.

`src/bufferService.js` is a server-only GraphQL client which discovers the sole
connected TikTok channel automatically (or honors
`BUFFER_TIKTOK_CHANNEL_ID` when an account has several), rejects disconnected
or locked channels, and creates an automatic `addToQueue` video post with the
real TikTok caption and selected thumbnail time. It handles GraphQL union
errors explicitly rather than treating every HTTP 200 as success.

Buffer must fetch the finished MP4 from a URL, but the internal video library
must not become publicly browsable. `/api/buffer/media/:pieceId` therefore
serves only an existing finished video for a TikTok-tagged piece and only while
a short-lived HMAC URL is valid. The signature is derived server-side from the
Buffer credential, checked with constant-time comparison, bounded to seven
days maximum, and reveals neither the credential nor other file paths.

Final Check's TikTok action now targets `/api/buffer/publish/:id`. A successful
Buffer enqueue stores the provider, Buffer post id/status/due time and moves
the card to Scheduled rather than falsely claiming the post is already live.
The captured thumbnail's exact video timestamp is now persisted so Buffer can
use the same chosen frame. Content Settings reports **TikTok via Buffer** and
whether the server can see a usable channel; the key itself never enters the
browser settings record. The old direct TikTok implementation remains in place
only for historical records and is no longer called by the UI.

The live secret is deliberately not committed. `.env.example` documents
`BUFFER_API_KEY`, optional `BUFFER_TIKTOK_CHANNEL_ID`, and
`BUFFER_MEDIA_BASE_URL`. Per the repository's hard credential boundary, an
agent may build the integration but Harvey must place the raw key into the VPS
`.env` himself before the status check and real channel discovery can run.

Regression coverage uses a synthetic credential and mocked Buffer server to
prove authenticated GraphQL calls, automatic channel discovery, queue payload,
thumbnail offset, signed media acceptance/rejection, ambiguous-channel refusal
and safe missing-configuration status. Full suite: 56/56.

---

# 227. Complete Buffer TikTok Queue, Lifecycle Reconciliation, and Metrics (2026-09-26)

The Buffer foundation in §226 now operates as a complete publication pipeline,
not a one-way queue submission. The real personal API key and connected TikTok
channel were verified without exposing the credential: Buffer identifies the
channel as `the.reality.manual`, connected/unlocked, automatic queue active,
timezone `Asia/Bangkok`, and no existing Buffer posts at implementation time.
Its live capability response includes `scheduleUpdates`, `viewInsights`,
`video.publish` and `video.insights`, so both unattended publishing and the
performance reads are authorized rather than inferred from connection alone.

Final Check still sends the finished MP4, TikTok caption and selected thumbnail
offset to Buffer with `addToQueue`; Buffer's channel schedule is authoritative
and its returned `dueAt` is what Content Studio shows. The connected channel is
currently configured for **two** posting slots on every day, not the intended
three, so Harvey must add a third daily time in Buffer's TikTok posting schedule.
The Settings connection card now reads Buffer's real timezone and schedule and
shows the daily slot count, making future drift visible inside Content Studio.

`src/bufferPublicationSync.js` runs every 15 minutes and reads each tracked
Buffer post's real lifecycle. Scheduled/sending items remain in Scheduled;
`sent` moves the Kanban card to Posted / Live with Buffer's `sentAt` and public
TikTok URL; `error` returns it to Final Check with Buffer's human-readable error
and support link. Temporary API failure never moves the affected card and never
blocks reconciliation of the other cards. To protect edits made while a network
request is in flight, the server merges only Buffer-owned fields into the
newest record rather than saving an older whole-card snapshot. The open Content
Pipeline refreshes records every minute (while no editor is open), so delayed
Buffer state changes appear without a manual browser reload.

The same post read imports Buffer's normalized metrics—views, reactions/likes,
comments, shares/reposts and any future metric types—plus `metricsUpdatedAt`.
Tracked metrics and a direct TikTok link appear on Kanban and Content Production
cards. The weekly report now fetches current Buffer metrics, measures view gains
against its prior weekly snapshot, and reports TikTok lifetime/new views,
reactions, comments and shares alongside YouTube. Buffer itself refreshes social
metrics about daily, so the 15-minute local sync cannot make upstream numbers
fresher than Buffer's last ingestion.

Protected status/run endpoints expose the synchronizer health for diagnostics;
environment settings allow disabling it or changing the 900,000 ms interval.
Regression coverage now includes real-shaped Buffer post reads, scheduled/sent/
error transitions, metrics storage, partial API failure isolation, and TikTok
weekly-report metrics. Full suite: 59/59. Real Chromium at 1440×900 and 390×844
confirmed the connected Buffer card and revised settings copy without overflow
or runtime errors.

---

# 228. Explicit Content Studio Caption Handoff to Buffer (2026-09-26)

Final Check's Buffer request now carries the rendered TikTok text under an
explicit `caption` field all the way to the server, rather than overloading a
field named `title`. The value is still produced by `captionsForPiece()`, so it
comes from the independently editable **Content Settings → Short-form →
TikTok** caption template after platform rendering and link policy are applied.
Buffer receives that exact string as its post `text`; only an actually empty
TikTok caption falls back to the piece title. The server temporarily accepts
the old `title` field as a compatibility fallback for browser tabs that were
already open during deployment.

The mocked Buffer regression now asserts the exact caption text in the GraphQL
`CreatePostInput`, preventing a future refactor from silently substituting the
card or YouTube title.

---

# 229. Direct Meta Connection Shell and Platform-Specific Cadence UI (2026-09-26)

Content Settings now has a protected **Facebook + Instagram · direct**
connection card. Harvey can enter the Meta App ID and App Secret there rather
than touching the VPS console. They are POSTed to an admin-only endpoint and
stored in a dedicated `meta_oauth` database row alongside the resulting tokens;
the secret and tokens are never returned to the browser or placed in the shared
settings JSON. Reopening Settings reveals only the non-secret App ID and whether
a secret exists. Changing the App ID invalidates tokens from the prior app.

The new first-party OAuth flow uses Meta Graph API v26, a CSRF state cookie and
the fixed callback `https://ops.realitymanual.com/api/meta/oauth/callback`. It
requests only Page discovery/publishing/insight and Instagram professional
publishing/insight permissions. After authorization it exchanges the short
grant for a long-lived token, discovers managed Pages, prefers the Page linked
to an Instagram professional account, and stores the Page token plus Page and
Instagram identities. This change establishes and verifies the credential and
account connection; actual Facebook/Instagram upload and reconciliation are the
next phase once Harvey supplies real credentials so their live API shapes can
be tested without inventing a successful publish.

Publishing cadence is now explicit about ownership. The editable `shorts`
cadence is labelled **Direct short-form (YouTube Shorts / Instagram /
Facebook)**, longform is **Direct longform (YouTube / Facebook)**, and TikTok is
excluded from both. TikTok gets a separate read-only seven-day schedule populated
from Buffer's live channel response, including every queue time and timezone,
with a note that changes belong in Buffer. Obsolete plaintext Instagram and
Facebook API-key fields were removed; their platform credentials now belong to
the protected Meta card.

Regression coverage verifies the exact Meta scopes, authorization URL, token
exchange and linked Page/Instagram discovery. The full suite passes 61/61. A
real Chromium run at 1440×900 and 390×844 confirmed the new cadence and Meta
controls render without horizontal overflow or runtime errors; a local API
round-trip additionally proved the stored App Secret never appears in status
responses.

Meta's app-settings form also requires a public user-data deletion instruction
URL even though Content Studio has no public users. `public/data-deletion.html`
now provides the truthful first-party process: disconnect Meta from Content
Settings to remove stored tokens/identifiers, revoke through Meta directly, or
email support for a verified deletion request. The privacy policy links to it.
This satisfies the platform form without pretending that the private tool has
a public customer-account system.

---

# 230. Meta Connection No Longer Blocked by an Unsupported Insights Scope (2026-09-26)

The first live owner authorization exposed a difference between Meta's current
Facebook Login for Business permission surface and older Instagram Graph API
examples: `instagram_manage_insights` was rejected by the OAuth dialog as an
invalid scope for this app. It is not part of the app's installed Instagram
content-publishing bundle, and the similarly named
`instagram_business_manage_insights` belongs to the separate Instagram Login
flow rather than this Facebook Login flow.

The initial connection now requests only the permissions the configured flow
actually exposes: Page discovery, Page publishing/read/insights, Instagram
basic identity, and Instagram content publishing. Instagram analytics is
deliberately deferred instead of preventing Facebook and Instagram publishing
from connecting at all. The regression test now explicitly rejects both
incompatible Instagram insight scope names so they cannot silently return to
the authorization URL.

The first successful grant also showed why the destination cannot be inferred:
the owner token returned five managed Pages, and the old callback silently
picked Health Sense Exercise Physiology merely because it was the only returned
Page with a linked Instagram account. Reality Manual was not present in Meta's
`/me/accounts` response at all. Content Settings now lists every Page actually
available to the grant and requires an explicit publishing destination. Page
access tokens remain server-only. A new authorization auto-selects only when
Meta returns exactly one Page, or retains a previously explicit choice; it
never guesses among multiple Pages. Reality Manual must first be added to the
authorized business portfolio/Page selection before it can appear in this
list.

A subsequent check of Meta Business Settings showed that The Reality Manual
was already the sole Page in Harvey's portfolio and that Harvey had full
access. The real mismatch was the authorization request: Meta's current
Facebook-login Instagram content bundle explicitly includes
`business_management`, but the first implementation had not requested it.
That omission allowed `/me/accounts` to return older directly managed Pages
while omitting the portfolio-owned Reality Manual Page. The OAuth scope list
now includes `business_management`; Harvey must disconnect/reconnect once to
grant it, after which the explicit selector can see portfolio assets without
reintroducing the invalid Instagram-insights scope from above.

Meta login itself still correctly identifies Harvey through his personal
Facebook profile—business portfolios are not separate login identities. Page
discovery now reflects that distinction in code: it merges directly assigned
`/me/accounts` Pages with every portfolio's `/owned_pages` reached through
`/me/businesses`. The selector labels portfolio-derived destinations, dedupes
Pages returned by both edges, and still never returns Page access tokens to the
browser. Until an older grant is reauthorized with `business_management`, a
portfolio lookup failure gracefully leaves the direct Page list usable.

---

# 231. Coordinated Facebook, Instagram, YouTube, and TikTok Publishing (2026-09-26)

Final Check's single **Schedule Video** action now covers every platform in
the piece's selected platform list: long-form YouTube, YouTube Shorts, TikTok
through Buffer, Instagram Reels, and Facebook Page video. Short-form defaults
therefore publish to all four intended short destinations; long-form defaults
publish to YouTube and Facebook. Each destination receives its own rendered
Content Settings caption, preserving the established link policy (Facebook
and long-form YouTube can carry the tracked link; Shorts, Instagram and TikTok
remain link-free). The chosen title and YouTube visibility still come from
Final Check.

The browser now starts one protected `/api/publish/:id` batch rather than
launching one competing request per platform. The server runs destinations
sequentially, stores independent status/error/id/link fields, keeps the card in
Final Check while work is running or any destination has failed, and retries
only failed destinations—already-successful platforms are never posted twice.
When every immediate destination succeeds the card becomes Posted / Live; a
batch containing Buffer TikTok remains Scheduled until Buffer's existing
lifecycle reconciliation observes the queued TikTok post going live.

Facebook uploads the reviewed `<piece>-final` MP4 directly to the selected
Reality Manual Page's Video API with the Facebook caption. Instagram creates a
Reels container for the linked `@therealitymanual` professional account,
waits for Meta to finish ingesting it, publishes it, and stores the resulting
media id/permalink. Meta must fetch Reel media from a URL, so
`/api/meta/media/:id` exposes only an Instagram-tagged finished video behind a
one-hour HMAC URL derived from the server-only App Secret; it provides no
directory listing and reveals no credential. `META_MEDIA_BASE_URL` documents
the public origin override.

Regression coverage uses mocked Meta responses to verify Facebook multipart
caption/video handoff, the complete Instagram create/process/publish/permalink
sequence, and rejection of tampered signed media URLs. The full suite passes
65/65. Per Harvey's explicit direction, verification did not create a live
Facebook or Instagram test post; the first real video will provide the live
platform acceptance check, and any platform-specific rejection remains visible
on its Final Check card without blocking or duplicating the others.

---

# 232. Kanban Column Scroll Survives Editor Open/Close (2026-09-27)

Closing the shared piece editor used to return every Content Pipeline column to
its top. The close callback redraws the Kanban so edits are visible, and
`render()` preserved the board's horizontal offset but replaced every
`.column-body` without preserving its independent vertical offset. This was most
noticeable in a long stage such as Outline Completed: opening a card halfway
down, then closing it, forced Harvey to find the same position again.

`render()` now captures every column body's `scrollTop` keyed by stage before
replacing the board markup and restores those offsets onto the corresponding
new elements immediately afterward. Keying by stable stage id rather than
column order keeps restoration correct across filtering, card moves, and future
stage additions. Because the fix lives in the shared redraw path, it also
protects scroll position during autosave/background refresh renders instead of
only special-casing the editor's close button.

---

# 233. Facebook Captions Are Entirely User-Controlled (2026-09-27)

Facebook publishing neither forces nor suppresses an outbound link. Harvey
chooses the complete caption in Content Settings and can decide per template
whether the post should contain a direct URL, link-in-bio wording, or no CTA.
The system does not append a fixed CTA and does not remove literal URLs.

Both short-form and long-form Facebook captions support the optional `[LINK]`
token, which expands in place to the per-piece tracked store URL. If the token
is absent, no URL is added; a literal pasted URL is preserved exactly. Long-form
YouTube retains the same optional tracked `[LINK]` behaviour. YouTube Shorts,
Instagram and TikTok remain link-free as before.

Content Settings explains this behaviour beside the platform-specific caption
fields. This keeps the reach-versus-attribution choice where it belongs: in the
caption Harvey selects, rather than hidden publishing policy.

---

# 234. Mobile Storefront Navigation CTA Has a Complete Border (2026-09-28)

The landing page's expanded mobile menu used the same bottom-border rule for
ordinary navigation links and the outlined **Get Your Copy** button. A more
specific mobile override then removed the button's bottom border in an attempt
to suppress the ordinary link divider, leaving the CTA looking visibly cut off
on phones. The mobile rule now restores the CTA's warm outlined bottom border,
so all four edges render consistently while About and FAQ retain their divider
lines.

---

# 235. Branded Transactional Email Templates and Resend Preview Delivery (2026-09-28)

The storefront backend now has a reusable Resend delivery client and three
production-shaped customer email templates: order accepted/entering production,
BookVault dispatch with an optional tracking button, and the exceptional refund
notice used when fulfillment cannot be completed. Every message has both inline
HTML and plain-text bodies, escapes all order/customer data, supports Resend
idempotency keys, and uses the verified Reality Manual sending identity and
reply-to address supplied through private environment variables.

The visual treatment deliberately matches the storefront rather than Resend's
generic examples: deep black and warm ivory surfaces, restrained gold rules,
serif editorial typography, responsive table-based markup, and no remote image
dependency. The confirmation copy presents the up-to-15-working-day production
window as the result of printing, binding and finishing each volume to order by
a specialist European book printer, with the intended payoff of a book made to
last a lifetime. The dispatch template accepts BookVault's carrier, tracking
number and tracking URL; if no tracking URL is supplied, it does not render a
dead button.

`npm run email:previews` sends clearly marked, synthetic previews of all three
templates to `PREVIEW_EMAIL_TO`, without creating an order, charging Stripe or
contacting BookVault. Automated coverage verifies escaping, production-window
copy, money formatting, conditional tracking, refund language, and the exact
Resend request shape. A real Chromium rendering at desktop email width confirmed
the inline design and content layout before the first preview send.

---

# 236. Transactional Email Copy Revision and Safe Preview Recipient (2026-09-28)

Harvey approved the email color scheme and layout but asked for warmer copy that
better communicates the care invested in each copy. The confirmation subject and
headline are now **“We’re Making Your Copy of The Reality Manual”**. Its body
explains that every copy is individually printed, bound, finished and inspected,
and frames the production window as time spent making a lasting volume rather
than as transactional delay.

The exceptional fulfillment-failure email now uses **“We couldn’t complete your
order.”** as both its subject and headline. It confirms the refund, asks the
customer to try once more, links directly back to checkout with a prominent
**Try Your Order Again** button, and explains that the team will follow up if a
second attempt encounters the same issue.

The manual preview recipient is now stored once in the VPS backend's private
`PREVIEW_EMAIL_TO` environment variable. Preview commands should use that value
instead of typing or remembering a recipient ad hoc. This corrects the earlier
one-character address mistake and prevents future preview sends from repeating
it; the personal address itself remains out of git.

---

# 237. Warmer Email Voice, No Em Dashes, and BookVault Delivery Estimates (2026-09-28)

Harvey's second email review established three explicit copy rules for customer
messages: sound genuinely pleased and appreciative rather than merely
transactional, use consistent title capitalization, and use absolutely no em
dashes. A regression now scans the complete subject, HTML and plain-text output
of all three messages for em dashes. The preview banner and edition label were
also rewritten so the prohibition applies to every visible part of an email,
not just its paragraphs.

The order confirmation now says the team is delighted to begin, describes the
printer as a creator of bespoke books, explains the individual inspection and
attention each copy receives, and thanks the customer for allowing the time to
make it properly. The dispatch message opens with “Wonderful news,” thanks the
customer for their patience, celebrates the completion of their book and sets an
expectation for how special it should feel to open. The failure message retains
the one-retry instruction and support promise without using dash punctuation.

BookVault's current `POST /Dispatch` response was rechecked against the live API
and its OpenAPI schema. Each selected service provides `MinDeliveryDays` and
`MaxDeliveryDays`; a live USPS Consolidator quote returned 1 and 8 working days.
The BookVault client now preserves those fields, checkout stores the selected
service and delivery-day range on the order, and the dispatch template shows the
range as working days after dispatch. If BookVault returns zero or no estimate,
the email gracefully omits the range rather than inventing one. Existing
databases gain the three nullable shipping fields through the same idempotent
startup-migration pattern used by earlier order columns.

Five template/delivery tests pass, a temporary real SQLite order confirmed the
new service and estimate fields persist, and real Chromium renders of all three
emails at 390 px showed no horizontal overflow.

---

# 238. Routine Security Emails Never Become Project Manager Alerts (2026-09-28)

Harvey confirmed the replacement Facebook Page is connected and reiterated that
routine security mail must not appear in Project Manager. Mail triage now has a
deterministic suppression rule for verification/security/authentication/login
codes, PINs, OTP and two-factor messages, routine new-login alerts, and automated
password-reset notices. This rule runs after ingestion but before either the AI
classifier or the existing “important security issue” safeguard can create an
alert. The original message is still archived in Mailbox, so suppression affects
only Project Manager notifications and does not delete the email.

On startup, Content Studio also finds any older Project Manager alert whose
source email matches this routine-authentication rule, marks the alert as
superseded/read, and removes its topic pointer. This cleans up the prior noisy
card as well as protecting future mail. A regression deliberately returns an
`important: true` security classification for a Meta verification code and a
Meta new-login warning; both are archived with zero Project Manager alerts.

---

# 239. Paid Order Fulfillment Is Wired, with an Explicit Live-Mode Gate (2026-09-28)

A go-live audit found that the storefront could create and confirm Stripe
PaymentIntents, quote BookVault shipping and render all three customer emails,
but these pieces were still disconnected: `payment_intent.succeeded` only set
`PAYMENT_RECEIVED`. It did not create a BookVault order, send confirmation mail,
watch for dispatch or refund an order BookVault could not accept. This was a
real launch blocker because a customer could otherwise be charged without
fulfillment.

The backend now has a durable fulfillment worker. A successful **live-mode**
Stripe event records payment and queues its SQLite order. The worker submits
`POST /Order?payMethod=Saved` using the customer's complete address, the title
ISBN and the exact BookVault service selected during checkout. The internal
order UUID is BookVault's `DocRef`; the client always queries that reference
before a POST, so a Stripe retry, process restart or lost BookVault response
cannot create a duplicate print order. An accepted `PodRef` is persisted before
Resend is called. Confirmation-email failures are retried separately and can
never refund or resubmit an already accepted print order.

Accepted orders are polled every 15 minutes with `GET /Order?PodRef=...`.
When `Progress.Status` becomes `Dispatched`, the bespoke shipping email is sent
once using BookVault's carrier, tracking number and combined tracking URL when
available. Submission failures use a widening retry schedule. After the final
attempt Stripe issues one idempotent full refund and Resend sends the failure
and retry email. Worker state, attempt times and all three email timestamps are
persisted, so the flow survives container restarts. Eight automated tests cover
the existing email contracts, exact BookVault order payload, accepted-order
state, tracked dispatch and the critical rule that a mail outage cannot refund
an accepted order.

Because BookVault has no sandbox, two independent safeguards prevent a Stripe
test payment from printing a real book: fulfillment candidates must have
`stripe_livemode = 1`, taken from Stripe's signed event, and the private
`FULFILLMENT_ENABLED` environment flag must explicitly be `true`. It remains
false while test Stripe keys are installed. The final go-live sequence is:
Harvey approves the physical proof, installs the live Stripe publishable and
secret keys plus a separate live-mode webhook signing secret, changes the
frontend publishable key, then enables fulfillment. No order or BookVault
submission was created during this implementation.

---

# 240. Controlled Card, Wallet and Link Checkout (2026-09-28)

Harvey chose a deliberately small launch payment-method set rather than either
card-only checkout or every method enabled in Stripe: ordinary cards, eligible
Apple Pay, eligible Google Pay and Link, including Link Instant Bank Payments
when Stripe offers that funding source to an eligible US customer. In Stripe's
API these are the controlled `card` and `link` types: `card` also powers Apple
Pay and Google Pay, while Link requires both types. Klarna, Afterpay, Cash App
and direct `us_bank_account` ACH Debit remain excluded. This keeps the $65 book
checkout uncluttered and avoids delayed ordinary ACH settlement while retaining
the lower-friction wallets and Stripe-managed instant bank option.

The backend PaymentIntent and the client-side deferred Elements configuration
now use the same exact `['card', 'link']` list. A regression locks that list and
specifically proves that ordinary ACH and BNPL methods are absent. Stripe's
`payment_intent.processing` webhook is now persisted as `PAYMENT_PROCESSING`,
and the confirmation page explains that fulfillment waits for confirmed funds;
only the existing signed `payment_intent.succeeded` path can enter BookVault.
Nine backend tests pass and both checkout scripts parse cleanly.

The go-live audit also confirmed that the VPS and public storefront still have
only `sk_test_` and `pk_test_` credentials, the current webhook is a sandbox
endpoint, and `FULFILLMENT_ENABLED` remains false. Live Stripe objects are
separate rather than a mode bit the application can toggle. Harvey must place
the live publishable key, live secret key and the signing secret from a new
live-mode webhook endpoint into the private environment directly. Until then,
the controlled payment-method change can be deployed and exercised only in
Stripe's sandbox, and no BookVault order can be created.

---

# 241. Stripe Live Mode Activated Without Placing an Order (2026-09-28)

Harvey installed the three separate live Stripe values directly in the private
VPS environment: `pk_live_`, `sk_live_` and the signing secret from the new
live webhook destination. `FULFILLMENT_ENABLED` is also true. A sanitized API
audit confirmed that the destination is a live, enabled endpoint at
`https://api.realitymanual.com/api/webhooks/stripe` and listens for all three
events the backend needs: `payment_intent.processing`, `.succeeded` and
`.payment_failed`. Listening to additional events is harmless because the route
acknowledges and ignores unknown types.

The payment-method domain `realitymanual.com` is now registered, enabled and
validated in **live mode**. Stripe reports Apple Pay, Google Pay and Link all
active. The account's live default payment-method configuration reports Card
and Link active, with Klarna, Afterpay/Clearpay and ordinary US bank account ACH
off, matching §240's intended launch set.

One final drift hazard was removed during activation. The static site formerly
embedded its own publishable key in `frontend/js/config.js`, which meant a
future server key rotation could silently leave the browser and backend in
different Stripe modes. The backend now exposes only its safe-to-publish active
key at `GET /api/config/stripe`; checkout fetches that before constructing
Elements and keeps the payment button disabled if it cannot load. The raw key
therefore remains sourced exclusively from the private VPS environment while
still reaching the browser as Stripe requires. No PaymentIntent, charge,
customer order or BookVault order was created during the live-mode audit.

---

# 242. Project Manager Recorder Recovers from Fresh-Session Mic False Starts (2026-09-28)

Harvey reported an intermittent first-recording failure in the mobile Project
Manager: after pressing the green voice button, the UI briefly said
"Listening" and Android announced that the call had ended, forcing him to
start over. The shared recorder previously considered `getUserMedia()` success
and a synchronous `MediaRecorder.start()` call sufficient proof that recording
had begun. A fresh Android/Chrome audio session can grant that stream and then
end it immediately during device/audio-session setup, so the UI could accept an
already-dying recorder and capture nothing.

`public/lib/voiceClient.js` now gives a newly opened recorder a 600 ms liveness
window. It confirms that the recorder is still in `recording` state and at
least one input track is still live before returning it to the page. If the
recorder errors or stops inside that startup window, the dead stream is cleaned
up and the microphone is acquired once more automatically. This is intentionally
separate from the abandoned Bluetooth call-tone suppression attempts in
§86/§103/§105/§106: it does not change routing, cache a stream, or claim to
silence Android's headset notification; it prevents an immediate audio-session
drop from becoming a false successful recording. `stop()` is also now safe if
the recorder has already become inactive, rather than waiting forever for a
`stop` event that already happened.

`voice-mobile.html` says "Starting microphone…" during that proving/retry
window and changes to "Listening…" only after the recorder is genuinely live.
Its flow id also makes cancelling during startup safe: a late recorder is
immediately stopped instead of continuing invisibly behind a closed overlay.
Both entry pages use a new cache-busting URL for the shared client.

A new Node regression simulates the first stream stopping after 20 ms, proves
that a second stream is acquired, and verifies that the stable take stops and
returns audio normally. The complete ops-service suite passes (67 tests). A
real Chromium mobile-viewport test exercised the actual `voice-mobile.html`
flow with the same first-stream interruption: the UI progressed from
"Starting microphone…" to "Listening…", made exactly two mic acquisitions,
kept the recording overlay open, and produced no page errors.

---

# 243. Big Idea-to-Completed-Outline Learning Trail (2026-09-28)

Harvey wants Content Studio to learn the transformation he performs between a
promising Big Idea and an Outline Completed card, so Project Manager can
eventually produce a useful first outline rather than requiring him to develop
every premise from zero. This is separate from §173's Big Idea generator
learning: that system learns which premises Harvey selects; this one learns how
he develops a selected premise into an outline.

`src/outlineLearningService.js` adds four normalized, admin-only data sets:

- immutable/coalesced content snapshots across `big_ideas`,
  `outline_started`, and `outline_completed`;
- one durable trajectory record per Kanban piece;
- restart-safe analysis jobs; and
- one compact, inspectable outline-development profile built from completed
  trajectories.

Every normal admin Kanban piece write now passes its persisted before/after
states to this service. Entering or leaving a tracked stage always records an
exact checkpoint. Ordinary edits are recorded as full snapshots with structured
title, word-count, character-count, heading, and changed-field metadata, but
edits inside the same ten-minute authoring burst coalesce into one checkpoint
so contentEditable autosaves do not manufacture hundreds of meaningless
keystroke revisions. Reviewer-owned audit content is excluded. Tracking errors
are logged but can never reject the primary Kanban save.

When a tracked piece reaches Outline Completed, analysis waits ten quiet
minutes. Any further completed-outline edit postpones or reruns it, preventing
the learner from treating an intermediate autosave as final. The selected
Content Ideation provider then receives the actual first/last Big Ideas
snapshots, first/last Outline Started snapshots, final Outline Completed
snapshot, and current learned profile. It records both an audit per trajectory
and a revised compact profile covering preserved ideas, transformations,
reasoning moves, structure, style, future-draft instructions, avoids, evidence
counts, confidence, and uncertainty. Reanalyzing a later edit refines the same
example rather than inflating the number of independent examples.

Project Manager automatically receives that compact profile on future messages
about outlines, Big Ideas, hooks, scripts, video ideas, or the Kanban. Unrelated
operational turns pay no context cost. The raw system is also inspectable at
admin-only `GET /api/outline-learning/state` and a piece's complete trajectory
at `GET /api/outline-learning/pieces/:id`; failed analyses remain visible and
explicitly retryable through `POST /api/outline-learning/jobs/:id/retry`.

Existing historical completed outlines are deliberately **not** reverse-labelled
as training examples because the database does not contain their original Big
Idea versions. On first startup, the system instead establishes honest
`tracking_baseline` snapshots for every card currently in Big Ideas and learns
forward from there. An in-memory migration using the live production records
confirmed that all 31 current Big Ideas become 31 trajectories/31 snapshots and
zero fake analyzed examples.

Verification includes two dedicated service regressions: the full
Big Ideas → edited Big Idea → Outline Started → developed outline → Outline
Completed path, coalescing, strict before/after prompt contents, profile update,
same-piece reanalysis without sample-count inflation, and real-record baseline
backfill. The complete ops-service suite passes (69 tests), both changed runtime
files pass syntax checking, and the migration was exercised against an in-memory
copy of every live piece rather than writing to production during development.

---

# 244. Short-Form Platforms Share Buffer's Fixed Bangkok Release Slots (2026-09-28)

Harvey reduced the short-form cadence from three rolling posts per day to two
fixed daily releases at **12:00 AM and 12:00 PM in Asia/Bangkok (GMT+7)**. TikTok
continues to own its queue in Buffer, but YouTube Shorts, Instagram and Facebook
must now release alongside it rather than publishing immediately when Final
Check's **Schedule Video** button is pressed. Longform remains on its existing,
separate rolling cadence and was deliberately not changed.

The coordinated publish job now queues TikTok first and treats Buffer's returned
`dueAt` as the authoritative release instant for the whole short. The exact
direct-platform payloads (title, rendered platform caption and YouTube privacy)
are persisted on the piece, which moves to Scheduled. A backend worker checks
every 30 seconds and uploads the direct destinations when that shared timestamp
arrives. The payload survives a container restart; a restart before the slot
does not publish early or lose the queue. If a short is intentionally not tagged
for TikTok, Content Studio reads Buffer's current seven-day schedule and selects
the next Bangkok slot itself, falling back to midnight/noon every day only when
Buffer's schedule is unavailable. This also means a later Buffer time/day change
is mirrored instead of requiring a second independent cadence setting.

Content Settings no longer presents direct short-form as an editable rolling
"1 every N hours" control. It explains the shared schedule, shows the Buffer
times/timezone, and retains only the independently editable longform cadence.
The older browser-side approval path was also changed from interval arithmetic
to Bangkok midnight/noon slots so it cannot create contradictory timestamps.

No live social post was created, following Harvey's instruction that the first
real content should be the integration test. Automated coverage locks Bangkok
midnight/noon UTC conversion, day pauses, future Buffer slot changes and the
safe fallback. The complete ops-service suite passes (72 tests). Real Chromium
at 1440×900 and 390×844 confirmed the Settings surface shows only the longform
rolling control, shows the shared short-form schedule, has no runtime errors and
has no horizontal overflow.

---

# 245. Three-Day Longform Releases at a Selectable Bangkok Midpoint (2026-09-28)

Harvey finalized Buffer at two daily TikTok slots around **1:55 AM and 1:55
PM Asia/Bangkok** and changed longform from the prior 70-hour interval to one
release every three days. The intended default longform time is **7:55 AM
Asia/Bangkok**, exactly halfway between the two nominal short slots, so a
YouTube/Facebook longform post never lands on top of either daily short.

Content Settings now presents longform as **Every 3 days at [time]
Asia/Bangkok** with a native time field. The stored default is `07:55`, and
existing production settings are migrated explicitly during deployment to
`cadence.longform = { every: 3, unit: 'days' }` plus
`longformScheduleTime = '07:55'`. The old rolling number/unit editor is gone;
the cadence decision is fixed while the release time remains easy for Harvey to
adjust later.

This is real publication scheduling, not UI-only metadata. Pressing **Schedule
Video** on a longform piece now persists the fully rendered YouTube/Facebook
payload and moves it to Scheduled. The same restart-safe 30-second release
worker used by direct short-form publishes it at the selected Bangkok time.
Each subsequent longform uses the previous scheduled longform's Bangkok
calendar date plus three days, which is exactly 72 hours when the selected time
is unchanged. Changing the time deliberately shifts the next three-day release
to the new wall-clock time. The legacy client-side approval route uses the same
calculation, so it cannot display a contradictory timestamp.

No social post was created. Two new regressions cover the 7:55 Bangkok UTC
conversion, first-slot rollover, three-day recurrence, and invalid-time
fallback. The complete ops-service suite passes (74 tests). Real Chromium at
1440×900 and 390×844 confirmed the new field defaults to 07:55, renders without
runtime errors, and causes no horizontal overflow.

---

# 246. Project Manager Speech No Longer Plays Faster Than It Arrives (2026-09-28)

Harvey reported that Codex's spoken acknowledgments repeatedly cut to silence
and resumed a few seconds later on multiple devices. This was not a device or
Bluetooth problem. A production trace reproduced the exact failure: one
nine-second acknowledgment arrived from OpenAI as roughly one-second MP3 bursts
separated by gaps of 11 to 16 seconds. The browser's MediaSource path started
playback after the first decodable network chunk, exhausted that tiny buffer,
then stalled until each later burst arrived.

Project Manager now buffers the complete TTS response before beginning
playback. The existing play token still discards a response if Harvey presses
Stop, begins recording, or requests newer speech while it is downloading, but
once audio starts it has the entire sentence available and cannot underrun due
to an uneven provider transfer. The voice, model and spoken wording are
unchanged. A VM regression presents a response explicitly marked as streaming
on a browser that claims MP3 MediaSource support and proves the client reads the
complete Blob, never opens the chunk reader, and starts playback exactly once.

---

# 247. Outlier Reads Separate the Source Idea from the Manual Synthesis (2026-09-28)

Harvey found the competitor outlier cards draining to read because their
`Topic`, `Big idea`, and `Angle` fields blended a creator's position into the
editorial interpretation without making either boundary clear. The cards now
have exactly two readable sections: **Their idea** and **Reality Manual angle**.
Each uses short, normal-weight body paragraphs. The source section also shows
one to three visually distinct direct quotations, while the Manual section has
its own subtle treatment instead of another run of bold labels. The desktop
board now uses two wider columns rather than three narrow ones and remains one
column on mobile.

This is not only a presentation change. Caption analysis now receives the
canonical Reality Manual concept map and returns a structured two-part read:
one to three source-summary paragraphs, one to three verbatim caption excerpts,
and one to three paragraphs identifying the relevant Manual principle plus the
specific agreement, extension, reframe, or challenge Harvey could develop.
The prompt expressly forbids mixing Manual claims into the creator summary or
merely restating the creator in the Manual section. Every returned source quote
is normalized only for whitespace and quotation marks and then checked against
the actual retrieved transcript; if none is genuinely present, the analysis is
rejected rather than displaying invented evidence.

Creative reads carry schema version 2. Cached version-1 reads are not silently
reused or disguised as the new format: the UI asks for a caption-read refresh,
and the normal refresh path regenerates them. The downstream Research idea
service accepts both legacy reads and the new source/quote/Manual structure so
the schema upgrade does not erase outlier corroboration from future idea
generation.

Automated coverage includes versioned caching, Manual-map prompt grounding,
new-field persistence, downstream Research consumption, and rejection of an
invented quote. The complete ops-service suite passes (78 tests). Real Chromium
at 1440×1000 and 390×844 verified the section labels, paragraph and quote
counts, normal 400-weight body copy, zero runtime errors, and no horizontal
overflow.

The same boundary now applies to the ten **Idea Research** cards, which were
the more important instance of Harvey's feedback: their previous `big_idea`
field mixed a named thinker's position directly into the Manual's conclusion,
despite having no stored source passage behind the attribution. The research
runner is no longer tool-free. It receives only `WebSearch` and `WebFetch`
(still no shell, filesystem, editing, browser-control, or MCP tools), and must
open a real public source before returning an attribution. For every new card
it stores:

- one to three plain-language **Their idea** paragraphs containing no Manual
  claims;
- one to three under-25-word direct quotations, each with the allow-listed
  thinker name and the exact HTTPS source page;
- one to three independent **Reality Manual angle** paragraphs; and
- allow-listed canonical Manual concepts and optional verified outlier links.

The UI renders the two positions side by side on desktop and stacked on mobile,
using normal-weight, Twitter-like paragraphs rather than one continuous bold
block. Source quotations are visually offset and link back to the evidence.
The Manual panel names the relevant concepts separately. Transferring a card to
Ideation preserves this exact source/evidence/synthesis structure in the new
Kanban card rather than collapsing it back into blended prose.

The display also breaks long model paragraphs at sentence boundaries into
roughly tweet-sized blocks (about 380 characters) without truncating or
rewriting their content. Future generation explicitly asks for one point and
fewer than 70 words per paragraph, so the interface remains skimmable even
when a synthesis needs several distinct steps.

Migration `source_manual_split_v1` preserves the prior unsplit rows as
`superseded` history and replaces the active queue, because there is no honest
way to infer where the source claim stopped and the Manual synthesis began in
those old paragraphs. The ten production rows had no approvals and no notes
before migration. Real Chromium at 1440×1000 and 390×844 verified both panels,
the linked quotation, normal 400-weight copy, and no horizontal overflow.

Source research runs are deliberately capped at two cards. Each card requires
live search and an opened evidence page, and the first ten-card production run
hit its four-minute deadline before it could return anything. Two-card jobs
finish and persist independently; the queue keeps adding two at a time until
the ten-card target is full. They are also partial-success tolerant: if one
candidate lacks a valid allow-listed thinker, HTTPS evidence URL, direct
quotation, Manual concept, or separated paragraph set, the sound card is saved
and only the remaining capacity is researched later. A batch with zero valid
sourced ideas becomes a visible retryable error.

The research runner's two web tools are named in both `tools` and
`allowedTools`. The distinction matters in the Agent SDK: `tools` makes a tool
available to the model, while a headless `dontAsk` session still denies its
execution unless `allowedTools` explicitly grants it. The first production
attempt exposed this by correctly refusing to fabricate a quote after both web
calls were denied. A live smoke test now proves the restricted runner can
search, open an HTTPS source page, and return a sourced quotation while still
having no shell, filesystem, edit, browser-control, or MCP access.

---

# 248. Project Manager Auto Voice Can Be Muted Before It Starts (2026-09-28)

Harvey sometimes wants to dictate a request without hearing the immediate
spoken acknowledgment over audio already playing in his headphones. The
existing per-message Stop button only became useful after playback had begun,
so both Project Manager views now have an always-visible **Auto voice** toggle.
Turning it off immediately cancels audio that is playing or still being
synthesized, and suppresses automatic early acknowledgments, quick final
answers, errors, and the mobile execute acknowledgment. Every message's manual
Play button remains available, because the preference gates only automatic
call sites rather than disabling `Voice.speak()` itself.

The preference is stored in same-origin localStorage and therefore survives a
reload and is shared by the desktop and mobile views on that browser/device.
The button changes to **Voice muted**, exposes the state through `aria-pressed`,
and synchronizes across open tabs through the storage event. Desktop avoids a
listener leak when its Project Manager panel is reopened. A VM regression
starts a pending TTS request, disables Auto voice before its response arrives,
and proves the stale audio never starts while the muted preference persists.

---

# 249. Ambient Track Auditioning and Loudest-Passage Calibration (2026-09-28)

Content Settings now has a **Test a voice recording** panel for evaluating
the ambient library before a real video reaches production. Harvey can upload
a local spoken audio or video sample, select any saved ambient track, and
build an MP3 audition. The spoken sample and rendered preview are temporary;
neither is added to the content library. The backend preview route calls the
same FFmpeg measurement, mixing, optional ducking, final loudness-normalizing,
and true-peak limiting helpers used when Final Check builds a real video, so
the result is representative rather than a browser-only approximation.

Each ambient track can now be renamed and given a short usage note such as
"Good for reflective ideas and slow reveals." The note is editable beside the
track and becomes the row's hover tooltip; both fields persist in the existing
`audioTracks` metadata record without uploading the audio blob again. Delete
now asks for confirmation, and every upload, edit, or deletion refreshes the
audition dropdown immediately.

The measured production mixer no longer calculates the music baseline from
whole-track integrated LUFS. That average could understate a track with a long
soft opening and therefore make its later build too loud. Music is now scanned
with EBU R128 and anchored by its loudest valid short-term loudness window, a
rolling three-second passage. Very short clips fall back to their loudest
momentary window. Dialogue remains measured as an integrated programme, the
configured `musicBelowDialogueDb` offset is applied to that loudest sustained
music passage, and the completed mix still receives the existing two-pass
loudness normalization plus true-peak limiter. Thus a quiet intro remains
quiet while the loudest later section is the part constrained by the chosen
"Music level below dialogue" value.

Verification covered all 79 Node tests, a generated seven-second FFmpeg
voice/music audition, and the real authenticated UI in headless Chromium. The
browser uploaded a track, renamed it, saved and exposed its usage tooltip,
selected it from the tester, uploaded a voice sample, and received a playable
six-second blob from the live preview route. A 390-pixel mobile pass confirmed
the tester and editable track rows collapse to one column with no horizontal
overflow.

---

# 250. Recording Cue Now Follows a Captured Pre-Roll (2026-09-29)

Harvey was beginning to speak as soon as the Project Manager microphone said
it was recording, but the opening words could still coincide with the browser
or Android audio session settling. The shared MediaRecorder proving window is
now one second rather than 600 ms. Audio is already being captured throughout
that hidden window, while the caller is deliberately prevented from presenting
the recorder as ready.

The mobile voice view adds another 350 ms of captured pre-roll after that
proof. During startup the overlay remains subdued green, says **Starting
microphone…**, and disables Finish. Only after the pre-roll does it visibly
switch to a red pulse and red-tinted overlay, say **Recording now**, and enable
Finish. Cancel still works throughout startup, clears the delayed cue, and
stops any recorder that resolves after cancellation.

The desktop Project Manager now exposes the same two genuine states. Its mic
is subdued green while the browser's SpeechRecognition service starts, then
turns pulsing red only after an `audiostart`/conservative `start` delay. The
record-and-upload fallback gets its green startup state before awaiting the
shared one-second recorder proof. In either path, automatic speech is muted as
soon as startup begins rather than waiting for the live cue.

All 79 Node tests pass. The recorder regression additionally asserts at least
900 ms of stable captured audio before `startRecording()` resolves. Real
Chromium checks verified green-to-red state and text transitions on desktop
and at 390-pixel mobile width; the mobile live cue appeared after roughly 1.4
seconds and introduced no horizontal overflow.

---

# 251. Project Manager Audio Loading Cannot Remain Stuck Forever (2026-09-29)

Harvey reported that manually playing an earlier Project Manager reply could
remain on **Loading audio…** indefinitely. The button was faithfully awaiting
`Voice.speak()`, but that shared client had no deadline around either the TTS
request or its full MP3 body download. If the provider stream, proxy, network,
or browser body reader stalled without rejecting, the promise never settled
and the UI had no path back to Play.

Every TTS load is now bounded to 45 seconds. The client uses an
`AbortController` to cancel the request, invalidates its playback token so a
late response cannot begin speaking afterward, and rejects with a specific
retryable timeout. Both desktop and mobile buttons recover to **↻ Try again**
and expose “Audio took too long to load. Please try again.” as the tooltip.
Starting a newer reply, beginning a recording, pressing Stop, or disabling
automatic speech now aborts any request still being synthesized as an ordinary
cancellation rather than showing a false playback error.

The audio element lifecycle also cleans up on terminal `error` and `abort`
events, not only normal `ended`, preventing a decoded-media failure after
`audio.play()` resolves from leaving the bubble highlighted with a permanent
Stop button. Object URLs are revoked exactly once.

Two VM regressions cover a never-settling fetch and a later media error. A real
390×844 Chromium pass used the actual mobile Project Manager UI and a deliberately
unanswered `/api/voice/tts` request: it entered **Loading audio…**, recovered to
**↻ Try again** after the deadline, displayed the timeout reason, and produced
no page errors. The shared script cache key was bumped on both Project Manager
pages so existing browsers fetch the fix immediately.

---

# 252. Manual Project Manager Playback Always Outranks Automatic Speech (2026-09-29)

Harvey reported that pressing Play on an existing response while a quick
automatic acknowledgment was loading or speaking did not take control of the
audio channel immediately. Manual and automatic playback previously entered
the same undifferentiated `Voice.speak()` path. Although any new request could
cancel an older one, there was no durable ownership: a later polling callback
for an acknowledgment or completed answer could reclaim playback after the
manual click.

The shared voice client now distinguishes manual from automatic speech. A
manual Play request immediately aborts any pending automatic TTS request or
pauses active automatic audio, then owns the speech channel until its request
fails, is explicitly stopped, or its audio ends. Any automatic acknowledgment,
answer, or error that arrives while that manual owner is loading or playing is
ignored without issuing another TTS request. Automatic speech resumes normally
after the selected audio releases ownership. Both desktop and mobile message
buttons explicitly identify their requests as manual; all existing background
call sites remain automatic by default.

The browser check also exposed a related status-display defect. User and
assistant bubbles for one turn intentionally share a message ID, but the
speaking-state listener selected the first matching bubble, which was often the
user bubble with no Play button. Both views now target the assistant bubble
explicitly, so a manually selected response reliably changes from **Loading
audio…** to **Stop** while it plays.

A VM regression proves manual playback aborts an in-flight acknowledgment,
blocks a later automatic callback without a third network request, and releases
the channel on `ended`. A real 430-pixel Chromium run used the actual mobile
Project Manager Play button and reproduced the same race: only the automatic
request and the manually selected request reached TTS, the late automatic
callback was suppressed, the selected response remained active, and its button
showed **Stop**. The shared voice-client cache key was bumped on both views.

---

# 253. One Voice Upload Can Audition the Entire Soundtrack Library (2026-09-29)

The Content Settings audio tester previously rendered only one selected track
at a time. Comparing twenty ambient tracks therefore meant repeatedly choosing
a track, rebuilding, waiting, and manually seeking the resulting audio back to
the beginning. It also re-uploaded the same potentially large spoken video for
every comparison.

The tester now uploads the voice sample once into a temporary audition session
and builds a separately mixed preview for every saved soundtrack. Two FFmpeg
workers process the library concurrently, with the initially selected track
prioritized so the first useful comparison becomes available quickly while the
rest continue in the background. The dropdown marks building tracks with an
ellipsis, completed tracks with a check, and failures with a cross. Harvey can
use **Previous**, **Next**, or the dropdown to move among completed versions;
every switch changes the soundtrack and restarts the same spoken sample at
zero for a direct like-for-like comparison.

Rendered browser blobs are cached for instant repeat listening. Their source
upload and server MP3s never enter a persistent Content Studio store: the
client deletes the audition session when it is replaced or the page closes,
and the server independently expires abandoned sessions after two hours.
Changing any loudness/mixing control invalidates the old batch so the UI cannot
silently compare previews made with inconsistent settings.

This workflow invokes no AI model and consumes no tokens or provider credits.
Its only cost is temporary VPS CPU, disk, and elapsed FFmpeg time; the UI says
so directly. All 82 Node tests pass. A real Chromium UI test with three tracks
proved there was exactly one source upload and one preview per soundtrack, then
proved both Previous and Next changed the audio URL and reset playback to the
beginning. The app and stylesheet cache keys were bumped for immediate pickup.
After deployment, the authenticated live API was also exercised with one
uploaded voice sample and two real library tracks. It returned two playable
four-second MP3s from the same session, then confirmed successful explicit
session deletion.

---

# 254. Audio Audition Navigation Lists Only Playable Previews (2026-09-29)

The first batch-audition UI exposed every soundtrack in its dropdown from the
moment rendering began. Selecting one that was still building changed the
visible name but had no new blob to assign to the audio element, so the old mix
continued playing. This made Previous/Next appear broken during the exact
incremental-build window the controls were meant to support.

Once a batch starts, the switcher now contains only previews that have actually
finished rendering. It initially says **Building the first preview…**, adds each
track with a checkmark as its blob becomes available, and keeps Previous/Next
disabled until at least two real alternatives can be played. Both buttons now
cycle strictly through that completed subset; they never select a placeholder
or leave the prior soundtrack playing under a different label. The first
completed preview begins playing as before, and every later dropdown/button
selection swaps the blob and resets playback to zero.

All 82 Node tests pass. A deliberately staggered real Chromium run verified
that the dropdown contained exactly one option after one of three renders,
that navigation stayed disabled, that the second option appeared only after
its render completed, and that Next then changed the audio source and restarted
it. Previous returned to the first source at zero, the third preview appeared
after completion, and the 390-pixel layout retained zero horizontal overflow.
The app cache key was bumped so the corrected client loads immediately.

---

# 255. Content Production Can Preview the Real Music Mix Against Its Video (2026-09-29)

The backing-audio dropdown in Content Production previously saved a soundtrack
choice without providing any way to hear it against the uploaded edit. Each
in-production row now has a **Preview** button beside that dropdown. For a
selected soundtrack, the backend renders a temporary MP3 with the exact saved
mix settings and the same loudness-measurement, loudest-three-second music
calibration, optional ducking, normalization, and peak limiting used by the
final-video builder. The browser keeps the already-loaded video muted and plays
the rendered mix from zero in lockstep with it, so the visible result is the
real video with the proposed music dubbed in without downloading a second full
copy of the video. **Stop** ends both streams. Selecting **No ambient music**
previews the original video audio directly.

Completed mixes are cached as browser blobs for instant repeat comparison
while that upload row remains open, then revoked when the row is removed or the
list is rebuilt. The server MP3 is scratch-only and deleted after its response;
previewing does not modify the final video or move the card. Reviewer ownership
is enforced on the new route in the same way as the actual final-build route.

The disabled **Use this frame** bug was independent but surfaced in the same
row. Moving the scrubber can temporarily drop a video below
`HAVE_CURRENT_DATA`, so the input handler correctly disabled capture while the
new frame loaded, but no `seeked` handler ever enabled it again. The visible
frame could therefore be ready while the button still showed the browser's
not-allowed cursor. A successful seek now restores the frame controls as soon
as decoded dimensions are available.

All 82 Node tests pass. A real Chromium regression with generated five-second
video and soundtrack fixtures proved that scrubbing to a new frame re-enables
capture, one preview request is made for the chosen track, both the visible
video and mixed-audio stream start from zero, and their playback clocks remain
in sync. The same check passed against the deployed authenticated service and
its real FFmpeg route, including the new cache-busted client; the temporary
piece, video, and soundtrack records were deleted afterward. A 390-pixel pass
also confirmed the new inline controls introduce no horizontal overflow.

---

# 256. Transcript-Driven Raw Video Editor (2026-09-29)

Content Studio now has an admin-only **Editor** under Content Ops for turning a
raw spoken recording into the simple finished format Harvey uses without
round-tripping through CapCut. A raw video upload is stored under
`DATA_DIR/editor/<project-id>/`, probed with FFprobe, and transcribed through
ElevenLabs Scribe with word-level timestamps. Editor project metadata is
durable in the existing `records` table under the isolated `editorProjects`
store; neither the source nor rendered video is placed in SQLite.

The first automatic edit removes the middle of speech gaps longer than one
second while retaining 380 milliseconds around each boundary, plus trims
obvious leading and trailing dead space. These decisions are non-destructive:
the original file never changes, the UI can toggle automatic silence removal,
and the computed cut list is rebuilt from source timestamps. The browser
previews the edit by jumping over those cut intervals in the original video.

The complete timed transcript is directly editable. Harvey can click words,
Shift-select a range, or drag across a sentence, then cut or restore it. Cut
words remain visible with a strikethrough, and an Undo stack makes accidental
changes reversible. Transcript selections become time-aligned manual cuts and
are combined with the automatic silence cuts. The panel always displays the
original duration, estimated edited duration, and seconds removed.

Captions are grouped into short readable phrases and previewed over the raw
video in bold yellow text below center. Rendering uses FFmpeg to trim and
concatenate the retained video/audio segments, remaps every caption from source
time to the edited timeline, burns an ASS caption track into H.264 video, and
produces a downloadable fast-start MP4. Interrupted transcription or rendering
jobs become explicit retryable errors after a service restart rather than
permanent spinners. Source and rendered media routes, editing routes, and the
Editor navigation itself remain unavailable to the external YouTube reviewer.

The ElevenLabs module now exposes its full timed transcription result while
preserving the existing plain-text wrapper for every earlier caller. Seven
focused Node tests cover word normalization, natural pause handles, manual
cuts, timeline mapping, caption grouping, ASS styling, and a real end-to-end
generated-video upload/transcribe/edit/FFmpeg-render/download flow. The full
suite has 89 passing tests. A real Chromium test exercised the Editor tab,
word/range selection, cut, Undo, render initiation, and the 390-pixel mobile
layout with no page errors or horizontal overflow.

The finished render is not a terminal download. **Finish edit** builds the
captioned MP4; once ready, the primary action becomes **Send to Production**.
That authenticated server-side handoff copies the render into the existing
`videos` file store, creates the same Processing-stage piece a manual upload
would have created (including orientation-based type/platform defaults), and
starts the existing Content Production transcript/title analysis. The browser
then opens Content Production with the item already present, ready for title
selection, thumbnail capture, and ambient music. The editor project id is
reused as the production piece id and persisted on the project, so retries and
double-clicks cannot create duplicates; an already-sent edit shows **Open
Content Production** instead. The handoff reuses the Editor's already-paid-for,
post-cut transcript for outline matching and title generation rather than
calling ElevenLabs a second time for the same recording.

---

# 257. Longform Captions Use Word-Timed Emphasis (2026-09-29)

Landscape Editor renders now use a slightly larger caption base than vertical
videos (6% rather than 5.2% of the shorter frame dimension). The entire short
phrase remains stable below center, while the word currently being spoken is
rendered 18% larger with a slightly heavier outline. This is driven by Scribe's
real per-word timestamps after the edit timeline has been remapped, not by an
estimated reading speed.

The browser preview uses the same full-phrase/current-word behavior as the ASS
caption track burned into the finished MP4. Vertical short-form renders retain
their own deliberately different treatment described below.

---

# 258. Vertical Captions Show One Large Word at a Time (2026-09-29)

Portrait/short-form Editor renders no longer display caption phrases. They show
exactly one bold yellow word at a time, switching at the next word's real Scribe
timestamp and clearing at sentence or deliberate-pause boundaries. Because a
single word uses far less horizontal space, the vertical caption base is now
8.5% of frame width (92 px on a 1080×1920 export), substantially larger than
the earlier phrase caption without occupying more of the image.

This behavior is implemented both in the browser preview and in the burned ASS
track. Landscape longform remains the stable full phrase with an enlarged
currently-spoken word from §257; orientation alone selects the two caption
systems, matching the existing Content Production longform/short-form rule.

---

# 259. Portrait Caption Preview Is Bound to the Video, Not the Panel (2026-09-29)

The first vertical one-word implementation exposed two connected orientation
bugs on a real phone recording. The caption overlay was positioned against the
full-width Editor preview panel rather than the narrow portrait `<video>`, so
text could run far outside the visible frame. In addition, phone files may be
stored as landscape pixels plus a 90-degree display matrix. Browsers honor that
matrix and visibly show portrait video, but the original FFprobe query ignored
it and selected the landscape full-phrase caption system. This produced several
concatenated words across the panel even though the source looked vertical.

The preview now wraps the video and overlay in the same shrink-wrapped frame,
so caption bounds are always inset inside the actual displayed image. Runtime
orientation uses the project's rotation-normalized display dimensions (with
browser dimensions only as a fallback), because Chrome can expose physical
landscape `videoWidth`/`videoHeight` while visibly applying a portrait matrix.
Server probing now reads both display-matrix and legacy rotation metadata, swaps stored
dimensions for quarter turns, and re-probes older Editor projects on startup;
if their orientation changes, the stale caption render is invalidated for a
clean rebuild. Final ASS rendering therefore uses the same display orientation
as the browser.

Vertical caption selection remains strictly singular: each time update replaces
the caption node's entire text with the one current timed word, in the same
centered position. Tests now cover rotation-normalized dimensions, exact
one-word ASS events, live portrait word replacement, and assert that the
caption rectangle stays within the video rectangle.

---

# 260. Editor Becomes an Automatic-First, Reversible Review Workflow (2026-09-29)

The Editor now treats the camera master and publishing composition as separate
decisions. New uploads generate a three-frame contact sheet and ask the
existing private Claude one-shot runner to classify whether the book is framed
around one page (vertical) or the complete open spread (horizontal). The model
also estimates the horizontal centre of the featured page. This is a visual
composition decision rather than an encoded-aspect-ratio guess, because Harvey
will shoot both formats with the same overhead camera. Its short explanation
and confidence are shown in the UI, and both layout and duration-derived
Ultra-short/Short/Long-short/Longform remain explicitly overridable. Older
projects can request the same analysis with **Analyze book framing**.

A production pass exposed an important boundary in that definition: a
single-page shot can still contain a narrow sliver of its facing page. The
classifier now calls a recording horizontal only when both pages are
substantially visible as co-equal subjects; one dominant page remains vertical.
A physically portrait master bypasses AI entirely and is always vertical unless
Harvey explicitly overrides it, preventing a visual-model mistake from undoing
an already unambiguous camera orientation.

Selecting vertical now changes the actual output, not only its label. The
preview displays a movable 9:16 crop with a horizontal crop-position control,
and FFmpeg applies that crop independently to every retained segment before
scaling the finished edit to 1080x1920. Horizontal output is normalized to
1920x1080. Caption dimensions follow the chosen publishing layout, and the
effective layout/type travel through the existing idempotent Content Production
handoff rather than being re-inferred from the physical source file.

The earlier all-or-nothing silence toggle is now accompanied by a proportional
speech map. Speech is green, removed silence is red, and retained silence is
grey; clicking any segment seeks the source video. Every automatic leading,
middle, and trailing silence decision is listed separately, and **Keep pause**
restores only that interval without disabling the other good cuts. Three pacing
presets adjust both the silence threshold and the small natural breath retained
around edits. Captions also have an explicit default-on toggle. All choices
invalidate a stale render and remain non-destructive because the source master
is never rewritten.

A conservative first retake detector now compares adjacent pause/sentence
utterances. When a later take restarts with the same words and continues
further, or two nearby lines substantially overlap, the UI shows both versions,
explains the reason, and offers **Use latest take** or **Keep both**. It does not
silently delete an ambiguous rhetorical repetition; dismissed decisions are
durable. Manual transcript cutting and its Undo stack remain available below
the higher-level review controls.

The focused suite now covers per-gap restoration, composition/type overrides,
retake-candidate generation, classification contact-sheet creation, vertical
crop rendering, captions and the production handoff. All 95 repository tests
pass, and the real Chromium workflow passes at desktop and 390px mobile widths
with no page errors or horizontal overflow.

---

# 261. Semantic Retake Decisions With Conservative Automatic Cuts (2026-09-29)

Once word-timed transcription finishes, the Editor now runs a separate
tool-free structured Claude review over the indexed transcript. Its only task
is to distinguish an abandoned/stumbled take followed by a cleaner nearby
replacement from intentional rhetorical repetition. It returns exact inclusive
source-word ranges, the replacement range, a reason, and either `high` or
`review` confidence. The prompt explicitly forbids treating emphasis,
callbacks, or unique meaning as disposable and exposes no filesystem, shell, or
network tools to transcript content.

Only high-confidence failed attempts are cut automatically, matching Harvey's
automatic-first workflow. They remain visible in Smart Review as **Removed
automatically**, with the rejected and retained wording side by side and a
one-click **Restore first take** action. Uncertain repetition is never removed;
it remains a **Check repetition** card offering **Use latest take** or **Keep
both**. Dismissals and restored words persist, the original recording remains
untouched, and every accepted range still flows through the same word-timed
manual-cut/FFmpeg path rather than a second lossy edit mechanism.

Retake analysis has explicit pending/running/error/ready states, resumes as a
retry rather than a spinner after a service restart, and can be requested for
older Editor projects from the review panel. A deterministic adjacent-phrase
detector remains as a no-cost UI fallback if no semantic decisions exist. Tests
cover bounded semantic ranges, automatic application of high-confidence cuts,
the async analysis lifecycle, and restoration alongside the existing complete
render/handoff path.

The first production semantic call exposed a transient empty failure from the
shared structured Claude process. It changed no words and succeeded unchanged
on immediate retry. Retake jobs therefore retry one such provider failure once
internally after 750ms before surfacing an error; the integration test forces
that first-call failure and proves the second result is applied exactly once.

---

# 262. Editor Approval Has a Real Readiness Gate (2026-09-29)

The bottom of the Editor is now an approval boundary rather than an always-live
render button. A compact readiness row shows Transcript, Framing and Retakes.
While automatic framing or semantic retake review is running, the action reads
**Preparing automatic edit…** and cannot be pressed. If the semantic pass finds
uncertain repetition, it instead names the number of decisions still requiring
review. Each must be resolved with **Use latest take** or **Keep both** before
the final build becomes available.

This is enforced by the server as well as the disabled button: direct render
requests receive a conflict while automatic jobs are active or a candidate is
unresolved. High-confidence retakes satisfy the gate because they were already
removed automatically; restoring one also dismisses that decision deliberately.
After rendering, the action is now **Approve & Send to Production**, which more
accurately names Harvey's final review step. Project-list status says **Ready for
approval** rather than the obsolete “Export ready.” Tests cover unresolved,
accepted, and explicitly dismissed retake states plus the full browser flow.

---

# 263. Cut Auditioning, Processing Story and Click-Free Audio Joins (2026-09-29)

Review no longer requires scrubbing through a complete recording to hear each
decision. Every automatic pause and possible retake now has **Preview**: it
starts the source about 1.2 seconds before the relevant boundary, scrolls the
video into view, and the existing non-destructive playback skipper performs the
same join the final edit will use. Harvey can therefore audition a cut, keep or
restore it, and move down the decision list quickly.

The pre-transcript waiting screen now explains the real four-step pipeline with
live visual states: Recording secured, Word-timed transcript, Publishing frame,
and Retake review. Completed stages are green, active work pulses gold, errors
are explicit, and the layout collapses to two columns on mobile. This replaces
the opaque single spinner while preserving the same restart-safe jobs.

Final FFmpeg audio segments now receive an inaudible 8ms fade at both cut
boundaries before concatenation. This removes clicks caused by joining two
arbitrary waveform positions while remaining far too short to blur speech or
behave like an editorial transition. The generated-video integration test still
proves the complete trim, caption, encode, download and production-handoff path,
and Chromium now also proves decision-preview controls at desktop and mobile
widths.

---

# 264. A Filming Session Can Enter the Editor as One Queue (2026-09-29)

Editor intake now accepts multiple videos from the file picker or a drag/drop
anywhere over the Editor. Dragging files produces a full-screen branded drop
target explaining that every video will enter the automatic edit queue. Uploads
run sequentially so several large camera masters do not compete for the same
browser/VPS connection, while the progress bar reflects aggregate queue
progress and names the current file (`Uploading 2 of 6`). Each accepted project
appears immediately in Recordings and starts its independent transcription,
framing and retake jobs on the server; once intake finishes, the first recording
opens for review while the others continue preparing.

One bad file does not discard the rest of a filming session. The queue continues,
then reports a concise per-file failure list while preserving every successful
upload. The heading now describes the real workflow (“Drop in a filming
session”) rather than the earlier single-file/export mental model. A dedicated
Chromium regression submits two in-memory MP4 files through the real multi-file
input, verifies two sequential POSTs, two project cards and the completed queue
status; the existing desktop/mobile Editor regression still passes unchanged.

---

# 265. Deploy Pulls Are Explicit Fast-Forwards (2026-09-29)

The filming-session public-only release initially failed to reach the live
checkout even though that tree was clean and only behind remote. During a CI
log-commit race, plain `git pull` stopped with Git's “need to specify how to
reconcile divergent branches” configuration prompt. No Editor data or code was
lost; manually fetching and fast-forwarding exposed the v6 assets immediately.

`ops-service/deploy.sh` now fetches `origin main` and performs an explicit
`merge --ff-only origin/main` in both `/root/realitymanual-repo` and the
bind-mounted `/srv/realitymanual-repo`. Deploy checkouts are never supposed to
create merge commits, so this states the real invariant, removes reliance on
host-global `pull.rebase` configuration, and still fails safely if either clone
contains an actual unpublished commit. Existing dirty-tree auto-stashing remains
unchanged.

---

# 266. Editor Recordings Stay Linked to the Content Pipeline (2026-09-29)

An Editor recording is now connected to the planning card it came from rather
than becoming an unrelated second item. As soon as word-timed transcription is
ready, a tool-free structured Claude pass compares the transcript with cards in
Filmed or Edited and links only a high-confidence subject match. The processing
story now includes a fifth Planning card step, the chosen card is visible in a
manual fallback dropdown, and **Match again** remains available. Provider
failure receives the same single 750ms retry used by semantic retake review;
an error never blocks manual linking or destroys an edit.

The link drives the real Kanban workflow. Completing the final Editor render
moves a linked Filmed card to Edited. **Approve & Send to Production** moves it
from Filmed/Edited to Uploaded immediately before the existing production
analyzer runs, so the established Uploaded-outline matching path can take over.
The generated Processing item stores both `editorProjectId` and
`sourcePlanningPieceId` for durable traceability. Transitions are forward-only
and idempotent: retrying a handoff can finish an interrupted planning-card move
without producing a duplicate production item.

Automatic planning-card matching is part of the readiness gate alongside
framing and retake review, and the server enforces the same boundary. The
Editor service integration now proves automatic linking plus the render-ready
callback; the full 97-test suite and real Chromium desktop/mobile workflow pass,
including manual plan selection and the multi-file filming queue.

This work also fixed a latent Smart Review persistence bug: server validation
accepted old deterministic IDs such as `retake-1` but silently discarded the
new semantic IDs such as `smart-retake-4-8-10`. Both ID formats are now accepted,
so **Keep both** and restored semantic takes remain resolved after refresh.

---

# 267. Approval Advances Through a Filming Session (2026-09-29)

Approving an Editor result no longer opens Content Production and interrupts
the review session. The handoff still happens immediately and durably, but the
approved recording changes to **Sent to Production** in the sidebar and the
Editor automatically opens the oldest remaining unapproved recording. A green
confirmation names the recording just sent. If the queue is finished, the
current recording stays open with **Open Content Production** available as the
explicit next action.

This preserves the requested division of labour: Harvey can review, approve and
move through an entire filming session without navigating or re-uploading,
while title, thumbnail and ambient-music work remains available in the existing
production screen. The Chromium batch regression now uploads two recordings,
approves the first and proves the second becomes active automatically; the
single-recording and mobile-overflow paths continue to pass.

---

# 268. The First Finished Edit Builds Without a Click (2026-09-29)

The Editor now begins its first final-quality FFmpeg render automatically once
the transcript, visual framing, semantic retake review and planning-card match
are all in a safe terminal state. There is no longer an unnecessary gap where
all automatic work is finished but Harvey must press **Build final edit** before
he can review anything. If semantic review finds an uncertain repetition, the
automatic build waits until **Use latest take** or **Keep both** resolves it.
Errors in an upstream automatic check remain manual rather than silently
rendering from uncertain inputs.

`automaticRenderStartedAt` is persisted before the render is queued, making the
automatic pass one-shot and restart-safe. Opening an older prepared project or
resolving its final review decision can trigger that first pass as well. Manual
changes after a completed render still invalidate it and expose the explicit
rebuild control, preventing every small experiment from starting an expensive
encode. The end-to-end service test now waits for the automatic render instead
of posting the render route itself, proving upload can reach a reviewable MP4
without another user action. All 97 repository tests and both Chromium Editor
workflows pass.

---

# 269. Editor Review Plays the Real Encoded File (2026-09-29)

Once a render is ready, the Editor player now defaults to the actual encoded
MP4, served inline from the render endpoint. It no longer asks Harvey to approve
a browser simulation of raw-video seeks and DOM caption overlays. A clear
**Final edit / Original master** switch preserves both jobs: Final edit is the
literal captioned/cropped/cut production asset, while Original master allows
source-level cut auditioning and restoration. Pressing a cut's Preview button
automatically moves to the source view because source timestamps do not map
directly onto the shortened final file.

The inline route keeps the existing attachment download behavior unchanged for
normal render requests. Service integration proves the inline response is a
playable body without an attachment header; Chromium proves Final edit is the
default after rendering, both preview modes switch to the correct media, and
the original one-word portrait caption behavior still works in source view at
mobile width.

---

# 270. Filming Sessions Use a Single Final-Render Queue (2026-09-29)

Automatic rendering is now serialized across Editor projects. A batch of
camera masters may still transcribe and undergo lightweight analysis
independently, but only one full-resolution FFmpeg encode runs at a time; later
projects persist as `queued` and visibly say **Waiting in render queue** before
becoming **Rendering**. This prevents a 10- or 20-video filming session from
starting the same number of CPU- and memory-heavy encodes simultaneously on the
VPS.

The queue survives individual job failure because each item is chained through
a swallowed predecessor result, while each project's real error remains stored
normally. A service restart turns either queued or running work into an
explicit retryable error instead of a permanent spinner. Edit-setting PATCHes
are rejected while that project's queued/running render is active, preventing a
late encode from silently publishing settings different from those shown in
the UI. Focused service and both Chromium workflows pass with the queued state
included in polling and button feedback.

---

# 271. Approval Requires a Technically Verified Render (2026-09-29)

FFmpeg exiting successfully is no longer enough to mark an Editor output ready.
Every completed render is immediately re-probed and must pass four checks: a
non-trivial playable file exists, the frame is exactly 1080x1920 or 1920x1080
for the chosen composition, an audio stream is present, and encoded duration is
within 350ms or one percent of the retained-segment duration. Only then does the
project become Ready for approval and only then can the linked planning card
advance to Edited.

The measured dimensions, duration, timestamp and individual check results are
stored as `renderQuality`; the review footer shows **Output verified**. A failed
check becomes an ordinary retryable render error and cannot expose the approval
button or the inline final preview. The generated-video integration asserts all
four checks and the expected 1080x1920 portrait output before exercising the
handoff.

---

# 272. Matched Recordings Carry Their Planning Identity (2026-09-29)

High-confidence and manually selected planning matches now persist the source
card's sequence number and title alongside its id. Editor navigation and the
review heading therefore show a useful identity such as
`#079 · Rule of Innovation` instead of an opaque camera filename such as
`9259`; the original filename remains visible as secondary provenance. Manual
selection updates all three fields and clearing the selection clears the
derived identity.

The linked title also becomes the initial title of the generated Content
Production item, while its physical media filename remains stable and safe.
This makes a multi-video filming session traceable from Filmed through Editor
and Production without relying on upload order or memory. Service integration
asserts that the automatic match persists id, title and sequence together.

---

# 273. Review Speed Persists Across Editor Recordings (2026-09-29)

The Final edit / Original master toolbar now includes 1x, 1.25x, 1.5x and 2x
review speeds. The selection applies immediately to either media view and is
stored locally, so moving to the next recording in a long filming session keeps
Harvey's preferred review pace. It affects playback only and never changes the
encoded production asset. Chromium verifies the media element receives the
chosen rate, persistence is written, and the expanded toolbar still fits the
390px mobile layout without horizontal overflow.

---

# 274. Batch Preprocessing Is Bounded, Not a Process Storm (2026-09-29)

Filming-session intake previously uploaded files sequentially but immediately
started every accepted project's server jobs, so 20 videos could still create
20 audio extractions/transcriptions, 20 contact-sheet/vision passes and dozens
of semantic one-shot processes at once. Each expensive phase now has a durable
in-process chain: transcription, frame classification, retake analysis and
planning-card matching each process one Editor project at a time. Retake and
planning chains remain independent, allowing two safe structured calls in
parallel without creating an unbounded process fan-out. Final encodes retain
their separate single-file render queue.

Queued preprocessing projects keep their existing Pending UI state until their
turn begins. On restart, both Pending and Running work becomes an explicit
retryable error rather than leaving a job that no longer exists behind a
permanent spinner; sidebar status now surfaces errors from every phase as
**Needs attention**. A two-video integration regression deliberately overlaps
requests and proves maximum simultaneous transcription and classification are
both one, while both jobs still complete their phase.

---

# 275. Editor Sessions Have an At-a-Glance Queue Summary (2026-09-29)

The Editor header now summarizes the whole filming session rather than forcing
Harvey to inspect every recording card: total recordings plus counts for
Processing, Ready to approve, Needs attention, Prepared and Sent. States are
derived from the same durable project fields used by the sidebar and approval
gate, so the strip updates during polling, rendering and automatic move-to-next
approval. Colour is supporting information only; every state remains named.

The Recordings sidebar also carries its current total. The Chromium batch flow
now proves two ready recordings become one ready plus one sent immediately
after approving the first, while the next recording automatically opens and the
mobile layout remains overflow-free.

---

# 276. Editor Saves Are Ordered and Cannot Pull Review Backward (2026-09-29)

Every Editor PATCH is now serialized per recording. Rapid crop, format, pacing
or transcript changes therefore reach the server in the order Harvey made them
instead of allowing a slower earlier response to overwrite a later choice.
Each request also captures its recording id: if Harvey opens the next item while
a previous save is in flight, that response updates the correct sidebar record
but cannot replace the newly opened workspace. The top bar shows Saving, Saved
or Save failed against the relevant recording.

The Chromium batch regression fires two changes without waiting, switches to a
different recording during the artificial network delay, and proves maximum
concurrent PATCHes for the original is one, server order is preserved, and the
active workspace remains on the recording Harvey selected.

---

# 277. Duplicate Filming Uploads Are Rejected Before Processing (2026-09-29)

Editor intake now deduplicates the selected batch and recordings already stored
using the camera filename plus exact byte size. Mixed batches continue with the
new files and report how many duplicates were skipped; an all-duplicate drop
shows a concise inline result instead of opening alerts or starting work. The
server independently enforces the same identity after upload and removes its
temporary file before returning the existing Editor project id, so a stale or
custom client cannot spend storage and downstream transcription/analysis on the
same master twice.

The generated-video integration submits the identical source a second time and
proves the server returns a conflict pointing to the first project. The browser
batch regression selects two distinct masters plus an exact duplicate and
proves only two uploads occur while the queue reports the skipped copy.

---

# 278. Editor Work Self-Resumes After Deploys (2026-09-29)

Interrupted Editor phases no longer become manual errors on an ops-service
restart. Pending/running transcription and frame analysis are returned to their
bounded queues; retake and planning analysis resume immediately when a durable
transcript already exists or wait for the resumed transcription; a queued or
running render clears its partial state and re-enters automatic rendering once
all gates are safe. FFmpeg still overwrites its partial target, and every
original master plus Harvey decision remains unchanged.

This matters because Content Studio deploys are routine while a filming session
may take much longer to process. The recovery path excludes recordings already
sent to Production, preventing background work from reopening completed items.
A regression seeds a persisted in-flight transcription, constructs a fresh
service instance, and proves it automatically retries the real source and
reaches the correct terminal result without a button press.

---

# 279. Editor Renders Show Real FFmpeg Progress (2026-09-29)

The Editor no longer presents a motionless `Rendering final video` state while
FFmpeg is doing the longest part of the job. The render process now uses
FFmpeg's machine-readable progress stream, compares encoded output time with
the retained edit duration, and durably records bounded percentage updates.
Both the active workspace and the recording sidebar display the actual encode
percentage; the workspace also includes a compact progress bar. Queued renders
remain distinguishable from encodes that have genuinely begun, completed
renders settle at 100%, and failures reset the meter instead of preserving a
misleading partial value.

Progress changes are persisted only when the reported value advances by at
least two percentage points, avoiding a write for every FFmpeg status line.
The generated-video integration test now asserts that the completed captioned
render reaches 100% in addition to proving the resulting MP4 exists.

---

# 280. Editor Sessions Separate Active Work, Recovery and Archive (2026-09-29)

The recording sidebar now defaults to **Active** work and provides a separate
**Sent** view for completed recordings. Each tab carries its own live count,
while the header summary still describes the entire filming session. Approval
moves directly to the next active recording without briefly leaving the
workspace unselected; completed masters remain available in Sent for review or
deliberate deletion instead of cluttering the working queue.

All non-transcription automatic failures now share one visible recovery banner
and one `retry-failed` endpoint. It retries exactly the failed framing, retake,
planning and/or render stages while retaining the original master and every
manual cut decision. Transcription retains its purpose-built full-screen retry
state because no editable workspace exists until timed words are available. A
backend regression proves recovery of a failed transcript and rejects a retry
when no failure exists.

Queued/running final renders now lock every mutating control and server-side
deletion while leaving video review, seeking and playback speed available.
That prevents a save or removal racing FFmpeg. Progress-only polling updates
the percentage in place rather than rebuilding the video element every 1.8
seconds, so Harvey can continue reviewing the source uninterrupted while the
final file encodes.

---

# 281. Editor Review Keeps Context Across Source and Final (2026-09-29)

Switching between **Original master** and **Final edit** now stays on the same
spoken moment. Source time is translated through the actual cut ranges when
opening the final file, and edited time is translated back across removed
sections when returning to the master. This makes before/after checking a true
A/B review rather than forcing Harvey to seek from zero after every switch. A
browser regression verifies both translations against two removed pauses.

The Active queue is also stable across page loads and background updates:
active recordings are always shown in original filming/upload order, while the
Sent archive shows the most recently approved item first. Durable `updated_at`
changes from transcription and render progress can no longer reshuffle cards.
Pending work is labelled as waiting, separately from the recording that is
actually transcribing/analyzing, so a large filming batch does not look like
every resource-intensive job is running simultaneously.

---

# 282. Every Editor Decision Automatically Regenerates the Final File (2026-09-29)

A stale `automaticRenderStartedAt` latch previously survived after the first
successful encode. Changing a cut, pause, crop, format, pacing, caption setting
or planning link correctly invalidated the old render, but the automatic render
gate then treated the recording as already handled and left Harvey to press
**Build final edit** manually. PATCH now resets the render latch and progress
alongside the stale output status, allowing the normal readiness gate to queue
a replacement encode immediately.

Because that queue transition occurs just after the PATCH response, the client
performs one guarded follow-up refresh when an edit response has no render
status. The normal progress poll takes over from there. The generated-video
integration now changes the caption setting after a verified render and proves
that a second verified FFmpeg output completes with no render endpoint call.

---

# 283. Rapid Editor Decisions Collapse Into One Safe Rebuild (2026-09-29)

Automatic regeneration is now debounced per recording for 650ms after an edit.
Without this, the first of two quick decisions could launch FFmpeg before the
client's serialized second PATCH reached the server; the render lock would then
reject that later decision. Each new save resets the short timer, so transcript
cuts, pacing, captions and crop adjustments made as one interaction burst all
persist before one replacement encode begins. Deleting a recording cancels its
pending timer.

The client waits just beyond that debounce before its one follow-up refresh,
then resumes ordinary progress polling. The end-to-end regression applies two
back-to-back changes after a completed render and proves both settings persist,
only one additional verified render runs, and no explicit render request is
needed.

---

# 284. Editor Batch Queues Expose Their Real Position (2026-09-29)

Every bounded Editor worker now exposes a transient queue position through the
authenticated API: transcription, book-frame classification, retake review,
planning match and final rendering. Pending sidebar cards distinguish “next”
from a recording with one or more items ahead, and the initial processing panel
shows the same position for its individual phases. A queued final encode names
how many recordings are ahead instead of indefinitely saying only that it is
waiting.

These positions are derived from the in-memory job maps and never persisted as
stale state; after a restart the self-resume queues establish fresh positions.
The two-recording concurrency regression now captures the second recording
while both expensive queues are occupied and proves both positions are at
least two, in addition to its existing maximum-concurrency assertions.

---

# 285. Editor Polling Follows the Whole Filming Session (2026-09-29)

The Editor previously polled only the open recording and stopped as soon as
that recording became idle. In a batch, every other card could finish
transcription, analysis and rendering correctly on the server while its
sidebar label and the session summary remained frozen until a reload or click.

Polling now refreshes the lightweight project list whenever *any* recording is
active. It updates all queue labels and summary counts, then fetches the full
open project only while that project is active or when one of its material
statuses changes. Render-progress-only updates still use the in-place path from
§280, so session-wide accuracy does not reintroduce video playback resets.
Network failures simply retry the session poll without erasing the last known
state.

---

# 286. Pre-Workflow Editor Recordings Are Migrated Into the Automatic Pipeline (2026-09-29)

The first real Editor recording predated planning-match and render-progress
fields. Its transcript, framing and retake review were ready, but the missing
planning status was neither `ready` nor `unavailable`, so the modern safety gate
correctly refused to auto-render it forever. Startup now normalizes absent
phase/progress fields and queues the missing classification, retake or planning
work when the recording has not already been sent to Production. Completed
archive items receive `unavailable` defaults without reopening background work.

This is a durable data migration performed through the existing JSON record
store, so it covers future restarts and not merely the current browser session.
A legacy-record regression starts with a timed transcript and no planning or
progress fields, then proves planning resolves locally and the normalized state
is persisted without an unnecessary AI call when no planning candidates exist.

---

# 287. No Changed Edit Can Retain a Stale “Verified” Output (2026-09-29)

Render invalidation is now one shared operation rather than several partial
field resets. A changed transcript, completed retake analysis, completed frame
classification, corrected phone rotation, or manual edit clears the render
status, error, progress, automatic-render latch, technical QC result, byte size
and edited duration together. The old MP4 may remain on disk until FFmpeg
atomically overwrites it, but the authenticated preview and Production handoff
routes will not serve it unless the new render reaches `ready` and passes QC.

This closes two edge cases where a retried classifier could change the crop or
a retried retake analysis could change cuts while an earlier output still
claimed to be ready. Rotation correction now also schedules the replacement
render rather than merely invalidating it. A focused regression proves every
stale output claim is removed by the shared operation; the full generated-video
test continues to prove the replacement reaches verified readiness.

---

# 288. Editor Rendering Is 58% Faster on the Real 4K Camera Sample (2026-09-29)

The H.264 preset was changed from `medium` to `veryfast` while retaining the
same 1080×1920/1920×1080 output, CRF 18 quality target, AAC 192 kbps audio,
captions and post-render QC. A sequential benchmark against three seconds of
the real 51.6 MB overhead-camera master measured 9.42s (`medium`), 6.68s
(`fast`) and 3.98s (`veryfast`) on the production host. The faster result was
also smaller (5.59 MB vs 6.22 MB) and its full-frame SSIM was marginally higher
(0.870929 vs 0.870235) on this footage, so there was no measured quality reason
to keep the 2.4× slower preset.

This directly reduces the tail of a many-recording filming session while the
single-render queue still protects the VPS from CPU saturation. The generated
video integration continues to decode and verify the resulting dimensions,
audio, duration and playable file after the preset change.

---

# 289. Editor Reads No Longer Leave Orphaned Readiness Callbacks (2026-09-29)

The per-project GET route used to defer its inexpensive automatic-render gate
with `setImmediate` after sending the response. Rapid polling could therefore
leave callbacks behind after the caller had already moved on (and made clean
database teardown in integration tests race those callbacks). The gate now
runs synchronously after the response is formed; the expensive render itself
remains asynchronous and queued. Read latency is unchanged in practice, while
each request fully accounts for its own readiness check.

---

# 290. Vertical Captions Match the Requested One-Word Visual Treatment (2026-09-29)

Visual inspection of an actual 1080×1920 rendered frame confirmed one-word
replacement and clipping were correct, but the previous 92 px word sat at
roughly 73% of frame height and read smaller/lower than Harvey's reference.
Vertical output now uses a 120 px base (11.1% of frame width) at roughly 63.5%
of frame height: clearly below centre, above common platform chrome, and large
enough to exploit the one-word layout. Horizontal multi-word captions retain
their separate size and spoken-word emphasis treatment.

Words beyond 18 characters shrink proportionally down to a bounded 64% of the
base size rather than clipping or wrapping into a second line. The live source
preview now uses CSS container-relative units and the identical length-fitting
formula, so it represents the eventual baked frame instead of showing a font
whose apparent size changed with the browser viewport. Tests cover exact
one-word timing, the new style/position and a 24-character fitted word.

---

# 291. Editor Approval Remains Available During Desktop Review (2026-09-29)

The readiness/Production bar is now sticky at the bottom of desktop review.
Long portrait previews, pause decisions and transcripts no longer force Harvey
to scroll to the very end again merely to see whether the output is ready or
approve it. The bar keeps its status chips, progress/error state and sole
primary action, with a translucent backed surface and upper shadow so it stays
legible over the workspace.

The workspace changed from `overflow:hidden` to non-scroll-container
`overflow:clip`, preserving rounded-boundary clipping without breaking sticky
positioning. At phone width the action returns to normal document flow so a
tall stacked bar never consumes the limited viewport. Browser checks assert
the computed desktop/mobile positioning and retain the existing no-overflow
guarantees.

---

# 292. Editor Duplicate Detection Uses Video Bytes, Not Camera Filenames (2026-09-29)

The server now streams each completed upload through SHA-256 and identifies a
recording by its exact bytes. Filename plus file size was only a convenient
proxy: cameras reuse names across cards/days, and two different clips can have
the same byte count. Conversely, renaming the same file used to bypass the
check. New projects persist `sourceSha256`; older durable masters are hashed
once in the background on startup so they join the same scheme.

The browser still removes an obvious duplicate selected twice in one batch
before upload, but it no longer rejects a new file merely because an existing
project shares its name and size. A server-reported byte duplicate is counted
as skipped rather than as a failed batch. Tests prove equal-size different
content receives different identities, repeated content is stable, exact
reuploads are rejected, and the concurrency fixture now uses two genuinely
different synthetic videos instead of disguising one file with two names.

---

# 293. Final-Preview Navigation Stays on the Source Timeline (2026-09-29)

The Editor timeline is intentionally drawn against the original recording so
Harvey can see every spoken word, retained pause and removed interval. Once a
final edit was ready, however, clicking that source-based timeline assigned the
same number directly to the shorter rendered file. Every earlier cut therefore
made later clicks and cut-preview actions land progressively too late. The
playhead also measured edited playback time against source duration, so its
visual position drifted from the words being reviewed.

All final-preview seeks now pass through the cut-list source-to-edited mapping,
while its playhead passes back through the inverse edited-to-source mapping.
Source preview keeps direct source seconds. Previewing a pause or proposed
retake no longer silently switches away from the finished render, so the button
now demonstrates the actual edit Harvey is deciding whether to approve. A real
browser regression enters final-preview mode, maps a 3.86-second edited moment
back to the 7-second source position, and proves clicking that source word seeks
back to 3.86 seconds in the rendered video.

---

# 294. Production Handoff Cannot Half-Succeed After Its Commit (2026-09-29)

Editor approval used to wrap the database transaction, workflow reporting and
linked-card advancement in one `try` whose catch deleted the copied Production
master. If the video/card transaction had committed successfully but either of
the later bookkeeping operations threw, the API reported failure and removed
the file while leaving its database records behind. Retrying then found an
existing Production card whose master had been deleted.

The copy plus Production piece/video transaction is now the only rollback
boundary. Once it commits, its file is authoritative and cannot be removed by a
secondary reporting or Kanban-stage failure. Reporting failure is logged;
planning advancement is retried idempotently and returns a non-blocking workflow
warning. The Editor persists and visibly displays that warning while still
confirming the safely completed handoff, instead of asking Harvey to repeat an
approval that already succeeded. Route tests cover warning persistence and API
delivery, and the browser workflow proves the warning is rendered after approval.

---

# 295. Batch Upload Never Guesses Duplicate Identity from Metadata (2026-09-29)

The server's SHA-256 identity fix in §292 was still preceded by an old browser
shortcut that removed files sharing a filename and byte count within one selected
batch. That is not a content identity: reused camera names and coincidentally
equal file sizes can represent different takes. Those files never reached the
server and therefore never received the exact-byte comparison built to solve
this problem.

The browser now submits every selected video in sequence and treats a recording
as duplicate only when the server reports an equal SHA-256 digest. This spends
some upload time on a true duplicate but cannot silently discard unique footage.
A browser regression selects three same-name, same-size files, proves both
different payloads are uploaded, and proves the server-rejected repeated payload
is the only one counted as skipped.

---

# 296. Transcript Editing Has a Fast Keyboard Path (2026-09-29)

The transcript's reversible word selection already worked with visible buttons,
but every cut required leaving the text and moving to the action row. A focused
transcript now accepts Delete or Backspace to cut the selected words, Ctrl/⌘ Z
to undo the last word edit, and Escape to clear the selection. The transcript
regains focus after its saved state re-renders, so a user can cut, inspect and
undo without the shortcut silently falling back to browser navigation. Mobile
and pointer users retain the original buttons and individual restoration path.

The hint beneath the text states the shortcuts and keyboard focus has a visible
but restrained green outline. A browser regression performs a keyboard cut,
waits for the persisted rerender, verifies focus restoration, undoes the cut,
and clears another selection. This pass also consolidated two accidentally
duplicated transcript CSS blocks so its locked and focus states have one source
of truth.

---

# 297. Batch Review Opens the Next Actionable Recording (2026-09-29)

After a reload or approval, the Editor previously opened the oldest unsent
recording even when that file was still transcribing/rendering and a later file
was already ready for approval. This made a healthy batch queue look blocked and
forced Harvey to scan the sidebar manually between every approval.

Automatic selection now prioritizes `ready to approve`, then `needs attention`,
then prepared items, and only then background work; creation time remains the
tiebreaker within each state. The visible sidebar stays chronological so status
updates do not make cards jump around. Empty Active/Sent filters also remain
truly empty rather than opening a hidden card from the other bucket. A browser
queue regression reloads with an older running recording and a newer ready one
and proves the ready recording opens automatically.

---

# 298. An Approved Editor Master Is an Immutable Review Artifact (2026-09-29)

Content Production receives a copied version of the exact verified Editor
render. The Sent archive previously left all Editor controls active, so changing
captions, crop, pauses or words afterward produced a new Editor “final” while
Production correctly retained the earlier approved copy. Both screens then
appeared authoritative even though their videos differed.

A project with `productionPieceId` is now read-only at both layers. The service
rejects patch, transcription, classification, retake/planning analysis, retry
and render mutations with `approved_read_only`; preview, download, deletion of
the Editor archive, idempotent approval and opening Production remain allowed.
The Sent UI disables every edit decision, clearly labels the approved version as
locked, and explains that downstream work belongs in Content Production. Server
tests prove post-approval patch/render rejection, while a browser regression
proves the archive is visibly locked without disabling its cleanup action.

---

# 299. Oversized Raw Takes Fail Before Transfer Without Sacrificing the Batch (2026-09-29)

Both nginx and the Editor upload parser intentionally cap one recording at 2
GiB, but that operational limit was invisible. nginx's HTML 413 response could
only become “The recording could not be uploaded,” after Harvey had already
waited for a huge transfer, and one oversized file made the intake outcome
needlessly unclear.

The Editor now preflights each browser `File.size`, explains which take exceeds
the 2 GB per-file limit and advises splitting or trimming it. Valid companions
in the same filming batch continue uploading and the oversized names join the
end-of-batch failure summary. A defense-in-depth 413 path handles Multer's
`LIMIT_FILE_SIZE`, while the XHR also recognizes an nginx 413 even when its body
is not JSON. A browser regression supplies a synthetic over-limit file, proves
no upload request is made, then proceeds through the normal multi-file batch.

---

# 300. Editor Storage Is Visible and Sent Cleanup Is Unambiguous (2026-09-29)

Raw 4K footage dominates this workflow's disk use, but the Editor showed only
duration and its generic “Delete recording” copy made removing a Sent archive
feel as though it might delete the approved Production asset too. Source size is
now visible on every recording card and beside the original/edited durations,
using readable KB/MB/GB units.

Once approved, the action becomes **Remove Editor files** and its confirmation
states precisely that it removes the Editor source plus render while the copied
Content Production version remains safe. Unsent deletion instead warns that the
original and edit are permanently removed. No automatic cleanup policy was
introduced: Harvey retains explicit control over his masters. The browser test
verifies size rendering, the Sent action label and the non-destructive boundary
communicated by its confirmation.

---

# 301. Caption Words Can Be Corrected Without Losing Their Timing or Original (2026-09-29)

The transcript editor could remove bad takes but had no way to fix a single
speech-to-text spelling error. That wrong word would flow into the preview,
baked ASS captions, Production transcript and final published video even when
the cut itself was perfect.

Selecting one word now enables **Correct word**. Its replacement changes only
the text: the original word timestamps and video remain untouched, the prior
transcription is retained as `originalText`, and corrected words get a subtle
dotted marker plus hover context. Entering the original wording again removes
the correction marker. The corrected transcript invalidates any stale render,
automatically rebuilds, and is the version passed to Content Production; Sent
records remain immutable.

Server validation accepts only one valid word index and 1–80 single-line
characters. Integration coverage proves corrected text, original preservation,
caption regeneration, transcript regeneration and handoff delivery. The browser
test selects a word, completes the correction prompt, and verifies the saved
word and original-text cue after the workspace rerenders. A restart test also
now waits for its asynchronous legacy hash migration before closing SQLite,
eliminating a real teardown race exposed by the expanded focused run.

---

# 302. Caption Correction Uses a Native Editor Tray, Not a Browser Prompt (2026-09-29)

The first correction interface proved the data path but used `window.prompt`,
which looked foreign, offered poor phone ergonomics and could not explain what
would happen to timing. Correction now opens a compact tray inside the transcript
panel with the selected word prefilled, the original wording shown when relevant,
and explicit Cancel/Save actions. Enter saves and Escape cancels.

The tray uses the Content Studio visual system, collapses to one column on phone
screens, enforces the same 80-character bound as the server and tells Harvey that
timing remains unchanged. The browser workflow now drives this real tray through
selection, input, persistence and rerender instead of intercepting a synthetic
native dialog.

---

# 303. Every Allowed Vertical Caption Correction Fits the Frame (2026-09-29)

Correction initially allowed 80 characters while the vertical one-word font
fitter stopped shrinking at 64% of its 120 px base. That combination could
recreate horizontal clipping with a long correction even though ordinary
transcribed words fit correctly.

Corrections are now bounded to 40 characters in both the tray and server. The
shared visual formula keeps normal words at the large 120 px treatment, then
targets a conservative 15-character line width and may shrink as far as 36%
for the longest accepted word. Browser preview uses the exact equivalent in
container-width units. Tests cover the 24-character intermediate size, the
40-character boundary size and server rejection at 41 characters.

---

# 304. Workflow Warnings Clear Only After a Successful Recovery (2026-09-29)

If the post-render Kanban advancement hook failed, the Editor correctly kept the
verified video and stored a visible `workflowWarning`. A later successful render
ran the hook again but never removed that old warning, leaving a permanently
alarming banner after the underlying workflow had healed.

Successful completion of `onRenderReady` now reloads the durable project and
clears a prior workflow warning; failure still records it exactly as before. The
warning is therefore neither dismissed optimistically nor made sticky forever.
The end-to-end Editor test deliberately fails the first workflow hook, proves
the verified render carries its warning, rerenders successfully, and proves the
warning disappears only after that second hook completes.

---

# 305. Caption Corrections Have a One-Click Original Restore (2026-09-29)

Corrected words retained `originalText`, but reversal still required reading the
tooltip/note and typing that wording back into the field. When an already
corrected word opens in the tray, it now exposes **Use original**; choosing it
saves the retained transcription through the normal correction path and removes
the corrected marker without changing timing.

The action is hidden for untouched words and remains unavailable in the locked
Sent archive. Browser coverage now corrects a word, verifies its original cue,
reopens the tray, restores the original with one click and proves both the text
and visual correction marker return to their initial state.

---

# 306. Vertical Word Corrections Cannot Become Multi-Word Captions (2026-09-29)

The correction field represented one timed transcript token but still accepted
spaces. On a vertical project that could turn one caption event into “two words,”
violating Harvey's explicit one-word replacement treatment even though the event
timing itself remained singular.

The correction tray now gives an inline, non-destructive validation message when
a vertical correction contains whitespace, keeps the tray open and leaves the
saved transcript untouched. The service independently enforces the same rule
using the project's effective layout, while horizontal longform corrections may
still contain a short phrase if transcription tokenization genuinely requires
it. Server and mobile-browser tests cover rejection at both boundaries.

---

# 307. Uncertain Retakes Are First-Class Batch Attention (2026-09-29)

The Editor already prevented rendering while an ambiguous repeated line still
needed Harvey's decision, but the recording list described that project as
merely **Prepared** and the session summary counted it with ordinary setup work.
In a large filming session this made the most important human-review items easy
to overlook.

The list API now derives and returns each project's unresolved-retake count from
its current candidates and decisions. Any non-zero count receives a precise
**Review 1 possible retake** (or plural) status, is counted under **needs
attention**, and is selected ahead of routine prepared or working recordings by
the existing next-action flow. The underlying safety rule remains unchanged:
automation does not guess when a repetition may be deliberate. Browser coverage
proves the label, summary bucket and next-action selection, and the focused
21-test service suite remains green.

---

# 308. Video Review Has Focused Keyboard Transport (2026-09-29)

Repeatedly reaching for the small native video controls made checking cuts and
retakes slower than the edit itself. The preview is now keyboard-focusable:
**Space** toggles playback and the left/right arrows move exactly two seconds in
either direction. The shortcuts work in both original and final-preview modes,
while controls such as the review-speed selector retain their normal keyboard
behavior.

A compact shortcut reminder sits beside the desktop review controls and is
hidden on phone layouts where hardware-key instructions would be noise. The
headless browser workflow verifies both seek directions and playback, and a
live authenticated phone-layout check confirms the real Editor remains free of
horizontal overflow.

---

# 309. Original Master Playback Is Genuinely Uncut (2026-09-29)

The source toggle was labelled **Original master**, but its `timeupdate`
handler still jumped across every current cut. That behavior was useful while
previewing an unrendered working edit, but wrong after a final render existed:
Harvey could not listen to the exact material an edit removed before deciding
whether to restore it.

The Editor now distinguishes three truthful review states. **Working preview**
uses the source file to simulate current cuts and live caption timing before an
encoded output exists. **Final edit** plays the verified encoded file. Once
that final exists, **Original master** plays the untouched source without ever
skipping a removed pause, word or take. Browser coverage deliberately parks the
playhead inside a cut and proves that Working preview advances past it while
Original master remains at the requested source timestamp.

---

# 310. Transcript Selections Can Be Auditioned in Source Context (2026-09-29)

Cutting from text still required manually finding the same phrase in the video
before Harvey could judge it. Any selected transcript word or range now enables
**Play selected**. It starts 0.8 seconds before the first word, plays through
0.8 seconds after the last, then pauses automatically so comparison stays
focused.

When a verified final is currently open, auditioning switches to the untouched
Original master automatically, preserving the transcript selection and exact
source timestamp. This is deliberate: a phrase being considered for restoration
may not exist in the final edit at all. Browser coverage proves the mode switch,
timestamp, retained visual selection and automatic endpoint pause.

---

# 311. Transcript-Cut Undo Survives Reloads and Reconnects (2026-09-29)

The original Undo button stored prior cut arrays only in browser memory. A page
reload, device switch or reconnect erased that safety net even though the cut
itself was durable, which was exactly the wrong asymmetry for unattended batch
editing.

Each genuine manual change to removed transcript words now stores the preceding
decision server-side, bounded to the latest 50 compact index arrays. **Undo last
cut** and Ctrl/Cmd-Z call a dedicated serialized endpoint, restore the previous
decision, invalidate the stale render and trigger the normal verified rebuild.
No-op saves do not manufacture history, internal history is not sent in list
payloads, and Sent projects remain immutable. The headless browser deliberately
reloads after a cut and proves Undo is still available; integration coverage
proves the durable cut, restore, derived captions and `canUndoCut` state.

---

# 312. Workflow Warnings Remain Visible Across the Session (2026-09-29)

A planning-card advancement warning was clearly shown inside an open recording,
but disappeared into the generic **Ready for approval** or **Sent to Production**
label in the sidebar and summary. Approving and moving to the next recording
could therefore hide the only remaining follow-up.

Warnings now have their own amber session bucket and explicit **Ready · workflow
warning** / **Sent · workflow warning** list labels. They remain distinct from a
failed video: the output is still safe and approvable, while the status makes the
secondary workflow repair impossible to lose in a long filming session. Browser
coverage verifies both the post-handoff session count and Sent-list label; clean
handoffs retain the ordinary blue Sent state.

---

# 313. Playback Tracks the Exact Spoken Transcript Word (2026-09-29)

The timeline and captions followed playback, but the editable transcript itself
remained visually static. During a wording review Harvey still had to infer
which repeated or awkward phrase corresponded to the audio currently playing.

Playback now maps final-edit time back to the original source timeline and adds
a restrained green highlight to the exact timed transcript word. Source and
working-preview playback use their native source time, and only the previously
active word is touched when the playhead advances, avoiding a full transcript
DOM repaint on every video event. The browser workflow verifies that the
highlight lands on the expected word at an exact timestamp.

---

# 314. Low-Confidence Framing Cannot Silently Auto-Render (2026-09-29)

Landscape camera masters require visual classification to decide whether a
single page should become 9:16 or a full spread should remain 16:9. A low-
confidence result previously flowed into automatic rendering exactly like a
high-confidence result, making the fastest workflow capable of confidently
producing the wrong composition.

Only genuinely low-confidence landscape detections now pause before rendering.
The recording becomes **Review framing**, enters the session's attention count,
and the readiness bar asks Harvey to confirm Vertical or Horizontal once. That
explicit dropdown choice clears the gate and resumes automatic rendering;
medium/high confidence and physically portrait masters stay fully hands-off.
The render endpoint independently enforces the gate rather than trusting a
disabled browser button.

The visual-classifier prompt also now defines `cropCenterX` as crop-window pan:
0 is flush left, 1 flush right and 0.5 centered. This matches both CSS
`object-position` and FFmpeg's `(input width - crop width) × position`, avoiding
systematic under-panning toward the gutter on one-page landscape recordings.
Unit and browser-batch coverage prove the review rule, explicit-override escape,
portrait exemption, visible label and attention count.

---

# 315. Automatic Retake Decisions Stay Visible at Approval (2026-09-29)

High-confidence failed takes are deliberately removed automatically, but once
the final render completed the recording list collapsed that fact into a generic
**Ready for approval**. A hands-off workflow should not require reopening every
panel merely to discover whether the system made a substantive wording cut.

The service now derives an applied-retake count from current candidates, cut
indices and dismissals. Ready recordings say, for example, **Ready · 1 retake
removed**, and the readiness strip says **1 removed · resolved**. This remains a
green ready state rather than manufacturing human work; it simply makes the
automation's meaningful decision visible before approval. Restoring or
dismissing the candidate updates the count immediately. Unit coverage verifies
unresolved, applied and dismissed states independently.

---

# 316. Correcting a Card Match Reconciles the Old Card's Stage (2026-09-29)

Rendering a linked recording advances its planning card from Filmed to Edited.
If the automatic match was wrong and Harvey selected a different card after the
render, the old card previously remained falsely Edited while the replacement
would also advance on the next render.

Planning-link changes now carry the previous id into a server-side reconciliation
hook. An old card is returned to Filmed only when it is currently Edited **and**
its `editorProjectId` proves this exact recording advanced it; unrelated or
manually moved cards are never touched. The newly selected card then advances
through the normal verified-render hook. Unlinking receives the same safe
cleanup, while Sent projects remain locked. Integration coverage starts with an
automatic match, changes to a second valid card, verifies the prior/new ids
delivered to reconciliation, and proves the subsequent render operates against
the corrected link.

---

# 317. Deleting an Unsent Edit Cannot Strand Its Card at Edited (2026-09-29)

The same stage-ownership issue applied when deleting an Editor recording. If a
verified but unapproved project had already advanced its linked card to Edited,
deleting the only edited file removed the Editor data but left the Kanban card
claiming an edited asset still existed.

Deletion now runs an injected workflow-cleanup hook before removing metadata or
files. For an unsent project, a linked card is returned to Filmed only when its
stage and `editorProjectId` prove this project owns the transition. If cleanup
fails, deletion is refused and the recording remains intact. A Sent archive is
different: its Production copy is authoritative and the linked card is already
Uploaded, so removing Editor files leaves both untouched. Integration coverage
proves the hook receives the complete Sent project and deletion still removes
only the Editor record.

---

# 318. Metadata Corrections Do Not Re-Encode an Identical Video (2026-09-29)

Every Editor PATCH previously invalidated the verified render. Correcting a
planning-card link, changing Short vs Long-short, or choosing Keep both on a
flagged repetition could trigger a complete FFmpeg encode even though no pixel,
caption, cut or sound changed.

The service now classifies mutations by whether they affect rendered media.
Transcript cuts/corrections, pause settings, captions, framing and crop still
invalidate and rebuild. Planning links, content-type metadata and retake
dismissals preserve the verified file. A card-link callback receives this
classification: if a ready recording changes links without a media edit, the
old owned card is reconciled and the new card advances to Edited immediately,
without encoding the same video again. If the same request also changes media,
the new card waits for the replacement render as before.

Unit coverage explicitly enumerates metadata-only versus render-affecting
patches. Integration coverage changes a ready project from one card to another,
proves the verified render remains ready, verifies the callback classification,
and later proves a real cut still triggers the normal second render.

Metadata-only does not mean workflow-idle: if no verified output exists yet,
such as when **Keep both** resolves the last ambiguous retake, the patch still
schedules the now-unblocked first render. A ready output is the condition that
suppresses redundant work, covered separately from patch classification.

---

# 319. “Preview Edit” Always Plays the Edited Seam (2026-09-29)

Pause and retake cards offer a contextual preview of the proposed jump cut. If
Harvey had toggled to Original master first, those buttons inherited the current
source mode and played the material being removed instead, contradicting their
**Preview edit** purpose.

Contextual cut previews now switch a ready project back to Final edit, translate
the source cue through all preceding cuts, preserve the listening handle and
autoplay the encoded seam. Working previews continue using their live cut
simulation before a final exists. General timeline clicks still respect the
chosen view, so Original master remains useful for deliberate source inspection.
The browser regression begins inside an actual cut in Original master, invokes
the contextual preview and proves playback switches to the rendered file.

---

# 320. Retake Undo Restores the Whole Decision Atomically (2026-09-29)

Durable cut history initially stored only removed word indices. Retake actions
also change whether a candidate is dismissed: **Keep both** had no Undo at all,
and undoing **Restore first take** could put the cut back while leaving its card
hidden as dismissed. The media and review UI could then disagree invisibly.

Each history entry now snapshots both `removedWordIndices` and
`dismissedRetakeIds` before either changes. **Undo last decision** and Ctrl/Cmd-Z
restore them together, so a kept repetition resurfaces for review and a restored
automatic take returns to the exact visible/applied state it had before. Legacy
array-only history remains readable and the bounded 50-decision limit is
unchanged. Integration coverage performs a combined restore-and-dismiss action,
undoes it, and proves the word cut, dismissed ids, applied candidate and Undo
availability all return coherently.

---

# 321. Final Masters Are Guaranteed Standard 8-bit H.264 (2026-09-29)

The Editor encoded H.264 but allowed FFmpeg to inherit the source pixel format.
Phone/camera masters can be 10-bit or use less portable chroma formats, producing
a technically valid file that browsers or social platforms may decode
inconsistently despite passing the existing dimensions/audio checks.

Every final render now explicitly outputs `yuv420p`, the broadly compatible
8-bit 4:2:0 H.264 format expected by the downstream Content Production player
and publishing platforms. `ffprobe` now returns the encoded pixel format and
technical verification refuses to mark a render ready unless it is exactly
`yuv420p`; the verified format is also retained in `renderQuality` for diagnosis.
The real FFmpeg integration test proves the generated 1080×1920 captioned master
passes this additional check.

---

# 322. Manual Edit Bursts Debounce Before Re-Encoding (2026-09-29)

After any manual cut or caption change the replacement render began after only
650 ms. That was fast for a single correction but hostile to a normal review
burst: the first change could start FFmpeg and lock the transcript while Harvey
was selecting the second sentence.

Manual changes now wait for 2.5 seconds of quiet before automatic rendering,
with each subsequent save or Undo resetting the timer. The explicit **Build
final edit** action remains immediately available when Harvey really made only
one change. The browser's delayed status refresh now follows the same window, so
hands-off rendering still becomes visible as soon as it queues rather than
leaving a blank state. Initial preprocessing renders remain immediate; only
interactive edit bursts receive the debounce. Focused service and browser
workflows pass with the longer quiet period.

---

# 323. Planning Cards Cannot Be Claimed by Two Editor Projects (2026-09-29)

Planning-match candidates included every Filmed **and Edited** card. Once one
recording rendered and advanced its card to Edited, a second recording could
still auto-match or manually select that already-owned card, leaving two Editor
projects apparently attached to one planning asset.

Candidate discovery now exposes all genuinely Filmed cards, the current
project's already-selected card, and an Edited card only when its
`editorProjectId` identifies this same recording. Another project's Edited card
is unavailable to both AI matching and the manual dropdown. Existing/legacy
links remain visible to their current project for diagnosis, while new claims
cannot be created. This complements the stage reconciliation in §316 rather
than relying on its later cleanup.

Stage alone is not the reservation boundary. Candidate discovery also scans
the durable `editorProjects` records and excludes any card already linked by a
different recording, even while that card is still Filmed and the first render
has not advanced it yet. Because planning analysis is serialized, the first
saved high-confidence match becomes visible before the next match builds its
candidate set, closing the concurrent-upload race as well as the post-render
case.

---

# 324. Edit Bursts Cause One Browser Refresh, Not One Per Save (2026-09-29)

The server-side render debounce coalesced rapid edits correctly, but each PATCH
still scheduled its own delayed browser fetch. Five transcript changes could
therefore produce five near-simultaneous workspace refreshes just as the render
began, causing needless DOM churn and potentially interrupting review controls.

The Editor now keeps one delayed render-status refresh timer per project. Every
new save replaces that timer, mirroring the server's quiet-period behavior;
deleting a recording or remounting the Editor cancels outstanding refreshes.
Serialized saves remain unchanged, and the final refresh still discovers the
queued/running render and hands control to normal polling.

---

# 325. Camera Files With Generic MIME Metadata Reach Video Probing (2026-09-29)

Desktop browsers do not consistently label camera recordings. In particular,
dragged `.MOV` files can arrive with an empty MIME type or the generic
`application/octet-stream` type. The Editor's client-side gate previously
accepted only values beginning with `video`, silently discarding a legitimate
recording before the server could inspect its real streams with `ffprobe`.

The uploader now accepts common camera/video extensions (MP4, MOV, M4V, WebM,
MKV and AVI) when the browser supplies empty or generic metadata, while the
server remains the authority that validates the actual media. Unsupported
files are also named explicitly, including when mixed into an otherwise valid
batch, rather than disappearing without explanation. Browser coverage uploads
an uppercase `.MOV` marked `application/octet-stream` and proves it enters the
edit queue.

---

# 326. Generic Camera Uploads Keep a Browser-Playable Source Preview (2026-09-29)

Accepting a generic-MIME camera file was only half of the ingest boundary. The
server persisted the browser's `application/octet-stream` label and later used
it as the Content-Type for Original master playback. A correctly probed `.MOV`
could therefore reach the Editor but fail to play inline in some browsers.

The server now normalizes a non-video MIME label from the recording extension
after `ffprobe` has validated the streams, using the correct video type for MOV,
MP4, M4V, WebM, MKV and AVI. The source route repeats that normalization for
older saved uploads too. The native file chooser explicitly lists the same
extensions so camera MOV files remain selectable even when the OS cannot supply
a useful MIME type. API integration coverage uploads a generic uppercase MOV
and verifies both persisted metadata and the source response header.

---

# 327. Failed Safety Analysis Cannot Be Silently Bypassed (2026-09-29)

A retake-analysis failure correctly put a recording in **Needs attention**, but
the final-render button and endpoint still allowed a manual render. That could
send a repeated or abandoned take downstream without Harvey ever making the
review decision the Editor exists to surface. A failed landscape framing check
had the same bypass while Frame remained on Auto.

Failed retake analysis now blocks rendering until retried successfully. Failed
automatic framing blocks only while a landscape source is still on Auto;
choosing Vertical or Horizontal explicitly is a valid human resolution and
unblocks it. Both the UI and API enforce these rules, with the disabled action
stating the exact recovery required. Planning-card matching remains metadata,
so its failure is visible but does not unnecessarily prevent a correct media
render. Focused service tests and a real browser failure-state check cover the
new gate.

---

# 328. Editor Approval Is Single-Flight and Idempotent (2026-09-29)

The browser disables **Approve & Send to Production** immediately, but that is
not a concurrency boundary: two open tabs or duplicated HTTP requests could
both observe an unsent edit and invoke the downstream handoff before either
stored `productionPieceId`. The current production copy happens mostly
synchronously, but the Editor service contract is asynchronous and must not
depend on that implementation detail.

The service now keeps one in-flight approval promise per Editor project.
Concurrent approvals join that exact operation, receive the same Production
piece id, and never invoke the handoff twice. Edit and deletion requests are
also rejected while approval is crossing the boundary, preventing the reviewed
master or its decisions from changing underneath the copy. Integration coverage
holds the synthetic handoff open, issues two simultaneous approvals, and proves
they return one created and one idempotent response from a single handoff call.

---

# 329. Rapid Edit Decisions Compose Instead of Overwriting Each Other (2026-09-29)

Editor PATCH requests were serialized, but some patches were calculated before
they entered that queue. Two fast pause restores, transcript selections, or
retake decisions could both start from the same old arrays; the second request
then replaced the first successful decision even though the network writes ran
one at a time.

Set-based decisions are now queued as transformations, not precomputed arrays.
When each request reaches the front, it derives its payload from the latest
acknowledged project returned by the preceding save. This applies to transcript
cut/restore, pause keep/remove, automatic-retake application, and retake
dismissal/restoration. The existing serialized network boundary remains. A
browser regression clicks two pause decisions faster than the mocked 120 ms
server round trip and proves both persist while concurrent PATCH count remains
one.

---

# 330. Approved Editor Projects Stay Immutable Across Restarts (2026-09-29)

The Editor promises that approval locks the exact reviewed version, but startup
maintenance still examined every saved project. An approved project carrying an
old pending/running phase could restart AI work; the display-rotation migration
could also update its dimensions and invalidate its final render, after which
automatic rendering correctly refused to touch the already-sent project. That
left the archived Editor record internally inconsistent and removed its final
preview even though the Production copy remained safe.

Restart recovery and media-dimension migration now exclude projects that have a
`productionPieceId`. Minimal schema backfills may still add missing inert
fields, and byte hashing may add duplicate-detection metadata, but no analysis,
orientation, cut, or render state can change after approval. A restart
integration test seeds an approved project with deliberately stale dimensions
and in-progress phase labels, then proves no classifier runs and every reviewed
state remains byte-for-byte semantically unchanged.

---

# 331. Editor Saves Stay Serialized Across Tab Round Trips (2026-09-29)

The Editor reset its per-project save queues every time its tab mounted. If
Harvey made an edit, briefly visited another Content Studio tab, returned, and
made another edit before the first network request completed, the new PATCH no
longer knew about its predecessor. Those requests could overlap and restore the
same stale-array overwrite problem fixed in §329. A successful old request
could also call `renderWorkspace()` after its DOM had been replaced and report
a false save error even though the server had persisted it.

Per-project save promises and save state now survive Editor remounts for the
life of the page, while poll/render-refresh timers remain mount-scoped. Workspace
refresh is a safe no-op when the Editor DOM is detached. A browser regression
starts a delayed edit, changes tabs, returns immediately, makes a second edit,
and proves the server still sees a maximum of one PATCH at a time in the correct
order.

---

# 332. Background Editor Work Does Not Manipulate Another Tab’s DOM (2026-09-29)

Uploads, approval, deletion, and delayed render refreshes can legitimately
finish after Harvey has navigated away from Editor. Their completion callbacks
still queried Editor-only elements from the shared `panelMain`, which another
tab had already replaced. Successful server operations could therefore end in
detached/null DOM exceptions, and an approval could quietly open the next
recording behind whatever tab Harvey was actually using.

The client now has an explicit Editor-mounted check. Durable operations continue
to completion and update their in-memory result, but Editor-only progress,
workspace, next-recording, and refresh behavior becomes a safe no-op while its
shell is absent. Returning to Editor reloads the authoritative server state as
normal. Existing batch, cross-tab save, failure-state, and queue browser checks
all pass with the detached-DOM guards.

---

# 333. Large Production Handoffs Do Not Freeze Content Studio (2026-09-29)

`sendEditorProjectToProduction` copied the verified final master with
`copyFileSync`. Editor accepts recordings up to 2 GB, so approval could block
Node's only event-loop thread for the full disk copy: Project Manager, upload
progress, polling, and every unrelated API request would appear frozen even
though nothing had crashed.

The handoff is now asynchronous and awaits `fs.promises.copyFile` before its
existing transactional Production records are committed. The single-flight
approval boundary from §328 ensures that making this I/O non-blocking cannot
admit duplicate approvals. The full 105-test suite passes. That run also exposed
and fixed an impossible post-transcription wake-up: a recording with no timed
speech no longer schedules render eligibility after it has already entered the
terminal transcription-error state, preventing stray work from outliving that
failed job during shutdown/restart.

---

# 334. Phone and Desktop Cannot Silently Overwrite Editor Decisions (2026-09-29)

The client queue protects rapid decisions in one browser, but Harvey routinely
uses Content Studio from both phone and desktop. Two loaded copies could still
submit full cut/restoration arrays from the same old state, allowing whichever
device saved last to silently erase the other device's decision.

Every project now carries a dedicated `editRevision`. User PATCH and Undo calls
include the revision they were based on; the server atomically rejects stale
ones. Transcript completion, automatic retake decisions, and frame/crop
classification also advance the revision because they can change the editable
media state in the background. Ordinary render progress does not, avoiding
spurious conflicts.

For normal edits, the client handles one conflict by fetching the authoritative
project and reapplying the user's intended transformation once, so independent
phone/desktop actions merge without ceremony. Undo is deliberately not replayed
against someone else's newer history; it reloads and asks the user to decide
again. Integration coverage sends simultaneous stale-revision PATCHes and proves
only one commits, while the browser regression simulates an external revision
and proves the intended pause changes are safely rebased and serialized.

---

# 335. Abandoned Large Uploads Cannot Accumulate Forever (2026-09-29)

Multer and extracted transcription audio use an Editor-only temporary directory.
Normal success and handled failure paths remove their files, but a disconnected
browser, killed request, or process interruption can strand a partial upload.
With a 2 GB per-recording limit, a handful of invisible orphans could consume
meaningful VPS storage despite not appearing anywhere in the UI.

Editor now removes only regular temp files older than 24 hours at service start
and every six hours thereafter. The conservative age boundary leaves active
uploads and current transcription extraction untouched; durable source masters
and renders live in a different directory and are never candidates. The timer
is unreferenced so it cannot hold shutdown open. Focused coverage creates old
and active temp media and proves exactly the orphan is removed.

---

# 336. Semantic Retakes Require a Real Later Replacement (2026-09-29)

The retake prompt is conservative, but its structured output still crosses an
untrusted model boundary. Normalization previously clamped malformed indices.
A valid removal range paired with an overlapping or wildly out-of-range
replacement could therefore survive as `high` confidence and automatically cut
real speech even though no concrete cleaner take existed.

Semantic candidates are now accepted only when all four indices are exact
integers inside the transcript, both ranges are bounded, the replacement begins
strictly after the failed attempt, and its first word occurs within 30 seconds.
Overlapping, reversed, oversized, out-of-range, or timestamp-less ranges are
dropped rather than repaired. Replacement text is always derived from those
verified timed words, never free-form model text. Focused tests cover a valid
earlier-failed/later-cleaner take plus overlapping and hallucinated replacement
ranges, and the end-to-end render test now models the same latest-take rule.

---

# 337. Kanban Stage Tracks Final-Master Validity During Rebuilds (2026-09-29)

Rendering a linked Editor project advances its planning card from Filmed to
Edited. If Harvey then changed a cut, caption, crop, or pacing setting, the
verified master was correctly invalidated and rebuilt, but the card stayed in
Edited throughout. The Kanban could therefore claim an edit was complete while
the Editor had no valid final file.

The Editor service now emits an `onRenderInvalidated` lifecycle callback only
when a previously verified render becomes stale. The Content Studio integration
moves that card back to Filmed only when it is still in Edited and still owned
by this exact Editor project. Once replacement encoding and verification pass,
the existing ready callback advances it to Edited and restores ownership.
Unrelated cards and later stages are never regressed. Callback failure leaves
the media edit safe and surfaces a workflow warning instead of discarding the
user's decision. The end-to-end service test proves one invalidation event for
the first post-verification cut and no duplicates during subsequent changes in
the same rebuild window.

---

# 338. nginx Streams Editor Uploads and Leaves Multipart Headroom (2026-09-29)

The live `ops.realitymanual.com` vhost already declared a 2 GB request limit,
matching Editor's 2 GiB file limit only superficially. A maximum-size file is
wrapped in a multipart request, so its envelope can exceed nginx's exact `2G`
cap before Multer gets to enforce the intended per-file boundary. nginx also
used default request buffering, writing a second complete temporary copy before
forwarding anything to Express. That doubled peak disk usage and let browser
upload progress reach 100% while the proxy still had to replay the body.

`/etc/nginx/sites-available/ops` now uses `client_max_body_size 2100M`, leaving
small protocol headroom while Express remains authoritative at exactly 2 GiB,
and its proxy location sets `proxy_request_buffering off` so camera data streams
directly into Multer. `nginx -t` passed, the service reloaded cleanly, and the
public authenticated boundary still returns the expected 401 without a session.
This is live host configuration, not a repository-managed nginx file.

---

# 339. Editor Rejects Recordings That Cannot Safely Finish the Pipeline (2026-09-29)

A raw recording does not consume only its upload size. During the full workflow,
the source, browser review proxy for incompatible camera codecs, verified Editor
render, Content Production copy, and later music-mixed final may coexist. With
19 GB currently free this is comfortable for normal 49 MB-style takes, but
blindly accepting a maximum 2 GiB file on a fuller disk could defer failure
until hours later during rendering or approval.

The upload route now measures the filesystem before reading a known-length
multipart body and again after Multer stores it. It reserves 2 GiB for normal
service operation plus space for every downstream master: five file sizes before
ingest, four additional sizes after the source already exists. Unsafe uploads
receive HTTP 507 and a direct cleanup message; if capacity cannot be measured,
the existing disk monitor and normal behavior remain the fallback rather than
blocking work. The post-upload rejection removes its temp file immediately.
Focused coverage proves a 2 GiB recording requires 12 GiB before ingest and
10 GiB still free after storage.

---

# 340. Stale and Failed Outputs Release Their Disk Space Immediately (2026-09-29)

Capacity admission prevents predictable exhaustion, but exceptional writes also
need cleanup. The Production handoff awaited `copyFile` outside the `try` that
removed its destination, so ENOSPC or another mid-copy failure could leave a
large invisible partial video. FFmpeg failures likewise left their partial
`render.mp4`, and changing a previously verified edit retained the now-stale
master until its replacement happened to overwrite it.

The Production copy now lives inside the existing cleanup boundary. Failed
renders remove their partial output, and render invalidation unlinks the stale
verified file immediately while preserving the original source master and every
edit decision. This also makes the new capacity model accurate between edit
bursts. The end-to-end test verifies that the prior render is physically gone
as soon as a post-verification transcript decision invalidates it, before the
debounced replacement begins.

---

# 341. Review Position Survives Refresh and Active/Sent Switching (2026-09-29)

Editor previously chose the queue's highest-priority recording on every mount.
A phone browser suspension or deliberate refresh could move Harvey away from the
take he was reviewing. Active/Sent filter buttons only changed the sidebar too,
so the workspace could continue showing an Active edit while the list claimed
to be Sent (or vice versa).

The last opened Active and Sent project ids are now remembered independently in
local storage. Mount/reload returns to the exact valid recording for the current
filter, with the normal actionable sort as fallback if it was deleted or moved.
Changing filters now opens that filter's remembered/fallback project and renders
a clear empty state when none exists. Deletion clears either matching memory
slot, approval naturally remembers the next Active edit, and opening the sent
copy establishes Sent continuity. Browser coverage proves refresh retention and
round-trip switching between the newly approved item and the current active
one.

---

# 342. Production Approval Revalidates the Exact Verified Master (2026-09-29)

A `ready` database flag and the existence of `render.mp4` were previously
enough to approve an Editor project. If that file were truncated, replaced, or
partially overwritten after quality verification, Production could receive a
different master from the one that passed the duration, stream, and size
checks.

Approval now requires the file to remain a regular file larger than the minimum
valid output, to match the exact byte count, and to match the streamed SHA-256
fingerprint recorded by the successful verification pass. This catches both
truncation and a same-size replacement without loading a potentially multi-GB
master into Node memory. A mismatch invalidates and removes the stale master,
returns a clear HTTP 409, and automatically schedules a clean rebuild; the
client refreshes immediately so the rebuilding state is visible. Existing
active verified renders acquire a fingerprint in the background on first
startup rather than being needlessly re-encoded. Already-sent projects remain
idempotent and return their existing Production piece even if their old Editor
render is later cleaned up. Unit coverage replaces a render with different
bytes of the same length, while route-level coverage mutates a finished render
and proves it is rejected and rebuilt.

---

# 343. Planning-Link Failures No Longer Stall Video Rendering (2026-09-29)

The automatic Editor pipeline previously required planning-card matching to be
`ready` or unavailable before it would render. A transient model/provider error
therefore stopped an otherwise safe, complete edit and forced Harvey to press
Build manually, even though planning linkage changes only workflow metadata and
cannot affect the finished video.

Planning-match errors now remain prominently visible and retryable but count as
non-blocking for automatic rendering. The failure path explicitly wakes the
automatic renderer, while transcription, framing, uncertain-layout, and retake
safety gates remain strict. Focused coverage proves a planning error proceeds
but a running match, failed retake review, or failed framing analysis does not.

---

# 344. Large Camera Uploads Survive Content-Studio Navigation Safely (2026-09-29)

The upload queue previously assumed Editor's DOM remained mounted. Navigating
to another Content Studio section while a large sequential batch continued
could leave the next file trying to update missing progress elements. Starting
a second batch concurrently also produced two independent queues competing for
one progress bar, and closing or refreshing the browser offered no warning that
an in-flight camera transfer would be lost.

Upload progress is now durable JavaScript state rather than state held only by
the current DOM. Leaving Editor for another in-app section does not interrupt
the requests; returning remounts the current filename and percentage. A second
batch is politely refused until the first finishes, the upload control visibly
locks and later re-enables, and an actual page unload triggers the browser's
standard unsaved-work warning only while bytes are in flight. Detached progress
elements are never dereferenced, so background batch completion remains safe.

---

# 345. Approval Refreshes Metadata After Streaming Verification (2026-09-29)

SHA-256 verification deliberately streams the final master and may take several
seconds for a large camera recording. Planning-card matching is metadata-only
and can legitimately finish during that window. Approval previously continued
with the project object loaded before hashing, so Content Production could miss
a planning link that had just been saved while the correct video was being
verified.

After fingerprinting, approval now reloads the authoritative project record and
hands off its latest metadata only if it still references the exact render
digest just checked. A concurrently completed planning match is therefore
included, while a changed/rebuilt edit receives a clear 409 and must be reviewed
again. An approval completed by another concurrent request remains idempotent.

---

# 346. HEVC Camera Masters Get Automatic Browser-Safe Review Proxies (2026-09-29)

The actual `9259.mp4` filming master is HEVC/`hvc1`. FFmpeg can transcribe,
classify, and render it correctly, but Chrome-class browsers do not reliably
decode that codec. If automatic retake or framing analysis required Harvey's
review before the final H.264 render existed, the source player could therefore
be blank even though the recording itself was perfectly valid.

Upload probing now records video/audio codecs and identifies masters that are
not dependable browser playback sources, including HEVC, unsupported audio, and
non-MP4/MOV containers. Only those recordings enter a serialized background
proxy queue that makes a review-only H.264/AAC MP4; the original master remains
untouched and is still the sole input to the final high-quality render. The
source endpoint transparently serves the proxy once ready, progress and failures
are visible and retryable in Editor, navigation/polling tracks the job, and
interrupted conversions resume after deployment. Proxy conversions and final
renders share one ordered encode chain so a filming batch cannot saturate the
VPS with competing FFmpeg jobs; because proxy work begins at ingest, it
naturally precedes that recording's final render. Legacy recordings are
re-probed and backfilled automatically. Disk admission now reserves the extra
worst-case copy. Unit coverage checks the codec/container policy, a real HEVC
fixture must produce an H.264 proxy, and the full upload/render test confirms
ordinary H.264 MOV recordings skip unnecessary conversion.

The player labels this honestly as a **Browser-safe source copy**, identifies
the preserved original codec, and explains that final rendering still uses the
untouched camera master. It never presents the compatibility transcode as the
original file. Queue cards say **Preparing browser preview** (with position when
applicable) rather than falling through to the misleading **Ready to edit**
label while that conversion is still running.

---

# 347. Linked Planning Titles Survive Production Analysis (2026-09-29)

Editor correctly handed a linked planning card's title into Content Production,
but the asynchronous downstream title analyzer treated it like an automatic
camera filename and could replace it with its generated working title seconds
later. That broke the durable identity between the Kanban outline and its filmed
piece even though the useful YouTube title suggestions were still wanted.

Editor handoffs now mark a planning-derived working title as preserved.
Downstream analysis continues to populate `ytTitles`, but only replaces the
generic working title when that preservation flag is absent. Existing manual
title editing remains authoritative over both fields. Coverage proves a linked
outline keeps its name while still receiving generated title options.

---

# 348. Automatic Planning Links Reconcile Kanban Stages Too (2026-09-29)

Manual planning-card selection invoked the Editor/Kanban reconciliation hook,
but a high-confidence automatic match only stored the ids. Normally the later
render callback still advanced that card, masking the difference. If matching
succeeded on a retry after a verified render already existed, however, the card
could remain at Filmed until Production approval instead of moving immediately
to Edited.

Every changed high-confidence automatic link now goes through the same
non-render-changing reconciliation hook as manual selection. Before rendering
it is harmless and the render callback advances normally; after rendering it
immediately advances the newly linked card and safely releases any prior link.
End-to-end coverage now observes both the automatic initial link and the later
manual reassignment.

---

# 349. Edit Decisions Preserve the Exact Review Position (2026-09-29)

Every saved decision re-renders the Editor workspace. Although this was safe,
it reset playback to the beginning, so checking a later retake or pause and then
cutting it forced Harvey to find the same moment again after each decision.

Before any save or undo, Editor now remembers the active player's time and mode.
Metadata-only changes return to the same point in the same source/final view.
When a decision invalidates the final render, its edited-timeline position is
translated back to the corresponding original-master time and the working
source preview resumes there. This applies consistently to transcript cuts and
restores, smart-retake choices, pause restoration, pacing, captions, framing,
crop changes, word corrections, and repeated undo.

---

# 350. Interrupted Camera Uploads Release Partial Files Immediately (2026-09-29)

The 24-hour temp-file sweeper made abandoned uploads eventually safe, but a
browser refresh or network loss near the 2 GiB limit could still leave that
large partial allocation occupying the Editor workspace for the rest of the
day. Multer's anonymous destination filenames also gave the request-abort path
no reliable file target to remove.

Editor now uses a UUID-named Multer storage target recorded on the request as
soon as streaming begins. If Node receives the request's `aborted` event, that
exact partial is unlinked immediately. Completed uploads follow the unchanged
hash/probe/rename flow, invalid recordings still clean themselves, and the
periodic sweeper remains as defense in depth for process-level interruptions.

---

# 351. Smart Retake Cards Own Disjoint Reversible Ranges (2026-09-29)

Structured retake output already required valid earlier/later ranges, but two
otherwise valid model decisions could still overlap the same failed words. Both
cards would appear applied; restoring either one would restore shared indices
still claimed by the other, making the cards non-independent and the UI state
misleading.

Semantic decision normalization now reserves high-confidence ranges first,
then review-only ranges in their original order, rejecting any later removal
range that intersects an accepted one. This ensures an uncertain suggestion
cannot displace a clear failed take just because the model listed it first.
Original model indices still form stable card ids. Disjoint chains of failed
takes remain valid, and every visible card can now be applied or restored
without silently changing another card's owned words. Focused coverage lists an
uncertain overlap first and proves the high-confidence plus independent ranges
are the ones retained.

---

# 352. Review Proxies Are Optimized for Immediate Review (2026-09-29)

The HEVC compatibility copy exists only to let Harvey inspect a recording while
Editor works; it is never a production input. The first live proxy preserved the
full 1080x1920 raster and occupied 19.9 MB for a 26.5-second recording, spending
time and disk on detail that the embedded review player cannot meaningfully use.

Browser proxies now preserve orientation while limiting the long edge to 1280
pixels, encode H.264 with the `superfast` preset at CRF 28, and use 96 kbps AAC.
A controlled pass over the same real HEVC camera master completed in 12.1
seconds and produced a 6.5 MB 720x1280 review file; an extracted frame retained
legible page text and clear framing. The untouched original still feeds the
full-resolution CRF-18 final render, so this changes only how quickly a safe
review player becomes available. The real proxy test now also enforces the
1280-pixel review ceiling.

---

# 353. Review Playback Recovers Without Losing Edit Context (2026-09-29)

Saving any edit rebuilt the workspace at the remembered timestamp, but it always
returned paused even if Harvey had been actively playing through the recording.
The editor now remembers that active-play state as well as mode and time, then
resumes automatically after the replacement player has metadata. Paused review
still remains paused, and final-to-source time translation is unchanged.

A media decoding or transient network error now produces an explicit overlay
inside the player instead of leaving a black, unexplained rectangle. **Reload
preview** cache-busts and reloads only that media source, retaining the project,
edit decisions, and generated files. It does not re-upload or re-encode the
recording, and it resumes playback if the failed player had been active.

---

# 354. Filming Batches Can Be Cancelled Safely Mid-Upload (2026-09-29)

Editor accepted camera masters up to 2 GB and showed reliable aggregate upload
progress, but a mistaken selection had no in-app escape: Harvey had to refresh
the whole tool. The progress panel now exposes **Cancel batch** only while a
batch is active. It aborts the current XHR, prevents every remaining queued file
from starting, and reports how many earlier recordings were already secured.

Cancellation is deliberately distinct from an upload failure, so it produces
no misleading connection-error alert. The server's abort handler immediately
unlinks the partial UUID upload, completed earlier files remain safely queued,
and the upload control re-enables for a corrected batch without reloading the
page. Navigation continues to leave intentional uploads running in the
background; cancellation is an explicit user action.

---

# 355. Retake Reanalysis Respects Harvey's Restores (2026-09-29)

High-confidence retakes are removed automatically, but their word indices were
previously indistinguishable from manual transcript cuts. If analysis was run
again, a take Harvey had explicitly restored could be removed again, while a
cut owned by an obsolete model decision could remain forever.

Each project now records the exact word indices owned by automatic retake
analysis. Reanalysis first releases only those owned indices, preserves every
manual cut, then applies current high-confidence decisions except ids Harvey
has dismissed or restored. Restoring an auto-cut also releases its ownership,
and the 50-step cut/retake undo snapshots retain that ownership metadata. A
focused regression proves a dismissed take stays restored, an obsolete auto
cut disappears, a new clear retake is applied, and an unrelated manual cut is
never touched. New projects initialize ownership explicitly, and undoing one of
the older pre-metadata array snapshots now intersects ownership with the
restored cut set so a legacy history entry cannot leave phantom ownership.

---

# 356. Browser Review Copies Self-Verify and Self-Heal (2026-09-29)

The original camera master is durable, but the H.264 browser proxy is derived
and replaceable. Startup previously trusted a stored `ready` flag plus mere file
existence. A truncated or corrupt proxy could therefore leave Chrome on a black
player even though Editor still had everything required to rebuild it.

Active projects now probe an existing proxy on startup and require a nontrivial,
playable H.264 file with audio and valid dimensions. Invalid derived media is
removed, marked pending, and rebuilt through the serialized encode queue; stale
proxies are also reclaimed when a re-probed source no longer needs one. The
source route catches a ready-but-missing/tiny proxy at request time, requeues it,
and explicitly reports preparation rather than serving incompatible HEVC as a
silent fallback. On a player error, the client refreshes project state once so
that a newly pending repair enters normal polling and replaces the player when
ready; it does not hammer the media route in a failure loop. The real HEVC
regression now begins with a corrupt proxy and a
false `ready` record, then requires startup to replace it with verified H.264.

Proxy verification also compares decoded duration with the original recording
using the same bounded 350 ms–1.5 s tolerance as final-output verification. A
valid-looking but prematurely truncated H.264 file is therefore rebuilt rather
than offered as a misleading complete review.

Player URLs are versioned as well. Final playback carries the exact verified
render SHA-256, untouched source playback carries its source SHA-256, and a
derived browser proxy carries the current project revision timestamp. Rebuilt
bytes can no longer be confused with a browser-cached predecessor at the same
route, while unchanged masters retain a stable cache identity.

The one-shot automatic media recovery timer also releases its per-project
guard when the operator navigates away before it fires. Returning to that
recording can therefore attempt recovery again instead of inheriting a stale
"retry already scheduled" flag from an abandoned player.

---

# 357. Editor Review Layout Remains Usable Before Media Metadata (2026-09-29)

A real browser screenshot exposed behavior that DOM assertions missed. The
horizontal frame used intrinsic video width, so an unavailable or failed media
response had no dimensions and collapsed the player/error overlay into a thin
vertical strip. Horizontal review now owns a responsive 16:9 frame up to the
workspace width, with the media contained inside it. Loading, successful, and
error states therefore retain the same stable layout.

At phone width the Recordings header and file list also sat side by side,
producing a tall awkward picker before the edit itself. The mobile aside is now
a compact header followed by a horizontally scrolling, snap-aligned recording
carousel. Desktop's persistent queue/sidebar is unchanged. The same visual pass
showed the sticky approval bar covering part of the video while Harvey was
supposed to review it. Approval now sits in normal document flow after the
transcript, matching the intended review-then-approve sequence and never
obscuring playback.

---

# 358. Restarts Immediately Reclaim Editor Upload Orphans (2026-09-29)

Request-level abort cleanup handles refreshes and network loss, but a container
restart kills both Node and the request before that handler can run. The shared
24-hour temp sweeper deliberately retained fresh files, so a nearly complete
2 GB upload interrupted by deployment could consume workspace until the next
day and block a corrected upload.

At startup, before any new Editor job exists, the service now removes every
Editor-owned `editor-upload-*` partial and extracted `editor-*.mp3` file without
an age delay. The cleanup is prefix-scoped because `/data/tmp` is shared with
voice previews, chat attachments, and other Content Studio features. Coverage
proves fresh Editor orphans disappear while same-directory files belonging to
other features remain untouched; the periodic age sweeper remains defense in
depth for ordinary runtime leftovers.

---

# 359. Verified Final Edits Must Contain Audible Audio (2026-09-29)

Technical verification previously proved that the final MP4 had an audio stream,
but a filter or encoder regression could still fill that stream with digital
silence and pass. Editor now runs FFmpeg `volumedetect` over the completed final
and records its peak level. Output must peak above -55 dBFS in addition to being
playable, correctly framed, standard pixel format, duration-matched, and
audio-bearing; `-inf`, missing measurements, and effectively silent tracks fail
closed before approval.

This adds only a fast audio decode, not another video encode. The real 9259 edit
was also inspected empirically during this pass: three source pauses totaling
10.46 seconds were reduced to a 16.07-second final whose remaining detected
quiet beat was 0.36 seconds, consistent with the configured natural handles.
Unit coverage protects loudness parsing, and the real FFmpeg end-to-end render
must now report an audible peak as part of its passed quality record.

Duration verification is also bounded rather than indefinitely proportional.
The normal 1% allowance now has a 350 ms floor for short clips and a 1.5-second
ceiling for long-form work. A one-hour export can no longer lose 36 seconds and
still pass merely because that loss equals one percent, while ordinary AAC/VFR
rounding remains comfortably tolerated.

---

# 360. Upload Batches Do Not Hijack the Active Review (2026-09-29)

The client used to wait for an entire multi-file batch before opening its first
recording, then forcibly selected that recording when the batch completed. A
fresh filming session therefore showed an empty workspace longer than
necessary, while adding background footage during an existing review could
unexpectedly throw Harvey into another project minutes later.

On an empty Editor, the first successfully secured recording now opens
immediately while the remaining files continue uploading. If a project was
already selected when the batch began, that review remains untouched throughout
and after completion; new recordings still appear live in the queue and session
summary. Completion only auto-selects when there is genuinely no active project.

Upload progress is now byte-weighted across the batch. A 2 GB camera master and
a 20 MB clip no longer each claim half the bar: progress reflects actual bytes
transferred, while the label still identifies the current file, ordinal, and
size. Duplicate/server-rejected files count as completed attempts once their
transfer settles, and explicit cancellation preserves the honest partial point.

Each ready workspace now also has **Previous** and **Next** recording controls
with an `n of total` position. They follow the same deterministic order as the
visible Active/Sent queue, disable cleanly at either edge, and make a large
filming session reviewable on phone without repeatedly swiping the carousel.
Approval still chooses the highest-priority next actionable recording rather
than blindly advancing, so this navigation does not weaken the attention-first
workflow.

The counter and button state repaint when background uploads alter the visible
queue, without rebuilding the workspace or resetting playback. Click handlers
also resolve the current ordered list at click time, preventing a newly added or
approved recording from leaving stale navigation closures behind. The browser
regression adds a second recording after the first workspace exists, then moves
forward and back to prove the live counter and both targets update correctly.

The mobile screenshot also showed the global fixed Project Manager return bubble
covering Editor form controls as the page scrolled. Editor now suppresses that
floating control only on its own tab and provides an in-flow **Project Manager**
link beside **Upload raw videos** at phone width. The return path remains obvious
without ever obscuring Frame, Format, crop, retake, or approval controls; every
other Content Studio tab keeps the established floating button.

Previous/Next navigation can also select a recording beyond the visible portion
of the phone carousel. After list repaint, Editor now horizontally centres the
active card with `scrollLeft` only; it never calls vertical `scrollIntoView`, so
background polling cannot yank Harvey away from the video or transcript he is
reviewing.

---

# 361. Final Review Can Approve Without Re-Scrolling (2026-09-29)

A complete Editor workspace can contain framing, video, cut decisions, retake
review, and a long transcript. The canonical approval gate correctly follows
all of that content, but after playing the final edit at the top Harvey had to
scroll to the bottom merely to send an already verified file onward.

When and only when the exact output is verified and ready, the recording header
now offers **Approve & next** beside Previous/Next. It invokes the same guarded
production handoff as the detailed bottom action, disables both entry points
during the request, surfaces the same failure recovery, and advances to the
highest-priority actionable recording after success. The bottom readiness gate
remains in place for a transcript-first review. Browser coverage approves via
the new fast path and proves both controls exist only in the eligible state.

---

# 362. Editor Queue Polling Is Transcript-Light (2026-09-29)

The queue endpoint originally returned every complete project record. That
included every timed word, full transcript, retake graph, correction history,
visual-analysis result, and render-quality object for every recording. The
client polls this endpoint every 1.8 seconds while a batch is processing, so a
20-video session would repeatedly serialize, transfer, parse, and retain the
entire editing corpus merely to repaint status labels.

`GET /api/editor` now emits lightweight lifecycle summaries. They retain every
field used for ordering, queue status, progress, action counts, filenames,
dimensions, and navigation, while omitting transcript-scale edit data. Opening
a recording still loads its full authoritative record from `GET /api/editor/:id`.
This changes no editing semantics; it removes work proportional to the total
spoken-word count from the hot polling path. Unit coverage proves summaries
retain actionable state, exclude heavy fields, and never mutate durable data.

---

# 363. Filming Batches Recover One Transient Upload Failure (2026-09-29)

A multi-gigabyte filming batch should not require manual reselection because one
request briefly lost connectivity or received a retryable server response.
Editor now retries each file once after a network error, timeout, rate limit,
early-processing response, or 5xx failure. The progress panel explicitly says
which recording is being retried, while cancellation remains authoritative
during the short retry delay. Permanent validation, capacity, and format errors
still fail immediately and the queue continues to the next file.

There is also a subtle accepted-but-response-lost case: the first request may
finish and persist the source after the browser connection dies. Its retry then
receives the existing byte-identity duplicate. Editor recognizes that response,
loads the already-secured project, and treats the upload as successful instead
of reporting a false failure. Navigating or refreshing the whole page during an
active browser upload now triggers the standard unsaved-work warning; moving
between Content Studio tabs remains safe and does not interrupt the batch.
Browser coverage forces both a 503-followed-by-success and a persisted-first-
request-followed-by-duplicate response. It proves exactly one retry, one queue
card, and no false failure in either case.

---

# 364. Editor Review Position Survives a Refresh (2026-09-29)

Reviewing a long recording on a phone can be interrupted by an accidental
refresh or the browser reclaiming the tab. Editor now checkpoints the current
position into tab-scoped session storage every half second. It stores source
time rather than raw player time, plus whether Harvey was checking the source
or final edit, so cut-heavy finals resume on the same spoken moment rather than
the same misleading timestamp.

Opening the recording again restores that mode and maps source time through the
current cut graph when necessary. Positions within the opening second or final
second are deliberately ignored, completed playback clears its checkpoint, and
approval or deletion removes it. The state survives refresh and same-tab
navigation but naturally disappears when the browser tab is closed, avoiding a
stale next-day review position. Browser coverage checkpoints an HEVC source
review, reloads the application, and proves mode and exact position return.

---

# 365. Active Final Edits Self-Verify After Restart (2026-09-29)

Approval already re-hashed the exact final bytes, but a truncated or externally
altered render could remain labelled Ready after a host restart. Harvey would
then encounter broken or stale playback and only discover the real issue when
approval rejected it.

Startup now walks active Ready finals serially and validates the recorded size,
passed-quality record, and SHA-256 against the actual file. A mismatch clears
every stale output claim, removes the bad file, reconciles the linked planning
stage, and automatically rebuilds once framing/retake safety is ready. Approved
projects are deliberately excluded because their immutable Production copy is
already authoritative. Serial hashing avoids turning a large existing queue
into a burst of competing disk reads. Coverage begins with a false Ready record
and truncated MP4, then proves its digest, size, status, and file are all
invalidated before review.

Recovery schedules a rebuild only when the project's automatic safety gates are
already satisfied. A failed retake/framing check remains visibly blocked and
retryable without leaving an unnecessary deferred database callback behind.

---

# 366. First-Stage Editor Providers Recover One Transient Failure (2026-09-29)

Retake and planning analysis already retried one transient model/credential
failure inside their durable job, but transcription and visual framing failed
immediately. In an unattended filming batch, a one-off provider interruption
therefore stranded an otherwise valid recording for manual intervention before
the later automatic stages could even begin.

Timed transcription and landscape frame classification now each retry once
after a short backoff, using the already-extracted audio/contact sheet rather
than repeating local FFmpeg work. A second failure remains visible and
explicitly retryable; deterministic invalid media is unchanged. The batch
concurrency test forces the first call of both providers to fail, proves each
recovers on its second attempt, and still proves only one transcription and one
classification job run concurrently across multiple recordings.

Long-form contact sheets also retain their intended meaning at any duration.
The former 0.01fps floor meant a ten-minute recording supplied frames only from
roughly 0, 100, and 200 seconds, ignoring its final two thirds. The sampler now
uses exactly three frames per complete duration, so ten-minute and hour-long
takes are represented across their full timeline while short clips retain the
same behavior. Unit coverage locks the sampling rate at one, ten, and sixty
minutes.

---

# 367. Upload Admission Reserves the Whole Batch's Downstream Work (2026-09-29)

The original disk gate conservatively reserved source, proxy, Editor render,
Production copy, later mixed final, and 2 GB operating headroom for the file
currently being uploaded. It did not carry forward the not-yet-created copies
owed to recordings accepted earlier in the same batch. A sequence of files
could therefore each pass admission while collectively promising more output
than the VPS could store.

Both the pre-body and post-upload capacity gates now add reservations for every
active project: a pending proxy when required, an unfinished Editor render, the
Production handoff copy, and its later soundtrack/final copy. Copies already on
disk are not counted twice, approved projects leave Editor's reservation, and
the fixed 2 GB operating reserve remains. The current host has roughly 15 GB
free; this accounting lets a large filming session stop cleanly with an
actionable 507 before later FFmpeg jobs can consume the safety margin. Unit
coverage locks copy counts across pending, ready, and already-sent projects.

---

# 368. Verified Finals Leapfrog Waiting Review Proxies (2026-09-29)

Browser-safe HEVC proxies and final renders deliberately share one FFmpeg lane
so a filming batch cannot saturate the VPS. The original promise chain was pure
FIFO, however: if twenty proxy jobs entered while the first transcript was
being analyzed, that first recording's final could wait behind all twenty even
though it was the next file Harvey could approve.

The shared lane is now a two-priority serial queue. A running encode is never
interrupted, but a newly ready final takes the next slot ahead of proxies that
have not started. Remaining proxies continue afterward, failures cannot stall
the pump, and concurrency remains exactly one. This improves time-to-first-
approval without creating CPU contention or sacrificing browser compatibility.
Unit coverage holds one proxy open, queues a second, inserts a final, and proves
the exact execution order is running proxy, final, waiting proxy.

---

# 369. Undo Covers Every Pause/Cut Decision (2026-09-29)

The transcript editor's undo history originally captured removed words and
retake dismissals only. **Keep pause**, the global long-pause toggle, and Tight /
Natural / Gentle pacing all change the cut graph too, but the visible **Undo
last decision** control could not reverse them. That made one class of editing
mistake less safely reversible than another.

One bounded 50-step decision history now snapshots manual word removals, retake
decisions and automation ownership, individually restored pauses, pause removal
on/off, silence threshold, and retained breathing room. A combined patch creates
one atomic snapshot rather than several, and legacy snapshots remain readable.
Undo restores the complete prior cut strategy, invalidates the stale render,
and schedules the same debounced rebuild. End-to-end coverage changes all pause
settings together, verifies the altered state, then proves one undo returns
every field to the exact natural-mode baseline.

---

# 370. Safe Automatic Renders Cannot Be Stranded by Restart (2026-09-29)

`maybeAutoRender` durably marks a kickoff before scheduling FFmpeg. A process
restart in the tiny interval between those operations left `renderStatus`
empty but `automaticRenderStartedAt` populated. Startup only resumed explicit
Queued/Running renders, while the stale kickoff marker prevented every future
automatic attempt. A recording could therefore remain prepared but never
become approvable until a manual edit happened to invalidate it.

Startup now clears orphaned kickoff markers and evaluates every renderless,
unapproved project after interrupted phase normalization. If transcription,
framing, retakes, and planning are already safe, it enters the same serialized
priority render queue immediately; if a safety phase is still pending or
failed, that phase's normal completion/retry remains authoritative. Integration
coverage starts with a valid source and the exact stranded metadata state, then
boots the service and requires a technically verified final without any GET or
manual action.

---

# 371. Concurrent Editor Uploads Reserve Capacity Before Arrival (2026-09-29)

The Editor's two disk-admission checks accounted for recordings already in the
database, but overlapping HTTP uploads could both pass the first check before
either became a project. This was especially plausible during a multi-file
camera dump or two open tabs and could promise more render/proxy/Production
copies than the VPS could safely hold.

Accepted uploads with a known Content-Length now reserve their full conservative
downstream capacity in an in-memory byte ledger before Multer receives the
body. Later requests include every live reservation in admission. Once Multer
has stored the current request, only that request's reservation is released;
the definitive post-upload check still includes all other uploads in flight.
Finish, disconnect, parse error, and duplicate release paths are idempotent, so
failed requests cannot leak capacity. A focused unit test proves summing and
exactly-once release behavior.

---

# 372. ElevenLabs Calls Have Bounded Waits (2026-09-29)

Both Scribe transcription and spoken-response synthesis previously used a bare
`fetch`. A lost upstream response could leave an Editor recording permanently
Transcribing, or leave the Project Manager audio UI loading indefinitely, until
the whole service restarted.

The shared ElevenLabs client now applies an abort deadline to both operations:
ten minutes for potentially long camera-recording transcription and 90 seconds
for short TTS replies. `ELEVENLABS_STT_TIMEOUT_MS` and
`ELEVENLABS_TTS_TIMEOUT_MS` can override those values, with a one-second floor
and one-hour cap. A deadline produces the stable errors `stt_timeout` or
`tts_timeout`; the Editor's existing one-retry path therefore gets a clean
second attempt and then exposes a recoverable Needs attention state rather than
hanging its serial transcription queue. Unit coverage proves validation,
abort behavior, and successful response passthrough.

---

# 373. Editor Readiness Never Calls a Failed Check Resolved (2026-09-29)

The review footer could display a green `RETAKES RESOLVED` badge while the red
banner above correctly said the retake review had failed. Planning-link errors,
which are intentionally non-blocking, also changed the whole queue card to
`Needs attention` and appeared in the blocking recovery banner. These mixed
signals made an otherwise automated review harder to trust.

Readiness badges now distinguish checking, failed, needs-review, and ready
states for framing and retakes. A failed automatic planning match is explicitly
labelled optional, explains that it does not block the edit, and can still be
retried from its own panel without presenting the video as broken. A framing
analysis failure is blocking only while a landscape source remains on Auto;
once Harvey chooses a frame manually it is accurately described as the active
fallback rather than a failed requirement. Shared predicates keep queue status,
session counts and priority, the recovery banner, render blocking, and footer
badges consistent.

---

# 374. Retake Analysis Covers the Entire Long-Form Recording (2026-09-29)

`analyzeEditorRetakes` previously sliced the timed transcript to its first 5,000
words and then marked the whole retake phase Ready. A sufficiently long
horizontal recording could therefore contain false starts near the end that
were never inspected, with no indication that coverage was partial.

Retake analysis now divides the complete transcript into 5,000-word windows
with 200 words of overlap. Global word indices are preserved, every word is
covered, boundary-spanning replacements have shared context, and exact
duplicate decisions from overlap are collapsed before the existing strict
range validator sees them. Ordinary recordings still make exactly one model
call. Unit coverage proves complete coverage beyond 10,000 words, the expected
overlap, preservation of a decision from the final window, and deduplication.

---

# 375. Planning Matching Samples the Whole Long-Form Narrative (2026-09-29)

The automatic Editor-to-Kanban matcher bounded its prompt by taking only the
first 9,000 transcript characters. That kept costs predictable, but made a
long-form take's middle and conclusion completely invisible. Generic openings
or a late change of emphasis could therefore cause a false low-confidence
result even when the correct Filmed card was obvious later.

The prompt remains capped at the same 9,000-character budget, but long
transcripts now contribute 50% opening, 25% middle, and 25% ending samples with
clear omission markers. Short transcripts remain unchanged. Focused coverage
proves all three regions survive and the result never exceeds its fixed model
budget.

---

# 376. Queued Editor Saves Keep a Full Decision Snapshot (2026-09-29)

The queue list deliberately polls compact project summaries without transcript
words or cut arrays (§362). Per-project PATCHes are serialized, but a narrow UI
race remained: make two quick decisions, navigate/remount while the first save
is in flight, and let a summary poll replace the list before the second queued
operation resolves its functional patch. That second operation could then use
an incomplete summary rather than the prior full edit as its base.

The browser now maintains an independent full-detail cache populated only by
upload/detail/PATCH responses. Queued functional edits fall back to that cache,
never to a summary when a complete revision is available; conflict reloads and
deletion update it explicitly. The existing unload protection now also covers
in-flight edit saves, and a duplicated upload-only unload listener was removed.
This preserves rapid pause/retake/transcript decisions across project changes,
tab changes, remounts, and compact background polling.

---

# 377. Byte-Identical Upload Retries Share One Project Claim (2026-09-29)

Upload retry recovery already recognized an existing project's source hash, but
there was a pre-persistence race: a response can disappear after the first body
arrives yet before probe/save completes, allowing the automatic retry to hash
the same bytes while no database row exists. Both requests could then pass the
duplicate query and create separate Editor projects.

After hashing and checking persisted projects, a request now claims that SHA-256
inside the process. A concurrent identical request waits for the owner: success
returns the owner's exact project id through the normal duplicate-recovery
contract, while a failed invalid owner releases the key so the independently
received copy can safely become the new claimant. Claims settle idempotently on
every post-claim success/failure path. Unit coverage proves one owner, waiting
recovery, exactly-once settlement, cleanup, and reacquisition after failure.

---

# 378. Restore All Automatic Cuts Without Touching Manual Edits (2026-09-29)

Harvey could restore individual pauses/takes and undo recent decisions, but an
obviously over-aggressive first pass still required many clicks. More
importantly, retake ownership previously included every index in a high-
confidence range even if Harvey had manually removed an overlapping word first;
a later automation restore could therefore revive his manual cut.

Retake reconciliation now claims only words that automation actually adds. A
focused regression proves an overlapping manual word survives both applying
and later dismissing the automatic retake. The Automatic edit panel now exposes
`Restore automatic cuts` whenever an applied automatic pause or retake exists.
It disables automatic pause removal, releases only automation-owned retake
indices, and dismisses only the applied retakes it restored; manual transcript
cuts and unresolved review-only candidates remain intact. The whole action is
one comprehensive undo snapshot, so Undo restores the exact prior automatic
strategy if Harvey changes his mind.

---

# 379. Editor Decisions Are Idempotent Across Lost Responses (2026-09-29)

PATCH saves were serialized and revision-checked, but a mobile connection can
drop after SQLite commits while the response is returning. Replaying a
functional decision such as “toggle this pause” against the newer revision can
apply the intent twice and end where it started; refusing to retry instead
leaves Harvey unsure whether the visible click was saved.

Every browser edit now carries one stable mutation id and retries a network,
408/425/429, or 5xx failure once after 350ms using the exact same resolved
payload. The service durably retains the latest 100 mutation ids per project
and checks them before revision/render locks; a replay returns the current full
project without modifying it or incrementing `editRevision`. These internal ids
are stripped from detail and lightweight list responses. The shared project-
detail builder also removes duplicated response-decoration logic. Integration
coverage applies the same stale-revision mutation twice and proves one revision,
while the headless browser forces a transient PATCH failure and proves the
automatic retry reaches Saved.

Undo now uses the same contract rather than being the one remaining destructive
decision outside it. A replayed Undo returns the already-undone revision before
checking history or render locks, and the client retries one transient failure
with the same mutation id. The Undo fallback also uses the full-detail cache
instead of a compact polling summary. Integration coverage replays one Undo and
proves it consumes exactly one history entry and one revision.

---

# 380. Approval Recovers From a Lost Handoff Response (2026-09-29)

The Production endpoint already makes duplicate approval safe: a concurrent
request joins `productionJobs`, and a later request returns the persisted
`productionPieceId`. The Editor UI did not use that guarantee. A network/5xx
failure while returning a successful handoff showed an alarming error and left
Harvey to reload and determine whether the click had worked.

`Approve & next` now retries one transient network, 408/425/429, or 5xx failure
after 500ms against the captured approved project id. The second request either
joins the running copy or receives the durable already-sent result, then follows
the normal notice/next-recording flow. Validation and business failures remain
single-shot and visible. The browser regression forces the first approval
response to fail and requires the retry to succeed exactly once.

---

# 381. A Newly Verified Render Becomes the Review Surface Automatically (2026-09-29)

When an edit invalidated a prior render, playback correctly moved to the source
working preview. But that same `source` flag survived the replacement render
finishing, so the workspace could continue showing the untouched camera master
while `Approve & next` appeared. In that state the source view also overlaid
preview captions even though its copy said it was untouched.

The browser now distinguishes an explicit click on `Original master` from the
temporary source mode used while a rebuild is pending. A completed verified
render automatically becomes the Final edit unless Harvey deliberately chose
the original after it was available. That deliberate choice, including its
source time, survives refresh; any render-changing decision clears it. Original
master playback now hides caption overlays as well as preserving every cut, so
the two review modes truthfully mean Final encoded bytes versus untouched
source. Browser coverage exercises explicit-source refresh separately from the
automatic working-source-to-final transition.

During that browser regression, a second ordering bug became reproducible: a
poll/detail GET for the old recording could already be in flight when Harvey
clicked the next card. Clearing the timer cannot cancel that request, so its
later response could steal selection back to the old recording. Every
`openProject` now receives a monotonic request token and only the newest token
may update global project/workspace state or show an error; remounting also
invalidates every prior response. The regression deliberately overlaps saves,
remounting, polling, and next-card navigation and requires the clicked card to
remain selected.

---

# 382. Working Preview Honors Removed Ending Silence (2026-09-29)

Instant cut preview skipped opening and middle cuts by seeking to each cut's
end, but deliberately required `cut.end < video.duration`. A trailing-silence
cut ends at the duration, so the working preview played that red section even
though FFmpeg removes it from the final file. This undermined the purpose of
reviewing pacing before an encode completed.

When playback enters a trailing cut, the Editor now pauses on the last retained
frame just before the cut starts. Non-trailing cuts retain the seamless forward
seek. The headless browser injects an ending cut, enters it, and requires the
playhead to return to the kept boundary; the project's normal state is then
restored for the rest of the workflow regression.

---

# 383. Transient Detail Failures Cannot Freeze Editor Polling (2026-09-29)

The list poll re-arms itself on list failure, but when it saw a changed active
project it delegated to `openProject(..., true)`. If that detail GET failed,
`openProject` swallowed the quiet error and never scheduled another poll. A
single brief network/VPS interruption could therefore leave Transcribing or
Rendering visibly frozen until Harvey clicked or reloaded.

Detail loads now retry one transient network, 408/425/429, or 5xx failure after
300ms. If the quiet retry still fails and the request remains current, polling
is explicitly re-armed; direct user navigation still surfaces a persistent
error. Explicit card/Previous/Next navigation now also has priority over quiet
poll and render-refresh loads: quiet requests no longer advance the navigation
generation, and any that began while an explicit load was pending stand down.
The browser regression deliberately races a stale automatic refresh against a
first-attempt 503 on Next and requires the intended card to win on retry.

---

# 384. Editor Entry and Delete Failure UX (2026-09-29)

Two small transport failures previously produced disproportionate confusion.
The initial recording-list request made only one attempt, so a momentary 503
could replace the entire Editor with an unavailable message even though a
reload would work. It now uses the same single bounded transient retry as
detail reads. Persistent failures still surface normally rather than looping.

Deletion is deliberately *not* retried because it is destructive, but its
button is now disabled and labelled `Deleting…` while the request is in flight.
If the request fails, the recording stays selected, the control is restored,
and the alert explicitly says that nothing was deleted. This also prevents a
double-click from issuing duplicate DELETE requests. The browser regression
forces both the first initial-list request and a confirmed delete to return 503,
then checks automatic list recovery and safe delete-control recovery.

---

# 385. Final-Render Starts Survive Lost Responses (2026-09-29)

`POST /api/editor/:id/render` is safely joinable: the server's per-project job
map returns the existing render promise when the same recording is requested
again. The Editor now uses that property when the initial response is lost or a
transient 408/425/429/5xx occurs. It disables the build control immediately,
shows `Starting final edit…`, retries once after 500ms, and then enters normal
render polling. A persistent failure restores the control and reports the
error. This prevents Harvey from wondering whether a click registered and
manually starting competing work after a harmless response-path interruption.
The browser regression simulates the lost first response and requires exactly
one bounded retry before the running state appears.

---

# 386. Mobile Session Queue and Recovery Readability (2026-09-29)

The phone audit showed the horizontal recording queue centring one 180px card
while leaving a distracting fragment of its neighbour (`ke 4`) at the edge.
Mobile recording cards now divide the available strip into two equal columns,
so Harvey can compare the current take with an adjacent take without clipped
labels or extra scrolling. The failure-recovery banner also stacks its retry
button beneath the explanation on narrow screens; `Retry failed steps` no
longer collapses into a tall three-word sliver. Desktop layout is unchanged.
The browser audit requires at least two recording cards to be fully visible in
the mobile queue before capturing its screenshot.

---

# 387. Caption Preview Uses Encoded Timing Exactly (2026-09-29)

The browser working preview added an undocumented 180ms tail after each caption
group's final transcribed word, while the ASS file used by FFmpeg ends that
caption at the word's actual mapped end. This made the supposedly faithful
approval preview retain the final vertical word and long-form emphasis slightly
longer than the delivered video. The browser now uses the same exact group end
for visibility, final-word selection, and long-form emphasis as the encoder.
The regression drives a one-word caption inside and then beyond its timestamp,
requiring it to appear during speech and disappear immediately afterward.

---

# 388. Semantic Retake Auto-Cuts Require Textual Support (2026-09-29)

The retake model was prompted to reserve `high` confidence for obvious failed
takes, and its ranges were structurally bounded, but a structurally valid model
mistake could still label two unrelated nearby passages as replacement takes.
Because all `high` decisions are applied automatically, that was an avoidable
route to deleting unique speech.

Normalization now independently checks that the later take shares either the
opening (up to two words) or at least half of the earlier take's vocabulary.
An unsupported model decision remains visible, with its exact ranges, but is
downgraded to `review` and cannot enter automation-owned cuts. This is
deliberately conservative: a genuine but substantially rephrased replacement
costs Harvey one review click, while unique speech can never disappear solely
because the model asserted high confidence. Unit coverage proves an unrelated
high-confidence pair is downgraded and leaves both manual and automatic removed
word sets empty.

The end-to-end fixture now represents an actual repeated take rather than
asserting that unrelated `One two` / `Three four` lines should be auto-cut. The
recovery-render test also allows 12 seconds rather than 6 for its FFmpeg result
when Node's full suite is running encoders concurrently; its functional
assertions and endpoint timeout remain bounded.

---

# 389. Transcript Recovery Has a Durable Starting State (2026-09-29)

The dedicated transcription-error screen previously fired one unguarded POST:
the control stayed clickable during the request, a lost response looked like a
dead button, and a failure became an unhandled browser rejection. The server's
transcription job map already makes repeated starts join the same job, so the
client now disables the button as `Starting transcription…`, retries one
transient network/408/425/429/5xx response after 500ms, and enters the existing
processing/polling view. A persistent failure restores `Retry transcription`
and reports the reason. The browser workflow forces a first-attempt 503 and
requires exactly one retry plus the processing state.

---

# 391. Docker Build Artifacts Can No Longer Exhaust Editor Storage (2026-09-29)

The media-runtime audit found the VPS at **96% disk usage** with only 4.6GB
free. The application data itself was modest; Docker held 108 dangling
`rm-ops-service` images from rapid backend iteration plus 13.4GB of builder
cache. That was not cosmetic: Editor capacity admission correctly reserves
space for the camera master, review proxy, final render, and Production copy,
so real filming uploads would soon have failed with `insufficient_storage`.

After verifying all four containers were running and all 108 targets were
unreferenced/dangling, `docker image prune -f` and `docker builder prune -f`
reclaimed the obsolete artifacts. Disk usage fell from 92GB/96% to 26GB/27%,
leaving 71GB free; all active images, containers, volumes, and application data
remain intact.

`ops-service/deploy.sh` now cleans dangling images after each *successful*
rebuild and caps unused builder cache at 8GB. The deliberately tagged
`rm-ops-service:previous` rollback image and every active container image are
preserved. Cleanup is best-effort after health-preserving deployment, so a
Docker housekeeping problem cannot falsely turn a working release into a
failed/rollback release.

---

# 392. Delayed Editor Actions Stay Bound to Their Originating Recording (2026-09-29)

The new bounded retries exposed a cross-recording race: transcription,
framing, retake, planning, and final-render callbacks constructed their retry
URL from the mutable global `project`. If Harvey clicked Next during the 500ms
backoff, attempt two could start work on the newly opened recording instead of
the one whose button he pressed. Even single-attempt `Retry failed steps`
could reopen the wrong card after a slow response.

Every asynchronous start now captures its immutable project ID before the
first request. All retries use that ID, and completion callbacks update or
refresh the workspace only if that same recording is still open. Background
work continues safely if Harvey has moved on, and its normal list polling/detail
load reveals the state when he returns. The browser test loses the first render
response, navigates away during backoff, and requires both attempts to target
the original recording without stealing selection.

---

# 393. Long-Form Caption Fitting Matches Preview and Export (2026-09-29)

Normal long-form groups (up to five words) fit comfortably at the requested
larger 65px/3.4cqw style, but an unusual run of long words could exceed the
single-line browser overlay. The browser hid that overflow while libass could
wrap it, creating another preview/export mismatch.

Both paths now leave ordinary phrases unchanged and apply the same bounded
scale only above 50 characters, never below 65% of the normal size. The active
spoken word remains 18% larger in both paths. FFmpeg emits explicit fitted
normal/emphasis sizes for every word in an oversized group, avoiding ASS style
reset leakage after the highlighted word. Unit coverage keeps the existing
normal 65/77px behavior and proves a five-long-word phrase uses the fitted
42/50px pair.

---

# 394. Slow Multi-Gigabyte Filming Uploads Are Allowed to Finish (2026-09-29)

The Editor and nginx intentionally agree on a 2GiB per-recording limit, nginx
streams request bodies rather than buffering another copy, and the backend
reserves disk for every downstream artifact. However, Node's HTTP server still
used its default five-minute timeout for receiving the *entire* request body.
A maximum-size take would need roughly 55Mbps sustained upload speed to avoid a
server-side 408, which is not a safe assumption for Harvey's phone/home path.

The HTTP server now allows two hours by default for a continuously progressing
request body. `REQUEST_BODY_TIMEOUT_MS` documents an optional override bounded
between five minutes and four hours. This does not raise the 2GiB Multer limit,
bypass storage admission, weaken nginx streaming, or extend idle gaps at the
proxy; it only removes the inappropriate whole-upload wall-clock cutoff.

---

# 390. Manual Analysis Restarts Survive Lost Responses (2026-09-29)

The framing, possible-retake, and planning-card `Analyze/Match again` controls
already disabled themselves while starting, but each made only one request.
Their server functions all deduplicate by recording ID, so retrying a lost
response joins the existing classifier rather than launching competing work.
All three controls now use one bounded transient retry after 500ms, preserving
the existing error restoration for persistent failures. The browser workflow
forces the first manual retake-analysis response to fail with 503, then requires
one retry and a visible running-analysis state.

---

# 395. Transcript-Timed Punch-Ins and Smaller Caption Defaults (2026-09-30)

Harvey reported that Editor captions were still substantially too large and
asked for the other major part of his normal edit: timed camera punch-ins for
both horizontal and vertical videos.

Caption sizing is now reduced consistently in the working browser preview and
the baked ASS export. Horizontal captions use a 52px export base with a gentler
12% spoken-word emphasis; vertical one-word captions use an 86px base. The
preview uses the exact proportional equivalents, including long-word fitting,
so approval does not change at encode time. The video frame clips the video
itself while caption overflow remains visible, keeping zoomed footage and text
inside their intended safe areas.

Punch-ins are transcript-driven. Harvey can select any words or sentence and
choose `Punch in selected`; the Editor creates a timed zoom with short speech
handles, jumps directly into its working preview, and exposes controls for
subtle through dramatic zoom plus horizontal and vertical focal position. Each
punch-in has a direct Preview and Remove action and a bright marker on the
speech timeline that also starts playback just before the zoom. The settings are durable,
revision-protected Editor state and invalidate/rebuild the verified render like
other visual edits.

The final encoder does not approximate these with CSS. It splits retained
footage at the exact source-time punch boundaries, applies a second crop and
scale at the chosen focal point, then concatenates those segments through the
existing audio-boundary and caption pipeline. Punch boundaries never remove
source duration and continue to work when silence/transcript cuts intersect
them. Contiguous visual-only boundaries preserve the original dialogue samples;
the 8ms click-prevention fades are now applied only across genuine source jumps,
not whenever the picture punches in or out. Unit coverage proves normalization, duration preservation, API
persistence, and a real FFmpeg export. A dedicated headless-browser workflow
selects transcript words, creates a punch-in, observes the live scale, changes
its strength, and removes it; the complete existing Editor browser regression
also remains green.

---

# 396. Storefront Deploys Ignore Internal-Tool-Only Commits (2026-09-30)

After the ops-service deployment race was fixed, Harvey received another
GitHub “run failed” email around 11:05 Bangkok time. GitHub's Actions API
confirmed that every post-fix `Deploy ops-service` run (370–373) succeeded.
The new notification came from a different workflow: storefront `Deploy` run
716 attempted a GitHub Pages publication for commit `f2ef44e`, even though
that commit changed only the internal Editor and project documentation. Its
`actions/deploy-pages` step failed while the actual ops-service deployment for
the same commit succeeded.

`.github/workflows/static.yml` previously ran on every push to `main`, so every
backend, internal-tool, documentation, and CI-log commit unnecessarily tried to
republish an unchanged storefront. It now triggers only for `frontend/**` or
the workflow file itself. Real storefront deployments also share a
`deploy-storefront-pages` concurrency group with queuing enabled, preventing
two genuine Pages publications from competing for the same environment. The
workflow and GitHub Pages hosting remain intact; unrelated changes simply stop
creating redundant Pages runs and failure emails.

---

# 397. Second VPS Storage Cleanup Preserves All Content Data (2026-09-30)

Harvey received a 90%-disk warning after the earlier Docker cleanup. Direct
host measurement showed that warning was stale: the live filesystem was already
at 31GB/96GB (33%), and the durable Content Studio data occupied only 2.3GB.
The Kanban SQLite database itself was about 9MB; the complete active Editor
workspace was about 99MB. Neither was responsible for storage pressure.

The remaining disposable usage was 8.528GB of Docker builder cache, a nine-day
old `rm-ops-usage-test-224285` test container plus its uniquely tagged
`rm-ops-service:usage-test` image, 1.8GB of npm download cache, its 2.7MB
temporary test data directory, and stale generated `audio-preview-*.mp3` files
older than twelve hours. Those targets were verified individually and removed.
The running ops-service, storefront backend, n8n container/volume, the current
and rollback ops images, `/root/ops-service-data`, all source recordings,
manuscript assets, audio-library files, production media, and both repository
clones were preserved.

After cleanup, disk use was 20GB/96GB (21%) with 77GB available. Docker builder
cache was 0B, the three production containers were still running, both public
health endpoints returned `ok`, and `PRAGMA quick_check` returned `ok` for the
Content Studio database.

---

# 398. Long Project Manager Replies Play Completely Without a Long Initial Stall (2026-09-30)

Harvey pressed Play on an 8,000-character Codex reply and the button appeared
stuck on **Loading audio…**. A live request reproduced the underlying behavior:
the TTS route silently truncated every reply to 4,096 characters, and preparing
even that truncated half took roughly 33 seconds before the browser could play
its four-minute MP3. The existing 45-second deadline prevented a permanent
hang, but it did not make long replies usable or complete.

Current Project Manager clients now request sentence-bounded speech parts of at
most 1,800 characters. The browser buffers the first part completely so uneven
provider delivery cannot cause the old stop-start playback, begins speaking as
soon as that first part is ready, and preloads exactly one following part while
the current one plays. It retains the same manual-play ownership and Stop state
across every boundary. Starting a recording, pressing Stop, muting voice, or
selecting another response still cancels the complete sequence immediately.

Codex parts remain resolved from the canonical completed database row, never
from browser-supplied text. The route exposes only the requested bounded part
and its total count, supports replies up to 50,000 spoken characters, and keeps
the legacy 4,096-character response for an already-open stale client until it
reloads. Cache keys were bumped on desktop and mobile. Unit coverage proves
lossless sentence/word splitting and a three-part browser sequence that starts,
prefetches, advances, retains ownership and releases cleanly; all 139 service
tests pass.

---

# 399. Editor Trusts Camera Orientation and Adds a Default Vertical Opening Push-In (2026-09-30)

Harvey will now record vertical pieces with the Sony camera physically rotated
and horizontal pieces in landscape. The Editor therefore no longer creates a
three-frame contact sheet or asks an AI vision turn to infer whether the book
shows one page or a spread. FFprobe's rotation-aware display dimensions are the
single automatic source of truth: portrait means vertical, landscape means
horizontal, and the existing manual Frame selector remains available as a
deliberate override. Existing active projects are migrated to the same
orientation result; already-approved projects remain immutable. This removes a
slow, fallible preprocessing phase and its failure/review gate without changing
duration-based short/long-short classification or the retake workflow.

Vertical projects now expose a **Subtle opening push-in** switch in Automatic
Edit. It is enabled by default for new and existing active projects, absent on
horizontal projects, revision-protected, and treated as a render-affecting
choice. The effect uses smoothstep easing from 100% to 104% over the first
three seconds of the edited timeline, then holds at 104%. That restrained
amount was selected from common editorial guidance that places subtle social
push-ins around 102–105%. Because timing is based on retained edited footage,
an automatically removed opening pause cannot consume the effect. It composes
with transcript-timed punch-ins rather than replacing them.

The working browser preview applies the same easing and combined zoom as the
FFmpeg export. The final render performs a frame-evaluated scale and centered
crop after the portrait frame and any manual punch-in, retaining an exact
1080×1920 output. Unit tests cover the easing, filter shape, orientation-only
classification and render invalidation; the end-to-end upload/transcribe/render
test now uses a portrait master and exercises the real animated FFmpeg path.

---

# 400. Camera Rotation Metadata Is Baked In Automatically (2026-09-30)

Harvey will rotate the Sony ZV-E10 physically for vertical recordings and does
not want a rotation setting in the Editor. Camera files may still contain
landscape-coded pixels plus a 90-degree display matrix; Sony's own ZV-E10 guide
also notes that vertically shot movies can play horizontally on the camera.
The Editor now records the stream's display-matrix or rotate-tag value during
FFprobe and treats those rotation-aware display dimensions as authoritative.

Any quarter-turned camera master is always given a browser review proxy, even
when its original MOV/MP4 codecs would otherwise play directly. FFmpeg
explicitly enables autorotation while building that proxy, so the proxy has
physically upright portrait pixels rather than relying on browser support for
the camera tag. Proxy verification rejects any output that still carries a
quarter-turn. The final Editor render also explicitly enables autorotation
before framing, captions, opening push-in, and punch-ins. There is no checkbox
or manual rotation step; the original camera master remains untouched.

The end-to-end Editor test now constructs the real edge case: a 640×360 coded
video carrying a 90-degree display matrix. It proves upload detection reports a
portrait project, the normalized H.264 review file becomes available, and the
captioned final passes the existing 1080×1920 technical verification.

---

# 401. Vertical Captions Sit Lower in the Frame (2026-09-30)

Harvey's real portrait preview showed the one-word yellow captions sitting too
high above the visual focus area. Vertical captions now use a 33% bottom margin
instead of 36.5%, moving them modestly downward to sit just above the lower
page/hand area he marked. Horizontal captions are unchanged.

The browser working preview and baked ASS render use the same proportional
position, and the stylesheet cache key was bumped so an already-open device
receives the new placement after reload. Unit coverage verifies the exact
1080×1920 export margin. Render format version 2 also invalidates and
automatically rebuilds any unapproved ready edit made with the earlier caption
position; approved Production inputs remain immutable.

---

# 402. Caption Yellow and Shadow Are Softer (2026-09-30)

Harvey wanted the yellow captions slightly less vivid and the reference's
subtle depth behind the lettering. Preview captions now use muted warm yellow
`#f4df63`, retain the dark readability edge, and finish with a softer blurred
black drop shadow. Baked ASS captions use the exact corresponding BGR colour
and a two-pixel shadow in addition to their existing outline, rather than the
old one-pixel offset.

The stylesheet cache key and Editor render version were advanced together.
Active unapproved edits therefore rebuild automatically and cannot show the
new preview styling while retaining an older baked export; approved Production
inputs remain immutable.

---

# 403. Portrait Review Uses Its Side Space and No Longer Exposes Crop Pan (2026-09-30)

Now that portrait recordings come from the physically rotated Sony camera,
the old **Horizontal crop position** slider was both confusing and redundant.
It has been removed from the Editor UI and accepted PATCH fields, and portrait
framing now uses the camera's centre deterministically in both the browser and
FFmpeg output. Old stored crop-pan values are ignored. Render format version 4
automatically rebuilds active unapproved outputs under the centred policy;
approved Production inputs remain immutable.

Portrait review no longer places a narrow 332×590 player in the middle of a
wide empty black strip. The player is now up to 430×764 on desktop. The former
empty sides contain real controls: playback speed and source/final switching
on the left, with captions, pause removal, opening push-in, pacing and restore
controls on the right. Those controls remain with the speech map for landscape
videos. At narrower desktop widths the enlarged player takes the full first
row and the two control cards sit beneath it; on phones the player and cards
stack into one usable column.

Both changed assets have new cache keys, so existing browsers receive the new
layout immediately after reload. Live authenticated Playwright checks at
1440×1000 and 390×844 verified the real portrait project has a 430×764
desktop player, two side-control cards, no duplicate control IDs, no crop
control, working speed/source/final controls, a 340×604 phone player, correct
stack order, and no horizontal overflow.

---

# 404. Punch-Ins Are Fast Smooth Moves With Direct On-Video Framing (2026-09-30)

Harvey clarified that a punch-in is not an instantaneous crop. It is a fast,
smooth camera move into the selected framing, followed by the same move in
reverse when that transcript section ends. Both the working browser preview
and FFmpeg export now use matching smoothstep ramps over 280ms. Very short
punches automatically use half their duration for each side, so the in/out
motion remains symmetrical and never overlaps incorrectly. Browser playback
updates the transform on animation frames rather than relying on the much
slower media `timeupdate` event, keeping the short move visibly fluid.

The separate zoom-strength and horizontal/vertical sliders have been removed.
New punches use the standard restrained 118% framing. Each punch card now has
**Position on video**, which pauses on the selected passage and overlays the
actual crop rectangle on the source frame. The area outside it is dimmed and
Harvey drags the rectangle directly to choose exactly what the zoom will retain;
arrow keys provide an accessible fine adjustment. The rectangle dimensions and
position are derived from the same zoom and normalized centre values used by
the encoder, so it is a framing guide rather than an approximate decoration.
**Preview** hides the guide and plays the working effect, or the verified baked
render when one is ready.

Render format version 5 invalidates active unapproved outputs made with the old
hard cut. Approved Production inputs remain immutable. Unit coverage verifies
the mirrored scale curve, generated dynamic FFmpeg filter, focal position, and
a real end-to-end render. The full 140-test service suite passes. After the
successful live deployment, an authenticated Chromium run verified the real
portrait project has no legacy zoom/X/Y controls, opens an 84.75%-sized framing
rectangle inside the 430×764 player, responds to a real pointer drag, and hides
the guide before switching Preview back to the verified final edit.

---

# 405. Editor Review Uses Small, Scrub-Optimized Proxies and Custom Playback Controls (2026-09-30)

Harvey found that seeking backward in the browser's native player could show a
fresh loading state even in a 16-second recording. Replacing the visible controls
alone could not fix the media-level cause: the Editor sometimes served the full
camera master whenever its codecs happened to be browser-compatible, while both
camera and rendered files could have widely spaced keyframes. A browser then had
to fetch and decode much more video than the requested frame required.

Every active recording now receives a dedicated H.264 editing proxy regardless
of its camera codec. It is capped at 854 pixels on its long edge (approximately
480p), normalized to 30fps, encoded at CRF 30 with 64kbps AAC, fast-started, and
given a keyframe every 15 frames, or half a second. Verified final edits receive
a separate proxy with the same properties. The source camera master and the
authoritative 1080×1920 or 1920×1080 Editor render remain untouched and continue
to be the inputs used for final output and Production handoff. Both proxy routes
retain Express byte-range support, so seeking fetches only the required portion.
Existing active sources and verified renders acquire version-2 proxies in the
background after deployment; new renders build and verify their review proxy
before becoming ready. Conservative disk-capacity admission now reserves space
for both additional proxy artifacts even though their real size is much smaller
than a master.

The native controls have been replaced by an Editor-owned overlay with immediate
play/pause, scrub rail, elapsed and total time, mute, fullscreen, and a delayed
Loading indicator that only appears for a real stall. The existing keyboard
shortcuts and preview motion/caption synchronization remain intact. Desktop and
mobile receive new asset cache keys.

During full-suite verification, the new startup migration exposed an existing
stale-write race: its asynchronous FFprobe validation could finish after resumed
transcription and save the older `running` snapshot back over the completed
state. The migration now re-reads the current project immediately after every
asynchronous validation before mutating or saving it. The focused recovery test
and the complete 140-test suite pass. Real FFmpeg coverage verifies the 854-pixel
cap, 30fps rate, half-second keyframe spacing, final-review proxy creation, and
HTTP 206 range responses for both source and final review media.

After the successful deployment, authenticated Chromium verified the migrated
real portrait project serves both source and final review at 480×854. A seek to
15 seconds completed in 75ms and a backward seek to 3 seconds completed in
51ms on the 16-second final; the longer source measured 53ms forward and 46ms
backward. Both live routes returned HTTP 206 for a requested byte range, the
custom slider moved the real playhead, its Play control started playback, and
no page errors occurred.

---

# 406. Redundant Editor Preview Description Removed (2026-09-30)

The full-width strip above the player repeated whether the current view was the
final edit or source copy and explained that Production receives the full-quality
file. That distinction was already evident from the selected source/final control
and added height without enabling any action. Portrait review no longer renders
the strip at all. Horizontal review still needs its speed and source/final
controls, so those remain in a compact action-only toolbar without the repeated
heading or explanatory copy. The old preview-mode CSS and its mobile layout rule
were removed, and both Editor asset cache keys were advanced.

---

# 407. Backing-Audio Choice and Instant Loudness-Matched Auditions Move Into Editor (2026-09-30)

Soundtrack selection for Editor-origin videos now happens while reviewing the
edit rather than later in Content Production. Once a verified edit is ready,
the Editor automatically requests one audio-only audition for every playable
ambient-library track. A visible **Loading audio previews X/N** indicator tracks
the batch. Two mixes run concurrently so a large library cannot launch an
unbounded FFmpeg storm, duplicate requests share one in-flight/cache result,
and server scratch results expire after two hours or immediately when that
project's render changes. The browser downloads each result completely and
holds a blob URL, making Previous, Next, and dropdown switching instant after
the batch completes.

These are not duplicate video renders. The browser keeps the lightweight final
video proxy and plays a separate mixed-audio stream beside it. Play, pause,
seek, playback speed, restart, mute, and drift correction control both streams
as one player. Selecting a track restarts the comparison at zero. Selecting
**No backing music** restores the edit's own audio. Source-view playback never
misapplies an edited-timeline mix; choosing music there returns review to the
verified final timeline.

Each audition goes through the same dialogue measurement, loudest sustained
music calibration, optional ducking, two-pass final normalization, and
true-peak limiting as the published final. Only its delivery codec is cheaper:
48kbps MP3 rather than the final video's 192kbps AAC. Thus compression reduces
browser memory/network cost without changing the relative loudness decision.
The selected global mix profile is snapshotted with the Editor choice and
carried into the Production piece, so a later Settings change cannot make the
published mix differ from what Harvey approved.

Approval is now blocked until a real track or **No backing music** is selected.
An uncommitted choice can still be cleared safely through the Editor API, while
the explicit **No backing music** state remains the reviewable, approvable
choice for a deliberately silent edit.
The Editor handoff copies that choice and mix snapshot into the Processing
piece. Content Production no longer shows a second backing-audio picker for
Editor-origin videos; it retains the picker only for legacy/direct uploads that
bypass Editor. That field is also hidden from the shared legacy piece modal for
Editor-origin videos, so there is no second UI capable of contradicting the
reviewed choice. Production therefore remains responsible for titles and the
thumbnail frame, while the existing final builder receives the already-reviewed
soundtrack automatically.

Backend coverage verifies the library response, 48kbps option, one shared build
for simultaneous identical auditions, persisted selection and mix settings,
missing-track rejection, and the approval gate. The complete 140-test suite
passes, and Editor/app/stylesheet cache keys were advanced.

After the successful full-container deployment, authenticated Chromium tested
the real portrait Editor project and its real 27-track library. The visible
counter advanced from 0/27 to all 27 ready in 33 seconds, then unlocked a
29-option selector (placeholder, explicit no-music choice, and 27 tracks).
Selecting and stepping to another track created no replacement video: the same
browser-safe video played beside the preloaded blob audio, both restarted at
zero, playback drift stayed around 0.05 seconds, and an eight-second seek
realigned them exactly. The project's original empty selection was restored by
API afterward. The 27 compressed auditions occupied 2,450,844 bytes total
(about 91KB each), versus duplicating the full video 27 times. A 390px-wide
browser then loaded the complete ready panel with no horizontal overflow or
page errors.

---

# 408. Editor Soundtrack Playback Uses an Audio-First Start Gate (2026-09-30)

Harvey noticed the failure mode inherent in starting the lightweight video and
the separate loudness-matched audio preview with one `Promise.all`: the video
decoder could enter playback before the audio decoder, so the picture visibly
started while the voice lagged behind. Drift correction after playback began
could not repair that initial perceptual miss.

The Editor now treats the mixed-audio stream as the start clock. Play holds the
muted video on its current frame, aligns both streams to the same timestamp,
starts the fully preloaded audio, then releases the video at the audio element's
actual position. This applies to the player button, clicking the picture,
keyboard playback, timeline jumps, cut previews, transcript-selection review,
autoplay after view changes, and track switching. A token cancels obsolete
starts, Pause explicitly stops both streams, and a guard routes any remaining
internal direct-video start back through the same gate. Single-stream source or
no-music playback remains a normal immediate video start.

The complete 140-test suite passes and the Editor asset cache key was advanced.

The frontend-only deployment completed without restarting the service.
Authenticated Chromium then measured the real Editor rather than a synthetic
player. On first soundtrack selection, audio reached `playing` before video;
the picture followed 18ms later instead of escaping first. A pause/resume began
audio 1.3ms before the video's `play` event, both reached steady playback within
62ms of the click, and ongoing timeline drift was about 0.03 seconds. The test
restored the project's original empty soundtrack choice and produced no page
errors.

---

# 409. Editor Working Titles Come From the Transcript, Never Camera Filenames (2026-09-30)

The Editor previously displayed an opaque camera basename such as `9259` when
its transcript did not confidently match a Filmed planning card. Production's
later analyzer could generate a useful label, but that was too late: the Editor
queue and review header still required Harvey to remember which numbered clip
contained which idea.

The existing post-transcription planning-match pass now has two inseparable
jobs. It still links a planning card when confidence is high, and it always
returns a concise 3–10 word working title describing the transcript's central
idea, even when the candidate list is empty or nothing matches. The structured
schema requires that title. Newline/whitespace/quote cleanup and a strict
length bound are applied before it becomes the project's visible `name` and
durable `workingTitle`. The original uploaded camera name remains untouched in
`fileName` as provenance and as the stable source-master identity.

Because the Editor's queue, heading, navigation and Production handoff already
consume `project.name`, they receive the meaningful transcript label without a
second naming system. A matched planning card remains the primary visible
identity (`#079 · Rule of Innovation`), while the transcript title remains
useful secondary context. Existing active transcribed projects without a
working title are automatically queued through the text pass once on service
startup, so legacy numeric filenames are backfilled rather than only fixing
future uploads.

Service coverage now proves both the no-candidate and high-confidence-match
paths persist a working title and name source, including the startup backfill.

After the successful full-container deployment, the startup migration sent the
real active `9259` project through the new text pass. Authenticated live API and
DOM checks confirmed its queue/review title became **Consciousness Is
Fundamental to the Game of Life**, its `workingTitle` and `nameSource` persisted
as transcript-derived, and the untouched source provenance remained
`fileName: 9259.mp4`.

---

# 410. Opening Push-In Uses Fractional Per-Frame Resampling (2026-09-30)

The opening portrait push-in had the correct three-second smoothstep easing in
both browser preview and export, but its rendered movement still looked jagged.
The cause was spatial quantization rather than the easing curve: FFmpeg's
dynamic `scale` filter was forced to round the growing 1080-wide frame to even
integer dimensions. Across a subtle four-percent move, many consecutive frames
therefore repeated exactly before catching up in a visible two-pixel step.

The render path now uses a fixed-output `zoompan` resample. Its crop window is
evaluated at a fractional zoom on every 30000/1001 output frame, centered on the
same point, and driven by the same 0–4% smoothstep used in the browser. Segment
offsets are converted to output-frame offsets, so edits containing cuts continue
one uninterrupted opening curve rather than restarting the motion at every
segment. Output dimensions remain fixed throughout, avoiding both dimension
stair-stepping and concat instability.

On a static high-contrast 1080x1920 diagnostic source, the old filter produced
only 53 distinct frames over the 90-frame opening and 37 adjacent duplicate
pairs. The fixed-output resample produced 73 distinct frames and only 17
adjacent duplicates; the remaining identical frames occur at the intentionally
near-zero velocity ends of the easing rather than in two-pixel catches. A
five-second benchmark took 2.68 seconds versus 1.94 seconds for the old path,
substantially cheaper than the equivalent two-times supersampled workaround at
5.42 seconds. The browser preview already uses a fractional CSS transform and
GPU transform hint, so no separate visual curve is introduced there.

---

# 411. Punch-In Motion Engine and Remotion Evaluation (2026-09-30)

Harvey reported that the Editor's punch-in still looked jagged and asked for a
real Remotion trial rather than another assumption about FFmpeg. A Remotion
4.0.530 prototype was built against the live 1080×1920 Reality Manual clip,
using its frame clock, `interpolate()`, cubic Bézier easing, an anchored CSS
transform, `OffthreadVideo`, and the server renderer. The output was visually
clean and validated the right animation model, but it also established that a
wholesale renderer replacement would be the wrong trade here: five seconds of
video took 28.27 seconds on this two-core VPS and required roughly 600MB of
Remotion/Chromium dependencies. The equivalent fixed-output FFmpeg prototype
took 6.29 seconds. Applying Remotion to a possible twenty-minute long-form edit
would add considerable render latency, image size, browser lifecycle failure
modes, and a second media pipeline for no visible benefit in this constrained
transform use case. No Remotion dependency or prototype artifact is committed.

The useful part of the Remotion architecture is now in the production Editor.
Punches remain a structured effect (`start`, `end`, `zoom`, and normalized
anchor), while one deterministic camera-motion function owns the interpolation
and rendering expression. The entrance and exit now use the same mirrored
ease-in-out cubic curve as the evaluated Remotion composition. Their motion
window is 450ms instead of 280ms, giving a 29.97fps export roughly fourteen
meaningful animation frames rather than eight while still reading as a fast
punch. The working browser preview uses the identical duration and equation.

The export no longer grows the source in even integer dimensions and crops it,
which was the remaining staircase that the opening-move fix had not addressed.
Punch scale and focal position are now evaluated together in a fixed-output
fractional `zoompan` transform on every output frame. When an opening push and a
punch overlap, their zooms and X/Y offsets are composed mathematically and the
source is sampled once, avoiding both wobble from independently rounded axes
and softness from two resampling passes. Render format version 6 invalidates
active unapproved files created by the previous punch renderer; approved
Production inputs remain immutable.

Coverage verifies the matching cubic midpoint and mirrored exit, anchored
fractional filter, absence of the old integer `scale` path, and the single-pass
composition of simultaneous opening and punch motion. The existing real
upload/transcription/cut/punch/caption/render integration test executes the new
filter and passes its 1080×1920 output checks.

The complete 141-test suite passes. After the successful full-container
deployment, startup render-version reconciliation rebuilt the real active
portrait project, including its existing 2.03-second punch focused at
`centerY: 0.68`. The new full-quality file and scrub proxy both reached ready;
FFprobe confirmed 1080×1920, 30000/1001fps, yuv420p, 15.033 seconds, and the
service's audio/duration/frame verification passed. Frame samples across both
the 450ms entrance and mirrored exit showed the focal point held steadily while
scale advanced through the intended cubic ramp.
