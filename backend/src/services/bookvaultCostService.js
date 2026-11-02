const orderService = require('./orderService');
const exchangeRateService = require('./exchangeRateService');

function poundsToCents(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('BookVault cost is missing or invalid.');
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('BookVault cost is missing or invalid.');
  return Math.round(amount * 100);
}

function extractBookVaultCost(data) {
  if (Number(data?.Partner?.ID) !== 1 ||
      String(data?.Partner?.CurrencyID || data?.Partner?.Currency).toUpperCase() !== 'GBP') {
    throw new Error('BookVault order cost is not from the UK GBP partner.');
  }
  const cost = data?.OrderCost;
  if (!cost) throw new Error('BookVault order cost is not available yet.');
  return {
    productionGbpCents: poundsToCents(cost.ProductionCost),
    shippingGbpCents: poundsToCents(cost.DispatchCost),
    totalGbpCents: poundsToCents(cost.GrandTotal),
  };
}

async function recordBookVaultCost(order, data, historicalRate) {
  const cost = extractBookVaultCost(data);
  if (order.bookvault_total_cost_gbp_cents === cost.totalGbpCents &&
      order.bookvault_production_cost_gbp_cents === cost.productionGbpCents &&
      order.bookvault_shipping_cost_gbp_cents === cost.shippingGbpCents &&
      Number.isSafeInteger(order.bookvault_total_cost_usd_cents)) return order;

  // Keep the original conversion rate for this order if BookVault later
  // adjusts its GBP cost; otherwise historical profit would drift with FX.
  const rate = Number(order.bookvault_gbp_usd_rate) > 0
    ? Number(order.bookvault_gbp_usd_rate)
    : Number.isFinite(historicalRate) && historicalRate > 0
      ? historicalRate : await exchangeRateService.latestGbpUsdRate();
  return orderService.setBookVaultCost(order.id, {
    ...cost, totalUsdCents: Math.ceil(cost.totalGbpCents * rate), gbpUsdRate: rate,
  });
}

module.exports = { extractBookVaultCost, recordBookVaultCost };
