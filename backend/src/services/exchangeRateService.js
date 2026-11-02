// Convert the UK partner's GBP shipping cost to the storefront's USD charge.
// Frankfurter publishes daily central-bank reference rates, not a guaranteed
// card settlement rate. A missing/stale rate stops checkout rather than
// silently charging an invented or stale shipping amount.
const RATE_URL = 'https://api.frankfurter.dev/v2/rate/GBP/USD';
const CACHE_MS = 60 * 60 * 1000;
const MAX_RATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let cached = null;

async function gbpToUsdCents(gbpCents) {
  if (!Number.isSafeInteger(gbpCents) || gbpCents < 0) {
    throw new Error('Invalid GBP shipping amount.');
  }
  const rate = await latestGbpUsdRate();
  return Math.ceil(gbpCents * rate);
}

async function latestGbpUsdRate() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.rate;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RATE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`GBP/USD rate request failed (${response.status}).`);
    const data = await response.json();
    const rate = Number(data.rate);
    const publishedAt = Date.parse(`${data.date}T00:00:00Z`);
    if (data.base !== 'GBP' || data.quote !== 'USD' || !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(publishedAt) || publishedAt > Date.now() + 86400000 ||
        Date.now() - publishedAt > MAX_RATE_AGE_MS) {
      throw new Error('GBP/USD rate response is invalid or stale.');
    }
    cached = { rate, fetchedAt: Date.now() };
    return rate;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { gbpToUsdCents, latestGbpUsdRate };
