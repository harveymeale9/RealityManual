const db = require('../db');
const config = require('../config');
const bookvaultService = require('./bookvaultService');
const errorLogService = require('./errorLogService');

const getRateStmt = db.prepare('SELECT * FROM shipping_rates WHERE country_code = ?');
const getRestOfWorldStmt = db.prepare("SELECT * FROM shipping_rates WHERE country_code = 'REST_OF_WORLD'");

// The server is the sole authority on price. The browser may tell us which
// country/postcode was entered, but never what shipping should cost.
//
// Primary path: a live BookVault shipping quote (POST /Dispatch), priced
// for the exact country + postcode entered — see bookvaultService.js and
// CLAUDE.md §64. If that call fails for any reason (BookVault down, network
// timeout, postcode BookVault doesn't recognise), we fall back to the
// static per-country shipping_rates table rather than blocking checkout —
// the customer still gets a price, just a flatter one, and the fallback is
// logged so it shows up in the admin error log.
async function calculateTotal(countryCode, postalCode) {
  const bookPriceCents = config.site.bookPriceCents;
  const currency = config.site.currency;

  let shippingPriceCents;
  try {
    const quote = await bookvaultService.getShippingQuote({
      countryCode,
      postalCode,
      currency: currency.toUpperCase(),
    });
    shippingPriceCents = quote.shippingPriceCents;
  } catch (err) {
    errorLogService.logError({
      service: 'bookvault',
      errorType: 'shipping_quote_failed',
      errorMessage: err.message,
    });
    shippingPriceCents = staticRateCents(countryCode);
  }

  const totalPriceCents = bookPriceCents + shippingPriceCents;

  return { bookPriceCents, shippingPriceCents, totalPriceCents, currency };
}

function staticRateCents(countryCode) {
  const rate = getRateStmt.get(countryCode) || getRestOfWorldStmt.get();

  if (!rate) {
    throw new Error(`No shipping rate configured for "${countryCode}" and no REST_OF_WORLD fallback exists.`);
  }

  return rate.price_usd_cents;
}

function listRates() {
  return db.prepare('SELECT * FROM shipping_rates ORDER BY country_name').all();
}

module.exports = { calculateTotal, listRates };
