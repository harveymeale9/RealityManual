const db = require('../db');
const config = require('../config');
const bookvaultService = require('./bookvaultService');
const errorLogService = require('./errorLogService');

const getRateStmt = db.prepare('SELECT * FROM shipping_rates WHERE country_code = ?');
const getRestOfWorldStmt = db.prepare("SELECT * FROM shipping_rates WHERE country_code = 'REST_OF_WORLD'");

// The server is the sole authority on price. The browser may tell us which
// country/postcode/quantity was entered, but never what it should cost.
//
// Primary path: a live BookVault shipping quote (POST /Dispatch), priced
// for the exact country + postcode + quantity entered — see
// bookvaultService.js and CLAUDE.md §64/§66. Quantity matters here, not
// just for the book subtotal: BookVault's quote is weight-based, and
// enough copies can push the order out of a cheaper service's weight
// bracket entirely (see §66) — always re-quote rather than reusing an
// earlier quantity's price. If the call fails for any reason (BookVault
// down, network timeout, postcode BookVault doesn't recognise), we fall
// back to the static per-country shipping_rates table (scaled by quantity,
// even though it isn't truly weight-aware) rather than blocking checkout —
// the customer still gets a price, just a flatter one, and the fallback is
// logged so it shows up in the admin error log.
async function calculateTotal(countryCode, postalCode, quantity = 1) {
  const bookPriceCents = config.site.bookPriceCents;
  const bookSubtotalCents = bookPriceCents * quantity;
  const currency = config.site.currency;

  let shippingPriceCents;
  let serviceName = null;
  // True once we can confirm the order has been priced out of whatever
  // service would apply to a single copy (USPS Consolidator domestically,
  // the cheapest tracked option generally — see CLAUDE.md §66) into a
  // pricier one purely because of quantity/weight. Compared by name against
  // a real qty=1 quote for the same destination rather than a guessed
  // weight threshold, since BookVault's weight brackets aren't documented
  // and can differ by country/carrier.
  let shippingUpgraded = false;

  try {
    const quote = await bookvaultService.getShippingQuote({
      countryCode,
      postalCode,
      quantity,
      currency: currency.toUpperCase(),
    });
    shippingPriceCents = quote.shippingPriceCents;
    serviceName = quote.serviceName;

    if (quantity > 1) {
      try {
        const baseline = await bookvaultService.getShippingQuote({
          countryCode,
          postalCode,
          quantity: 1,
          currency: currency.toUpperCase(),
        });
        shippingUpgraded = Boolean(baseline.serviceName) && baseline.serviceName !== serviceName;
      } catch {
        // The baseline comparison only drives an informational warning, not
        // the authoritative price — if it fails, just skip the warning
        // rather than failing the whole shipping calculation over it.
      }
    }
  } catch (err) {
    errorLogService.logError({
      service: 'bookvault',
      errorType: 'shipping_quote_failed',
      errorMessage: err.message,
    });
    shippingPriceCents = staticRateCents(countryCode) * quantity;
  }

  const totalPriceCents = bookSubtotalCents + shippingPriceCents;

  return {
    bookPriceCents,
    bookSubtotalCents,
    shippingPriceCents,
    totalPriceCents,
    currency,
    quantity,
    serviceName,
    shippingUpgraded,
  };
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
