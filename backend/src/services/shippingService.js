const db = require('../db');
const config = require('../config');
const bookvaultService = require('./bookvaultService');
const exchangeRateService = require('./exchangeRateService');
const errorLogService = require('./errorLogService');

// The server is the sole authority on price. The browser may tell us which
// country/postcode/quantity was entered, but never what it should cost.
//
// Get a live GBP quote for the UK partner and convert it to USD. Quantity
// matters because BookVault's available services depend on parcel weight.
// Never fall back to a flat rate or a stale FX rate: that was capable of
// undercharging UK fulfillment while presenting a plausible checkout total.
async function calculateTotal(countryCode, postalCode, quantity = 1) {
  const bookPriceCents = config.site.bookPriceCents;
  const bookSubtotalCents = bookPriceCents * quantity;
  const currency = config.site.currency;

  let shippingPriceCents;
  let serviceName = null;
  let serviceId = null;
  let minDeliveryDays = null;
  let maxDeliveryDays = null;
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
    });
    if (quote.currency !== 'GBP') throw new Error('BookVault shipping quote was not in GBP.');
    shippingPriceCents = await exchangeRateService.gbpToUsdCents(quote.shippingPriceCents);
    serviceName = quote.serviceName;
    serviceId = quote.serviceId;
    minDeliveryDays = quote.minDeliveryDays;
    maxDeliveryDays = quote.maxDeliveryDays;

    if (quantity > 1) {
      try {
        const baseline = await bookvaultService.getShippingQuote({
          countryCode,
          postalCode,
          quantity: 1,
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
    // A static fallback could undercharge a UK-fulfilled order by a large
    // amount. Fail closed until both the UK quote and FX rate are available.
    throw err;
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
    serviceId,
    minDeliveryDays,
    maxDeliveryDays,
    shippingUpgraded,
  };
}

function listRates() {
  return db.prepare('SELECT * FROM shipping_rates ORDER BY country_name').all();
}

module.exports = { calculateTotal, listRates };
