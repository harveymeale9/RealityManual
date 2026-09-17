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

// Harvey's explicit instruction (2026-09-17): USPS Consolidator must always
// be used for US orders when BookVault offers it, not just "whatever happens
// to be cheapest" — verified by direct API testing that it's already the
// cheapest US option today (vs. Fedex Priority), but that's a coincidence of
// current pricing, not a guarantee, and it can disappear from the list
// entirely for a large enough order (its weight bracket tops out somewhere
// between qty 3 and qty 5 — see CLAUDE.md §66). Match by name rather than a
// hardcoded ServID since BookVault doesn't document ServID stability.
const PREFERRED_SERVICE_NAME = 'USPS Consolidator';

// Get a live shipping quote for the given quantity of books to a
// country/postcode. Returns { shippingPriceCents, currency, serviceName } or
// throws — callers decide how to handle a failure (shippingService falls
// back to the static shipping_rates table).
//
// POST /Dispatch — "Loads all the available dispatch services based on the
// supplied data to give you the current prices". ServiceLevel "NotSpecified"
// asks for every available service rather than letting BookVault pre-filter
// to just one, so PREFERRED_SERVICE_NAME can be matched by name against the
// full list; falls back to the lowest DelTotal if that service isn't offered
// for this destination/weight (e.g. every non-US destination, or a large
// enough order that USPS Consolidator's weight bracket is exceeded).
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
    ServiceLevel: 'NotSpecified',
    PartnerID: 0, // 0 = let BookVault choose the best print partner for this destination
    Currency: currency,
    ShipmentDate: new Date().toISOString(),
  };

  const data = await request('POST', '/Dispatch', body);
  const services = Array.isArray(data?.Services) ? data.Services : [];

  if (services.length === 0) {
    throw new Error(`BookVault returned no shipping services for ${countryCode}/${postalCode}.`);
  }

  const preferred = services.find((s) => s.ServName === PREFERRED_SERVICE_NAME);
  const chosen = preferred || services.reduce((min, s) => (s.DelTotal < min.DelTotal ? s : min), services[0]);

  return {
    shippingPriceCents: Math.round(chosen.DelTotal * 100),
    currency,
    serviceName: chosen.ServName || null,
  };
}

module.exports = { getShippingQuote };
