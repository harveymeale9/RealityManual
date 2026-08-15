// Frontend runtime configuration.
//
// STRIPE_PUBLISHABLE_KEY is safe to expose (it is designed to be public).
// Never put a Stripe *secret* key or webhook secret here.
//
// Update API_BASE_URL per environment:
//   local dev  -> http://localhost:4000
//   production -> https://api.realitymanual.com
window.RM_CONFIG = {
  API_BASE_URL: 'http://localhost:4000',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_REPLACE_ME',
};
