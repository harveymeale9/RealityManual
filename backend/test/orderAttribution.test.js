const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-order-attribution-'));
process.env.DATABASE_PATH = path.join(scratch, 'orders.db');
const db = require('../src/db');
const orders = require('../src/services/orderService');

test.after(() => { db.close(); fs.rmSync(scratch, { recursive: true, force: true }); });

test('checkout attribution survives landing-to-checkout navigation and a second tagged click', () => {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/analytics.js'), 'utf8');
  function visit(url, referrer) {
    const location = new URL(url);
    const window = {
      RM_CONFIG: { API_BASE_URL: '' }, location,
      crypto: { randomUUID: () => 'browser-id' },
      addEventListener() {}, setTimeout() {},
      history: { replaceState() {} },
    };
    vm.runInNewContext(source, { window, document: { referrer }, localStorage,
      URL, URLSearchParams, Date, Math, JSON, fetch() {} });
    return window.RMAnalytics.getCheckoutAttribution();
  }
  visit('https://realitymanual.com/?utm_source=instagram&utm_medium=bio', 'https://instagram.com/profile');
  visit('https://realitymanual.com/?utm_source=youtube&utm_medium=video&utm_campaign=longform&utm_content=235', 'https://youtube.com/watch?v=abc');
  const attribution = visit('https://realitymanual.com/checkout.html', 'https://realitymanual.com/');
  assert.equal(attribution.first.utm_source, 'instagram');
  assert.equal(attribution.last_tagged.utm_source, 'youtube');
  assert.equal(attribution.last_tagged.utm_campaign, 'longform');
  assert.equal(attribution.last_tagged.utm_content, '235');
  assert.equal(attribution.last_tagged.captured_at.length > 10, true);
});

test('order persists sanitized first and latest tagged source without full referrer URL', () => {
  const order = orders.createOrder({
    customer_name: 'Test Customer', email: 'test@example.invalid', phone: '+1234567890',
    country_code: 'US', street1: '1 Test St', city: 'New York', postal_code: '10001',
    quantity: 1, bookPriceCents: 6500, shippingPriceCents: 1000,
    totalPriceCents: 7500, currency: 'usd',
    attribution: { first: { utm_source: 'instagram', referrer: 'https://instagram.com/path?email=private@example.com' },
      last_tagged: { utm_source: 'youtube', utm_medium: 'video', utm_campaign: 'longform',
        utm_content: '235', referrer: 'https://youtube.com/watch?secret=private' } },
  });
  const stored = JSON.parse(order.attribution_json);
  assert.equal(stored.first.source, 'instagram');
  assert.equal(stored.first.referrer_host, 'instagram.com');
  assert.equal(stored.last_tagged.source, 'youtube');
  assert.equal(stored.last_tagged.campaign, 'longform');
  assert.equal(stored.last_tagged.content, '235');
  assert.equal(order.attribution_json.includes('private'), false);
});
