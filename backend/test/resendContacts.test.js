const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PURCHASER_PROPERTIES,
  PURCHASER_SEGMENT_NAME,
  createResendClient,
  quantityBand,
} = require('../src/services/resendService');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('quantity bands preserve useful one-through-four and five-plus cohorts', () => {
  assert.equal(quantityBand(1), '1_book');
  assert.equal(quantityBand(2), '2_books');
  assert.equal(quantityBand(4), '4_books');
  assert.equal(quantityBand(5), '5_plus_books');
  assert.equal(quantityBand(20), '5_plus_books');
});

test('a first purchase provisions Resend fields and creates one segmented contact', async () => {
  const requests = [];
  const client = createResendClient({
    apiKey: 're_test_key',
    fromEmail: 'orders@example.com',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ path, method, body });
      if (path === '/contact-properties' && method === 'GET') return response(200, { data: [] });
      if (path === '/segments' && method === 'GET') {
        return response(200, { data: [{ id: 'general', name: 'General' }] });
      }
      if (path === '/contact-properties' && method === 'POST') {
        return response(201, { id: `property_${body.key}` });
      }
      if (path === '/segments' && method === 'POST') return response(201, { id: 'customers' });
      if (path === '/contacts/ava%40example.com' && method === 'GET') {
        return response(404, { message: 'Contact not found' });
      }
      if (path === '/contacts' && method === 'POST') return response(201, { id: 'contact_1' });
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  });

  const result = await client.syncPurchaserContact({
    customer_name: 'Ava Reader',
    email: 'AVA@example.com',
    quantity: 5,
  }, {
    purchase_order_count: 2,
    lifetime_book_quantity: 6,
    largest_order_quantity: 5,
    first_purchase_at: '2026-10-01T12:00:00.000Z',
    latest_purchase_at: '2026-10-05T12:00:00.000Z',
  });

  assert.equal(result.created, true);
  const propertyCreates = requests.filter((item) => item.path === '/contact-properties' && item.method === 'POST');
  assert.deepEqual(propertyCreates.map((item) => item.body), PURCHASER_PROPERTIES);
  assert.deepEqual(
    requests.find((item) => item.path === '/segments' && item.method === 'POST').body,
    { name: PURCHASER_SEGMENT_NAME },
  );
  const contact = requests.find((item) => item.path === '/contacts' && item.method === 'POST').body;
  assert.equal(contact.email, 'ava@example.com');
  assert.equal(contact.first_name, 'Ava');
  assert.equal(contact.last_name, 'Reader');
  assert.equal(contact.unsubscribed, false);
  assert.deepEqual(contact.segments, [{ id: 'customers' }]);
  assert.deepEqual(contact.properties, {
    customer_status: 'purchaser',
    products_purchased: 'reality_manual_hardcover',
    last_order_quantity: 5,
    largest_order_quantity: 5,
    lifetime_book_quantity: 6,
    purchase_order_count: 2,
    quantity_band: '5_plus_books',
    first_purchase_at: '2026-10-01T12:00:00.000Z',
    latest_purchase_at: '2026-10-05T12:00:00.000Z',
  });
});

test('a repeat purchase updates the same contact without reversing an unsubscribe', async () => {
  const requests = [];
  const client = createResendClient({
    apiKey: 're_test_key',
    fromEmail: 'orders@example.com',
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      const path = parsed.pathname;
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ path, method, body });
      if (path === '/contact-properties' && method === 'GET') {
        return response(200, { data: PURCHASER_PROPERTIES });
      }
      if (path === '/segments' && method === 'GET') {
        return response(200, { data: [{ id: 'customers', name: PURCHASER_SEGMENT_NAME }] });
      }
      if (path === '/contacts/ava%40example.com' && method === 'GET') {
        return response(200, { id: 'contact_1', email: 'ava@example.com', unsubscribed: true });
      }
      if (path === '/contacts/ava%40example.com' && method === 'PATCH') {
        return response(200, { id: 'contact_1' });
      }
      if (path === '/contacts/ava%40example.com/segments/customers' && method === 'POST') {
        return response(200, { id: 'contact_1' });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  });

  const result = await client.syncPurchaserContact({
    customer_name: 'Ava Reader',
    email: 'ava@example.com',
    quantity: 1,
  }, {
    purchase_order_count: 3,
    lifetime_book_quantity: 7,
    largest_order_quantity: 5,
    first_purchase_at: '2026-10-01T12:00:00.000Z',
    latest_purchase_at: '2026-10-05T13:00:00.000Z',
  });

  assert.equal(result.created, false);
  const update = requests.find((item) => item.method === 'PATCH');
  assert.equal(Object.hasOwn(update.body, 'unsubscribed'), false);
  assert.equal(update.body.properties.last_order_quantity, 1);
  assert.equal(update.body.properties.quantity_band, '5_plus_books');
  assert.ok(requests.some((item) => item.path.endsWith('/segments/customers')));
});
