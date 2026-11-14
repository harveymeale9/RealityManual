import { gbpUsdRate } from './shipping.js';

function poundsToCents(value) {
  if (value === null || value === undefined || value === '') throw new Error('BookVault cost is missing.');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('BookVault cost is invalid.');
  return Math.round(amount * 100);
}

export function extractBookVaultCost(data) {
  if (Number(data?.Partner?.ID) !== 1 ||
      String(data?.Partner?.CurrencyID || data?.Partner?.Currency).toUpperCase() !== 'GBP') {
    throw new Error('BookVault order cost is not from the UK GBP partner.');
  }
  if (!data?.OrderCost) throw new Error('BookVault cost is not available yet.');
  return {
    productionGbpCents: poundsToCents(data.OrderCost.ProductionCost),
    shippingGbpCents: poundsToCents(data.OrderCost.DispatchCost),
    totalGbpCents: poundsToCents(data.OrderCost.GrandTotal),
  };
}

export async function captureBookVaultCost(db, order, data, rate = gbpUsdRate) {
  const cost = extractBookVaultCost(data);
  if (order.bookvault_total_cost_gbp_cents === cost.totalGbpCents &&
      order.bookvault_production_cost_gbp_cents === cost.productionGbpCents &&
      order.bookvault_shipping_cost_gbp_cents === cost.shippingGbpCents &&
      Number.isSafeInteger(order.bookvault_total_cost_usd_cents)) return false;
  const gbpUsd = Number(order.bookvault_gbp_usd_rate) > 0
    ? Number(order.bookvault_gbp_usd_rate) : await rate(fetch, Date.now());
  await db.prepare(`UPDATE orders SET bookvault_production_cost_gbp_cents = ?,
    bookvault_shipping_cost_gbp_cents = ?, bookvault_total_cost_gbp_cents = ?,
    bookvault_total_cost_usd_cents = ?, bookvault_gbp_usd_rate = ?,
    bookvault_cost_recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ? AND bookvault_order_id IS NOT NULL`).bind(
    cost.productionGbpCents, cost.shippingGbpCents, cost.totalGbpCents,
    Math.ceil(cost.totalGbpCents * gbpUsd), gbpUsd, order.id,
  ).run();
  return true;
}
