import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBookVaultCost, captureBookVaultCost } from '../src/bookvaultCost.js';

const data = {
  Partner: { ID: 1, CurrencyID: 'GBP' },
  OrderCost: { ProductionCost: 19.77, DispatchCost: 13.64, GrandTotal: 33.41 },
};

test('cost capture requires UK GBP costs and preserves original saved FX rate', async () => {
  assert.deepEqual(extractBookVaultCost(data), {
    productionGbpCents: 1977, shippingGbpCents: 1364, totalGbpCents: 3341,
  });
  assert.throws(() => extractBookVaultCost({ ...data, Partner: { ID: 2, CurrencyID: 'USD' } }), /UK GBP/);
  const updates = [];
  const db = { prepare: () => ({ bind: (...args) => ({ run: async () => updates.push(args) }) }) };
  await captureBookVaultCost(db, { id: 'order-1', bookvault_gbp_usd_rate: 1.25 }, data,
    () => { throw new Error('Must not fetch a later rate.'); });
  assert.equal(updates[0][3], 4177);
  assert.equal(updates[0][4], 1.25);
});
