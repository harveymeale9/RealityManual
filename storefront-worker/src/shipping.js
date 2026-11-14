const UK_PARTNER_ID = 1;
const BOOK_PRICE_CENTS = 6500;
const PREFERRED_US_SERVICE = 'USPS Consolidator';
const RATE_URL = 'https://api.frankfurter.dev/v2/rate/GBP/USD';
const MAX_RATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function bookvaultQuote(env, countryCode, postalCode, quantity, fetcher) {
  if (!env.BOOKVAULT_API_KEY || !env.BOOKVAULT_TITLE_ISBN) {
    throw new Error('BookVault quote configuration is incomplete.');
  }
  const response = await fetcher(`${env.BOOKVAULT_API_BASE_URL || 'https://api.bookvault.app/v3'}/Dispatch`, {
    method: 'POST',
    headers: {
      authorization: `basic ${env.BOOKVAULT_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      OrderLines: [{ LineNumber: 1, ISBN: env.BOOKVAULT_TITLE_ISBN, Quantity: quantity }],
      CountryCode: countryCode,
      AreaCode: postalCode,
      ServiceLevel: 'NotSpecified',
      PartnerID: UK_PARTNER_ID,
      Currency: 'GBP',
      ShipmentDate: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`BookVault dispatch quote failed (${response.status}).`);
  const data = await response.json();
  if (Number(data?.PartnerID) !== UK_PARTNER_ID || !Array.isArray(data.Services) || !data.Services.length) {
    throw new Error('BookVault did not return UK partner shipping services.');
  }
  const valid = data.Services.filter((service) =>
    Number.isFinite(Number(service.DelTotal)) && Number(service.DelTotal) >= 0);
  if (!valid.length) throw new Error('BookVault returned no valid shipping prices.');
  const preferred = valid.find((service) => service.ServName === PREFERRED_US_SERVICE);
  const chosen = preferred || valid.reduce((min, service) =>
    Number(service.DelTotal) < Number(min.DelTotal) ? service : min, valid[0]);
  return {
    shippingPriceGbpCents: Math.round(Number(chosen.DelTotal) * 100),
    serviceName: chosen.ServName || null,
    serviceId: Number(chosen.ServID) || null,
    minDeliveryDays: Number(chosen.MinDeliveryDays) > 0 ? Number(chosen.MinDeliveryDays) : null,
    maxDeliveryDays: Number(chosen.MaxDeliveryDays) > 0 ? Number(chosen.MaxDeliveryDays) : null,
  };
}

async function gbpUsdRate(fetcher, now) {
  const response = await fetcher(RATE_URL, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`GBP/USD rate request failed (${response.status}).`);
  const data = await response.json();
  const rate = Number(data.rate);
  const publishedAt = Date.parse(`${data.date}T00:00:00Z`);
  if (data.base !== 'GBP' || data.quote !== 'USD' || !Number.isFinite(rate) || rate <= 0 ||
      !Number.isFinite(publishedAt) || publishedAt > now + 86400000 || now - publishedAt > MAX_RATE_AGE_MS) {
    throw new Error('GBP/USD rate response is invalid or stale.');
  }
  return rate;
}

export async function calculateTotal(env, countryCode, postalCode, quantity = 1, fetcher = fetch, now = Date.now()) {
  if (!/^[A-Z]{2}$/.test(countryCode) || !postalCode || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error('Invalid shipping destination or quantity.');
  }
  const quote = await bookvaultQuote(env, countryCode, postalCode, quantity, fetcher);
  const rate = await gbpUsdRate(fetcher, now);
  const shippingPriceCents = Math.ceil(quote.shippingPriceGbpCents * rate);
  let shippingUpgraded = false;
  if (quantity > 1) {
    try {
      const baseline = await bookvaultQuote(env, countryCode, postalCode, 1, fetcher);
      shippingUpgraded = Boolean(baseline.serviceName) && baseline.serviceName !== quote.serviceName;
    } catch {
      // Baseline is informational only; the authoritative quantity quote above succeeded.
    }
  }
  return {
    bookPriceCents: BOOK_PRICE_CENTS,
    bookSubtotalCents: BOOK_PRICE_CENTS * quantity,
    shippingPriceCents,
    totalPriceCents: BOOK_PRICE_CENTS * quantity + shippingPriceCents,
    currency: 'usd',
    quantity,
    serviceName: quote.serviceName,
    serviceId: quote.serviceId,
    minDeliveryDays: quote.minDeliveryDays,
    maxDeliveryDays: quote.maxDeliveryDays,
    shippingUpgraded,
  };
}
