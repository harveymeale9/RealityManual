import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { aggregateCompletedDays, alertCheckoutErrors, getSummary, recordEvent } from '../src/analytics.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/src/db/schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const make = (args) => ({
        first: async () => statement.get(...args) || null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      });
      return { ...make([]), bind: (...args) => make(args) };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, env: { DB: db, CORS_ORIGIN: 'https://realitymanual.com' } };
}

test('only verified site browser events enter analytics, then roll into anonymous daily totals', async () => {
  const { sqlite, env } = fixture();
  const event = {
    session_id: 'visitor-1', event_name: 'page_view', page: '/', utm_source: 'youtube',
    human_verified: true, human_verification: 'interaction',
  };
  const request = (origin, agent) => new Request('https://api.example.test/api/analytics/event', {
    method: 'POST', headers: { origin, 'user-agent': agent, 'sec-fetch-site': 'same-site' },
    body: JSON.stringify(event),
  });
  assert.equal((await recordEvent(request('https://evil.test', 'Mozilla/5.0'), env)).status, 204);
  assert.equal((await recordEvent(request('https://realitymanual.com', 'curl/8'), env)).status, 204);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 0);
  assert.equal((await recordEvent(request('https://realitymanual.com', 'Mozilla/5.0'), env)).status, 204);
  const before = await getSummary(env);
  assert.equal((await before.json()).today.page_views, 1);
  sqlite.prepare("UPDATE analytics_events SET created_at = '2026-11-13T12:00:00.000Z'").run();
  await aggregateCompletedDays(env, new Date('2026-11-14T12:00:00.000Z'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 0);
  assert.equal(sqlite.prepare('SELECT verified_visits FROM analytics_daily_utm_sources').get().verified_visits, 1);
  const after = await getSummary(env, new Date('2026-11-14T12:00:00.000Z'));
  assert.equal((await after.json()).last_30_days.page_views, 1);
  sqlite.close();
});

test('checkout form errors retain only a safe code/country and trigger a deduplicated owner alert', async () => {
  const { sqlite, env } = fixture();
  const event = {
    session_id: 'shopper-1', event_name: 'checkout_form_error', page: '/checkout.html',
    country: 'AU', error_code: 'shipping_quote_missing',
    human_verified: true, human_verification: 'interaction',
    email: 'must-not-be-stored@example.test', postal_code: '2000',
  };
  const request = (body) => new Request('https://api.example.test/api/analytics/event', {
    method: 'POST', headers: { origin: 'https://realitymanual.com',
      'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-site' },
    body: JSON.stringify(body),
  });
  assert.equal((await recordEvent(request(event), env)).status, 204);
  assert.equal((await recordEvent(request({ ...event, error_code: 'arbitrary private text' }), env)).status, 400);
  assert.equal((await recordEvent(request({ ...event, event_name: 'checkout_quote_state', error_code: 'stale_retry' }), env)).status, 204);
  assert.equal((await recordEvent(request({ ...event, event_name: 'checkout_quote_state', error_code: 'raw_postcode_2000' }), env)).status, 400);
  const stored = sqlite.prepare("SELECT event_name,country,classification_reason FROM analytics_events").get();
  assert.deepEqual({ ...stored }, { event_name: 'checkout_form_error', country: 'AU', classification_reason: 'shipping_quote_missing' });
  const summary = await (await getSummary(env)).json();
  assert.equal(summary.checkout_errors_24h[0].count, 1);
  assert.equal(summary.checkout_quote_states_24h[0].state, 'stale_retry');
  env.RESEND_API_KEY = 'test-key';
  env.RESEND_FROM_EMAIL = 'orders@example.test';
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ id: 'message-1' });
  };
  try {
    assert.equal(await alertCheckoutErrors(env), true);
    assert.equal(await alertCheckoutErrors(env), false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /shipping_quote_missing/);
    assert.doesNotMatch(sent[0].text, /must-not-be-stored|2000/);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test('checkout diagnostics keep fixed failure stages and link uncertain payments to current order status', async () => {
  const { sqlite, env } = fixture();
  const orderId = '12345678-1234-4234-8234-123456789abc';
  sqlite.prepare(`INSERT INTO orders(id,customer_name,email,phone,country,street1,city,postal_code,
    book_price_cents,shipping_price_cents,total_price_cents,order_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderId, 'Private Name', 'private@example.test', '555',
    'US', 'Private Street', 'New York', '10001', 6500, 1800, 8300, 'BOOKVAULT_ACCEPTED');
  const sendEvent = (body) => recordEvent(new Request('https://api.example.test/api/analytics/event', {
    method: 'POST', headers: { origin: 'https://realitymanual.com',
      'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-site' },
    body: JSON.stringify({ session_id: 'shopper-2', event_name: 'checkout_form_error', page: '/checkout.html',
      human_verified: true, human_verification: 'interaction', ...body }),
  }), env);
  assert.equal((await sendEvent({ error_code: 'payment_config_error:config_request' })).status, 204);
  assert.equal((await sendEvent({ error_code: 'payment_uncertain:confirm_timeout', country: 'US', order_id: orderId })).status, 204);
  assert.equal((await sendEvent({ error_code: 'payment_uncertain:card_number_1234', order_id: orderId })).status, 400);
  const stored = sqlite.prepare("SELECT classification_reason,order_id FROM analytics_events WHERE classification_reason LIKE 'payment_uncertain:%'").get();
  assert.equal(stored.classification_reason, 'payment_uncertain:confirm_timeout');
  assert.equal(stored.order_id, orderId);
  env.RESEND_API_KEY = 'test-key';
  env.RESEND_FROM_EMAIL = 'orders@example.test';
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ id: 'message-2' });
  };
  try {
    assert.equal(await alertCheckoutErrors(env), true);
    assert.match(sent[0].text, /payment_config_error:config_request/);
    assert.match(sent[0].text, /payment_uncertain:confirm_timeout/);
    assert.match(sent[0].text, /order 12345678 · current status BOOKVAULT_ACCEPTED/);
    assert.doesNotMatch(sent[0].text, /Private Name|private@example\.test|Private Street|10001/);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});
