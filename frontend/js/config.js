// Frontend runtime configuration.
//
// api.realitymanual.com is a real backend now (Docker container
// rm-storefront-backend on the Hostinger VPS, nginx + Let's Encrypt — see
// CLAUDE.md §65). The checkout obtains Stripe's active publishable key from
// that backend at runtime so client and server can never use different modes.
// Only switch this to http://localhost:4000 for local dev against a backend you
// started yourself (`npm start` in backend/), and add
// http://localhost:5500 (or wherever you're serving /frontend) to
// backend/.env's CORS_ORIGIN in that case — the deployed backend only
// allows the live origin.
window.RM_CONFIG = {
  API_BASE_URL: 'https://api.realitymanual.com',
};
