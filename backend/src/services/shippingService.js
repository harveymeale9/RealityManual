const db = require('../db');
const config = require('../config');

const getRateStmt = db.prepare('SELECT * FROM shipping_rates WHERE country_code = ?');
const getRestOfWorldStmt = db.prepare("SELECT * FROM shipping_rates WHERE country_code = 'REST_OF_WORLD'");

// The server is the sole authority on price. The browser may tell us which
// country was selected, but never what it should cost.
function calculateTotal(countryCode) {
  const rate = getRateStmt.get(countryCode) || getRestOfWorldStmt.get();

  if (!rate) {
    throw new Error(`No shipping rate configured for "${countryCode}" and no REST_OF_WORLD fallback exists.`);
  }

  const bookPriceCents = config.site.bookPriceCents;
  const shippingPriceCents = rate.price_usd_cents;
  const totalPriceCents = bookPriceCents + shippingPriceCents;

  return {
    bookPriceCents,
    shippingPriceCents,
    totalPriceCents,
    currency: config.site.currency,
  };
}

function listRates() {
  return db.prepare('SELECT * FROM shipping_rates ORDER BY country_name').all();
}

module.exports = { calculateTotal, listRates };
