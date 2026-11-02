// One-off, safe-to-repeat backfill for accepted orders predating profit
// capture. Only GETs existing BookVault orders; never places or charges one.
const db = require('../src/db');
const bookvaultService = require('../src/services/bookvaultService');
const bookvaultCostService = require('../src/services/bookvaultCostService');

async function historicalRateFor(order) {
  const day = String(order.created_at || '').slice(0, 10);
  if (day === new Date().toISOString().slice(0, 10)) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Order date is invalid.');
  const response = await fetch(`https://api.frankfurter.dev/v2/rate/GBP/USD?date=${day}`);
  if (!response.ok) throw new Error('Historical GBP/USD rate is unavailable.');
  const data = await response.json();
  const rate = Number(data.rate);
  if (data.base !== 'GBP' || data.quote !== 'USD' || !Number.isFinite(rate) || rate <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '')) || data.date > day) {
    throw new Error('Historical GBP/USD rate is invalid.');
  }
  return rate;
}

async function main() {
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE bookvault_order_id IS NOT NULL
      AND stripe_payment_status IN ('succeeded', 'paid')
      AND order_status != 'REFUNDED'
      AND bookvault_total_cost_usd_cents IS NULL
    ORDER BY created_at ASC
  `).all();
  let captured = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      const data = await bookvaultService.getOrder(order.bookvault_order_id);
      await bookvaultCostService.recordBookVaultCost(order, data, await historicalRateFor(order));
      captured += 1;
      console.log(`Captured BookVault cost for order ${order.id.slice(0, 8)}.`);
    } catch (err) {
      failed += 1;
      console.error(`BookVault cost unavailable for order ${order.id.slice(0, 8)}: ${err.message}`);
    }
  }
  console.log(`BookVault cost backfill: ${captured} captured, ${failed} pending.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
