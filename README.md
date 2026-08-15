# The Reality Manual

Custom single-product ecommerce site for **The Reality Manual** (First
Edition Premium Hardcover, $39 USD) — realitymanual.com.

Full project scope and product/engineering requirements live in
[`CLAUDE.md`](./CLAUDE.md).

## Status

Building in phases. **Phase 1 (current): core paid flow** — landing page,
custom Stripe Elements checkout, server-side shipping calculation, Stripe
webhook-confirmed payments, and a confirmation page that polls order status.

Not yet built: Lulu print fulfillment, first-party analytics, SEO admin,
`/admin-dashboard`, refunds.

## Structure

```
/frontend   static HTML/CSS/JS site — deploys to GitHub Pages
/backend    Node/Express API + SQLite — deploys to the VPS
```

See [`backend/README.md`](./backend/README.md) for setup, environment
variables, and how to test the Stripe flow locally (Stripe CLI + test
cards).

To run the frontend locally, serve `/frontend` with any static file
server (e.g. `npx serve frontend`) and point `frontend/js/config.js` at
your local backend.

## Deployment

- **Frontend:** GitHub Pages, via `.github/workflows/static.yml` — deploys
  the `/frontend` directory automatically on every push to `main`.
  `realitymanual.com`'s DNS is proxied through Cloudflare in front of it
  (CDN/DNS only, not the separate Cloudflare Pages product).
- **Backend:** Node process on the existing Hostinger VPS, behind Nginx,
  at `api.realitymanual.com`. Not deployed yet — this part is still
  local-development-only until Stripe test-mode credentials are supplied
  and the Phase 1 flow is verified end-to-end, and until VPS access is set
  up.
