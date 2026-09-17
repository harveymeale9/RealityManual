// BookVault API client.
//
// Docs: https://api.bookvault.app/v3/docs (ReDoc UI over the OpenAPI spec at
// https://api.bookvault.app/v3/swagger/docs/v3 — fetched directly since the
// ReDoc page itself renders client-side and isn't scrapeable). Researched
// 2026-09-17, see CLAUDE.md §64 for a summary of what's implemented here vs.
// what's still outstanding (order creation, fulfillment confirmation).
//
// Auth: `Authorization: basic <api key>` — a literal "basic " prefix on the
// raw key, NOT base64-encoded HTTP Basic auth, per
// https://help.bookvault.app/api-setup. BookVault has no sandbox — every
// call here hits their live API (see config.js and CLAUDE.md §26).

const config = require('../config');

const REQUEST_TIMEOUT_MS = 8000;

function authHeader() {
  return `basic ${config.bookvault.apiKey}`;
}

async function request(method, path, body) {
  if (!config.bookvault.apiKey) {
    throw new Error('BOOKVAULT_API_KEY is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.bookvault.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const message = (data && data.Message) || (typeof data === 'string' ? data : null) || `BookVault ${method} ${path} returned ${res.status}`;
      throw new Error(message);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Get a live shipping quote for one copy of the book to a given
// country/postcode. Returns { shippingPriceCents, currency, service } or
// throws — callers decide how to handle a failure (shippingService falls
// back to the static shipping_rates table).
//
// POST /Dispatch — "Loads all the available dispatch services based on the
// supplied data to give you the current prices". Requesting ServiceLevel
// "Cheapest" asks BookVault to do the picking; we still defensively take the
// lowest DelTotal from whatever Services[] comes back in case more than one
// is returned.
async function getShippingQuote({ countryCode, postalCode, quantity = 1, currency = 'USD' }) {
  if (!config.bookvault.titleIsbn) {
    throw new Error('BOOKVAULT_TITLE_ISBN is not configured.');
  }

  const body = {
    OrderLines: [
      {
        LineNumber: 1,
        ISBN: config.bookvault.titleIsbn,
        Quantity: quantity,
      },
    ],
    CountryCode: countryCode,
    AreaCode: postalCode,
    ServiceLevel: 'Cheapest',
    PartnerID: 0, // 0 = let BookVault choose the best print partner for this destination
    Currency: currency,
    ShipmentDate: new Date().toISOString(),
  };

  const data = await request('POST', '/Dispatch', body);
  const services = Array.isArray(data?.Services) ? data.Services : [];

  if (services.length === 0) {
    throw new Error(`BookVault returned no shipping services for ${countryCode}/${postalCode}.`);
  }

  const cheapest = services.reduce((min, s) => (s.DelTotal < min.DelTotal ? s : min), services[0]);

  return {
    shippingPriceCents: Math.round(cheapest.DelTotal * 100),
    currency,
    serviceName: cheapest.ServName || null,
  };
}

module.exports = { getShippingQuote };
