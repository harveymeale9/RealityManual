import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotal } from '../src/shipping.js';

const env = { BOOKVAULT_API_KEY: 'fixture-key', BOOKVAULT_TITLE_ISBN: '9780000000000' };
const now = Date.parse('2026-11-14T12:00:00Z');

function fixtureFetch({ services, fxDate = '2026-11-13', failQuote = false, failFx = false }) {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push({ url, options });
    if (url.endsWith('/Dispatch')) {
      if (failQuote) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ PartnerID: 1, Services: services(JSON.parse(options.body).OrderLines[0].Quantity) }) };
    }
    if (failFx) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ base: 'GBP', quote: 'USD', rate: 1.25, date: fxDate }) };
  };
  return { fetcher, seen };
}

test('matches live US preferred-service pricing and includes quantity', async () => {
  const { fetcher, seen } = fixtureFetch({ services: (quantity) => quantity === 1
    ? [
      { ServName: 'Fedex Priority', ServID: 2, DelTotal: 10 },
      { ServName: 'USPS Consolidator', ServID: 4, DelTotal: 12 },
    ]
    : [{ ServName: 'Fedex Priority', ServID: 2, DelTotal: 18 }] });
  const one = await calculateTotal(env, 'US', '10001', 1, fetcher, now);
  assert.equal(one.shippingPriceCents, 1500);
  assert.equal(one.serviceId, 4);
  const two = await calculateTotal(env, 'US', '10001', 2, fetcher, now);
  assert.equal(two.shippingPriceCents, 2250);
  assert.equal(two.totalPriceCents, 15250);
  assert.equal(two.shippingUpgraded, true);
  const dispatch = seen.filter((item) => item.url.endsWith('/Dispatch'));
  assert.equal(JSON.parse(dispatch[1].options.body).Currency, 'GBP');
  assert.equal(JSON.parse(dispatch[1].options.body).PartnerID, 1);
  assert.equal(JSON.parse(dispatch[1].options.body).OrderLines[0].Quantity, 2);
});

test('quote or FX failure closes checkout rather than inventing a price', async () => {
  const services = () => [{ ServName: 'Tracked', ServID: 8, DelTotal: 9.99 }];
  await assert.rejects(calculateTotal(env, 'GB', 'SW1A 1AA', 1,
    fixtureFetch({ services, failQuote: true }).fetcher, now), /BookVault/);
  await assert.rejects(calculateTotal(env, 'GB', 'SW1A 1AA', 1,
    fixtureFetch({ services, failFx: true }).fetcher, now), /rate request failed/);
  await assert.rejects(calculateTotal(env, 'GB', 'SW1A 1AA', 1,
    fixtureFetch({ services, fxDate: '2026-10-01' }).fetcher, now), /stale/);
});
