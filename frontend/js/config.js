// Frontend runtime configuration.
//
// STRIPE_PUBLISHABLE_KEY is safe to expose (it is designed to be public).
// Never put a Stripe *secret* key or webhook secret here.
//
// api.realitymanual.com is a real backend now (Docker container
// rm-storefront-backend on the Hostinger VPS, nginx + Let's Encrypt — see
// CLAUDE.md §65), still running on Stripe TEST keys pending go-live. Only
// switch this to http://localhost:4000 for local dev against a backend you
// started yourself (`npm start` in backend/), and add
// http://localhost:5500 (or wherever you're serving /frontend) to
// backend/.env's CORS_ORIGIN in that case — the deployed backend only
// allows the live origin.
window.RM_CONFIG = {
  API_BASE_URL: 'https://api.realitymanual.com',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_51TYNf5R2O5kp0xhWNCcqAOvkKO6lYACpdKfOnxiIeJTuxsPJGhM5OmTgl146Fi91lpmbKbZ6a9Ek3xH4mbEKKebs00tGix5uI0',
};
